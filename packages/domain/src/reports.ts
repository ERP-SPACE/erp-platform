import { formatINRCompact } from "./format.js";
import { fyLabel, fyStartYear, toIstCalendarDate } from "./fy.js";
import { D, type Dec, type DecimalLike, sum } from "./money.js";

/**
 * Reports, analytics and the Today page (Stage 5): pure helpers. The SQL views produce rows;
 * everything that decides how a number is grouped, rounded or worded lives here.
 */

// ── Periods (IST calendar dates, Indian FY) ───────────────────────────────────

export const PERIOD_GRAINS = ["day", "month", "quarter", "fy"] as const;
export type PeriodGrain = (typeof PERIOD_GRAINS)[number];

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * The bucket a date falls in: `2026-10-28` · `2026-10` · `2026-27 Q3` · `2026-27`.
 * Quarters follow the financial year (Q1 = Apr–Jun), so keys sort in time order.
 */
export function periodKey(date: string, grain: PeriodGrain): string {
  const { year, month, day } = toIstCalendarDate(date);
  switch (grain) {
    case "day":
      return `${year}-${pad(month)}-${pad(day)}`;
    case "month":
      return `${year}-${pad(month)}`;
    case "quarter":
      return `${fyLabel(date)} Q${Math.floor(((month + 8) % 12) / 3) + 1}`;
    case "fy":
      return fyLabel(date);
  }
}

/** First and last date of the period a date falls in. */
export function periodRange(date: string, grain: PeriodGrain): { from: string; to: string } {
  const { year, month } = toIstCalendarDate(date);
  const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
  const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  switch (grain) {
    case "day":
      return { from: date, to: date };
    case "month":
      return { from: iso(year, month, 1), to: iso(year, month, lastDay(year, month)) };
    case "quarter": {
      const fq = Math.floor(((month + 8) % 12) / 3); // 0 = Apr–Jun
      const start = fyStartYear(date);
      const m0 = ((3 + fq * 3) % 12) + 1;
      const y0 = m0 < 4 ? start + 1 : start;
      const m1 = m0 + 2;
      return { from: iso(y0, m0, 1), to: iso(y0, m1, lastDay(y0, m1)) };
    }
    case "fy": {
      const start = fyStartYear(date);
      return { from: `${start}-04-01`, to: `${start + 1}-03-31` };
    }
  }
}

/** Whole days from `from` to `to` (both `YYYY-MM-DD`); negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  const a = toIstCalendarDate(from);
  const b = toIstCalendarDate(to);
  return Math.round(
    (Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86_400_000,
  );
}

// ── Ratios ─────────────────────────────────────────────────────────────────────

/** Margin as a percentage of revenue, 1 decimal; null when there is no revenue. */
export function marginPercent(revenue: DecimalLike, cogs: DecimalLike): Dec | null {
  const r = D(revenue);
  if (r.isZero()) return null;
  return r.minus(cogs).dividedBy(r).times(100).toDecimalPlaces(1);
}

/**
 * Days Sales Outstanding for a period: closing receivables ÷ credit sales × days in the period,
 * whole days. Null when nothing was sold (DSO is meaningless, not zero).
 */
export function dso(closingReceivables: DecimalLike, sales: DecimalLike, days: number): Dec | null {
  const s = D(sales);
  if (!s.greaterThan(0) || days <= 0) return null;
  const ar = D(closingReceivables);
  return (ar.greaterThan(0) ? ar : D(0)).dividedBy(s).times(days).toDecimalPlaces(0);
}

/** Exposure as a percentage of the credit limit; null when there is no limit. */
export function utilisationPercent(exposure: DecimalLike, limit: DecimalLike): Dec | null {
  const l = D(limit);
  if (!l.greaterThan(0)) return null;
  return D(exposure).dividedBy(l).times(100).toDecimalPlaces(1);
}

/**
 * Churn risk (Q38): a customer who has ordered before but has no confirmed order in the
 * last `days`. Customers who never ordered are not "churning".
 */
export function isChurnRisk(lastOrderDate: string | null, asOf: string, days: number): boolean {
  return lastOrderDate !== null && daysBetween(lastOrderDate, asOf) > days;
}

/** Age bands used by batch aging: under the first highlight, between, beyond the last. */
export function ageBand(ageDays: number, highlights: readonly number[]): number {
  let band = 0;
  for (const h of [...highlights].sort((a, b) => a - b)) if (ageDays > h) band += 1;
  return band;
}

