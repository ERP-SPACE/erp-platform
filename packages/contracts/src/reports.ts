import { NEEDS_YOU_KINDS, PERIOD_GRAINS, PIVOT_DIMENSIONS, PIVOT_MEASURES } from "@erp/domain";
import { z } from "zod";
import { isoDate } from "./masters.js";
import type { PermissionCode } from "./permissions.js";

/**
 * Stage 5 contracts: the report catalogue (PRD §9 except accounting statements), one shared
 * query / response shape for every report, the pivot builder with saved pivots, the role-aware
 * Today page and exports built in the worker. Money travels as decimal strings.
 */

const moneyStr = z.string();

// ── report catalogue ─────────────────────────────────────────────────────────

export const REPORT_SECTIONS = [
  "operational",
  "sales",
  "purchase",
  "credit",
  "profitability",
] as const;
export type ReportSection = (typeof REPORT_SECTIONS)[number];

export interface ReportMeta {
  title: string;
  section: ReportSection;
  description: string;
  /** PRD §9 row it implements. */
  prd: string;
  /** Read from a materialized view ("as of" stamp) or live tables. */
  source: "view" | "live";
  /** Needs this permission besides `reports.view`. */
  permission?: PermissionCode;
  /** Shows cost, COGS or margin: those columns need `reports.margin.view` (Q36). */
  hasCost?: boolean;
  /** Takes a date range. */
  dated?: boolean;
}

export const REPORTS = {
  "stock-by-sku": {
    title: "Stock by SKU",
    section: "operational",
    prd: "9.1",
    source: "view",
    hasCost: true,
    description: "Rolls, metres and value in stock per SKU.",
  },
  "stock-by-batch": {
    title: "Stock by batch",
    section: "operational",
    prd: "9.1",
    source: "view",
    hasCost: true,
    description: "Rolls, metres and value per supplier batch.",
  },
  "stock-by-supplier": {
    title: "Stock by supplier",
    section: "operational",
    prd: "9.1",
    source: "view",
    hasCost: true,
    description: "Rolls, metres and value per supplier.",
  },
  "unmapped-rolls": {
    title: "Unmapped rolls",
    section: "operational",
    prd: "9.1",
    source: "live",
    description: "Rolls still unmapped, with hours since the GRN.",
  },
  "batch-aging": {
    title: "Batch aging",
    section: "operational",
    prd: "9.1",
    source: "view",
    hasCost: true,
    description: "Stock by age; rolls past the highlight days are flagged.",
  },
  "dead-stock": {
    title: "Dead stock",
    section: "operational",
    prd: "9.1",
    source: "view",
    hasCost: true,
    description: "Rolls with no movement beyond the dead-stock days.",
  },
  "po-variance": {
    title: "PO vs GRN vs PI",
    section: "operational",
    prd: "9.1",
    source: "view",
    dated: true,
    permission: "purchase.view",
    description: "Ordered, received and invoiced metres per PO line.",
  },
  "dc-pending-invoice": {
    title: "Challans pending invoice",
    section: "operational",
    prd: "9.1",
    source: "live",
    description: "Dispatched challans not yet invoiced.",
  },
  "so-backorder": {
    title: "Order backlog",
    section: "operational",
    prd: "9.1",
    source: "live",
    description: "Open order lines not yet dispatched.",
  },
  "sales-trend": {
    title: "Customer sales trend",
    section: "sales",
    prd: "9.2",
    source: "view",
    dated: true,
    description: "Metres and value by customer, group and period.",
  },
  "sku-sales": {
    title: "SKU volume & value",
    section: "sales",
    prd: "9.2",
    source: "view",
    dated: true,
    description: "Metres and revenue by SKU.",
  },
  "override-frequency": {
    title: "Rate overrides",
    section: "sales",
    prd: "9.2",
    source: "view",
    dated: true,
    description: "Rate overrides by salesman, with how far below the list rate.",
  },
  "discount-impact": {
    title: "Discount impact",
    section: "sales",
    prd: "9.2",
    source: "view",
    dated: true,
    description: "Revenue given away in discounts by customer and period.",
  },
  "churn-risk": {
    title: "Churn risk",
    section: "sales",
    prd: "9.2",
    source: "live",
    description: "Customers with no confirmed order within the churn days.",
  },
  "salesman-performance": {
    title: "Salesman performance",
    section: "sales",
    prd: "9.2",
    source: "view",
    dated: true,
    description: "Metres, value and commission earned per salesman.",
  },
  "supplier-reliability": {
    title: "Supplier reliability",
    section: "purchase",
    prd: "9.3",
    source: "view",
    dated: true,
    permission: "purchase.view",
    description: "GRN rejection and short-supply rates by supplier.",
  },
  "landed-cost-trend": {
    title: "Landed cost trend",
    section: "purchase",
    prd: "9.3",
    source: "view",
    dated: true,
    permission: "purchase.view",
    hasCost: true,
    description: "Average landed cost per metre by SKU and supplier over time.",
  },
  "supplier-lead-time": {
    title: "Supplier lead time",
    section: "purchase",
    prd: "9.3",
    source: "view",
    dated: true,
    permission: "purchase.view",
    description: "Days from PO approval to GRN posting.",
  },
  "credit-utilisation": {
    title: "Credit utilisation",
    section: "credit",
    prd: "9.4",
    source: "live",
    permission: "collections.view",
    description: "Exposure against the credit limit per customer.",
  },
  "collection-efficiency": {
    title: "Collection efficiency (DSO)",
    section: "credit",
    prd: "9.4",
    source: "view",
    dated: true,
    permission: "collections.view",
    description: "Days sales outstanding, month by month.",
  },
  "allocation-status": {
    title: "Unallocated money",
    section: "credit",
    prd: "9.5",
    source: "live",
    permission: "collections.view",
    description: "Receipts and payments with money not yet applied to invoices.",
  },
  "gross-margin": {
    title: "Gross margin",
    section: "profitability",
    prd: "9.6",
    source: "view",
    dated: true,
    hasCost: true,
    permission: "reports.margin.view",
    description: "Revenue minus COGS by SKU, customer or month.",
  },
  "price-vs-cogs": {
    title: "Price vs COGS",
    section: "profitability",
    prd: "9.6",
    source: "view",
    dated: true,
    hasCost: true,
    permission: "reports.margin.view",
    description: "Selling rate against landed cost, per roll sold.",
  },
  "scrap-impact": {
    title: "Scrap impact",
    section: "profitability",
    prd: "9.6",
    source: "view",
    dated: true,
    hasCost: true,
    permission: "reports.margin.view",
    description: "Value of stock written off as scrap per period.",
  },
  "commission-summary": {
    title: "Commission payout summary",
    section: "profitability",
    prd: "9.6",
    source: "live",
    dated: true,
    permission: "commission.view",
    description: "Accrued, paid and outstanding commission by salesman.",
  },
} as const satisfies Record<string, ReportMeta>;

