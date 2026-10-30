import type { PermissionCode, TodayResponse } from "@erp/contracts";
import {
  D,
  NEEDS_YOU_BY_ROLE,
  type NeedsYouItem,
  type NeedsYouKind,
  istToday,
  marginPercent,
  rankNeedsYou,
  todaySentence,
} from "@erp/domain";
import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { actor } from "../../common/context.js";
import { UnitOfWork } from "../../db/unit-of-work.js";
import { StatementsService } from "../collections/statements.service.js";
import { siOutstanding } from "../collections/outstanding.js";
import { customerScopeFilter, loadCustomerScope } from "../customers/customer-scope.js";
import { SettingsService } from "../settings/settings.service.js";

const LABELS: Record<NeedsYouKind, string> = {
  rateApproval: "Order rates waiting for approval",
  creditHold: "Orders on credit hold",
  supplierPaymentApproval: "Supplier payments waiting for approval",
  irnFailed: "E-invoices that failed",
  unmappedRolls: "Rolls still unmapped",
  challanToInvoice: "Challans to invoice",
  challanToPick: "Challans being picked",
  returnToInspect: "Returned rolls to inspect",
  moneyOnAccount: "Receipts with money not applied",
  overdueCustomer: "Customers overdue",
};
const HREF: Record<NeedsYouKind, string> = {
  rateApproval: "/sales/orders?status=Draft",
  creditHold: "/collections/blocked",
  supplierPaymentApproval: "/collections/payments?status=Draft",
  irnFailed: "/sales/irn",
  unmappedRolls: "/inventory/unmapped",
  challanToInvoice: "/sales/challans?status=Open",
  challanToPick: "/floor/pick",
  returnToInspect: "/floor/inspect",
  moneyOnAccount: "/reports/allocation-status",
  overdueCustomer: "/collections/aging",
};
/** Who may act on each row; a row is only counted for users who could resolve it. */
const NEEDS: Record<NeedsYouKind, PermissionCode> = {
  rateApproval: "pricing.override.approve",
  creditHold: "sales.credit.release",
  supplierPaymentApproval: "payables.payment.approve",
  irnFailed: "compliance.einvoice.manage",
  unmappedRolls: "inventory.map",
  challanToInvoice: "sales.invoice.manage",
  challanToPick: "sales.dispatch.manage",
  returnToInspect: "sales.return.manage",
  moneyOnAccount: "collections.receipt.manage",
  overdueCustomer: "collections.view",
};

/**
 * Today (PRD §9.7, brief §B4.1): KPIs, the Needs-you worklist and three charts, filtered by
 * role. Everything live except the sales trend, margin and stock heatmap (views, "as of").
 * Each block is computed only for users who may see it.
 */