// ── Pivot ──────────────────────────────────────────────────────────────────────

export const PIVOT_DIMENSIONS = [
  "sku",
  "category",
  "gsm",
  "quality",
  "width",
  "customer",
  "customerGroup",
  "supplier",
  "salesman",
  "day",
  "month",
  "quarter",
  "fy",
] as const;
export type PivotDimension = (typeof PIVOT_DIMENSIONS)[number];

export const PIVOT_MEASURES = ["metres", "rolls", "value", "cogs", "margin", "marginPct"] as const;
export type PivotMeasure = (typeof PIVOT_MEASURES)[number];

/** Measures that read cost: hidden without `reports.margin.view` (Q36). */
export const COST_MEASURES: readonly PivotMeasure[] = ["cogs", "margin", "marginPct"];

/** One fact row from the sales-lines view; dimensions already resolved to labels. */
export interface PivotFact {
  dims: Partial<Record<PivotDimension, string>>;
  metres: DecimalLike;
  rolls: number;
  value: DecimalLike;
  cogs: DecimalLike;
}

export interface PivotTotals {
  metres: string;
  rolls: number;
  value: string;
  cogs: string;
  margin: string;
  marginPct: string | null;
}

export interface PivotResult {
  rowKeys: string[][];
  colKeys: string[][];
  /** `cells[r][c]`, null where no fact falls. */
  cells: (PivotTotals | null)[][];
  rowTotals: PivotTotals[];
  colTotals: PivotTotals[];
  grandTotal: PivotTotals;
}

interface Acc {
  metres: Dec;
  rolls: number;
  value: Dec;
  cogs: Dec;
}
const empty = (): Acc => ({ metres: D(0), rolls: 0, value: D(0), cogs: D(0) });
const add = (a: Acc, f: PivotFact) => {
  a.metres = a.metres.plus(f.metres);
  a.rolls += f.rolls;
  a.value = a.value.plus(f.value);
  a.cogs = a.cogs.plus(f.cogs);
};
const finish = (a: Acc): PivotTotals => ({
  metres: a.metres.toFixed(2),
  rolls: a.rolls,
  value: a.value.toFixed(2),
  cogs: a.cogs.toFixed(2),
  margin: a.value.minus(a.cogs).toFixed(2),
  marginPct: marginPercent(a.value, a.cogs)?.toFixed(1) ?? null,
});

const SEP = "\u0000";
const MISSING = "—";
const keyOf = (f: PivotFact, dims: readonly PivotDimension[]) =>
  dims.map((d) => f.dims[d] ?? MISSING);

/**
 * Groups facts by row and column dimensions. Sums are exact (decimal), so every cell adds up
 * to its row and column total and the totals to the grand total, under any grouping.
 * Keys are sorted (period keys sort in time order); "—" marks a missing value and sorts last.
 */
export function pivot(
  facts: readonly PivotFact[],
  rows: readonly PivotDimension[],
  cols: readonly PivotDimension[],
): PivotResult {
  const rowIndex = new Map<string, string[]>();
  const colIndex = new Map<string, string[]>();
  for (const f of facts) {
    const r = keyOf(f, rows);
    const c = keyOf(f, cols);
    rowIndex.set(r.join(SEP), r);
    colIndex.set(c.join(SEP), c);
  }
  const collate = new Intl.Collator("en-IN", { numeric: true });
  const sortKeys = (m: Map<string, string[]>) =>
    [...m.entries()].sort(([, a], [, b]) => {
      for (let i = 0; i < a.length; i++) {
        if (a[i] === b[i]) continue;
        if (a[i] === MISSING) return 1;
        if (b[i] === MISSING) return -1;
        return collate.compare(a[i]!, b[i]!);
      }
      return 0;
    });
  const rowList = sortKeys(rowIndex);
  const colList = sortKeys(colIndex);
  const rPos = new Map(rowList.map(([k], i) => [k, i]));
  const cPos = new Map(colList.map(([k], i) => [k, i]));

  const cells: (Acc | null)[][] = rowList.map(() => colList.map(() => null));
  const rowAcc = rowList.map(empty);
  const colAcc = colList.map(empty);
  const grand = empty();
  for (const f of facts) {
    const r = rPos.get(keyOf(f, rows).join(SEP))!;
    const c = cPos.get(keyOf(f, cols).join(SEP))!;
    const cell = (cells[r]![c] ??= empty());
    add(cell, f);
    add(rowAcc[r]!, f);
    add(colAcc[c]!, f);
    add(grand, f);
  }
  return {
    rowKeys: rowList.map(([, k]) => k),
    colKeys: colList.map(([, k]) => k),
    cells: cells.map((row) => row.map((a) => (a ? finish(a) : null))),
    rowTotals: rowAcc.map(finish),
    colTotals: colAcc.map(finish),
    grandTotal: finish(grand),
  };
}

