import type {
  AgingReport,
  CreditCheck,
  BlockedOrderItem,
  PartyStatement,
  agingQuery,
} from "@erp/contracts";
import { creditPolicies, customers, salesOrders } from "@erp/db";
import { D, agingBuckets, istToday, sum } from "@erp/domain";
import { Injectable } from "@nestjs/common";
import { and, asc, eq, sql } from "drizzle-orm";
import type { z } from "zod";
import { actor } from "../../common/context.js";
import { notFound } from "../../common/errors.js";
import { UnitOfWork } from "../../db/unit-of-work.js";
import { customerScopeFilter, loadCustomerScope } from "../customers/customer-scope.js";
import { SettingsService } from "../settings/settings.service.js";
import { piOutstanding, siOutstanding, unusedCredits } from "./outstanding.js";
import type { PartyType } from "./receipts.service.js";

const DESCRIPTION: Record<string, string> = {
  SI: "Sales invoice",
  CN: "Credit note",
  DN: "Debit note",
  PI: "Purchase invoice",
  RC: "Receipt",
  PY: "Payment",
  REV: "Reversed (bounce / mistake)",
  TDS: "TDS / short payment",
};

/**
 * Statements (customer / supplier sub-ledgers), AR / AP aging and the blocked-orders view.
 * Built from `v_customer_ledger` / `v_supplier_ledger` and the shared outstanding SQL, so they
 * agree with the credit check and the allocation screens.
 */
