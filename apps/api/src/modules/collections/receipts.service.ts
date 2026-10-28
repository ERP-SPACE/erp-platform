import type {
  AllocationSuggestion,
  OpenItemsResponse,
  ReceiptDetail,
  ReceiptListItem,
  applyCredit,
  moneyListQuery,
  receiptCreate,
  receiptReverse,
} from "@erp/contracts";
import {
  type Tx,
  allocations,
  customerNotes,
  customers,
  purchaseInvoices,
  purchaseReturns,
  receipts,
  salesInvoices,
  suppliers,
} from "@erp/db";
import { D, checkAllocation, istToday, receiptMachine, suggestAllocation, sum } from "@erp/domain";
import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { z } from "zod";
import { actor, ctx } from "../../common/context.js";
import {
  approvalRequired,
  notFound,
  reasonRequired,
  validationError,
} from "../../common/errors.js";
import { recordTransition, writePostingEvent } from "../../db/ledger.js";
import { UnitOfWork } from "../../db/unit-of-work.js";
import { updateVersioned } from "../../db/versioning.js";
import { customerScopeFilter, loadCustomerScope } from "../customers/customer-scope.js";
import { EventBus } from "../realtime/event-bus.js";
import { CreditRecheckQueue } from "../sales/credit-recheck.queue.js";
import type { Db } from "../sales/sales-common.js";
import { SeriesService } from "../series/series.service.js";
import { SettingsService } from "../settings/settings.service.js";
import { CommissionService } from "./commission.service.js";
import {
  type OpenDoc,
  openPurchaseInvoices,
  openSalesInvoices,
  unusedCredits,
} from "./outstanding.js";

export type PartyType = "CUSTOMER" | "SUPPLIER";
type Input = z.infer<typeof receiptCreate>;
type Row = typeof receipts.$inferSelect;

const LABEL = { CUSTOMER: "Receipt", SUPPLIER: "Payment" } as const;
const SERIES = { CUSTOMER: "RC", SUPPLIER: "PY" } as const;

/**
 * Customer receipts (RC/…) and supplier payments (PY/…), PRD §8: money in or out, allocated to
 * specific invoices (oldest-first suggestion), the rest on account. Posting freezes them; a
 * bounce or mistake reverses them with a reason, undoing allocations and their commission.
 * Customer data follows the actor's customer scope (CLAUDE.md rule 10).
 */
