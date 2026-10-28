import type {
  CommissionEntryItem,
  CommissionSummary,
  PayoutDetail,
  PayoutListItem,
  commissionQuery,
  payoutCreate,
  payoutPay,
} from "@erp/contracts";
import {
  type Tx,
  commissionEntries,
  commissionPayouts,
  commissionRules,
  customerNotes,
  customers,
  salesInvoiceLines,
  salesInvoices,
  salesmen,
} from "@erp/db";
import {
  D,
  type Dec,
  commissionDelta,
  commissionOnInvoice,
  creditNoteReversal,
  istToday,
  payoutMachine,
  ruleOn,
  sum,
} from "@erp/domain";
import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import type { z } from "zod";
import { actor } from "../../common/context.js";
import { notFound, validationError } from "../../common/errors.js";
import { recordTransition, writePostingEvent } from "../../db/ledger.js";
import { UnitOfWork } from "../../db/unit-of-work.js";
import { updateVersioned } from "../../db/versioning.js";
import { EventBus } from "../realtime/event-bus.js";
import { SeriesService } from "../series/series.service.js";

type Si = typeof salesInvoices.$inferSelect;
type Rule = typeof commissionRules.$inferSelect;

/**
 * Salesman commission (PRD §5.6, port matrix 4.8–4.9): accrual and reversal entries caused by
 * documents, settled by payout batches. Hooks run inside the caller's transaction, so an entry
 * exists exactly when its document does. The rule is the one in force on the invoice date for
 * the invoice's salesman (frozen at posting) and customer.
 */
