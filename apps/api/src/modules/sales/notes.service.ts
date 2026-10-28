import type { NoteDetail, NoteItem, noteCreate, salesListQuery } from "@erp/contracts";
import {
  type Tx,
  allocations,
  customerNoteLines,
  customerNotes,
  customers,
  salesInvoices,
} from "@erp/db";
import { D, customerNoteMachine, invoiceTotals, lineTaxes, taxLine } from "@erp/domain";
import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, gte, ilike, isNull, lte, or, sql } from "drizzle-orm";
import type { z } from "zod";
import { actor, ctx } from "../../common/context.js";
import { trimDecimal } from "../../common/decimal.js";
import { notFound, reasonRequired, validationError } from "../../common/errors.js";
import { recordTransition, writePostingEvent } from "../../db/ledger.js";
import { UnitOfWork } from "../../db/unit-of-work.js";
import { updateVersioned } from "../../db/versioning.js";
import { customerScopeFilter, loadCustomerScope } from "../customers/customer-scope.js";
import { EInvoiceQueue } from "../compliance/einvoice.queue.js";
import { EInvoiceService } from "../compliance/einvoice.service.js";
import { CommissionService } from "../collections/commission.service.js";
import { CreditRecheckQueue } from "./credit-recheck.queue.js";
import { EventBus } from "../realtime/event-bus.js";
import { SeriesService } from "../series/series.service.js";
import { SettingsService } from "../settings/settings.service.js";
import { customerContext, totalsOut } from "./sales-common.js";

type Input = z.infer<typeof noteCreate>;
export interface NoteLine {
  description: string;
  hsnCode: string;
  taxable: string;
  gstRate: string;
}

/**
 * Credit and debit notes to customers (PRD §6.6; ADR-0011). A note against an invoice takes the
 * invoice's GST regime and party details; posting numbers it (CN… / DN…), writes the posting event
 * and, for registered buyers, queues its IRN. Returns issue their credit note through `issue`.
 */
