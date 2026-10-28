import type {
  AllocationPreview,
  CreditCheck,
  CustomerLedger,
  DcDetail,
  DcListItem,
  EInvoiceQueueItem,
  EInvoiceRequestItem,
  NoteDetail,
  NoteItem,
  ProformaDetail,
  ProformaListItem,
  RateQuote,
  SalesReturnDetail,
  SalesReturnItem,
  SiDetail,
  SiListItem,
  SoDetail,
  SoListItem,
} from "@erp/contracts";
import { GST_STATES, formatINR } from "@erp/domain";
import type { Tone } from "@erp/ui";
import { queryOptions } from "@tanstack/react-query";
import { ApiError, api, call, reasonHeader } from "./api.js";
import { keys } from "./queries.js";

/** Query options for the Stage 3 sales screens; everything nests under keys.sales. */
type ListFilter = { customerId?: string; status?: string };
const q = (f: ListFilter = {}) => ({ params: { query: f } });

export const soListQuery = (f: ListFilter = {}) =>
  queryOptions({
    queryKey: [...keys.sales, "so", f],
    queryFn: () => call<SoListItem[]>(() => api.GET("/api/sales-orders", q(f))),
  });
export const soQuery = (id: string) =>
  queryOptions({
    queryKey: [...keys.sales, "so", "detail", id],
    queryFn: () =>
      call<SoDetail>(() => api.GET("/api/sales-orders/{id}", { params: { path: { id } } })),
  });
export const allocationQuery = (id: string) =>
  queryOptions({
    queryKey: [...keys.sales, "so", "allocation", id],
    queryFn: () =>
      call<AllocationPreview>(() =>
        api.GET("/api/sales-orders/{id}/allocation", { params: { path: { id } } }),
      ),
  });
export const rateQuoteQuery = (customerId: string, skuId: string) =>
  queryOptions({
    queryKey: [...keys.sales, "quote", customerId, skuId],
    queryFn: () =>
      call<RateQuote>(() =>
        api.GET("/api/sales-orders/rate-quote", { params: { query: { customerId, skuId } } }),
      ),
    enabled: Boolean(customerId && skuId),
    staleTime: 10_000,
  });
export const creditCheckQuery = (customerId: string) =>
  queryOptions({
    queryKey: [...keys.sales, "credit", customerId],
    queryFn: () =>
      call<CreditCheck>(() =>
        api.GET("/api/customers/{id}/credit-check", { params: { path: { id: customerId } } }),
      ),
    enabled: Boolean(customerId),
  });

export const dcListQuery = (f: ListFilter = {}) =>
  queryOptions({
    queryKey: [...keys.sales, "dc", f],
    queryFn: () => call<DcListItem[]>(() => api.GET("/api/delivery-challans", q(f))),
  });
export const dcQuery = (id: string) =>
  queryOptions({
    queryKey: [...keys.sales, "dc", "detail", id],
    queryFn: () =>
      call<DcDetail>(() => api.GET("/api/delivery-challans/{id}", { params: { path: { id } } })),
  });

export const siListQuery = (f: ListFilter = {}) =>
  queryOptions({
    queryKey: [...keys.sales, "si", f],
    queryFn: () => call<SiListItem[]>(() => api.GET("/api/sales-invoices", q(f))),
  });
export const siQuery = (id: string) =>
  queryOptions({
    queryKey: [...keys.sales, "si", "detail", id],
    queryFn: () =>
      call<SiDetail>(() => api.GET("/api/sales-invoices/{id}", { params: { path: { id } } })),
  });

export const pfListQuery = (f: ListFilter = {}) =>
  queryOptions({
    queryKey: [...keys.sales, "pf", f],
    queryFn: () => call<ProformaListItem[]>(() => api.GET("/api/proformas", q(f))),
  });
export const pfQuery = (id: string) =>
  queryOptions({
    queryKey: [...keys.sales, "pf", "detail", id],
    queryFn: () =>
      call<ProformaDetail>(() => api.GET("/api/proformas/{id}", { params: { path: { id } } })),
  });

export const srListQuery = (f: ListFilter = {}) =>
  queryOptions({
    queryKey: [...keys.sales, "sr", f],
    queryFn: () => call<SalesReturnItem[]>(() => api.GET("/api/sales-returns", q(f))),
  });
export const srQuery = (id: string) =>
  queryOptions({
    queryKey: [...keys.sales, "sr", "detail", id],
    queryFn: () =>
      call<SalesReturnDetail>(() =>
        api.GET("/api/sales-returns/{id}", { params: { path: { id } } }),
      ),
  });

export const noteListQuery = (f: ListFilter = {}) =>
  queryOptions({
    queryKey: [...keys.sales, "note", f],
    queryFn: () => call<NoteItem[]>(() => api.GET("/api/customer-notes", q(f))),
  });
export const noteQuery = (id: string) =>
  queryOptions({
    queryKey: [...keys.sales, "note", "detail", id],
    queryFn: () =>
      call<NoteDetail>(() => api.GET("/api/customer-notes/{id}", { params: { path: { id } } })),
  });