@Injectable()
export class CommissionService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly bus: EventBus,
    private readonly series: SeriesService,
  ) {}

  // ── hooks ──────────────────────────────────────────────────────────────────

  private async ruleFor(tx: Tx, si: Si): Promise<Rule | null> {
    if (!si.salesmanId) return null;
    const rules = await tx
      .select()
      .from(commissionRules)
      .where(
        and(
          eq(commissionRules.salesmanId, si.salesmanId),
          eq(commissionRules.customerId, si.customerId),
        ),
      );
    return ruleOn(
      rules.map((r) => ({ ...r, trigger: r.triggerEvent })),
      si.date,
    );
  }

  private async fullFor(tx: Tx, si: Si, rule: Rule): Promise<Dec> {
    const [m] = await tx
      .select({ metres: sql<number>`coalesce(sum(${salesInvoiceLines.metres}), 0)::int` })
      .from(salesInvoiceLines)
      .where(and(eq(salesInvoiceLines.siId, si.id), eq(salesInvoiceLines.kind, "GOODS")));
    return commissionOnInvoice(rule, { taxable: si.taxable, metres: m!.metres });
  }

  private async write(
    tx: Tx,
    si: Si,
    rule: Pick<Rule, "method" | "rate">,
    entry: {
      sourceType: "SI" | "CN" | "RC";
      sourceId: string;
      sourceNo: string | null;
      date: string;
      base: string;
      amount: Dec;
      reason?: string;
    },
  ) {
    if (entry.amount.isZero() || !si.salesmanId) return;
    const amount = entry.amount.toFixed(2);
    const [row] = await tx
      .insert(commissionEntries)
      .values({
        companyId: si.companyId,
        salesmanId: si.salesmanId,
        customerId: si.customerId,
        salesInvoiceId: si.id,
        sourceType: entry.sourceType,
        sourceId: entry.sourceId,
        date: entry.date,
        method: rule.method,
        rate: rule.rate,
        base: entry.base,
        amount,
        reversalReason: entry.amount.isNegative() ? (entry.reason ?? "Reversed") : null,
        createdBy: actor().userId,
      })
      .returning();
    await writePostingEvent(tx, {
      type: entry.amount.isNegative() ? "COMMISSION_REVERSED" : "COMMISSION_ACCRUED",
      docType: entry.sourceType,
      docId: entry.sourceId,
      docNo: entry.sourceNo,
      docDate: entry.date,
      partyType: "CUSTOMER",
      partyId: si.customerId,
      payload: {
        entryId: row!.id,
        salesmanId: si.salesmanId,
        siId: si.id,
        siNo: si.siNo,
        amount,
        reason: row!.reversalReason,
      },
    });
    this.bus.publishAfterCommit("collections.changed", { commission: si.salesmanId });
  }

  /** ON_SI_POSTED: the full commission when the invoice posts. */
  async onInvoicePosted(tx: Tx, siId: string) {
    const [si] = await tx.select().from(salesInvoices).where(eq(salesInvoices.id, siId));
    const rule = si && (await this.ruleFor(tx, si));
    if (!si || !rule || rule.triggerEvent !== "ON_SI_POSTED") return;
    await this.write(tx, si, rule, {
      sourceType: "SI",
      sourceId: si.id,
      sourceNo: si.siNo,
      date: si.date,
      base: rule.method === "PERCENT_SALES" ? si.taxable : "0",
      amount: await this.fullFor(tx, si, rule),
    });
  }

  /** A cancelled invoice takes back whatever it earned (net of earlier reversals). */
  async onInvoiceCancelled(tx: Tx, siId: string, reason: string) {
    const [si] = await tx.select().from(salesInvoices).where(eq(salesInvoices.id, siId));
    if (!si) return;
    const net = await this.netFor(tx, siId);
    if (net.isZero()) return;
    const [last] = await tx
      .select()
      .from(commissionEntries)
      .where(eq(commissionEntries.salesInvoiceId, siId))
      .orderBy(desc(commissionEntries.createdAt))
      .limit(1);
    await this.write(tx, si, last!, {
      sourceType: "SI",
      sourceId: si.id,
      sourceNo: si.siNo,
      date: istToday(),
      base: "0",
      amount: net.negated(),
      reason: `Invoice ${si.siNo} cancelled: ${reason}`,
    });
  }

  /** ON_SI_POSTED: a credit note against the invoice reverses its share (UAT 11.6). */
  async onCreditNote(tx: Tx, noteId: string) {
    const [n] = await tx.select().from(customerNotes).where(eq(customerNotes.id, noteId));
    if (!n || n.kind !== "CREDIT" || !n.siId) return;
    const [si] = await tx.select().from(salesInvoices).where(eq(salesInvoices.id, n.siId));
    const rule = si && (await this.ruleFor(tx, si));
    if (!si || !rule || rule.triggerEvent !== "ON_SI_POSTED") return;
    const [before] = await tx
      .select({ taxable: sql<string>`coalesce(sum(${customerNotes.taxable}), 0)::text` })
      .from(customerNotes)
      .where(
        and(
          eq(customerNotes.siId, si.id),
          eq(customerNotes.kind, "CREDIT"),
          eq(customerNotes.status, "Posted"),
          ne(customerNotes.id, n.id),
        ),
      );
    await this.write(tx, si, rule, {
      sourceType: "CN",
      sourceId: n.id,
      sourceNo: n.noteNo,
      date: n.date,
      base: n.taxable,
      amount: creditNoteReversal(
        await this.fullFor(tx, si, rule),
        si.taxable,
        before!.taxable,
        n.taxable,
      ),
      reason: `Credit note ${n.noteNo}: ${n.reason}`,
    });
  }

  /** A cancelled credit note gives back what it took. */
  async onCreditNoteCancelled(tx: Tx, noteId: string) {
    const rows = await tx
      .select()
      .from(commissionEntries)
      .where(and(eq(commissionEntries.sourceType, "CN"), eq(commissionEntries.sourceId, noteId)));
    if (!rows.length) return;
    const [si] = await tx
      .select()
      .from(salesInvoices)
      .where(eq(salesInvoices.id, rows[0]!.salesInvoiceId));
    const [n] = await tx.select().from(customerNotes).where(eq(customerNotes.id, noteId));
    await this.write(tx, si!, rows[0]!, {
      sourceType: "CN",
      sourceId: noteId,
      sourceNo: n?.noteNo ?? null,
      date: istToday(),
      base: "0",
      amount: sum(rows.map((r) => r.amount)).negated(),
      reason: `Credit note ${n?.noteNo} cancelled`,
    });
  }

  /**
   * ON_PAYMENT_RECEIVED: the share earned as the invoice's settled amount moves from `before` to
   * `after` (pro-rata, Q24). A receipt reversal passes after < before and takes it back.
   */
  async onSettlement(
    tx: Tx,
    siId: string,
    receipt: { id: string; docNo: string | null; date: string },
    before: string,
    after: string,
    reason?: string,
  ) {
    const [si] = await tx.select().from(salesInvoices).where(eq(salesInvoices.id, siId));
    const rule = si && (await this.ruleFor(tx, si));
    if (!si || !rule || rule.triggerEvent !== "ON_PAYMENT_RECEIVED") return;
    const full = await this.fullFor(tx, si, rule);
    await this.write(tx, si, rule, {
      sourceType: "RC",
      sourceId: receipt.id,
      sourceNo: receipt.docNo,
      date: receipt.date,
      base: D(after).minus(before).abs().toFixed(2),
      amount: commissionDelta(full, si.total, before, after),
      reason: reason ?? `Receipt ${receipt.docNo} reversed`,
    });
  }

  private async netFor(tx: Tx, siId: string): Promise<Dec> {
    const [r] = await tx
      .select({ net: sql<string>`coalesce(sum(${commissionEntries.amount}), 0)::text` })
      .from(commissionEntries)
      .where(eq(commissionEntries.salesInvoiceId, siId));
    return D(r!.net);
  }

  // ── entries, summary ───────────────────────────────────────────────────────

  async entries(query: z.infer<typeof commissionQuery>): Promise<CommissionEntryItem[]> {
    const where = [eq(commissionEntries.companyId, actor().companyId)];
    if (query.salesmanId) where.push(eq(commissionEntries.salesmanId, query.salesmanId));
    if (query.status) where.push(eq(commissionEntries.status, query.status));
    if (query.from) where.push(gte(commissionEntries.date, query.from));
    if (query.to) where.push(lte(commissionEntries.date, query.to));
    return this.load(and(...where)!);
  }

  private async load(where: ReturnType<typeof and>): Promise<CommissionEntryItem[]> {
    const rows = await this.uow.db
      .select({
        e: commissionEntries,
        customerName: customers.legalName,
        siNo: salesInvoices.siNo,
        payoutNo: commissionPayouts.payoutNo,
        sourceNo: sql<string>`coalesce(
          (SELECT si2.si_no FROM sales_invoices si2 WHERE si2.id = ${commissionEntries.sourceId}),
          (SELECT n.note_no FROM customer_notes n WHERE n.id = ${commissionEntries.sourceId}),
          (SELECT r.doc_no FROM receipts r WHERE r.id = ${commissionEntries.sourceId}), '—')`,
      })
      .from(commissionEntries)
      .innerJoin(customers, eq(customers.id, commissionEntries.customerId))
      .innerJoin(salesInvoices, eq(salesInvoices.id, commissionEntries.salesInvoiceId))
      .leftJoin(commissionPayouts, eq(commissionPayouts.id, commissionEntries.payoutId))
      .where(where)
      .orderBy(desc(commissionEntries.date), desc(commissionEntries.createdAt))
      .limit(2000);
    return rows.map(({ e, customerName, siNo, payoutNo, sourceNo }) => ({
      id: e.id,
      salesmanId: e.salesmanId,
      customerId: e.customerId,
      customerName,
      sourceType: e.sourceType,
      sourceId: e.sourceId,
      sourceNo,
      invoiceId: e.salesInvoiceId,
      invoiceNo: siNo ?? "—",
      date: e.date,
      method: e.method,
      rate: D(e.rate).toString(),
      amount: D(e.amount).toFixed(2),
      reversalReason: e.reversalReason,
      status: e.status,
      payoutId: e.payoutId,
      payoutNo,
    }));
  }

  async summary(): Promise<CommissionSummary[]> {
    const rows = await this.uow.db
      .select({
        salesmanId: salesmen.id,
        salesmanName: salesmen.name,
        accrued: sql<string>`coalesce(sum(${commissionEntries.amount}), 0)::text`,
        paid: sql<string>`coalesce(sum(${commissionEntries.amount}) FILTER (WHERE ${commissionEntries.status} = 'Paid'), 0)::text`,
      })
      .from(salesmen)
      .leftJoin(commissionEntries, eq(commissionEntries.salesmanId, salesmen.id))
      .where(eq(salesmen.companyId, actor().companyId))
      .groupBy(salesmen.id, salesmen.name)
      .orderBy(asc(salesmen.name));
    return rows.map((r) => ({
      salesmanId: r.salesmanId,
      salesmanName: r.salesmanName,
      accrued: D(r.accrued).toFixed(2),
      paid: D(r.paid).toFixed(2),
      outstanding: D(r.accrued).minus(r.paid).toFixed(2),
    }));
  }

  // ── payouts (Q34) ──────────────────────────────────────────────────────────

  async payouts(salesmanId?: string): Promise<PayoutListItem[]> {
    const rows = await this.uow.db
      .select({ p: commissionPayouts, salesmanName: salesmen.name })
      .from(commissionPayouts)
      .innerJoin(salesmen, eq(salesmen.id, commissionPayouts.salesmanId))
      .where(
        and(
          eq(commissionPayouts.companyId, actor().companyId),
          salesmanId ? eq(commissionPayouts.salesmanId, salesmanId) : undefined,
        ),
      )
      .orderBy(desc(commissionPayouts.createdAt));
    return Promise.all(rows.map((r) => this.toItem(r.p, r.salesmanName)));
  }

  /** Entries a draft would settle: accrued, unpaid, dated up to the payout's date. */
  private pendingWhere(p: { salesmanId: string; upTo: string }) {
    return and(
      eq(commissionEntries.salesmanId, p.salesmanId),
      eq(commissionEntries.status, "Accrued"),
      isNull(commissionEntries.payoutId),
      lte(commissionEntries.date, p.upTo),
    );
  }

  private async toItem(
    p: typeof commissionPayouts.$inferSelect,
    salesmanName: string,
  ): Promise<PayoutListItem> {
    let gross = D(p.gross);
    let count: number;
    if (p.status === "Draft") {
      const [r] = await this.uow.db
        .select({
          n: sql<number>`count(*)::int`,
          total: sql<string>`coalesce(sum(${commissionEntries.amount}), 0)::text`,
        })
        .from(commissionEntries)
        .where(this.pendingWhere(p));
      gross = D(r!.total);
      count = r!.n;
    } else {
      const [r] = await this.uow.db
        .select({ n: sql<number>`count(*)::int` })
        .from(commissionEntries)
        .where(eq(commissionEntries.payoutId, p.id));
      count = r!.n;
    }
    return {
      id: p.id,
      payoutNo: p.payoutNo ?? "Draft",
      salesmanId: p.salesmanId,
      salesmanName,
      upTo: p.upTo,
      status: p.status,
      gross: gross.toFixed(2),
      tds: D(p.tds).toFixed(2),
      net: (p.status === "Draft" ? gross.minus(p.tds) : D(p.net)).toFixed(2),
      entryCount: count,
      paidOn: p.paidOn,
      version: p.version,
    };
  }

  async payout(id: string): Promise<PayoutDetail> {
    const [row] = await this.uow.db
      .select({ p: commissionPayouts, salesmanName: salesmen.name })
      .from(commissionPayouts)
      .innerJoin(salesmen, eq(salesmen.id, commissionPayouts.salesmanId))
      .where(and(eq(commissionPayouts.id, id), eq(commissionPayouts.companyId, actor().companyId)));
    if (!row) throw notFound("Commission payout");
    const p = row.p;
    return {
      ...(await this.toItem(p, row.salesmanName)),
      mode: p.mode,
      reference: p.reference,
      notes: p.notes,
      entries: await this.load(
        p.status === "Draft" ? this.pendingWhere(p) : eq(commissionEntries.payoutId, p.id),
      ),
    };
  }

  async createPayout(dto: z.infer<typeof payoutCreate>): Promise<PayoutDetail> {
    const id = await this.uow.run(async (tx) => {
      const [sm] = await tx
        .select()
        .from(salesmen)
        .where(and(eq(salesmen.id, dto.salesmanId), eq(salesmen.companyId, actor().companyId)));
      if (!sm) throw notFound("Salesman");
      const [open] = await tx
        .select({ id: commissionPayouts.id })
        .from(commissionPayouts)
        .where(
          and(
            eq(commissionPayouts.salesmanId, dto.salesmanId),
            eq(commissionPayouts.status, "Draft"),
          ),
        );
      if (open)
        throw validationError("This salesman already has a draft payout. Pay or cancel it first.");
      const [p] = await tx
        .insert(commissionPayouts)
        .values({
          companyId: actor().companyId,
          salesmanId: dto.salesmanId,
          upTo: dto.upTo,
          notes: dto.notes ?? null,
          createdBy: actor().userId,
          updatedBy: actor().userId,
        })
        .returning();
      await recordTransition(tx, "CommissionPayout", p!.id, null, "Draft");
      return p!.id;
    });
    return this.payout(id);
  }

  /** Paying settles the accrued entries up to the date as they stand now; numbered CP/… */
  async pay(id: string, dto: z.infer<typeof payoutPay>): Promise<PayoutDetail> {
    await this.uow.run(async (tx) => {
      const [p] = await tx
        .select()
        .from(commissionPayouts)
        .where(
          and(eq(commissionPayouts.id, id), eq(commissionPayouts.companyId, actor().companyId)),
        )
        .for("update");
      if (!p) throw notFound("Commission payout");
      payoutMachine.assert(p.status, "Paid");
      const entries = await tx
        .select()
        .from(commissionEntries)
        .where(this.pendingWhere(p))
        .for("update");
      const gross = sum(entries.map((e) => e.amount));
      if (!entries.length || gross.lessThanOrEqualTo(0)) {
        throw validationError("There is no commission to pay up to this date.");
      }
      const tds = D(dto.tds ?? 0);
      if (tds.greaterThan(gross))
        throw validationError("TDS can't be more than the commission.", [
          { path: "tds", message: "More than the commission" },
        ]);
      const payoutNo = await this.series.allocate(tx, "CP", dto.paidOn);
      await tx
        .update(commissionEntries)
        .set({ status: "Paid", payoutId: p.id })
        .where(
          inArray(
            commissionEntries.id,
            entries.map((e) => e.id),
          ),
        );
      await updateVersioned(
        tx,
        commissionPayouts,
        eq(commissionPayouts.id, id),
        dto.version,
        {
          status: "Paid",
          payoutNo,
          gross: gross.toFixed(2),
          tds: tds.toFixed(2),
          net: gross.minus(tds).toFixed(2),
          paidOn: dto.paidOn,
          mode: dto.mode,
          reference: dto.reference ?? null,
          paidBy: actor().userId,
        },
        "Commission payout",
      );
      await recordTransition(tx, "CommissionPayout", p.id, "Draft", "Paid");
      await writePostingEvent(tx, {
        type: "COMMISSION_PAID",
        docType: "CP",
        docId: p.id,
        docNo: payoutNo,
        docDate: dto.paidOn,
        payload: {
          payoutNo,
          salesmanId: p.salesmanId,
          gross: gross.toFixed(2),
          tds: tds.toFixed(2),
          net: gross.minus(tds).toFixed(2),
          mode: dto.mode,
          reference: dto.reference ?? null,
          entryIds: entries.map((e) => e.id),
        },
      });
      this.bus.publishAfterCommit("collections.changed", { payout: p.id });
    });
    return this.payout(id);
  }

  async cancelPayout(id: string, version: number): Promise<PayoutDetail> {
    await this.uow.run(async (tx) => {
      const [p] = await tx
        .select()
        .from(commissionPayouts)
        .where(
          and(eq(commissionPayouts.id, id), eq(commissionPayouts.companyId, actor().companyId)),
        )
        .for("update");
      if (!p) throw notFound("Commission payout");
      payoutMachine.assert(p.status, "Cancelled");
      await updateVersioned(
        tx,
        commissionPayouts,
        eq(commissionPayouts.id, id),
        version,
        { status: "Cancelled" },
        "Commission payout",
      );
      await recordTransition(tx, "CommissionPayout", p.id, "Draft", "Cancelled");
      this.bus.publishAfterCommit("collections.changed", { payout: p.id });
    });
    return this.payout(id);
  }
}