@Injectable()
export class NotesService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly bus: EventBus,
    private readonly series: SeriesService,
    private readonly settings: SettingsService,
    private readonly einvoice: EInvoiceService,
    private readonly irnQueue: EInvoiceQueue,
    private readonly creditRecheck: CreditRecheckQueue,
    private readonly commission: CommissionService,
  ) {}

  async list(query: z.infer<typeof salesListQuery>): Promise<NoteItem[]> {
    const scope = await loadCustomerScope(this.uow.db);
    const where = [customerScopeFilter(scope)];
    if (query.status) where.push(eq(customerNotes.status, query.status as "Draft"));
    if (query.customerId) where.push(eq(customerNotes.customerId, query.customerId));
    if (query.from) where.push(gte(customerNotes.date, query.from));
    if (query.to) where.push(lte(customerNotes.date, query.to));
    if (query.q) {
      const q = `%${query.q}%`;
      where.push(or(ilike(customerNotes.noteNo, q), ilike(customers.legalName, q))!);
    }
    const rows = await this.uow.db
      .select({ n: customerNotes, siNo: salesInvoices.siNo })
      .from(customerNotes)
      .innerJoin(customers, eq(customers.id, customerNotes.customerId))
      .leftJoin(salesInvoices, eq(salesInvoices.id, customerNotes.siId))
      .where(and(...where))
      .orderBy(desc(customerNotes.date), desc(customerNotes.createdAt))
      .limit(500);
    return rows.map((r) => toItem(r.n, r.siNo));
  }

  async get(id: string): Promise<NoteDetail> {
    const scope = await loadCustomerScope(this.uow.db);
    const [row] = await this.uow.db
      .select({ n: customerNotes, siNo: salesInvoices.siNo })
      .from(customerNotes)
      .innerJoin(customers, eq(customers.id, customerNotes.customerId))
      .leftJoin(salesInvoices, eq(salesInvoices.id, customerNotes.siId))
      .where(and(eq(customerNotes.id, id), customerScopeFilter(scope)));
    if (!row) throw notFound("Note");
    const n = row.n;
    const lines = await this.uow.db
      .select()
      .from(customerNoteLines)
      .where(eq(customerNoteLines.noteId, id))
      .orderBy(asc(customerNoteLines.lineNo));
    const { cancelWindowHours } = await this.settings.value("einvoice.config");
    return {
      ...toItem(n, row.siNo),
      lines: lines.map((l) => ({
        description: l.description,
        hsnCode: l.hsnCode,
        taxable: D(l.taxable).toFixed(2),
        gstRate: trimDecimal(l.gstRate),
        cgst: D(l.cgst).toFixed(2),
        sgst: D(l.sgst).toFixed(2),
        igst: D(l.igst).toFixed(2),
      })),
      totals: totalsOut(n, n.regime),
      einvoice: {
        status: n.einvoiceStatus,
        irn: n.irn,
        ackNo: n.ackNo,
        ackDate: n.ackDate?.toISOString() ?? null,
        signedQr: n.signedQr,
        attempts: n.irnAttempts,
        lastError: n.irnLastError,
        cancellableUntil:
          n.status === "Posted" && n.postedAt
            ? new Date(n.postedAt.getTime() + cancelWindowHours * 3_600_000).toISOString()
            : null,
      },
    };
  }

  async create(dto: Input): Promise<NoteDetail> {
    const id = await this.uow.run(async (tx) => {
      const head = await this.headFor(tx, dto.customerId, dto.siId ?? null);
      const [n] = await tx
        .insert(customerNotes)
        .values({
          companyId: actor().companyId,
          branchId: actor().branchId,
          customerId: dto.customerId,
          kind: dto.kind,
          siId: dto.siId ?? null,
          date: dto.date,
          reasonCode: dto.reasonCode,
          reason: dto.reason,
          ...head,
          createdBy: actor().userId,
          updatedBy: actor().userId,
        })
        .returning();
      await this.writeLines(tx, n!.id, n!.regime, n!.supplyType === "SEZWOP", dto.lines);
      await recordTransition(tx, "CustomerNote", n!.id, null, "Draft");
      this.changed(n!.id);
      return n!.id;
    });
    return this.get(id);
  }

  async update(id: string, dto: Input & { version: number }): Promise<NoteDetail> {
    await this.uow.run(async (tx) => {
      const n = await this.lock(tx, id);
      if (n.status !== "Draft") throw validationError("A posted note can't be edited.");
      if (n.salesReturnId) throw validationError("A return's credit note follows the return.");
      const head = await this.headFor(tx, dto.customerId, dto.siId ?? null);
      await updateVersioned(
        tx,
        customerNotes,
        eq(customerNotes.id, id),
        dto.version,
        {
          customerId: dto.customerId,
          kind: dto.kind,
          siId: dto.siId ?? null,
          date: dto.date,
          reasonCode: dto.reasonCode,
          reason: dto.reason,
          ...head,
        },
        "Note",
      );
      await tx.delete(customerNoteLines).where(eq(customerNoteLines.noteId, id));
      await this.writeLines(tx, id, head.regime, head.supplyType === "SEZWOP", dto.lines);
      this.changed(id);
    });
    return this.get(id);
  }

  /** Party details: the invoice's frozen snapshot when the note is against one, else the customer's. */
  private async headFor(tx: Tx, customerId: string, siId: string | null) {
    if (siId) {
      const [si] = await tx
        .select()
        .from(salesInvoices)
        .where(and(eq(salesInvoices.id, siId), eq(salesInvoices.companyId, actor().companyId)));
      if (!si) throw notFound("Sales invoice");
      if (si.customerId !== customerId)
        throw validationError("That invoice is another customer's.");
      if (si.status !== "Posted")
        throw validationError("Notes can only be raised against a posted invoice.");
      return {
        regime: si.regime,
        placeOfSupply: si.placeOfSupply,
        supplyType: si.supplyType,
        customerName: si.customerName,
        customerGstin: si.customerGstin,
        billingAddress: si.billingAddress,
        shippingAddress: si.shippingAddress,
      };
    }
    const c = await customerContext(tx, customerId);
    return {
      regime: c.regime,
      placeOfSupply: c.placeOfSupply,
      supplyType: c.supplyType,
      customerName: c.customerName,
      customerGstin: c.customer.gstin,
      billingAddress: c.billingAddress,
      shippingAddress: c.shippingAddress,
    };
  }

  private async writeLines(
    tx: Tx,
    noteId: string,
    regime: "CGST_SGST" | "IGST",
    zeroRated: boolean,
    lines: readonly NoteLine[],
  ) {
    const tax = lines.map((l) =>
      taxLine({ quantity: 1, rate: l.taxable, gstRate: zeroRated ? 0 : l.gstRate }),
    );
    const totals = invoiceTotals(tax, regime, await this.settings.value("invoice.roundOffTo"));
    const split = lineTaxes(tax, totals);
    await tx.insert(customerNoteLines).values(
      lines.map((l, i) => ({
        noteId,
        lineNo: i + 1,
        description: l.description,
        hsnCode: l.hsnCode,
        taxable: D(l.taxable).toFixed(2),
        gstRate: tax[i]!.gstRate.toString(),
        cgst: split[i]!.cgst.toFixed(2),
        sgst: split[i]!.sgst.toFixed(2),
        igst: split[i]!.igst.toFixed(2),
        createdBy: actor().userId,
      })),
    );
    await tx
      .update(customerNotes)
      .set({
        gross: totals.taxable.toFixed(2),
        discount: "0.00",
        taxable: totals.taxable.toFixed(2),
        cgst: totals.cgst.toFixed(2),
        sgst: totals.sgst.toFixed(2),
        igst: totals.igst.toFixed(2),
        roundOff: totals.roundOff.toFixed(2),
        total: totals.total.toFixed(2),
      })
      .where(eq(customerNotes.id, noteId));
  }

  async post(id: string, version: number): Promise<NoteDetail> {
    await this.uow.run(async (tx) => {
      const n = await this.lock(tx, id);
      await this.postLocked(tx, n, version);
    });
    return this.get(id);
  }

  /** Credit note for a posted sales return (ADR-0015), created and posted in the same transaction. */
  async issue(
    tx: Tx,
    head: { customerId: string; siId: string; salesReturnId: string; date: string; reason: string },
    lines: NoteLine[],
  ): Promise<{ id: string; noteNo: string }> {
    const h = await this.headFor(tx, head.customerId, head.siId);
    const [n] = await tx
      .insert(customerNotes)
      .values({
        companyId: actor().companyId,
        branchId: actor().branchId,
        customerId: head.customerId,
        kind: "CREDIT",
        siId: head.siId,
        salesReturnId: head.salesReturnId,
        date: head.date,
        reasonCode: "RETURN",
        reason: head.reason,
        ...h,
        createdBy: actor().userId,
        updatedBy: actor().userId,
      })
      .returning();
    await this.writeLines(tx, n!.id, h.regime, h.supplyType === "SEZWOP", lines);
    await recordTransition(tx, "CustomerNote", n!.id, null, "Draft");
    const [fresh] = await tx.select().from(customerNotes).where(eq(customerNotes.id, n!.id));
    const noteNo = await this.postLocked(tx, fresh!, fresh!.version);
    return { id: n!.id, noteNo };
  }

  private async postLocked(tx: Tx, n: typeof customerNotes.$inferSelect, version: number) {
    customerNoteMachine.assert(n.status, "Posted");
    // A credit note can't credit more than the invoice it corrects (less earlier credit notes).
    if (n.siId && n.kind === "CREDIT") {
      const [room] = (
        await tx.execute<{ left: string }>(
          sql`
            SELECT (si.total - coalesce((SELECT sum(total) FROM customer_notes
                    WHERE si_id = si.id AND kind = 'CREDIT' AND status = 'Posted'), 0))::text AS left
            FROM sales_invoices si WHERE si.id = ${n.siId}`,
        )
      ).rows;
      if (D(n.total).greaterThan(D(room!.left))) {
        throw validationError(
          `This credit note is more than is left on the invoice (₹${D(room!.left).toFixed(2)}).`,
        );
      }
    }
    const noteNo = await this.series.allocate(tx, n.kind === "CREDIT" ? "CN" : "DN", n.date);
    await updateVersioned(
      tx,
      customerNotes,
      eq(customerNotes.id, n.id),
      version,
      {
        status: "Posted",
        noteNo,
        einvoiceStatus: n.supplyType === "B2C" ? "NotRequired" : "Pending",
        postedAt: new Date(),
        postedBy: actor().userId,
      },
      "Note",
    );
    await recordTransition(tx, "CustomerNote", n.id, "Draft", "Posted");
    if (n.supplyType !== "B2C")
      this.irnQueue.enqueueAfterCommit(n.kind === "CREDIT" ? "CN" : "DN", n.id);
    if (n.kind === "CREDIT") {
      await this.commission.onCreditNote(tx, n.id);
      this.creditRecheck.enqueueAfterCommit(n.customerId);
    }
    const lines = await tx
      .select()
      .from(customerNoteLines)
      .where(eq(customerNoteLines.noteId, n.id));
    await writePostingEvent(tx, {
      type: n.kind === "CREDIT" ? "CN_POSTED" : "DN_POSTED",
      docType: n.kind === "CREDIT" ? "CN" : "DN",
      docId: n.id,
      docNo: noteNo,
      docDate: n.date,
      partyType: "CUSTOMER",
      partyId: n.customerId,
      payload: {
        noteNo,
        kind: n.kind,
        siId: n.siId,
        salesReturnId: n.salesReturnId,
        reasonCode: n.reasonCode,
        reason: n.reason,
        customer: { id: n.customerId, name: n.customerName, gstin: n.customerGstin },
        regime: n.regime,
        placeOfSupply: n.placeOfSupply,
        lines: lines.map((l) => ({
          description: l.description,
          hsnCode: l.hsnCode,
          taxable: l.taxable,
          gstRate: l.gstRate,
          cgst: l.cgst,
          sgst: l.sgst,
          igst: l.igst,
        })),
        totals: totalsOut(n, n.regime),
      },
    });
    this.changed(n.id);
    return noteNo;
  }

  /** Cancel a draft, or a posted note within the IRN window (reason, step-up). Returns' notes follow the return. */
  async cancel(id: string, version: number): Promise<NoteDetail> {
    await this.uow.run(async (tx) => {
      const n = await this.lock(tx, id);
      customerNoteMachine.assert(n.status, "Cancelled");
      if (n.salesReturnId)
        throw validationError("A return's credit note can't be cancelled on its own.");
      if (n.status === "Posted") {
        const reason = ctx().reason?.trim();
        if (!reason) throw reasonRequired();
        const [used] = await tx
          .select({ id: allocations.id })
          .from(allocations)
          .where(and(eq(allocations.customerNoteId, id), isNull(allocations.reversedAt)))
          .limit(1);
        if (used)
          throw validationError(
            "This credit note has been applied to invoices and can't be cancelled.",
          );
        const { cancelWindowHours } = await this.settings.value("einvoice.config");
        if (Date.now() - n.postedAt!.getTime() > cancelWindowHours * 3_600_000) {
          throw validationError(
            `Notes can only be cancelled within ${cancelWindowHours} hours. Issue an opposite note instead.`,
          );
        }
        await writePostingEvent(tx, {
          type: n.kind === "CREDIT" ? "CN_CANCELLED" : "DN_CANCELLED",
          docType: n.kind === "CREDIT" ? "CN" : "DN",
          docId: n.id,
          docNo: n.noteNo,
          docDate: n.date,
          partyType: "CUSTOMER",
          partyId: n.customerId,
          payload: { noteNo: n.noteNo, reason, total: n.total },
        });
      }
      await updateVersioned(
        tx,
        customerNotes,
        eq(customerNotes.id, id),
        version,
        {
          status: "Cancelled",
          cancelledAt: new Date(),
          cancelledBy: actor().userId,
        },
        "Note",
      );
      await recordTransition(tx, "CustomerNote", id, n.status, "Cancelled");
      if (n.status === "Posted") {
        await this.einvoice.cancelIrn(
          tx,
          n.kind === "CREDIT" ? "CN" : "DN",
          id,
          ctx().reason!.trim(),
        );
        if (n.kind === "DEBIT") this.creditRecheck.enqueueAfterCommit(n.customerId);
        else await this.commission.onCreditNoteCancelled(tx, id);
      }
      this.changed(id);
    });
    return this.get(id);
  }

  private async lock(tx: Tx, id: string) {
    const scope = await loadCustomerScope(tx);
    const [row] = await tx
      .select({ n: customerNotes })
      .from(customerNotes)
      .innerJoin(customers, eq(customers.id, customerNotes.customerId))
      .where(and(eq(customerNotes.id, id), customerScopeFilter(scope)))
      .for("update", { of: customerNotes });
    if (!row) throw notFound("Note");
    return row.n;
  }

  private changed(id: string) {
    this.bus.publishAfterCommit("sales.changed", { doc: "NOTE", id });
  }
}

function toItem(n: typeof customerNotes.$inferSelect, siNo: string | null): NoteItem {
  return {
    id: n.id,
    kind: n.kind,
    noteNo: n.noteNo,
    date: n.date,
    customerId: n.customerId,
    customerName: n.customerName,
    siId: n.siId,
    siNo,
    salesReturnId: n.salesReturnId,
    reasonCode: n.reasonCode,
    reason: n.reason,
    status: n.status,
    total: D(n.total).toFixed(2),
    einvoiceStatus: n.einvoiceStatus,
    version: n.version,
  };
}
