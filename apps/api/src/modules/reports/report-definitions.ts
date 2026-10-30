import type { ReportColumn, ReportId, ReportQuery, ReportResponse } from "@erp/contracts";
import type { SettingKey, SettingValue } from "@erp/contracts";
import { D, dso, utilisationPercent } from "@erp/domain";
import { type SQL, sql } from "drizzle-orm";

/**
 * One definition per report (PRD §9). Most are a SQL query whose columns are named after the
 * report's column keys; the runner wraps it for search, sort, paging and totals, so a page
 * costs one indexed query whatever the data size. A few (credit utilisation, DSO) compute their
 * rows in code from shared services and are sorted and paged in memory (they are small).
 */

export type Row = Record<string, string | number | null>;
type Link = NonNullable<ReportResponse["rows"][number]["links"]>[string];

export interface ReportCtx {
  q: ReportQuery;
  company: string;
  /** WHERE fragment on the `customers` table for the actor's scope (includes the company). */
  scope: SQL;
  canCost: boolean;
  from: string;
  to: string;
  setting<K extends SettingKey>(key: K): Promise<SettingValue<K>>;
  has(permission: string): boolean;
  raw<T extends Record<string, unknown>>(query: SQL): Promise<{ rows: T[] }>;
  /** Live credit exposure of the scoped customers (credit utilisation). */
  exposures(): Promise<
    { customerId: string; name: string; limit: string; exposure: string; blocked: boolean }[]
  >;
}

export interface ReportDef {
  columns: ReportColumn[];
  sort: [string, "asc" | "desc"];
  /** Column keys searched by `q`. */
  search?: string[];
  /** Cell → link, from an id column in the row (id columns are not sent as cells). */
  links?: Record<string, { kind: Link["kind"]; idKey: string }>;
  tone?: (
    row: Row,
    ctx: ReportCtx & { extra: Record<string, number> },
  ) => "warning" | "danger" | undefined;
  /** Numbers the tone needs (settings), loaded once per request. */
  extra?: (ctx: ReportCtx) => Promise<Record<string, number>>;
  /** Materialized view to read the "as of" stamp from. */
  view?: string;
  query?: (ctx: ReportCtx) => SQL | Promise<SQL>;
  compute?: (ctx: ReportCtx) => Promise<Row[]>;
  /** Optional chart series above the table. */
  series?: (ctx: ReportCtx) => SQL | null;
  /** Valid `groupBy` values; the first is the default. */
  groupBy?: string[];
}

const col = (
  key: string,
  label: string,
  kind: ReportColumn["kind"],
  opts: { total?: boolean; cost?: boolean } = {},
): ReportColumn => ({ key, label, kind, ...opts });

const pick = (ctx: ReportCtx, def: ReportDef) =>
  def.groupBy?.includes(ctx.q.groupBy ?? "") ? ctx.q.groupBy! : def.groupBy![0]!;

/** `to_char` pattern for a period grain; quarters / FY follow the Indian FY (Apr–Mar). */
export function periodSql(dateCol: SQL, grain: ReportQuery["grain"] = "month"): SQL {
  switch (grain) {
    case "day":
      return sql`to_char(${dateCol}, 'YYYY-MM-DD')`;
    case "quarter":
      return sql`(CASE WHEN extract(month FROM ${dateCol}) >= 4 THEN extract(year FROM ${dateCol})::int ELSE extract(year FROM ${dateCol})::int - 1 END)::text
        || '-' || lpad(((CASE WHEN extract(month FROM ${dateCol}) >= 4 THEN extract(year FROM ${dateCol})::int ELSE extract(year FROM ${dateCol})::int - 1 END + 1) % 100)::text, 2, '0')
        || ' Q' || (((extract(month FROM ${dateCol})::int + 8) % 12) / 3 + 1)::text`;
    case "fy":
      return sql`(CASE WHEN extract(month FROM ${dateCol}) >= 4 THEN extract(year FROM ${dateCol})::int ELSE extract(year FROM ${dateCol})::int - 1 END)::text
        || '-' || lpad(((CASE WHEN extract(month FROM ${dateCol}) >= 4 THEN extract(year FROM ${dateCol})::int ELSE extract(year FROM ${dateCol})::int - 1 END + 1) % 100)::text, 2, '0')`;
    default:
      return sql`to_char(${dateCol}, 'YYYY-MM')`;
  }
}

/** Optional equality filters shared by the sales-lines reports. */
const salesFilters = (ctx: ReportCtx) =>
  sql.join(
    [
      ctx.q.customerId ? sql`AND f.customer_id = ${ctx.q.customerId}` : sql``,
      ctx.q.customerGroupId ? sql`AND f.customer_group_id = ${ctx.q.customerGroupId}` : sql``,
      ctx.q.salesmanId ? sql`AND f.salesman_id = ${ctx.q.salesmanId}` : sql``,
      ctx.q.skuId ? sql`AND f.sku_id = ${ctx.q.skuId}` : sql``,
      ctx.q.supplierId ? sql`AND f.supplier_id = ${ctx.q.supplierId}` : sql``,
    ],
    sql` `,
  );
/** Sales facts in range, within the customer scope. */
const salesFacts = (ctx: ReportCtx) => sql`
  mv_sales_lines f JOIN customers ON customers.id = f.customer_id
  WHERE ${ctx.scope} AND f.date BETWEEN ${ctx.from} AND ${ctx.to} ${salesFilters(ctx)}`;

