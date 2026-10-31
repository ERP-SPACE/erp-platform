import type {
  ExportItem,
  ExportRequest,
  PivotResponse,
  PivotSpec,
  ReportColumn,
  ReportId,
  ReportResponse,
  ReportSection,
  SavedPivot,
  TodayResponse,
} from "@erp/contracts";
import { formatNumber } from "@erp/domain";
import { queryOptions } from "@tanstack/react-query";
import { api, call } from "./api.js";
import { rupees } from "./sales.js";

/** Stage 5: Today, reports, the pivot builder and exports. */
/** No-break space between a number and its unit ("1,000 m" never wraps). */
const NBSP = String.fromCharCode(160);

export const reportKeys = {
  all: ["reports"] as const,
  today: ["reports", "today"] as const,
  catalogue: ["reports", "catalogue"] as const,
  report: (id: string, q: Record<string, unknown>) => ["reports", "run", id, q] as const,
  pivots: ["reports", "pivots"] as const,
  exports: ["reports", "exports"] as const,
};

export const todayQuery = queryOptions({
  queryKey: reportKeys.today,
  queryFn: () => call<TodayResponse>(() => api.GET("/api/today")),
  refetchInterval: 60_000,
});

export const catalogueQuery = queryOptions({
  queryKey: reportKeys.catalogue,
  queryFn: () =>
    call<{
      reports: {
        id: ReportId;
        title: string;
        section: ReportSection;
        description: string;
        prd: string;
        source: "view" | "live";
        dated: boolean;
      }[];
      linked: { title: string; section: ReportSection; prd: string; href: string }[];
      asOf: string | null;
    }>(() => api.GET("/api/reports")),
});

export type ReportSearch = {
  from?: string;
  to?: string;
  grain?: "day" | "month" | "quarter" | "fy";
  groupBy?: string;
  q?: string;
  customerId?: string;
  supplierId?: string;
  salesmanId?: string;
  skuId?: string;
};

export const reportQuery = (id: ReportId, s: ReportSearch) =>
  queryOptions({
    queryKey: reportKeys.report(id, s),
    queryFn: () =>
      call<ReportResponse>(() =>
        api.GET("/api/reports/{id}", {
          params: { path: { id }, query: { ...s, pageSize: 500 } as never },
        }),
      ),
    placeholderData: (prev) => prev,
  });

export const pivotsQuery = queryOptions({
  queryKey: reportKeys.pivots,
  queryFn: () => call<SavedPivot[]>(() => api.GET("/api/reports/pivots")),
});

export const runPivot = (spec: PivotSpec) =>
  call<PivotResponse>(() => api.POST("/api/reports/pivot", { body: spec }));

export const exportsQuery = queryOptions({
  queryKey: reportKeys.exports,
  queryFn: () => call<ExportItem[]>(() => api.GET("/api/reports/exports")),
  // Poll while something is still being built.
  refetchInterval: (q) =>
    q.state.data?.some((e) => e.status === "Queued" || e.status === "Running") ? 2_000 : false,
});

export const requestExport = (body: ExportRequest) =>
  call<ExportItem>(() => api.POST("/api/reports/exports", { body }));

export const SECTION_LABEL: Record<ReportSection, string> = {
  operational: "Operations",
  sales: "Sales",
  purchase: "Purchase",
  credit: "Credit & receivables",
  profitability: "Profitability",
};

/** A report cell as text: money with ₹ and Indian grouping, metres with "m", etc. */
export function formatCell(kind: ReportColumn["kind"], v: string | number | null): string {
  if (v === null || v === "") return "—";
  switch (kind) {
    case "money":
      return rupees(String(v));
    case "metres":
      return `${formatNumber(String(v), { decimals: 0 })}${NBSP}m`;
    case "count":
      return Number(v).toLocaleString("en-IN");
    case "percent":
      return `${v}${NBSP}%`;
    case "days":
      return `${Number(v).toLocaleString("en-IN")}${NBSP}d`;
    case "hours":
      return `${Number(v).toLocaleString("en-IN")}${NBSP}h`;
    default:
      return String(v);
  }
}

export const NUMERIC_KINDS = new Set(["money", "metres", "count", "percent", "days", "hours"]);

/** Where a linked cell opens. */
export function linkTarget(link: { kind: string; id: string }): {
  to: string;
  params?: Record<string, string>;
  search?: Record<string, string>;
} | null {
  switch (link.kind) {
    case "customer":
      return { to: "/customers/$customerId", params: { customerId: link.id } };
    case "supplier":
      return { to: "/suppliers", search: { id: link.id } };
    case "salesman":
      return { to: "/salesmen/$salesmanId", params: { salesmanId: link.id } };
    case "roll":
      return { to: "/inventory/roll/$rollId", params: { rollId: link.id } };
    case "so":
      return { to: "/sales/orders/$soId", params: { soId: link.id } };
    case "dc":
      return { to: "/sales/challans/$dcId", params: { dcId: link.id } };
    case "si":
      return { to: "/sales/invoices/$siId", params: { siId: link.id } };
    case "po":
      return { to: "/purchase/orders/$poId", params: { poId: link.id } };
    case "grn":
      return { to: "/purchase/receipts/$grnId", params: { grnId: link.id } };
    case "pi":
      return { to: "/purchase/invoices/$piId", params: { piId: link.id } };
    case "receipt":
      return { to: "/collections/$kind/$moneyId", params: { kind: "receipts", moneyId: link.id } };
    case "payment":
      return { to: "/collections/$kind/$moneyId", params: { kind: "payments", moneyId: link.id } };
    default:
      return null;
  }
}

/** "as of 14:32" from an ISO stamp. */
export function asOfLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return `as of ${new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" })}`;
}