@Injectable()
export class ReceiptsService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly bus: EventBus,
    private readonly series: SeriesService,
    private readonly settings: SettingsService,
    private readonly commission: CommissionService,
    private readonly creditRecheck: CreditRecheckQueue,
  ) {}

  // ── parties ────────────────────────────────────────────────────────────────

  /** The party (scope-checked for customers) and its display name. */
  private async party(db: Db, type: PartyType, id: string) {
    if (type === "CUSTOMER") {
      const scope = await loadCustomerScope(db);
      const [c] = await db
        .select({ id: customers.id, name: customers.legalName, gstin: customers.gstin })
        .from(customers)
        .where(and(eq(customers.id, id), customerScopeFilter(scope)));
      if (!c) throw notFound("Customer");
      return c;
    }
    const [s] = await db
      .select({ id: suppliers.id, name: suppliers.name, gstin: suppliers.gstin })
      .from(suppliers)
      .where(and(eq(suppliers.id, id), eq(suppliers.companyId, actor().companyId)));
    if (!s) throw notFound("Supplier");
    return s;
  }

  private openInvoices(db: Db, type: PartyType, partyId: string, lock = false): Promise<OpenDoc[]> {
    return type === "CUSTOMER"
      ? openSalesInvoices(db, partyId, lock)
      : openPurchaseInvoices(db, partyId, lock);
  }

  async openItems(type: PartyType, partyId: string): Promise<OpenItemsResponse> {
    await this.party(this.uow.db, type, partyId);
    const today = istToday();
    const days = (from: string) =>
      Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
    const invoices = await this.openInvoices(this.uow.db, type, partyId);
    const credits = await unusedCredits(this.uow.db, type, partyId);
    return {
      invoices: invoices.map((i) => ({
        id: i.id,
        docNo: i.doc_no,
        date: i.date,
        dueDate: i.due_date,
        total: D(i.total).toFixed(2),
        outstanding: D(i.outstanding).toFixed(2),
        daysPastDue: Math.max(0, days(i.due_date)),
      })),
      credits: credits.map((c) => ({
        source: c.source,
        id: c.id,
        docNo: c.doc_no,
        date: c.date,
        available: D(c.available).toFixed(2),
      })),
    };
  }

  async suggest(type: PartyType, partyId: string, amount: string): Promise<AllocationSuggestion> {
    await this.party(this.uow.db, type, partyId);
    const fifo = await this.settings.value("collections.suggestFifo");
    const invoices = await this.openInvoices(this.uow.db, type, partyId);
    const s = fifo
      ? suggestAllocation(
          amount,
          invoices.map((i) => ({
            id: i.id,
            date: i.date,
            dueDate: i.due_date,
            outstanding: i.outstanding,
          })),
        )
      : { lines: [], unallocated: D(amount) };
    return {
      lines: s.lines.map((l) => ({ invoiceId: l.invoiceId, amount: l.amount.toFixed(2) })),
      unallocated: s.unallocated.toFixed(2),
    };
  }

  // ── list & detail ──────────────────────────────────────────────────────────

  async list(type: PartyType, query: z.infer<typeof moneyListQuery>): Promise<ReceiptListItem[]> {
    const where = [eq(receipts.companyId, actor().companyId), eq(receipts.partyType, type)];
    if (query.status) where.push(eq(receipts.status, query.status as Row["status"]));
    if (query.from) where.push(gte(receipts.date, query.from));
    if (query.to) where.push(lte(receipts.date, query.to));
    if (query.partyId) {
      where.push(
        eq(type === "CUSTOMER" ? receipts.customerId : receipts.supplierId, query.partyId),
      );
    }
    const allocated = sql<string>`coalesce((SELECT sum(a.amount) FROM allocations a
      WHERE a.receipt_id = ${receipts.id} AND a.reversed_at IS NULL), 0)::text`;
    if (query.onAccount === "true") {
      where.push(eq(receipts.status, "Posted"), sql`${receipts.amount} > ${allocated}::numeric`);
    }
    const rows =
      type === "CUSTOMER"
        ? await (async () => {
            const scope = await loadCustomerScope(this.uow.db);
            if (query.q) {
              const q = `%${query.q}%`;
              where.push(
                or(
                  ilike(receipts.docNo, q),
                  ilike(customers.legalName, q),
                  ilike(receipts.reference, q),
                )!,
              );
            }
            return this.uow.db
              .select({ r: receipts, name: customers.legalName, allocated })
              .from(receipts)
              .innerJoin(customers, eq(customers.id, receipts.customerId))
              .where(and(...where, customerScopeFilter(scope)))
              .orderBy(desc(receipts.date), desc(receipts.createdAt))
              .limit(500);
          })()
        : await (async () => {
            if (query.q) {
              const q = `%${query.q}%`;
              where.push(
                or(
                  ilike(receipts.docNo, q),
                  ilike(suppliers.name, q),
                  ilike(receipts.reference, q),
                )!,
              );
            }
            return this.uow.db
              .select({ r: receipts, name: suppliers.name, allocated })
              .from(receipts)
              .innerJoin(suppliers, eq(suppliers.id, receipts.supplierId))
              .where(and(...where))
              .orderBy(desc(receipts.date), desc(receipts.createdAt))
              .limit(500);
          })();
    return rows.map((x) => this.toItem(x.r, x.name, x.allocated));
  }

  private toItem(r: Row, partyName: string, allocated: string): ReceiptListItem {
    const posted = r.status === "Posted";
    return {
      id: r.id,
      docNo: r.docNo,
      partyType: r.partyType,
      date: r.date,
      partyId: (r.customerId ?? r.supplierId)!,
      partyName,
      mode: r.mode,
      reference: r.reference,
      amount: D(r.amount).toFixed(2),
      allocated: D(posted ? allocated : 0).toFixed(2),
      unallocated: posted ? D(r.amount).minus(allocated).toFixed(2) : "0.00",
      status: r.status,
      version: r.version,
    };
  }

  async get(type: PartyType, id: string): Promise<ReceiptDetail> {
    const r = await this.find(this.uow.db, type, id);
    const party = await this.party(this.uow.db, type, (r.customerId ?? r.supplierId)!);
    const allocs =
      r.status === "Draft" || r.status === "Cancelled"
        ? []
        : await this.uow.db
            .select({
              a: allocations,
              docNo: sql<string>`coalesce(${salesInvoices.siNo}, ${purchaseInvoices.supplierInvoiceNo}, ${purchaseInvoices.piNo})`,
              docDate: sql<string>`coalesce(${salesInvoices.date}, ${purchaseInvoices.supplierInvoiceDate})::text`,
            })
            .from(allocations)
            .leftJoin(salesInvoices, eq(salesInvoices.id, allocations.salesInvoiceId))
            .leftJoin(purchaseInvoices, eq(purchaseInvoices.id, allocations.purchaseInvoiceId))
            .where(eq(allocations.receiptId, id))
            .orderBy(asc(allocations.createdAt));
    const drafts = (r.status === "Draft" ? (r.draftAllocations as Input["allocations"]) : []) ?? [];
    const live = allocs.filter((x) => !x.a.reversedAt);
    const allocated =
      r.status === "Reversed"
        ? sum(allocs.map((x) => x.a.amount))
        : sum(live.map((x) => x.a.amount));
    return {
      ...this.toItem(r, party.name, allocated.toFixed(2)),
      bankName: r.bankName,
      instrumentDate: r.instrumentDate,
      notes: r.notes,
      allocations: [
        ...allocs.map((x) => ({
          id: x.a.id,
          invoiceId: (x.a.salesInvoiceId ?? x.a.purchaseInvoiceId)!,
          invoiceNo: x.docNo,
          invoiceDate: x.docDate,
          amount: D(x.a.amount).toFixed(2),
          deduction: D(x.a.deduction).toFixed(2),
          reversedAt: x.a.reversedAt?.toISOString() ?? null,
        })),
        ...(await this.describeDrafts(type, drafts)),
      ],
      postedAt: r.postedAt?.toISOString() ?? null,
      reversedAt: r.reversedAt?.toISOString() ?? null,
      reversalKind: r.reversalKind,
      reversalReason: r.reversalReason,
    };
  }

  private async describeDrafts(type: PartyType, lines: Input["allocations"]) {
    if (!lines.length) return [];
    const ids = lines.map((l) => l.invoiceId);
    const docs =
      type === "CUSTOMER"
        ? await this.uow.db
            .select({ id: salesInvoices.id, no: salesInvoices.siNo, date: salesInvoices.date })
            .from(salesInvoices)
            .where(inArray(salesInvoices.id, ids))
        : await this.uow.db
            .select({
              id: purchaseInvoices.id,
              no: purchaseInvoices.supplierInvoiceNo,
              date: purchaseInvoices.supplierInvoiceDate,
            })
            .from(purchaseInvoices)
            .where(inArray(purchaseInvoices.id, ids));
    return lines.map((l, i) => {
      const d = docs.find((x) => x.id === l.invoiceId);
      return {
        id: `draft-${i}`,
        invoiceId: l.invoiceId,
        invoiceNo: d?.no ?? "—",
        invoiceDate: d?.date ?? "",
        amount: D(l.amount).toFixed(2),
        deduction: D(l.deduction ?? 0).toFixed(2),
        reversedAt: null,
      };
    });
  }

  private async find(db: Db, type: PartyType, id: string, lock = false): Promise<Row> {
    const q = db
      .select()
      .from(receipts)
      .where(
        and(
          eq(receipts.id, id),
          eq(receipts.companyId, actor().companyId),
          eq(receipts.partyType, type),
        ),
      );
    const [r] = lock ? await q.for("update") : await q;
    if (!r) throw notFound(LABEL[type]);
    await this.party(db, type, (r.customerId ?? r.supplierId)!); // scope check
    return r;
  }

  // ── drafts ─────────────────────────────────────────────────────────────────

  private fields(type: PartyType, dto: Input) {
    return {
      customerId: type === "CUSTOMER" ? dto.partyId : null,
      supplierId: type === "SUPPLIER" ? dto.partyId : null,
      date: dto.date,
      mode: dto.mode,
      amount: D(dto.amount).toFixed(2),
      reference: dto.reference?.trim() || null,
      bankName: dto.bankName ?? null,
      instrumentDate: dto.instrumentDate ?? null,
      notes: dto.notes ?? null,
      draftAllocations: dto.allocations,
    };
  }

  async create(type: PartyType, dto: Input): Promise<ReceiptDetail> {
    const id = await this.uow.run(async (tx) => {
      await this.party(tx, type, dto.partyId);
      const [r] = await tx
        .insert(receipts)
        .values({
          companyId: actor().companyId,
          branchId: actor().branchId,
          partyType: type,
          ...this.fields(type, dto),
          createdBy: actor().userId,
          updatedBy: actor().userId,
        })
        .returning();
      await recordTransition(tx, LABEL[type], r!.id, null, "Draft");
      this.changed(r!.id);
      return r!.id;
    });
    return this.get(type, id);
  }

  async update(
    type: PartyType,
    id: string,
    dto: Input & { version: number },
  ): Promise<ReceiptDetail> {
    await this.uow.run(async (tx) => {
      const r = await this.find(tx, type, id, true);
      if (r.status !== "Draft")
        throw validationError(
          `A posted ${LABEL[type].toLowerCase()} can't be edited. Reverse it instead.`,
        );
      await this.party(tx, type, dto.partyId);
      await updateVersioned(
        tx,
        receipts,
        eq(receipts.id, id),
        dto.version,
        this.fields(type, dto),
        LABEL[type],
      );
      this.changed(id);
    });
    return this.get(type, id);
  }

  async cancel(type: PartyType, id: string, version: number): Promise<ReceiptDetail> {
    await this.uow.run(async (tx) => {
      const r = await this.find(tx, type, id, true);
      receiptMachine.assert(r.status, "Cancelled");
      await updateVersioned(
        tx,
        receipts,
        eq(receipts.id, id),
        version,
        { status: "Cancelled" },
        LABEL[type],
      );
      await recordTransition(tx, LABEL[type], id, "Draft", "Cancelled");
      this.changed(id);
    });
    return this.get(type, id);
  }

  // ── posting ────────────────────────────────────────────────────────────────

  /**
   * Post: number it, check and write the allocations against what each invoice owes now (rows
   * locked), accrue ON_PAYMENT_RECEIVED commission, write the posting event, and re-check held
   * orders. Supplier payments above the threshold need `payables.payment.approve` (Q33).
   */
  async post(type: PartyType, id: string, version: number): Promise<ReceiptDetail> {
    await this.uow.run(async (tx) => {
      const r = await this.find(tx, type, id, true);
      receiptMachine.assert(r.status, "Posted");
      const partyId = (r.customerId ?? r.supplierId)!;
      let approved = false;
      if (type === "SUPPLIER") {
        const threshold = await this.settings.value("payables.approvalThresholdInr");
        if (D(r.amount).greaterThan(threshold)) {
          if (!actor().permissions.has("payables.payment.approve")) {
            throw approvalRequired(
              `Payments above ₹${threshold.toLocaleString("en-IN")} need the Owner's approval.`,
              [{ path: "amount", message: "Ask the Owner to post this payment" }],
            );
          }
          approved = true;
        }
      }
      const lines = (r.draftAllocations as Input["allocations"] | null) ?? [];
      const open = await this.openInvoices(tx, type, partyId, true);
      const owed = new Map(open.map((o) => [o.id, o.outstanding]));
      const problems = checkAllocation(r.amount, lines, owed);
      if (problems.length) {
        throw validationError(
          "The allocation doesn't fit what the invoices owe now.",
          problems.map((message, i) => ({ path: `allocations.${i}`, message })),
        );
      }
      const docNo = await this.series.allocate(tx, SERIES[type], r.date);
      for (const l of lines) {
        await tx.insert(allocations).values({
          companyId: actor().companyId,
          source: type === "CUSTOMER" ? "RECEIPT" : "PAYMENT",
          receiptId: r.id,
          salesInvoiceId: type === "CUSTOMER" ? l.invoiceId : null,
          purchaseInvoiceId: type === "SUPPLIER" ? l.invoiceId : null,
          date: r.date,
          amount: D(l.amount).toFixed(2),
          deduction: D(l.deduction ?? 0).toFixed(2),
          createdBy: actor().userId,
        });
        if (type === "CUSTOMER") {
          const before = await this.moneySettled(tx, l.invoiceId, r.id);
          const after = D(before)
            .plus(l.amount)
            .plus(l.deduction ?? 0)
            .toFixed(2);
          await this.commission.onSettlement(
            tx,
            l.invoiceId,
            { id: r.id, docNo, date: r.date },
            before,
            after,
          );
        }
      }
      await updateVersioned(
        tx,
        receipts,
        eq(receipts.id, id),
        version,
        {
          status: "Posted",
          docNo,
          draftAllocations: null,
          postedAt: new Date(),
          postedBy: actor().userId,
          ...(approved ? { approvedAt: new Date(), approvedBy: actor().userId } : {}),
        },
        LABEL[type],
      );
      await recordTransition(tx, LABEL[type], id, "Draft", "Posted");
      const allocated = sum(lines.map((l) => l.amount));
      await writePostingEvent(tx, {
        type: type === "CUSTOMER" ? "RECEIPT_POSTED" : "PAYMENT_POSTED",
        docType: SERIES[type],
        docId: id,
        docNo,
        docDate: r.date,
        partyType: type,
        partyId,
        payload: {
          docNo,
          date: r.date,
          mode: r.mode,
          reference: r.reference,
          amount: D(r.amount).toFixed(2),
          allocated: allocated.toFixed(2),
          onAccount: D(r.amount).minus(allocated).toFixed(2),
          allocations: lines.map((l) => ({
            invoiceId: l.invoiceId,
            amount: D(l.amount).toFixed(2),
            deduction: D(l.deduction ?? 0).toFixed(2),
          })),
          approvedBy: approved ? actor().userId : null,
        },
      });
      if (type === "CUSTOMER") this.creditRecheck.enqueueAfterCommit(partyId);
      this.changed(id);
    });
    return this.get(type, id);
  }

  /** Money (and TDS) settled on a sales invoice by receipts, excluding one receipt. */
  private async moneySettled(
    tx: Tx,
    siId: string,
    exceptReceiptId: string | null,
  ): Promise<string> {
    const [r] = await tx
      .select({
        v: sql<string>`coalesce(sum(${allocations.amount} + ${allocations.deduction}), 0)::text`,
      })
      .from(allocations)
      .where(
        and(
          eq(allocations.salesInvoiceId, siId),
          eq(allocations.source, "RECEIPT"),
          isNull(allocations.reversedAt),
          exceptReceiptId ? sql`${allocations.receiptId} <> ${exceptReceiptId}` : undefined,
        ),
      );
    return r!.v;
  }

  /**
   * Bounce or mistake (Q23): the receipt is Reversed with a reason (step-up), its allocations are
   * stamped reversed so the invoices owe again, its commission share is taken back and held
   * orders are re-checked. The number is never reused.
   */
  async reverse(
    type: PartyType,
    id: string,
    dto: z.infer<typeof receiptReverse>,
  ): Promise<ReceiptDetail> {
    const reason = ctx().reason?.trim();
    if (!reason) throw reasonRequired();
    await this.uow.run(async (tx) => {
      const r = await this.find(tx, type, id, true);
      receiptMachine.assert(r.status, "Reversed");
      const live = await tx
        .select()
        .from(allocations)
        .where(and(eq(allocations.receiptId, id), isNull(allocations.reversedAt)))
        .for("update");
      for (const a of live) {
        if (type === "CUSTOMER" && a.salesInvoiceId) {
          const before = await this.moneySettled(tx, a.salesInvoiceId, null);
          const after = D(before).minus(a.amount).minus(a.deduction).toFixed(2);
          await this.commission.onSettlement(
            tx,
            a.salesInvoiceId,
            { id: r.id, docNo: r.docNo, date: istToday() },
            before,
            after,
            `${LABEL[type]} ${r.docNo} ${dto.kind === "BOUNCED" ? "bounced" : "reversed"}: ${reason}`,
          );
        }
        await tx
          .update(allocations)
          .set({ reversedAt: new Date(), reversedBy: actor().userId })
          .where(eq(allocations.id, a.id));
      }
      await updateVersioned(
        tx,
        receipts,
        eq(receipts.id, id),
        dto.version,
        {
          status: "Reversed",
          reversedAt: new Date(),
          reversedBy: actor().userId,
          reversalKind: dto.kind,
          reversalReason: reason,
        },
        LABEL[type],
      );
      await recordTransition(tx, LABEL[type], id, "Posted", "Reversed", reason);
      const partyId = (r.customerId ?? r.supplierId)!;
      await writePostingEvent(tx, {
        type: type === "CUSTOMER" ? "RECEIPT_REVERSED" : "PAYMENT_REVERSED",
        docType: SERIES[type],
        docId: id,
        docNo: r.docNo,
        docDate: istToday(),
        partyType: type,
        partyId,
        payload: {
          docNo: r.docNo,
          kind: dto.kind,
          reason,
          amount: D(r.amount).toFixed(2),
          allocationsReversed: live.map((a) => ({
            invoiceId: a.salesInvoiceId ?? a.purchaseInvoiceId,
            amount: D(a.amount).toFixed(2),
            deduction: D(a.deduction).toFixed(2),
          })),
        },
      });
      if (type === "CUSTOMER") this.creditRecheck.enqueueAfterCommit(partyId);
      this.changed(id);
    });
    return this.get(type, id);
  }

  /**
   * Use money on account or an unused note against invoices, without a new receipt. Posted at
   * once (it moves no money); the same checks as posting a receipt.
   */
  async applyCredit(type: PartyType, partyId: string, dto: z.infer<typeof applyCredit>) {
    const expected = type === "CUSTOMER" ? ["RECEIPT", "CREDIT_NOTE"] : ["PAYMENT", "DEBIT_NOTE"];
    if (!expected.includes(dto.source))
      throw validationError("That kind of credit doesn't belong to this party.");
    if (dto.allocations.some((l) => D(l.deduction ?? 0).greaterThan(0))) {
      throw validationError("TDS is recorded on the receipt itself, not when applying a credit.");
    }
    await this.uow.run(async (tx) => {
      await this.party(tx, type, partyId);
      const credits = await unusedCredits(tx, type, partyId);
      const credit = credits.find((c) => c.source === dto.source && c.id === dto.sourceId);
      if (!credit) throw validationError("That credit has nothing left to use.");
      // Lock the source so two users can't spend it twice.
      if (dto.source === "RECEIPT" || dto.source === "PAYMENT") {
        await tx
          .select({ id: receipts.id })
          .from(receipts)
          .where(eq(receipts.id, dto.sourceId))
          .for("update");
      } else if (dto.source === "CREDIT_NOTE") {
        await tx
          .select({ id: customerNotes.id })
          .from(customerNotes)
          .where(eq(customerNotes.id, dto.sourceId))
          .for("update");
      } else {
        await tx
          .select({ id: purchaseReturns.id })
          .from(purchaseReturns)
          .where(eq(purchaseReturns.id, dto.sourceId))
          .for("update");
      }
      const open = await this.openInvoices(tx, type, partyId, true);
      const problems = checkAllocation(
        credit.available,
        dto.allocations,
        new Map(open.map((o) => [o.id, o.outstanding])),
      );
      if (problems.length) {
        throw validationError(
          "The allocation doesn't fit.",
          problems.map((message, i) => ({ path: `allocations.${i}`, message })),
        );
      }
      const today = istToday();
      for (const l of dto.allocations) {
        const isMoney = dto.source === "RECEIPT" || dto.source === "PAYMENT";
        const before =
          type === "CUSTOMER" && isMoney ? await this.moneySettled(tx, l.invoiceId, null) : null;
        await tx.insert(allocations).values({
          companyId: actor().companyId,
          source: dto.source,
          receiptId: isMoney ? dto.sourceId : null,
          customerNoteId: dto.source === "CREDIT_NOTE" ? dto.sourceId : null,
          purchaseReturnId: dto.source === "DEBIT_NOTE" ? dto.sourceId : null,
          salesInvoiceId: type === "CUSTOMER" ? l.invoiceId : null,
          purchaseInvoiceId: type === "SUPPLIER" ? l.invoiceId : null,
          date: today,
          amount: D(l.amount).toFixed(2),
          createdBy: actor().userId,
        });
        if (before !== null) {
          await this.commission.onSettlement(
            tx,
            l.invoiceId,
            { id: dto.sourceId, docNo: credit.doc_no, date: today },
            before,
            D(before).plus(l.amount).toFixed(2),
          );
        }
      }
      await writePostingEvent(tx, {
        type: "CREDIT_APPLIED",
        docType:
          dto.source === "CREDIT_NOTE" ? "CN" : dto.source === "DEBIT_NOTE" ? "DN" : SERIES[type],
        docId: dto.sourceId,
        docNo: credit.doc_no,
        docDate: today,
        partyType: type,
        partyId,
        payload: {
          source: dto.source,
          allocations: dto.allocations.map((l) => ({
            invoiceId: l.invoiceId,
            amount: D(l.amount).toFixed(2),
          })),
        },
      });
      if (type === "CUSTOMER") this.creditRecheck.enqueueAfterCommit(partyId);
      this.bus.publishAfterCommit("collections.changed", { party: partyId });
    });
    return this.openItems(type, partyId);
  }

  private changed(id: string) {
    this.bus.publishAfterCommit("collections.changed", { receipt: id });
  }
}