const stockCols = [
  col("rolls", "Rolls", "count", { total: true }),
  col("metres", "Metres", "metres", { total: true }),
  col("value", "Value", "money", { total: true, cost: true }),
];

export const REPORT_DEFS: Record<ReportId, ReportDef> = {
  // ── 9.1 operational ────────────────────────────────────────────────────────
  "stock-by-sku": {
    view: "mv_stock_by_sku",
    columns: [
      col("description", "Item", "text"),
      col("gsm", "GSM", "count"),
      col("width", "Width (in)", "text"),
      ...stockCols,
      col("unmapped", "Unmapped rolls", "count", { total: true }),
      col("oldest", "Oldest roll received", "date"),
    ],
    sort: ["metres", "desc"],
    search: ["description"],
    links: { description: { kind: "sku", idKey: "sku_id" } },
    query: (c) => sql`
      SELECT s.sku_id, s.description, s.gsm, s.width_in::text AS width, s.rolls, s.metres, s.value,
             s.unmapped_rolls AS unmapped, (s.oldest_received_at AT TIME ZONE 'Asia/Kolkata')::date::text AS oldest
      FROM mv_stock_by_sku s WHERE s.company_id = ${c.company}
        ${c.q.skuId ? sql`AND s.sku_id = ${c.q.skuId}` : sql``}`,
  },
  "stock-by-batch": {
    view: "mv_stock_by_batch",
    columns: [
      col("supplier", "Supplier", "text"),
      col("batch", "Batch", "code"),
      col("supplierRef", "Supplier batch ref", "text"),
      ...stockCols,
      col("oldest", "Received", "date"),
    ],
    sort: ["oldest", "asc"],
    search: ["supplier", "supplierRef", "batch"],
    links: { supplier: { kind: "supplier", idKey: "supplier_id" } },
    query: (c) => sql`
      SELECT b.supplier_id, sup.name AS supplier, b.batch_seq::text AS batch, b.supplier_batch_ref AS "supplierRef",
             b.rolls, b.metres, b.value, (b.oldest_received_at AT TIME ZONE 'Asia/Kolkata')::date::text AS oldest
      FROM mv_stock_by_batch b JOIN suppliers sup ON sup.id = b.supplier_id
      WHERE b.company_id = ${c.company} ${c.q.supplierId ? sql`AND b.supplier_id = ${c.q.supplierId}` : sql``}`,
  },
  "stock-by-supplier": {
    view: "mv_stock_by_supplier",
    columns: [
      col("supplier", "Supplier", "text"),
      ...stockCols,
      col("unmapped", "Unmapped rolls", "count", { total: true }),
      col("oldest", "Oldest roll received", "date"),
    ],
    sort: ["value", "desc"],
    search: ["supplier"],
    links: { supplier: { kind: "supplier", idKey: "supplier_id" } },
    query: (c) => sql`
      SELECT s.supplier_id, sup.name AS supplier, s.rolls, s.metres, s.value, s.unmapped_rolls AS unmapped,
             (s.oldest_received_at AT TIME ZONE 'Asia/Kolkata')::date::text AS oldest
      FROM mv_stock_by_supplier s JOIN suppliers sup ON sup.id = s.supplier_id
      WHERE s.company_id = ${c.company}`,
  },
  "unmapped-rolls": {
    columns: [
      col("barcode", "Barcode", "code"),
      col("description", "Item", "text"),
      col("supplier", "Supplier", "text"),
      col("grn", "GRN", "code"),
      col("metres", "Metres", "metres", { total: true }),
      col("received", "Received", "date"),
      col("hours", "Hours waiting", "hours"),
    ],
    sort: ["hours", "desc"],
    search: ["barcode", "description", "supplier", "grn"],
    links: { barcode: { kind: "roll", idKey: "roll_id" }, grn: { kind: "grn", idKey: "grn_id" } },
    extra: async (c) => ({ alert: (await c.setting("inventory.aging")).unmappedAlertHours }),
    tone: (r, c) => (Number(r.hours) >= c.extra.alert! ? "danger" : undefined),
    query: (c) => sql`
      SELECT r.id AS roll_id, r.barcode, r.description, sup.name AS supplier, g.id AS grn_id, g.grn_no AS grn,
             r.current_length_m AS metres, (r.received_at AT TIME ZONE 'Asia/Kolkata')::date::text AS received,
             floor(extract(epoch FROM now() - r.received_at) / 3600)::int AS hours
      FROM rolls r JOIN suppliers sup ON sup.id = r.supplier_id JOIN goods_receipts g ON g.id = r.grn_id
      WHERE r.company_id = ${c.company} AND r.status = 'Unmapped'`,
  },
  "batch-aging": {
    view: "mv_stock_aging",
    columns: [
      col("barcode", "Barcode", "code"),
      col("description", "Item", "text"),
      col("supplier", "Supplier", "text"),
      col("metres", "Metres", "metres", { total: true }),
      col("value", "Value", "money", { total: true, cost: true }),
      col("received", "Received", "date"),
      col("ageDays", "Age (days)", "days"),
    ],
    sort: ["ageDays", "desc"],
    search: ["barcode", "description", "supplier"],
    links: { barcode: { kind: "roll", idKey: "roll_id" } },
    extra: async (c) => {
      const [a = 90, b = 180] = await c.setting("reports.agingHighlightDays");
      return { warn: a, danger: b };
    },
    tone: (r, c) =>
      Number(r.ageDays) > c.extra.danger!
        ? "danger"
        : Number(r.ageDays) > c.extra.warn!
          ? "warning"
          : undefined,
    query: (c) => sql`
      SELECT a.roll_id, a.barcode, a.description, a.supplier_name AS supplier, a.metres, a.value,
             (a.received_at AT TIME ZONE 'Asia/Kolkata')::date::text AS received, a.age_days AS "ageDays"
      FROM mv_stock_aging a WHERE a.company_id = ${c.company}
        ${c.q.supplierId ? sql`AND a.supplier_id = ${c.q.supplierId}` : sql``}
        ${c.q.skuId ? sql`AND a.sku_id = ${c.q.skuId}` : sql``}`,
    series: (c) => sql`
      SELECT band AS key, band AS label, sum(metres)::text AS value FROM (
        SELECT a.metres, CASE WHEN a.age_days <= 30 THEN '0–30 days' WHEN a.age_days <= 90 THEN '31–90 days'
                              WHEN a.age_days <= 180 THEN '91–180 days' ELSE 'Over 180 days' END AS band,
               CASE WHEN a.age_days <= 30 THEN 1 WHEN a.age_days <= 90 THEN 2 WHEN a.age_days <= 180 THEN 3 ELSE 4 END AS o
        FROM mv_stock_aging a WHERE a.company_id = ${c.company}) x
      GROUP BY band, o ORDER BY o`,
  },
  "dead-stock": {
    view: "mv_stock_aging",
    columns: [
      col("barcode", "Barcode", "code"),
      col("description", "Item", "text"),
      col("supplier", "Supplier", "text"),
      col("metres", "Metres", "metres", { total: true }),
      col("value", "Value", "money", { total: true, cost: true }),
      col("lastMoved", "Last movement", "date"),
      col("idleDays", "Days without movement", "days"),
    ],
    sort: ["idleDays", "desc"],
    search: ["barcode", "description", "supplier"],
    links: { barcode: { kind: "roll", idKey: "roll_id" } },
    query: async (c) => {
      const days = (await c.setting("inventory.aging")).deadStockDays;
      return sql`
        SELECT a.roll_id, a.barcode, a.description, a.supplier_name AS supplier, a.metres, a.value,
               (a.last_moved_at AT TIME ZONE 'Asia/Kolkata')::date::text AS "lastMoved", a.idle_days AS "idleDays"
        FROM mv_stock_aging a WHERE a.company_id = ${c.company} AND a.idle_days > ${days}`;
    },
  },
  "po-variance": {
    view: "mv_purchase_lines",
    columns: [
      col("po", "PO", "code"),
      col("date", "Date", "date"),
      col("supplier", "Supplier", "text"),
      col("description", "Item", "text"),
      col("ordered", "Ordered m", "metres", { total: true }),
      col("received", "Received m", "metres", { total: true }),
      col("invoiced", "Invoiced m", "metres", { total: true }),
      col("short", "Short m", "metres", { total: true }),
      col("uninvoiced", "Received, not invoiced m", "metres", { total: true }),
      col("rejected", "Rejected m", "metres", { total: true }),
      col("status", "PO status", "text"),
    ],
    sort: ["date", "desc"],
    search: ["po", "supplier", "description"],
    links: {
      po: { kind: "po", idKey: "po_id" },
      supplier: { kind: "supplier", idKey: "supplier_id" },
    },
    tone: (r) =>
      Number(r.uninvoiced) > 0 || (r.status === "Closed" && Number(r.short) > 0)
        ? "warning"
        : undefined,
    query: (c) => sql`
      SELECT p.po_id, p.po_no AS po, p.po_date::text AS date, p.supplier_id, p.supplier_name AS supplier,
             p.description, p.ordered_m AS ordered, p.received_m AS received, p.invoiced_m AS invoiced,
             p.short_m AS short, p.uninvoiced_m AS uninvoiced, p.rejected_m AS rejected, p.po_status AS status
      FROM mv_purchase_lines p
      WHERE p.company_id = ${c.company} AND p.po_date BETWEEN ${c.from} AND ${c.to}
        ${c.q.supplierId ? sql`AND p.supplier_id = ${c.q.supplierId}` : sql``}`,
  },
  "dc-pending-invoice": {
    columns: [
      col("dc", "Challan", "code"),
      col("date", "Date", "date"),
      col("customer", "Customer", "text"),
      col("so", "Order", "code"),
      col("value", "Value", "money", { total: true }),
      col("days", "Days waiting", "days"),
    ],
    sort: ["days", "desc"],
    search: ["dc", "customer", "so"],
    links: {
      dc: { kind: "dc", idKey: "dc_id" },
      customer: { kind: "customer", idKey: "customer_id" },
      so: { kind: "so", idKey: "so_id" },
    },
    tone: (r) => (Number(r.days) > 2 ? "warning" : undefined),
    query: (c) => sql`
      SELECT dc.id AS dc_id, dc.dc_no AS dc, dc.date::text AS date, customers.id AS customer_id,
             customers.legal_name AS customer, so.id AS so_id, so.so_no AS so, dc.value,
             (current_date - dc.date) AS days
      FROM delivery_challans dc JOIN customers ON customers.id = dc.customer_id
      JOIN sales_orders so ON so.id = dc.so_id
      WHERE ${c.scope} AND dc.status = 'Open'`,
  },
  "so-backorder": {
    columns: [
      col("so", "Order", "code"),
      col("date", "Date", "date"),
      col("customer", "Customer", "text"),
      col("description", "Item", "text"),
      col("ordered", "Ordered m", "metres", { total: true }),
      col("dispatched", "Dispatched m", "metres", { total: true }),
      col("pending", "Pending m", "metres", { total: true }),
      col("value", "Pending value", "money", { total: true }),
      col("status", "Status", "text"),
      col("days", "Days open", "days"),
    ],
    sort: ["days", "desc"],
    search: ["so", "customer", "description"],
    links: {
      so: { kind: "so", idKey: "so_id" },
      customer: { kind: "customer", idKey: "customer_id" },
    },
    tone: (r) => (r.status === "OnHold" ? "danger" : undefined),
    query: (c) => sql`
      SELECT so.id AS so_id, so.so_no AS so, so.date::text AS date, customers.id AS customer_id,
             customers.legal_name AS customer, l.description, l.total_m AS ordered, l.dispatched_m AS dispatched,
             l.total_m - l.dispatched_m AS pending,
             round((l.total_m - l.dispatched_m) * l.rate_per_m * (1 - l.discount_pct / 100), 2) AS value,
             so.status::text AS status, (current_date - so.date) AS days
      FROM sales_order_lines l JOIN sales_orders so ON so.id = l.so_id
      JOIN customers ON customers.id = so.customer_id
      WHERE ${c.scope} AND so.status IN ('Confirmed', 'PartiallyFulfilled', 'OnHold')
        AND l.total_m > l.dispatched_m
        ${c.q.customerId ? sql`AND so.customer_id = ${c.q.customerId}` : sql``}`,
  },

  // ── 9.2 sales ──────────────────────────────────────────────────────────────
  "sales-trend": {
    view: "mv_sales_lines",
    groupBy: ["customer", "customerGroup"],
    columns: [
      col("party", "Customer / group", "text"),
      col("period", "Period", "text"),
      col("metres", "Metres", "metres", { total: true }),
      col("invoices", "Invoices", "count", { total: true }),
      col("value", "Sales (taxable)", "money", { total: true }),
    ],
    sort: ["period", "desc"],
    search: ["party"],
    links: { party: { kind: "customer", idKey: "customer_id" } },
    query: function (c) {
      const byGroup = pick(c, this as ReportDef) === "customerGroup";
      const period = periodSql(sql`f.date`, c.q.grain);
      return sql`
        SELECT ${byGroup ? sql`NULL::uuid` : sql`f.customer_id`} AS customer_id,
               ${byGroup ? sql`coalesce(f.customer_group_name, 'No group')` : sql`min(f.customer_name)`} AS party,
               ${period} AS period, sum(f.metres) AS metres,
               count(DISTINCT f.doc_id) FILTER (WHERE f.doc_type = 'SI')::int AS invoices, sum(f.value) AS value
        FROM ${salesFacts(c)}
        GROUP BY ${byGroup ? sql`f.customer_group_name` : sql`f.customer_id`}, ${period}`;
    },
    series: (c) => sql`
      SELECT ${periodSql(sql`f.date`, c.q.grain)} AS key, ${periodSql(sql`f.date`, c.q.grain)} AS label,
             sum(f.value)::text AS value
      FROM ${salesFacts(c)} GROUP BY 1 ORDER BY 1`,
  },
  "sku-sales": {
    view: "mv_sales_lines",
    columns: [
      col("sku", "SKU", "code"),
      col("category", "Category", "text"),
      col("gsm", "GSM", "count"),
      col("quality", "Quality", "text"),
      col("width", "Width (in)", "text"),
      col("rolls", "Rolls", "count", { total: true }),
      col("metres", "Metres", "metres", { total: true }),
      col("value", "Sales (taxable)", "money", { total: true }),
    ],
    sort: ["value", "desc"],
    search: ["sku", "category", "quality"],
    links: { sku: { kind: "sku", idKey: "sku_id" } },
    query: (c) => sql`
      SELECT f.sku_id, min(f.sku_code) AS sku, min(f.category_name) AS category, min(f.gsm) AS gsm,
             min(f.quality_name) AS quality, min(f.width_in)::text AS width,
             sum(f.rolls)::int AS rolls, sum(f.metres) AS metres, sum(f.value) AS value
      FROM ${salesFacts(c)} AND f.sku_id IS NOT NULL
      GROUP BY f.sku_id`,
  },
  "override-frequency": {
    columns: [
      col("salesman", "Salesman", "text"),
      col("lines", "Order lines", "count", { total: true }),
      col("overrides", "Rate changed", "count", { total: true }),
      col("belowList", "Below the list rate", "count", { total: true }),
      col("approvals", "Needed approval", "count", { total: true }),
      col("overrideShare", "Share changed %", "percent"),
      col("avgBelow", "Average below list %", "percent"),
      col("worst", "Deepest cut %", "percent"),
    ],
    sort: ["overrideShare", "desc"],
    search: ["salesman"],
    links: { salesman: { kind: "salesman", idKey: "salesman_id" } },
    tone: (r) => (Number(r.approvals) > 0 && Number(r.overrideShare) >= 25 ? "warning" : undefined),
    query: (c) => sql`
      SELECT so.salesman_id, coalesce(sm.name, 'No salesman') AS salesman, count(*)::int AS lines,
             count(*) FILTER (WHERE coalesce(l.deviation_pct, 0) <> 0)::int AS overrides,
             count(*) FILTER (WHERE l.deviation_pct < 0)::int AS "belowList",
             count(*) FILTER (WHERE l.needs_approval)::int AS approvals,
             round(100.0 * count(*) FILTER (WHERE coalesce(l.deviation_pct, 0) <> 0) / count(*), 1) AS "overrideShare",
             round(avg(-l.deviation_pct) FILTER (WHERE l.deviation_pct < 0), 1) AS "avgBelow",
             round(max(-l.deviation_pct) FILTER (WHERE l.deviation_pct < 0), 1) AS worst
      FROM sales_order_lines l JOIN sales_orders so ON so.id = l.so_id
      JOIN customers ON customers.id = so.customer_id
      LEFT JOIN salesmen sm ON sm.id = so.salesman_id
      WHERE ${c.scope} AND so.status <> 'Cancelled' AND so.date BETWEEN ${c.from} AND ${c.to}
        ${c.q.salesmanId ? sql`AND so.salesman_id = ${c.q.salesmanId}` : sql``}
      GROUP BY so.salesman_id, sm.name`,
  },
  "discount-impact": {
    columns: [
      col("customer", "Customer", "text"),
      col("period", "Period", "text"),
      col("gross", "Gross", "money", { total: true }),
      col("lineDiscount", "Line discounts", "money", { total: true }),
      col("billDiscount", "Bill discounts", "money", { total: true }),
      col("discount", "Total discount", "money", { total: true }),
      col("discountPct", "Discount % of gross", "percent"),
    ],
    sort: ["discount", "desc"],
    search: ["customer"],
    links: { customer: { kind: "customer", idKey: "customer_id" } },
    query: (c) => {
      const period = periodSql(sql`si.date`, c.q.grain);
      return sql`
        SELECT si.customer_id, min(customers.legal_name) AS customer, ${period} AS period,
               sum(l.gross) AS gross, sum(l.discount) AS "lineDiscount", sum(l.bill_discount) AS "billDiscount",
               sum(l.discount + l.bill_discount) AS discount,
               round(100 * sum(l.discount + l.bill_discount) / nullif(sum(l.gross), 0), 1) AS "discountPct"
        FROM sales_invoice_lines l JOIN sales_invoices si ON si.id = l.si_id
        JOIN customers ON customers.id = si.customer_id
        WHERE ${c.scope} AND si.status = 'Posted' AND si.date BETWEEN ${c.from} AND ${c.to}
          ${c.q.customerId ? sql`AND si.customer_id = ${c.q.customerId}` : sql``}
        GROUP BY si.customer_id, ${period}`;
    },
  },
  "churn-risk": {
    columns: [
      col("customer", "Customer", "text"),
      col("salesman", "Salesman", "text"),
      col("lastOrder", "Last confirmed order", "date"),
      col("daysSince", "Days since", "days"),
      col("orders12m", "Orders, last 12 months", "count"),
      col("value12m", "Order value, last 12 months", "money", { total: true }),
    ],
    sort: ["value12m", "desc"],
    search: ["customer", "salesman"],
    links: { customer: { kind: "customer", idKey: "customer_id" } },
    query: async (c) => {
      const days = await c.setting("reports.churnDays");
      return sql`
        SELECT * FROM (
          SELECT customers.id AS customer_id, customers.legal_name AS customer, sm.name AS salesman,
                 max(so.date)::text AS "lastOrder", (current_date - max(so.date)) AS "daysSince",
                 count(*) FILTER (WHERE so.date > current_date - 365)::int AS orders12m,
                 coalesce(sum(so.total) FILTER (WHERE so.date > current_date - 365), 0) AS value12m
          FROM sales_orders so JOIN customers ON customers.id = so.customer_id
          LEFT JOIN salesmen sm ON sm.id = customers.salesman_id
          WHERE ${c.scope} AND customers.active AND so.status IN ('Confirmed', 'PartiallyFulfilled', 'Closed', 'OnHold')
          GROUP BY customers.id, customers.legal_name, sm.name
        ) x WHERE x."daysSince" > ${days}`;
    },
  },
  "salesman-performance": {
    view: "mv_sales_lines",
    columns: [
      col("salesman", "Salesman", "text"),
      col("customers", "Customers billed", "count"),
      col("invoices", "Invoices", "count", { total: true }),
      col("metres", "Metres", "metres", { total: true }),
      col("value", "Sales (taxable)", "money", { total: true }),
      col("commission", "Commission earned", "money", { total: true }),
    ],
    sort: ["value", "desc"],
    search: ["salesman"],
    links: { salesman: { kind: "salesman", idKey: "salesman_id" } },
    query: (c) => sql`
      SELECT s.salesman_id, coalesce(s.salesman, 'No salesman') AS salesman, s.customers, s.invoices, s.metres,
             s.value, coalesce(ce.amount, 0) AS commission
      FROM (
        SELECT f.salesman_id, min(f.salesman_name) AS salesman, count(DISTINCT f.customer_id)::int AS customers,
               count(DISTINCT f.doc_id) FILTER (WHERE f.doc_type = 'SI')::int AS invoices,
               sum(f.metres) AS metres, sum(f.value) AS value
        FROM ${salesFacts(c)} GROUP BY f.salesman_id
      ) s
      LEFT JOIN LATERAL (
        SELECT sum(e.amount) AS amount FROM commission_entries e
        JOIN customers ON customers.id = e.customer_id
        WHERE ${c.scope} AND e.salesman_id = s.salesman_id AND e.date BETWEEN ${c.from} AND ${c.to}
      ) ce ON true`,
  },

  // ── 9.3 purchase ───────────────────────────────────────────────────────────
  "supplier-reliability": {
    view: "mv_purchase_lines",
    columns: [
      col("supplier", "Supplier", "text"),
      col("lines", "PO lines", "count", { total: true }),
      col("accepted", "Rolls accepted", "count", { total: true }),
      col("rejected", "Rolls rejected", "count", { total: true }),
      col("rejectionPct", "Rejection %", "percent"),
      col("closedLines", "Closed lines", "count", { total: true }),
      col("shortLines", "Closed short", "count", { total: true }),
      col("shortPct", "Short-supply %", "percent"),
      col("shortM", "Short m", "metres", { total: true }),
    ],
    sort: ["rejectionPct", "desc"],
    search: ["supplier"],
    links: { supplier: { kind: "supplier", idKey: "supplier_id" } },
    tone: (r) => (Number(r.rejectionPct) >= 5 || Number(r.shortPct) >= 20 ? "warning" : undefined),
    query: (c) => sql`
      SELECT p.supplier_id, min(p.supplier_name) AS supplier, count(*)::int AS lines,
             sum(p.accepted_rolls)::int AS accepted, sum(p.rejected_rolls)::int AS rejected,
             round(100.0 * sum(p.rejected_rolls) / nullif(sum(p.accepted_rolls + p.rejected_rolls), 0), 1) AS "rejectionPct",
             count(*) FILTER (WHERE p.po_status = 'Closed')::int AS "closedLines",
             count(*) FILTER (WHERE p.po_status = 'Closed' AND p.short_m > 0)::int AS "shortLines",
             round(100.0 * count(*) FILTER (WHERE p.po_status = 'Closed' AND p.short_m > 0)
                   / nullif(count(*) FILTER (WHERE p.po_status = 'Closed'), 0), 1) AS "shortPct",
             coalesce(sum(p.short_m) FILTER (WHERE p.po_status = 'Closed' AND p.short_m > 0), 0) AS "shortM"
      FROM mv_purchase_lines p
      WHERE p.company_id = ${c.company} AND p.po_date BETWEEN ${c.from} AND ${c.to}
      GROUP BY p.supplier_id`,
  },
  "landed-cost-trend": {
    view: "mv_landed_cost_monthly",
    columns: [
      col("sku", "SKU", "code"),
      col("supplier", "Supplier", "text"),
      col("month", "Month received", "text"),
      col("rolls", "Rolls", "count", { total: true }),
      col("metres", "Metres", "metres", { total: true }),
      col("avgCost", "Average landed ₹/m", "money", { cost: true }),
      col("final", "Landed cost final", "text"),
    ],
    sort: ["month", "desc"],
    search: ["sku", "supplier"],
    links: {
      sku: { kind: "sku", idKey: "sku_id" },
      supplier: { kind: "supplier", idKey: "supplier_id" },
    },
    query: (c) => sql`
      SELECT m.sku_id, m.sku_code AS sku, m.supplier_id, m.supplier_name AS supplier, m.month, m.rolls, m.metres,
             m.avg_cost_per_m AS "avgCost", CASE WHEN m.landed_known THEN 'Yes' ELSE 'Provisional' END AS final
      FROM mv_landed_cost_monthly m
      WHERE m.company_id = ${c.company} AND m.month BETWEEN to_char(${c.from}::date, 'YYYY-MM') AND to_char(${c.to}::date, 'YYYY-MM')
        ${c.q.skuId ? sql`AND m.sku_id = ${c.q.skuId}` : sql``}
        ${c.q.supplierId ? sql`AND m.supplier_id = ${c.q.supplierId}` : sql``}`,
  },
  "supplier-lead-time": {
    view: "mv_purchase_lines",
    columns: [
      col("supplier", "Supplier", "text"),
      col("pos", "POs received", "count", { total: true }),
      col("avgDays", "Average days", "days"),
      col("minDays", "Fastest", "days"),
      col("maxDays", "Slowest", "days"),
    ],
    sort: ["avgDays", "desc"],
    search: ["supplier"],
    links: { supplier: { kind: "supplier", idKey: "supplier_id" } },
    query: (c) => sql`
      SELECT supplier_id, min(supplier_name) AS supplier, count(*)::int AS pos,
             round(avg(lead_days), 1) AS "avgDays", min(lead_days) AS "minDays", max(lead_days) AS "maxDays"
      FROM (SELECT DISTINCT ON (po_id) po_id, supplier_id, supplier_name, lead_days FROM mv_purchase_lines
            WHERE company_id = ${c.company} AND po_date BETWEEN ${c.from} AND ${c.to} AND lead_days IS NOT NULL) p
      GROUP BY supplier_id`,
  },

  // ── 9.4 / 9.5 credit & AR ──────────────────────────────────────────────────
  "credit-utilisation": {
    columns: [
      col("customer", "Customer", "text"),
      col("limit", "Credit limit", "money", { total: true }),
      col("exposure", "Exposure", "money", { total: true }),
      col("headroom", "Headroom", "money", { total: true }),
      col("used", "Used %", "percent"),
      col("blocked", "Blocked", "text"),
    ],
    sort: ["used", "desc"],
    search: ["customer"],
    links: { customer: { kind: "customer", idKey: "customer_id" } },
    tone: (r) => (Number(r.used) > 100 ? "danger" : Number(r.used) >= 80 ? "warning" : undefined),
    compute: async (c) =>
      (await c.exposures()).map((e) => ({
        customer_id: e.customerId,
        customer: e.name,
        limit: e.limit,
        exposure: e.exposure,
        headroom: D(e.limit).minus(e.exposure).toFixed(2),
        used: utilisationPercent(e.exposure, e.limit)?.toFixed(1) ?? null,
        blocked: e.blocked ? "Yes" : "No",
      })),
  },
  "collection-efficiency": {
    view: "mv_dso_monthly",
    columns: [
      col("month", "Month", "text"),
      col("sales", "Sales incl. GST", "money", { total: true }),
      col("receivables", "Receivables at month end", "money"),
      col("dso", "DSO (days)", "days"),
    ],
    sort: ["month", "desc"],
    compute: async (c) => {
      const { rows } = await c.raw<{
        month: string;
        sales: string;
        closing_receivables: string;
        days: number;
      }>(sql`
        SELECT month, sales::text, closing_receivables::text, days FROM mv_dso_monthly
        WHERE company_id = ${c.company} AND month_end >= ${c.from}::date AND month_start <= ${c.to}::date`);
      return rows.map((r) => ({
        month: r.month,
        sales: r.sales,
        receivables: r.closing_receivables,
        dso: dso(r.closing_receivables, r.sales, r.days)?.toNumber() ?? null,
      }));
    },
  },
  "allocation-status": {
    columns: [
      col("docNo", "Document", "code"),
      col("party", "Party", "text"),
      col("kind", "Kind", "text"),
      col("date", "Date", "date"),
      col("amount", "Amount", "money", { total: true }),
      col("allocated", "Applied", "money", { total: true }),
      col("unallocated", "Not applied", "money", { total: true }),
      col("days", "Days", "days"),
    ],
    sort: ["unallocated", "desc"],
    search: ["docNo", "party"],
    links: { docNo: { kind: "receipt", idKey: "doc_id" } },
    tone: (r) => (Number(r.days) > 30 ? "warning" : undefined),
    query: (c) => sql`
      SELECT * FROM (
        SELECT r.id AS doc_id, r.doc_no AS "docNo", customers.legal_name AS party, 'Receipt' AS kind, r.date::text AS date,
               r.amount, coalesce(a.applied, 0) AS allocated, r.amount - coalesce(a.applied, 0) AS unallocated,
               (current_date - r.date) AS days
        FROM receipts r JOIN customers ON customers.id = r.customer_id
        LEFT JOIN LATERAL (SELECT sum(x.amount) AS applied FROM allocations x WHERE x.receipt_id = r.id AND x.reversed_at IS NULL) a ON true
        WHERE ${c.scope} AND r.party_type = 'CUSTOMER' AND r.status = 'Posted'
        ${
          c.has("payables.view")
            ? sql`
        UNION ALL
        SELECT r.id, r.doc_no, sup.name, 'Supplier payment', r.date::text, r.amount, coalesce(a.applied, 0),
               r.amount - coalesce(a.applied, 0), (current_date - r.date)
        FROM receipts r JOIN suppliers sup ON sup.id = r.supplier_id
        LEFT JOIN LATERAL (SELECT sum(x.amount) AS applied FROM allocations x WHERE x.receipt_id = r.id AND x.reversed_at IS NULL) a ON true
        WHERE r.company_id = ${c.company} AND r.party_type = 'SUPPLIER' AND r.status = 'Posted'`
            : sql``
        }
      ) m WHERE m.unallocated > 0`,
  },

  // ── 9.6 profitability ──────────────────────────────────────────────────────
  "gross-margin": {
    view: "mv_sales_lines",
    groupBy: ["month", "sku", "customer"],
    columns: [
      col("label", "Month / SKU / customer", "text"),
      col("metres", "Metres", "metres", { total: true }),
      col("value", "Revenue", "money", { total: true }),
      col("cogs", "COGS", "money", { total: true, cost: true }),
      col("margin", "Gross margin", "money", { total: true, cost: true }),
      col("marginPct", "Margin %", "percent", { cost: true }),
    ],
    sort: ["label", "desc"],
    search: ["label"],
    tone: (r) => (r.marginPct !== null && Number(r.marginPct) < 0 ? "danger" : undefined),
    query: function (c) {
      const g = pick(c, this as ReportDef);
      const key =
        g === "sku"
          ? sql`coalesce(f.sku_code, 'Not by SKU (notes, charges)')`
          : g === "customer"
            ? sql`f.customer_name`
            : periodSql(sql`f.date`, c.q.grain);
      return sql`
        SELECT ${key} AS label, sum(f.metres) AS metres, sum(f.value) AS value, sum(f.cogs) AS cogs,
               sum(f.value) - sum(f.cogs) AS margin,
               round(100 * (sum(f.value) - sum(f.cogs)) / nullif(sum(f.value), 0), 1) AS "marginPct"
        FROM ${salesFacts(c)} GROUP BY 1`;
    },
    series: (c) =>
      !c.canCost
        ? null
        : sql`
      SELECT ${periodSql(sql`f.date`, c.q.grain)} AS key, ${periodSql(sql`f.date`, c.q.grain)} AS label,
             (sum(f.value) - sum(f.cogs))::text AS value
      FROM ${salesFacts(c)} GROUP BY 1 ORDER BY 1`,
  },
  "price-vs-cogs": {
    view: "mv_sales_lines",
    columns: [
      col("date", "Date", "date"),
      col("invoice", "Invoice", "code"),
      col("customer", "Customer", "text"),
      col("barcode", "Roll", "code"),
      col("sku", "SKU", "code"),
      col("metres", "Metres", "metres", { total: true }),
      col("rate", "Rate ₹/m", "money"),
      col("costPerM", "Cost ₹/m", "money", { cost: true }),
      col("deltaPerM", "Margin ₹/m", "money", { cost: true }),
      col("margin", "Margin", "money", { total: true, cost: true }),
    ],
    sort: ["date", "desc"],
    search: ["invoice", "customer", "barcode", "sku"],
    links: {
      invoice: { kind: "si", idKey: "doc_id" },
      barcode: { kind: "roll", idKey: "roll_id" },
      customer: { kind: "customer", idKey: "customer_id" },
    },
    tone: (r) => (Number(r.deltaPerM) < 0 ? "danger" : undefined),
    query: (c) => sql`
      SELECT f.date::text AS date, f.doc_id, f.doc_no AS invoice, f.customer_id, f.customer_name AS customer,
             f.roll_id, r.barcode, f.sku_code AS sku, f.metres, round(f.value / nullif(f.metres, 0), 4) AS rate,
             round(f.cogs / nullif(f.metres, 0), 4) AS "costPerM",
             round((f.value - f.cogs) / nullif(f.metres, 0), 4) AS "deltaPerM", f.margin
      FROM mv_sales_lines f JOIN customers ON customers.id = f.customer_id JOIN rolls r ON r.id = f.roll_id
      WHERE ${c.scope} AND f.date BETWEEN ${c.from} AND ${c.to} ${salesFilters(c)}
        AND f.doc_type = 'SI'`,
  },
  "scrap-impact": {
    view: "mv_scrap",
    columns: [
      col("period", "Period", "text"),
      col("rolls", "Rolls scrapped", "count", { total: true }),
      col("cuts", "Cuts with waste", "count", { total: true }),
      col("metres", "Metres written off", "metres", { total: true }),
      col("value", "Value written off", "money", { total: true, cost: true }),
    ],
    sort: ["period", "desc"],
    query: (c) => {
      const period = periodSql(sql`s.date`, c.q.grain);
      return sql`
        SELECT ${period} AS period, count(*) FILTER (WHERE s.kind = 'ROLL')::int AS rolls,
               count(*) FILTER (WHERE s.kind = 'CUT_WASTE')::int AS cuts, sum(s.metres) AS metres, sum(s.value) AS value
        FROM mv_scrap s WHERE s.company_id = ${c.company} AND s.date BETWEEN ${c.from} AND ${c.to}
        GROUP BY 1`;
    },
  },
  "commission-summary": {
    columns: [
      col("salesman", "Salesman", "text"),
      col("accrued", "Earned", "money", { total: true }),
      col("reversed", "Reversed", "money", { total: true }),
      col("net", "Net earned", "money", { total: true }),
      col("paid", "Paid", "money", { total: true }),
      col("outstanding", "Outstanding", "money", { total: true }),
    ],
    sort: ["outstanding", "desc"],
    search: ["salesman"],
    links: { salesman: { kind: "salesman", idKey: "salesman_id" } },
    query: (c) => sql`
      SELECT e.salesman_id, min(sm.name) AS salesman,
             coalesce(sum(e.amount) FILTER (WHERE e.amount > 0), 0) AS accrued,
             coalesce(sum(e.amount) FILTER (WHERE e.amount < 0), 0) AS reversed,
             sum(e.amount) AS net,
             coalesce(sum(e.amount) FILTER (WHERE e.status = 'Paid'), 0) AS paid,
             coalesce(sum(e.amount) FILTER (WHERE e.status = 'Accrued'), 0) AS outstanding
      FROM commission_entries e JOIN salesmen sm ON sm.id = e.salesman_id
      WHERE e.company_id = ${c.company} AND e.date BETWEEN ${c.from} AND ${c.to}
        ${c.q.salesmanId ? sql`AND e.salesman_id = ${c.q.salesmanId}` : sql``}
      GROUP BY e.salesman_id`,
  },
};