export type ReportId = keyof typeof REPORTS;
export const REPORT_IDS = Object.keys(REPORTS) as ReportId[];
export const reportId = z.enum(REPORT_IDS as [ReportId, ...ReportId[]]);

/** Where the AR / AP aging and blocked-orders reports already live (Stage 4). */
export const LINKED_REPORTS = [
  { title: "AR aging", section: "credit", prd: "9.4", href: "/collections/aging" },
  { title: "AP aging", section: "credit", prd: "9.5", href: "/collections/aging?party=SUPPLIER" },
  { title: "Blocked orders", section: "credit", prd: "9.4", href: "/collections/blocked" },
] as const;

// ── one query / response for every report ────────────────────────────────────

export const reportQuery = z
  .object({
    from: isoDate.optional(),
    to: isoDate.optional(),
    grain: z.enum(PERIOD_GRAINS).optional(),
    /** Report-specific grouping, e.g. sku | customer | month for gross margin. */
    groupBy: z.string().max(40).optional(),
    customerId: z.string().optional(),
    customerGroupId: z.string().optional(),
    supplierId: z.string().optional(),
    salesmanId: z.string().optional(),
    skuId: z.string().optional(),
    q: z.string().trim().max(80).optional(),
    sort: z.string().max(40).optional(),
    dir: z.enum(["asc", "desc"]).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(500).default(100),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, {
    message: "The start date must be on or before the end date",
    path: ["to"],
  });
export type ReportQuery = z.infer<typeof reportQuery>;

export const REPORT_COLUMN_KINDS = [
  "text",
  "code",
  "date",
  "money",
  "metres",
  "count",
  "percent",
  "days",
  "hours",
] as const;

export const reportColumn = z.object({
  key: z.string(),
  label: z.string(),
  kind: z.enum(REPORT_COLUMN_KINDS),
  /** Included in the totals row. */
  total: z.boolean().optional(),
  /** Hidden without `reports.margin.view`; never sent to those users. */
  cost: z.boolean().optional(),
});
export type ReportColumn = z.infer<typeof reportColumn>;

/** A cell links to the document or party behind it. */
export const reportLink = z.object({
  kind: z.enum([
    "customer",
    "supplier",
    "salesman",
    "sku",
    "roll",
    "so",
    "dc",
    "si",
    "po",
    "grn",
    "pi",
    "receipt",
    "payment",
  ]),
  id: z.string(),
});

const cell = z.union([z.string(), z.number(), z.null()]);
export const reportResponse = z.object({
  id: reportId,
  title: z.string(),
  columns: z.array(reportColumn),
  rows: z.array(
    z.object({
      cells: z.record(z.string(), cell),
      links: z.record(z.string(), reportLink).optional(),
      /** Highlight tone, e.g. aged stock or over-limit customers. */
      tone: z.enum(["warning", "danger"]).optional(),
    }),
  ),
  totals: z.record(z.string(), cell).nullable(),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  /** When the underlying view was refreshed; null for live reports. */
  asOf: z.string().nullable(),
  /** Echo of the date range used (defaults applied). */
  from: isoDate.nullable(),
  to: isoDate.nullable(),
  /** Optional series for a chart above the table. */
  series: z.array(z.object({ key: z.string(), label: z.string(), value: moneyStr })).optional(),
});
export type ReportResponse = z.infer<typeof reportResponse>;

export const reportCatalogueItem = z.object({
  id: reportId,
  title: z.string(),
  section: z.enum(REPORT_SECTIONS),
  description: z.string(),
  prd: z.string(),
  source: z.enum(["view", "live"]),
  dated: z.boolean(),
});
export const reportCatalogue = z.object({
  reports: z.array(reportCatalogueItem),
  linked: z.array(
    z.object({
      title: z.string(),
      section: z.enum(REPORT_SECTIONS),
      prd: z.string(),
      href: z.string(),
    }),
  ),
  asOf: z.string().nullable(),
});

// ── pivot ────────────────────────────────────────────────────────────────────

export const pivotDimension = z.enum(PIVOT_DIMENSIONS);
export const pivotMeasure = z.enum(PIVOT_MEASURES);

export const pivotSpec = z
  .object({
    rows: z.array(pivotDimension).max(3),
    cols: z.array(pivotDimension).max(2),
    measures: z.array(pivotMeasure).min(1).max(6),
    from: isoDate,
    to: isoDate,
    filters: z
      .object({
        customerIds: z.array(z.string()).max(200).optional(),
        customerGroupIds: z.array(z.string()).max(50).optional(),
        supplierIds: z.array(z.string()).max(200).optional(),
        salesmanIds: z.array(z.string()).max(50).optional(),
        skuIds: z.array(z.string()).max(500).optional(),
        categoryIds: z.array(z.string()).max(50).optional(),
      })
      .default({}),
  })
  .refine((s) => s.from <= s.to, {
    message: "The start date must be on or before the end date",
    path: ["to"],
  })
  .refine((s) => !s.rows.some((d) => s.cols.includes(d)), {
    message: "A dimension can be in rows or columns, not both",
    path: ["cols"],
  });
export type PivotSpec = z.infer<typeof pivotSpec>;

const pivotTotals = z.object({
  metres: z.string(),
  rolls: z.number().int(),
  value: z.string(),
  cogs: z.string().optional(),
  margin: z.string().optional(),
  marginPct: z.string().nullable().optional(),
});
export const pivotResponse = z.object({
  rowKeys: z.array(z.array(z.string())),
  colKeys: z.array(z.array(z.string())),
  cells: z.array(z.array(pivotTotals.nullable())),
  rowTotals: z.array(pivotTotals),
  colTotals: z.array(pivotTotals),
  grandTotal: pivotTotals,
  /** Measures dropped because the user cannot see cost (Q36). */
  hiddenMeasures: z.array(pivotMeasure),
  /** True when the result was cut to the row / column cap. */
  truncated: z.boolean(),
  asOf: z.string().nullable(),
});
export type PivotResponse = z.infer<typeof pivotResponse>;

/** Private by default; shared with chosen roles (Q39). */
export const savedPivotInput = z.object({
  name: z.string().trim().min(1).max(80),
  spec: pivotSpec,
  /** Relative date range, so a saved pivot stays current; overrides spec.from / to. */
  range: z
    .enum(["custom", "thisMonth", "lastMonth", "thisQuarter", "thisFy", "last30", "last90"])
    .default("custom"),
  sharedWithRoles: z.array(z.string()).max(20).default([]),
});
export const savedPivotUpdate = savedPivotInput.extend({ version: z.number().int().positive() });
export const savedPivot = z.object({
  id: z.string(),
  name: z.string(),
  spec: pivotSpec,
  range: savedPivotInput.shape.range,
  sharedWithRoles: z.array(z.string()),
  ownerId: z.string(),
  ownerName: z.string(),
  mine: z.boolean(),
  version: z.number().int(),
  updatedAt: z.string(),
});
export type SavedPivot = z.infer<typeof savedPivot>;

// ── Today ────────────────────────────────────────────────────────────────────

export const TODAY_ROLES = ["all", "warehouse", "accounts", "sales"] as const;

export const todayResponse = z.object({
  date: isoDate,
  asOf: z.string(),
  /** Which Needs-you set this user gets, from their permissions. */
  view: z.enum(TODAY_ROLES),
  sentence: z.string().nullable(),
  kpis: z.object({
    ordersToday: z.object({ count: z.number().int(), value: moneyStr }).nullable(),
    invoicesToday: z.object({ count: z.number().int(), value: moneyStr }).nullable(),
    collectionsToday: z.object({ count: z.number().int(), value: moneyStr }).nullable(),
    creditBlocks: z.object({ count: z.number().int(), exposure: moneyStr }).nullable(),
    unmappedRolls: z
      .object({ count: z.number().int(), olderThanAlert: z.number().int() })
      .nullable(),
    /** Month to date; null without `reports.margin.view`. */
    grossMargin: z.object({ value: moneyStr, percent: z.string().nullable() }).nullable(),
  }),
  needsYou: z.array(
    z.object({
      kind: z.enum(NEEDS_YOU_KINDS),
      label: z.string(),
      count: z.number().int(),
      amount: moneyStr.nullable(),
      oldestHours: z.number(),
      href: z.string(),
    }),
  ),
  charts: z.object({
    /** 30 days, oldest first; days with no sales are 0. */
    salesTrend: z.array(z.object({ date: isoDate, value: moneyStr })).nullable(),
    /** AR aging buckets, for the waterfall. */
    arAging: z.array(z.object({ label: z.string(), amount: moneyStr })).nullable(),
    /** GSM × width, metres in stock and their average age in days. */
    stockHeatmap: z
      .array(
        z.object({
          gsm: z.number(),
          widthIn: z.string(),
          metres: z.string(),
          avgAgeDays: z.number(),
        }),
      )
      .nullable(),
  }),
});
export type TodayResponse = z.infer<typeof todayResponse>;

// ── exports ──────────────────────────────────────────────────────────────────

export const EXPORT_FORMATS = ["csv", "xlsx", "pdf"] as const;
export const EXPORT_STATUSES = ["Queued", "Running", "Ready", "Failed", "Expired"] as const;

/** A report (`reportId` + `query`) or a pivot (`spec`). One flat object so it has one OpenAPI schema. */
export const exportRequest = z
  .object({
    kind: z.enum(["report", "pivot"]),
    reportId: reportId.optional(),
    query: reportQuery.optional(),
    spec: pivotSpec.optional(),
    format: z.enum(EXPORT_FORMATS),
  })
  .refine((r) => (r.kind === "report" ? !!r.reportId : !!r.spec), {
    message: "Say which report or pivot to export",
    path: ["kind"],
  });
export type ExportRequest = z.infer<typeof exportRequest>;

export const exportItem = z.object({
  id: z.string(),
  title: z.string(),
  format: z.enum(EXPORT_FORMATS),
  status: z.enum(EXPORT_STATUSES),
  rowCount: z.number().int().nullable(),
  sizeBytes: z.number().int().nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
  readyAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  /** Present once Ready and before expiry. */
  downloadUrl: z.string().nullable(),
});
export type ExportItem = z.infer<typeof exportItem>;