// ── Today ──────────────────────────────────────────────────────────────────────

export interface TodayFigures {
  invoicedToday: DecimalLike;
  invoiceCount: number;
  collectedToday: DecimalLike;
  heldOrders: number;
  heldExposure: DecimalLike;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The one-sentence summary at the top of Today, e.g.
 * "₹ 4.8 L invoiced today across 12 invoices; ₹ 2.1 L collected; 3 orders on hold (₹ 2.4 L exposure)."
 */
export function todaySentence(f: TodayFigures): string {
  const parts: string[] = [];
  parts.push(
    f.invoiceCount
      ? `${formatINRCompact(f.invoicedToday)} invoiced today across ${plural(f.invoiceCount, "invoice")}`
      : "Nothing invoiced yet today",
  );
  parts.push(
    D(f.collectedToday).greaterThan(0)
      ? `${formatINRCompact(f.collectedToday)} collected`
      : "no collections yet",
  );
  parts.push(
    f.heldOrders
      ? `${plural(f.heldOrders, "order")} on hold (${formatINRCompact(f.heldExposure)} exposure)`
      : "no orders on hold",
  );
  return `${parts.join("; ")}.`;
}

export const NEEDS_YOU_KINDS = [
  "rateApproval",
  "creditHold",
  "supplierPaymentApproval",
  "irnFailed",
  "unmappedRolls",
  "challanToInvoice",
  "challanToPick",
  "returnToInspect",
  "moneyOnAccount",
  "overdueCustomer",
] as const;
export type NeedsYouKind = (typeof NEEDS_YOU_KINDS)[number];

export interface NeedsYouItem {
  kind: NeedsYouKind;
  count: number;
  /** Money at stake, if any. */
  amount?: DecimalLike;
  /** Age of the oldest item in hours. */
  oldestHours: number;
}

/** Things that stop the business (approvals, holds, IRN) come before housekeeping. */
const WEIGHT: Record<NeedsYouKind, number> = {
  rateApproval: 0,
  creditHold: 0,
  supplierPaymentApproval: 1,
  irnFailed: 1,
  unmappedRolls: 2,
  challanToPick: 2,
  challanToInvoice: 2,
  returnToInspect: 3,
  moneyOnAccount: 3,
  overdueCustomer: 3,
};

/** Which Needs-you rows each role sees (the Owner and managers see all of them). */
export const NEEDS_YOU_BY_ROLE: Record<
  "all" | "warehouse" | "accounts" | "sales",
  readonly NeedsYouKind[]
> = {
  all: NEEDS_YOU_KINDS,
  warehouse: ["unmappedRolls", "challanToPick", "returnToInspect"],
  accounts: [
    "irnFailed",
    "supplierPaymentApproval",
    "moneyOnAccount",
    "overdueCustomer",
    "challanToInvoice",
  ],
  sales: ["rateApproval", "creditHold", "overdueCustomer", "challanToInvoice"],
};

/**
 * Drops empty rows and ranks the rest: blocking work first, then the oldest, then the largest.
 * Unmapped rolls only count once they are older than `unmappedHours` (24 h).
 */
export function rankNeedsYou(items: readonly NeedsYouItem[], unmappedHours = 24): NeedsYouItem[] {
  return items
    .filter((i) => i.count > 0 && (i.kind !== "unmappedRolls" || i.oldestHours >= unmappedHours))
    .sort(
      (a, b) =>
        WEIGHT[a.kind] - WEIGHT[b.kind] ||
        b.oldestHours - a.oldestHours ||
        D(b.amount ?? 0).comparedTo(D(a.amount ?? 0)),
    );
}

/** Totals row for a report: sums the named money columns exactly. */
export function totalsOf<T extends Record<string, unknown>>(
  rows: readonly T[],
  columns: readonly (keyof T & string)[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of columns) out[c] = sum(rows.map((r) => (r[c] as DecimalLike) ?? 0)).toFixed(2);
  return out;
}