@Injectable()
export class TodayService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly settings: SettingsService,
    private readonly statements: StatementsService,
  ) {}

  private has(p: PermissionCode) {
    return actor().permissions.has(p);
  }

  /** Warehouse, accounts and sales staff get their own worklist; owners and managers get all. */
  view(): TodayResponse["view"] {
    const p = (c: PermissionCode) => this.has(c);
    if (
      p("pricing.override.approve") ||
      p("settings.update") ||
      (p("collections.view") && p("purchase.view") && p("sales.view") && p("inventory.map"))
    )
      return "all";
    if (p("collections.receipt.manage")) return "accounts";
    if (p("sales.order.manage")) return "sales";
    if (p("inventory.map") || p("sales.dispatch.manage")) return "warehouse";
    return "all";
  }

  async today(): Promise<TodayResponse> {
    const db = this.uow.db;
    const today = istToday();
    const monthStart = `${today.slice(0, 8)}01`;
    const company = actor().companyId;
    const scope = customerScopeFilter(await loadCustomerScope(db));
    const view = this.view();
    const q = async <T extends Record<string, unknown>>(s: ReturnType<typeof sql>) =>
      (await db.execute<T>(s)).rows;
    const canSales = this.has("sales.view");
    const canMoney = this.has("collections.view");
    const canStock = this.has("inventory.view");
    const canMargin = this.has("reports.margin.view");

    const [kpi] = await q<Record<string, string | number | null>>(sql`
      SELECT
        ${
          canSales
            ? sql`(SELECT count(*) FROM sales_orders so JOIN customers ON customers.id = so.customer_id
          WHERE ${scope} AND so.date = ${today} AND so.status NOT IN ('Draft', 'Cancelled'))::int`
            : sql`NULL`
        } AS orders_n,
        ${
          canSales
            ? sql`(SELECT coalesce(sum(so.total), 0) FROM sales_orders so JOIN customers ON customers.id = so.customer_id
          WHERE ${scope} AND so.date = ${today} AND so.status NOT IN ('Draft', 'Cancelled'))::text`
            : sql`NULL`
        } AS orders_v,
        ${
          canSales
            ? sql`(SELECT count(*) FROM sales_invoices si JOIN customers ON customers.id = si.customer_id
          WHERE ${scope} AND si.status = 'Posted' AND si.date = ${today})::int`
            : sql`NULL`
        } AS si_n,
        ${
          canSales
            ? sql`(SELECT coalesce(sum(si.total), 0) FROM sales_invoices si JOIN customers ON customers.id = si.customer_id
          WHERE ${scope} AND si.status = 'Posted' AND si.date = ${today})::text`
            : sql`NULL`
        } AS si_v,
        ${
          canMoney
            ? sql`(SELECT count(*) FROM receipts r JOIN customers ON customers.id = r.customer_id
          WHERE ${scope} AND r.party_type = 'CUSTOMER' AND r.status = 'Posted' AND r.date = ${today})::int`
            : sql`NULL`
        } AS rc_n,
        ${
          canMoney
            ? sql`(SELECT coalesce(sum(r.amount), 0) FROM receipts r JOIN customers ON customers.id = r.customer_id
          WHERE ${scope} AND r.party_type = 'CUSTOMER' AND r.status = 'Posted' AND r.date = ${today})::text`
            : sql`NULL`
        } AS rc_v,
        ${
          canSales
            ? sql`(SELECT count(*) FROM sales_orders so JOIN customers ON customers.id = so.customer_id
          WHERE ${scope} AND so.status = 'OnHold')::int`
            : sql`NULL`
        } AS hold_n,
        ${
          canSales
            ? sql`(SELECT coalesce(sum(so.total), 0) FROM sales_orders so JOIN customers ON customers.id = so.customer_id
          WHERE ${scope} AND so.status = 'OnHold')::text`
            : sql`NULL`
        } AS hold_v,
        ${canStock ? sql`(SELECT count(*) FROM rolls r WHERE r.company_id = ${company} AND r.status = 'Unmapped')::int` : sql`NULL`} AS unmapped_n,
        ${
          canStock
            ? sql`(SELECT count(*) FROM rolls r WHERE r.company_id = ${company} AND r.status = 'Unmapped'
          AND r.received_at < now() - make_interval(hours => ${(await this.settings.value("inventory.aging")).unmappedAlertHours}))::int`
            : sql`NULL`
        } AS unmapped_old,
        ${
          canMargin
            ? sql`(SELECT coalesce(sum(f.value), 0) FROM mv_sales_lines f JOIN customers ON customers.id = f.customer_id
          WHERE ${scope} AND f.date BETWEEN ${monthStart} AND ${today})::text`
            : sql`NULL`
        } AS mtd_value,
        ${
          canMargin
            ? sql`(SELECT coalesce(sum(f.cogs), 0) FROM mv_sales_lines f JOIN customers ON customers.id = f.customer_id
          WHERE ${scope} AND f.date BETWEEN ${monthStart} AND ${today})::text`
            : sql`NULL`
        } AS mtd_cogs
    `);
    const k = kpi!;
    const pair = (n: unknown, v: unknown) =>
      n === null ? null : { count: Number(n), value: D(v as string).toFixed(2) };
    const kpis: TodayResponse["kpis"] = {
      ordersToday: pair(k.orders_n, k.orders_v),
      invoicesToday: pair(k.si_n, k.si_v),
      collectionsToday: pair(k.rc_n, k.rc_v),
      creditBlocks:
        k.hold_n === null
          ? null
          : { count: Number(k.hold_n), exposure: D(k.hold_v as string).toFixed(2) },
      unmappedRolls:
        k.unmapped_n === null
          ? null
          : { count: Number(k.unmapped_n), olderThanAlert: Number(k.unmapped_old) },
      grossMargin:
        k.mtd_value === null
          ? null
          : {
              value: D(k.mtd_value as string)
                .minus(k.mtd_cogs as string)
                .toFixed(2),
              percent:
                marginPercent(k.mtd_value as string, k.mtd_cogs as string)?.toFixed(1) ?? null,
            },
    };
    const sentence =
      kpis.invoicesToday && kpis.collectionsToday && kpis.creditBlocks
        ? todaySentence({
            invoicedToday: kpis.invoicesToday.value,
            invoiceCount: kpis.invoicesToday.count,
            collectedToday: kpis.collectionsToday.value,
            heldOrders: kpis.creditBlocks.count,
            heldExposure: kpis.creditBlocks.exposure,
          })
        : null;

    return {
      date: today,
      asOf: new Date().toISOString(),
      view,
      sentence,
      kpis,
      needsYou: await this.needsYou(view, scope),
      charts: {
        salesTrend: canSales ? await this.salesTrend(scope, today) : null,
        arAging: canMoney
          ? await this.statements
              .aging({ partyType: "CUSTOMER" })
              .then((a) => a.buckets.map((label, i) => ({ label, amount: a.totals[i] ?? "0.00" })))
          : null,
        stockHeatmap: canStock
          ? (
              await q<{ gsm: number; width: string; metres: string; age: string }>(sql`
                SELECT gsm, width_in::text AS width, sum(metres)::text AS metres,
                       round(sum(age_days::numeric * metres) / nullif(sum(metres), 0))::int AS age
                FROM mv_stock_aging WHERE company_id = ${company}
                GROUP BY gsm, width_in ORDER BY gsm, width_in`)
            ).map((r) => ({
              gsm: Number(r.gsm),
              widthIn: D(r.width).toString(),
              metres: D(r.metres).toFixed(0),
              avgAgeDays: Number(r.age ?? 0),
            }))
          : null,
      },
    };
  }

  private async salesTrend(scope: ReturnType<typeof sql>, today: string) {
    const rows = (
      await this.uow.db.execute<{ date: string; value: string }>(sql`
        SELECT f.date::text AS date, sum(f.value)::text AS value
        FROM mv_sales_lines f JOIN customers ON customers.id = f.customer_id
        WHERE ${scope} AND f.date > ${today}::date - 30 AND f.date <= ${today}
        GROUP BY f.date`)
    ).rows;
    const byDate = new Map(rows.map((r) => [r.date, r.value]));
    return Array.from({ length: 30 }, (_, i) => {
      const date = new Date(Date.parse(`${today}T00:00:00Z`) - (29 - i) * 86_400_000)
        .toISOString()
        .slice(0, 10);
      return { date, value: D(byDate.get(date) ?? 0).toFixed(2) };
    });
  }

  private async needsYou(view: TodayResponse["view"], scope: ReturnType<typeof sql>) {
    const kinds = NEEDS_YOU_BY_ROLE[view].filter((kd) => this.has(NEEDS[kd]));
    if (!kinds.length) return [];
    const company = actor().companyId;
    const today = istToday();
    const threshold = await this.settings.value("payables.approvalThresholdInr");
    const QUERIES: Record<NeedsYouKind, ReturnType<typeof sql>> = {
      rateApproval: sql`SELECT count(DISTINCT so.id)::int AS n, NULL::text AS amount,
          coalesce(extract(epoch FROM now() - min(so.created_at)) / 3600, 0) AS hours
        FROM sales_orders so JOIN customers ON customers.id = so.customer_id
        JOIN sales_order_lines l ON l.so_id = so.id
        WHERE ${scope} AND so.status = 'Draft' AND l.needs_approval AND l.approved_at IS NULL`,
      creditHold: sql`SELECT count(*)::int AS n, coalesce(sum(so.total), 0)::text AS amount,
          coalesce(extract(epoch FROM now() - min(coalesce(h.at, so.updated_at))) / 3600, 0) AS hours
        FROM sales_orders so JOIN customers ON customers.id = so.customer_id
        LEFT JOIN LATERAL (SELECT max(t.at) AS at FROM status_transitions t
          WHERE t.entity_type = 'SalesOrder' AND t.entity_id = so.id AND t.to_status = 'OnHold') h ON true
        WHERE ${scope} AND so.status = 'OnHold'`,
      supplierPaymentApproval: sql`SELECT count(*)::int AS n, coalesce(sum(r.amount), 0)::text AS amount,
          coalesce(extract(epoch FROM now() - min(r.created_at)) / 3600, 0) AS hours
        FROM receipts r WHERE r.company_id = ${company} AND r.party_type = 'SUPPLIER' AND r.status = 'Draft'
          AND r.amount > ${threshold} AND r.approved_at IS NULL`,
      irnFailed: sql`SELECT count(*)::int AS n, NULL::text AS amount,
          coalesce(extract(epoch FROM now() - min(at)) / 3600, 0) AS hours FROM (
          SELECT si.posted_at AS at FROM sales_invoices si JOIN customers ON customers.id = si.customer_id
          WHERE ${scope} AND si.status = 'Posted' AND si.einvoice_status = 'Failed'
          UNION ALL
          SELECT n.posted_at FROM customer_notes n JOIN customers ON customers.id = n.customer_id
          WHERE ${scope} AND n.status = 'Posted' AND n.einvoice_status = 'Failed') x`,
      unmappedRolls: sql`SELECT count(*)::int AS n, NULL::text AS amount,
          coalesce(extract(epoch FROM now() - min(r.received_at)) / 3600, 0) AS hours
        FROM rolls r WHERE r.company_id = ${company} AND r.status = 'Unmapped'`,
      challanToInvoice: sql`SELECT count(*)::int AS n, coalesce(sum(dc.value), 0)::text AS amount,
          coalesce(extract(epoch FROM now() - min(coalesce(dc.posted_at, dc.created_at))) / 3600, 0) AS hours
        FROM delivery_challans dc JOIN customers ON customers.id = dc.customer_id
        WHERE ${scope} AND dc.status = 'Open'`,
      challanToPick: sql`SELECT count(*)::int AS n, NULL::text AS amount,
          coalesce(extract(epoch FROM now() - min(dc.created_at)) / 3600, 0) AS hours
        FROM delivery_challans dc JOIN customers ON customers.id = dc.customer_id
        WHERE ${scope} AND dc.status = 'Draft'`,
      returnToInspect: sql`SELECT count(*)::int AS n, NULL::text AS amount,
          coalesce(extract(epoch FROM now() - min(sr.posted_at)) / 3600, 0) AS hours
        FROM sales_return_rolls srr JOIN sales_returns sr ON sr.id = srr.return_id
        JOIN customers ON customers.id = sr.customer_id
        WHERE ${scope} AND sr.status = 'Posted' AND srr.inspected_at IS NULL`,
      moneyOnAccount: sql`SELECT count(*)::int AS n, coalesce(sum(left_over), 0)::text AS amount,
          coalesce(extract(epoch FROM now() - min(posted_at)) / 3600, 0) AS hours FROM (
          SELECT r.posted_at, r.amount - coalesce((SELECT sum(a.amount) FROM allocations a
                 WHERE a.receipt_id = r.id AND a.reversed_at IS NULL), 0) AS left_over
          FROM receipts r JOIN customers ON customers.id = r.customer_id
          WHERE ${scope} AND r.party_type = 'CUSTOMER' AND r.status = 'Posted') x WHERE left_over > 0`,
      overdueCustomer: sql`SELECT count(DISTINCT si.customer_id)::int AS n,
          coalesce(sum(${siOutstanding()}), 0)::text AS amount,
          coalesce(max(${today}::date - si.due_date) * 24, 0) AS hours
        FROM sales_invoices si JOIN customers ON customers.id = si.customer_id
        WHERE ${scope} AND si.status = 'Posted' AND si.due_date < ${today} AND ${siOutstanding()} > 0`,
    };
    const items: NeedsYouItem[] = await Promise.all(
      kinds.map(async (kind) => {
        const [r] = (
          await this.uow.db.execute<{ n: number; amount: string | null; hours: string | number }>(
            QUERIES[kind],
          )
        ).rows;
        return {
          kind,
          count: Number(r?.n ?? 0),
          ...(r?.amount !== null && r?.amount !== undefined ? { amount: r.amount } : {}),
          oldestHours: Math.max(0, Math.floor(Number(r?.hours ?? 0))),
        };
      }),
    );
    const alert = (await this.settings.value("inventory.aging")).unmappedAlertHours;
    return rankNeedsYou(items, alert).map((i) => ({
      kind: i.kind,
      label: LABELS[i.kind],
      count: i.count,
      amount: i.amount === undefined ? null : D(i.amount).toFixed(2),
      oldestHours: i.oldestHours,
      href: HREF[i.kind],
    }));
  }
}