@Injectable()
export class StatementsService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly settings: SettingsService,
  ) {}

  private async partyRow(type: PartyType, id: string) {
    if (type === "CUSTOMER") {
      const scope = await loadCustomerScope(this.uow.db);
      const [c] = await this.uow.db
        .select({ name: customers.legalName, gstin: customers.gstin })
        .from(customers)
        .where(and(eq(customers.id, id), customerScopeFilter(scope)));
      return c;
    }
    const rows = await this.uow.db.execute<{ name: string; gstin: string | null }>(
      sql`SELECT name, gstin FROM suppliers WHERE id = ${id} AND company_id = ${actor().companyId}`,
    );
    return rows.rows[0];
  }

  /**
   * Statement for a date range: opening balance, every entry with a running balance, closing,
   * money on account and aging. Customers: + owes us; suppliers: + we owe.
   */
  async statement(
    type: PartyType,
    partyId: string,
    from?: string,
    to?: string,
  ): Promise<PartyStatement> {
    const party = await this.partyRow(type, partyId);
    if (!party) throw notFound(type === "CUSTOMER" ? "Customer" : "Supplier");
    const view = type === "CUSTOMER" ? sql`v_customer_ledger` : sql`v_supplier_ledger`;
    const col = type === "CUSTOMER" ? sql`customer_id` : sql`supplier_id`;
    const rows = (
      await this.uow.db.execute<{
        date: string;
        doc_type: string;
        doc_id: string;
        doc_no: string | null;
        debit: string;
        credit: string;
      }>(sql`
        SELECT date::text, doc_type, doc_id, doc_no, debit::text, credit::text
        FROM ${view}
        WHERE company_id = ${actor().companyId} AND ${col} = ${partyId}
        ORDER BY date, posted_at, doc_no`)
    ).rows;
    // Customers owe on debits; for suppliers we owe on credits.
    const sign = type === "CUSTOMER" ? 1 : -1;
    const toDate = to ?? istToday();
    let balance = D(0);
    let opening = D(0);
    const entries: PartyStatement["entries"] = [];
    for (const r of rows) {
      balance = balance.plus(D(r.debit).minus(r.credit).times(sign));
      if (from && r.date < from) {
        opening = balance;
        continue;
      }
      if (r.date > toDate) continue;
      entries.push({
        date: r.date,
        docType: r.doc_type as PartyStatement["entries"][number]["docType"],
        docId: r.doc_id,
        docNo: r.doc_no ?? "—",
        description: DESCRIPTION[r.doc_type] ?? r.doc_type,
        debit: D(r.debit).toFixed(2),
        credit: D(r.credit).toFixed(2),
        balance: balance.toFixed(2),
      });
    }
    const credits = await unusedCredits(this.uow.db, type, partyId);
    const aging = await this.agingFor(type, toDate, [partyId]);
    return {
      partyType: type,
      partyId,
      partyName: party.name,
      gstin: party.gstin,
      from: from ?? rows[0]?.date ?? toDate,
      to: toDate,
      opening: opening.toFixed(2),
      entries,
      closing: (entries.length ? D(entries.at(-1)!.balance) : opening).toFixed(2),
      onAccount: sum(credits.map((c) => c.available)).toFixed(2),
      aging: aging.labels.map((label, i) => ({
        label,
        amount: (aging.rows.get(partyId)?.[i] ?? D(0)).toFixed(2),
      })),
    };
  }

  /** Open invoices of the given parties (or all), bucketed by age since the invoice date. */
  private async agingFor(type: PartyType, asOf: string, partyIds?: string[]) {
    const limits = await this.settings.value("ar.agingBuckets");
    const company = actor().companyId;
    const scope =
      type === "CUSTOMER" ? customerScopeFilter(await loadCustomerScope(this.uow.db)) : sql`true`;
    const only = (col: ReturnType<typeof sql>) =>
      partyIds?.length
        ? sql`AND ${col} IN (${sql.join(
            partyIds.map((id) => sql`${id}`),
            sql`, `,
          )})`
        : sql``;
    const open = (
      type === "CUSTOMER"
        ? await this.uow.db.execute<{
            party_id: string;
            party_name: string;
            date: string;
            owed: string;
          }>(sql`
            SELECT si.customer_id AS party_id, customers.legal_name AS party_name, si.date::text,
                   ${siOutstanding()}::text AS owed
            FROM sales_invoices si JOIN customers ON customers.id = si.customer_id
            WHERE si.company_id = ${company} AND si.status = 'Posted' AND si.date <= ${asOf}
              AND ${scope} ${only(sql`si.customer_id`)}`)
        : await this.uow.db.execute<{
            party_id: string;
            party_name: string;
            date: string;
            owed: string;
          }>(sql`
            SELECT pi.supplier_id AS party_id, s.name AS party_name, pi.supplier_invoice_date::text AS date,
                   ${piOutstanding()}::text AS owed
            FROM purchase_invoices pi JOIN suppliers s ON s.id = pi.supplier_id
            WHERE pi.company_id = ${company} AND pi.status = 'Posted' AND pi.supplier_invoice_date <= ${asOf}
              ${only(sql`pi.supplier_id`)}`)
    ).rows.filter((r) => D(r.owed).greaterThan(0));
    const byParty = new Map<string, typeof open>();
    for (const r of open) byParty.set(r.party_id, [...(byParty.get(r.party_id) ?? []), r]);
    const rows = new Map<string, ReturnType<typeof D>[]>();
    const names = new Map<string, string>();
    const oldest = new Map<string, number>();
    let labels: string[] = agingBuckets(asOf, [], limits).map((b) => b.label);
    for (const [id, items] of byParty) {
      const b = agingBuckets(
        asOf,
        items.map((i) => ({ date: i.date, outstanding: i.owed })),
        limits,
      );
      labels = b.map((x) => x.label);
      rows.set(
        id,
        b.map((x) => x.amount),
      );
      names.set(id, items[0]!.party_name);
      const first = items.map((i) => i.date).sort()[0]!;
      oldest.set(
        id,
        Math.round(
          (Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 86_400_000,
        ),
      );
    }
    return { labels, rows, names, oldest };
  }

  async aging(query: z.infer<typeof agingQuery>): Promise<AgingReport> {
    const asOf = query.asOf ?? istToday();
    const a = await this.agingFor(query.partyType, asOf);
    let ids = [...a.rows.keys()];
    if (query.q) {
      const q = query.q.toLowerCase();
      ids = ids.filter((id) => a.names.get(id)!.toLowerCase().includes(q));
    }
    const rows = await Promise.all(
      ids.map(async (id) => {
        const buckets = a.rows.get(id)!;
        const credits = await unusedCredits(this.uow.db, query.partyType, id);
        return {
          partyId: id,
          partyName: a.names.get(id)!,
          buckets: buckets.map((x) => x.toFixed(2)),
          total: sum(buckets).toFixed(2),
          onAccount: sum(credits.map((c) => c.available)).toFixed(2),
          oldestDays: a.oldest.get(id)!,
        };
      }),
    );
    rows.sort((x, y) => D(y.total).comparedTo(x.total));
    const totals = a.labels.map((_, i) => sum(rows.map((r) => r.buckets[i]!)).toFixed(2));
    return {
      partyType: query.partyType,
      asOf,
      buckets: a.labels,
      rows,
      totals,
      total: sum(totals).toFixed(2),
    };
  }

  /** Orders on hold, with why, the exposure at the last check and the latest receipt. */
  async blockedOrders(): Promise<BlockedOrderItem[]> {
    const scope = await loadCustomerScope(this.uow.db);
    const rows = await this.uow.db
      .select({
        so: salesOrders,
        customerName: customers.legalName,
        lastReceipt: sql<
          string | null
        >`(SELECT r.date::text || '|' || r.amount::text FROM receipts r
          WHERE r.customer_id = ${salesOrders.customerId} AND r.status = 'Posted'
          ORDER BY r.date DESC, r.posted_at DESC LIMIT 1)`,
        heldSince: sql<string | null>`(SELECT max(t.at)::text FROM status_transitions t
          WHERE t.entity_type = 'SalesOrder' AND t.entity_id = ${salesOrders.id} AND t.to_status = 'OnHold')`,
      })
      .from(salesOrders)
      .innerJoin(customers, eq(customers.id, salesOrders.customerId))
      .leftJoin(creditPolicies, eq(creditPolicies.customerId, customers.id))
      .where(and(eq(salesOrders.status, "OnHold"), customerScopeFilter(scope)))
      .orderBy(asc(salesOrders.date));
    return rows.map(({ so, customerName, lastReceipt, heldSince }) => {
      const check = so.creditCheck as CreditCheck | null;
      const [rDate, rAmount] = lastReceipt?.split("|") ?? [null, null];
      return {
        soId: so.id,
        soNo: so.soNo,
        date: so.date,
        customerId: so.customerId,
        customerName,
        total: D(so.total).toFixed(2),
        reasons: (so.heldReasons ?? []) as BlockedOrderItem["reasons"],
        exposure: D(check?.exposure ?? 0).toFixed(2),
        limit: D(check?.limit ?? 0).toFixed(2),
        maxDaysPastDue: check?.maxDaysPastDue ?? 0,
        lastReceiptDate: rDate ?? null,
        lastReceiptAmount: rAmount ? D(rAmount).toFixed(2) : null,
        heldSince: heldSince ? new Date(heldSince).toISOString() : null,
        version: so.version,
      };
    });
  }
}