export const ledgerQuery = (customerId: string) =>
  queryOptions({
    queryKey: [...keys.sales, "ledger", customerId],
    queryFn: () =>
      call<CustomerLedger>(() =>
        api.GET("/api/customers/{id}/ledger", {
          params: { path: { id: customerId }, query: {} },
        }),
      ),
  });

export const irnQueueQuery = queryOptions({
  queryKey: [...keys.sales, "irn-queue"],
  queryFn: () => call<EInvoiceQueueItem[]>(() => api.GET("/api/einvoice/queue")),
});
export const irnRequestsQuery = (docType: "SI" | "CN" | "DN", id: string) =>
  queryOptions({
    queryKey: [...keys.sales, "irn-requests", docType, id],
    queryFn: () =>
      call<EInvoiceRequestItem[]>(() =>
        api.GET("/api/einvoice/{docType}/{id}/requests", {
          params: { path: { docType, id } },
        }),
      ),
  });

// ── labels & tones ───────────────────────────────────────────────────────────

export const SO_TONE: Record<SoListItem["status"], Tone> = {
  Draft: "neutral",
  Confirmed: "info",
  OnHold: "danger",
  PartiallyFulfilled: "warning",
  Closed: "success",
  Cancelled: "neutral",
};
export const STATUS_LABEL: Record<string, string> = {
  OnHold: "On hold",
  PartiallyFulfilled: "Part dispatched",
  NotRequired: "Not required",
  Generated: "IRN generated",
  Pending: "IRN pending",
  Failed: "IRN failed",
};
export const DC_TONE: Record<DcListItem["status"], Tone> = {
  Draft: "neutral",
  Open: "info",
  Closed: "success",
  Cancelled: "neutral",
};
export const DOC_TONE: Record<string, Tone> = {
  Draft: "neutral",
  Sent: "info",
  Posted: "success",
  Converted: "success",
  Cancelled: "danger",
};
export const IRN_TONE: Record<SiListItem["einvoiceStatus"], Tone> = {
  NotRequired: "neutral",
  Pending: "warning",
  Generated: "success",
  Failed: "danger",
  Cancelled: "neutral",
};
export const CREDIT_REASON_LABEL: Record<CreditCheck["reasons"][number], string> = {
  MANUAL_BLOCK: "Customer blocked",
  OVER_LIMIT: "Over credit limit",
  OVER_DUE: "Overdue invoices",
};
export const RATE_SOURCE_LABEL: Record<RateQuote["source"], string> = {
  PARTY_RATE: "Customer rate",
  SALESMAN_DEFAULT: "Salesman default",
  NONE: "No rate on file",
};
export const NOTE_REASON_LABEL: Record<string, string> = {
  RETURN: "Sales return",
  RATE_DIFFERENCE: "Rate difference",
  DISCOUNT: "Discount",
  SHORTAGE: "Shortage",
  OTHER: "Other",
};

/** "1,000 m" with a non-breaking space, so a unit never wraps from its number. */
export const metres = (m: number) => `${m.toLocaleString("en-IN")}\u00a0m`;

/**
 * Opens a document PDF in a new tab (made by the worker's Chromium). The response is a file, so
 * it is fetched directly rather than through the typed client.
 */
export async function openDocumentPdf(
  kind: "sales-invoices" | "customer-notes" | "delivery-challans" | "proformas",
  id: string,
): Promise<void> {
  // Open the tab first, inside the click, so pop-up blockers allow it.
  const tab = window.open("", "_blank");
  const res = await fetch(`/api/${kind}/${id}/pdf`, { credentials: "include" });
  if (!res.ok) {
    tab?.close();
    throw new ApiError(res.status, await res.json());
  }
  const url = URL.createObjectURL(await res.blob());
  if (tab) tab.location.href = url;
  else window.open(url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * POST a document action (`/api/<doc>/{id}/<action>`). All of them take `{ version }` (some a
 * little more) and may need a reason; the typed client is told the shared shape.
 */
export function docAction<T>(
  path: `/api/${string}/{id}/${string}`,
  id: string,
  body: Record<string, unknown>,
  reason?: string,
): Promise<T> {
  return call<T>(
    () =>
      api.POST(path as "/api/sales-orders/{id}/confirm", {
        params: { path: { id } },
        headers: reasonHeader(reason),
        body: body as { version: number },
      }) as never,
  );
}

/** ₹ amount that never wraps between the symbol and the figure. */
export const rupees = (v: Parameters<typeof formatINR>[0]) => formatINR(v).replace(" ", "\u00a0");

/** "1 roll", "3 rolls". */
export const count = (n: number, word: string) =>
  `${n.toLocaleString("en-IN")} ${word}${n === 1 ? "" : "s"}`;
/** "Gujarat (24)". */
export const placeOfSupply = (code: string) => `${GST_STATES[code] ?? code} (${code})`;
