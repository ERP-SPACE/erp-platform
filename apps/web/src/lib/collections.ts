import type {
  AgingReport,
  AllocationSuggestion,
  BlockedOrderItem,
  CommissionEntryItem,
  CommissionSummary,
  OpenItemsResponse,
  PartyStatement,
  PayoutDetail,
  PayoutListItem,
  ReceiptDetail,
  ReceiptListItem,
} from "@erp/contracts";
import type { Tone } from "@erp/ui";
import { queryOptions } from "@tanstack/react-query";
import { ApiError, api, call } from "./api.js";
import { keys } from "./queries.js";

/** Stage 4 screens: customer receipts and supplier payments share one shape (`kind`). */
export type MoneyKind = "receipts" | "payments";
export type PartyType = "CUSTOMER" | "SUPPLIER";
export const KIND: Record<
  MoneyKind,
  {
    path: "/api/receipts" | "/api/supplier-payments";
    party: PartyType;
    partyApi: "customers" | "suppliers";
    title: string;
    one: string;
    newLabel: string;
    view: string;
    manage: string;
  }
> = {
  receipts: {
    path: "/api/receipts",
    party: "CUSTOMER",
    partyApi: "customers",
    title: "Receipts",
    one: "Receipt",
    newLabel: "New receipt",
    view: "collections.view",
    manage: "collections.receipt.manage",
  },
  payments: {
    path: "/api/supplier-payments",
    party: "SUPPLIER",
    partyApi: "suppliers",
    title: "Supplier payments",
    one: "Payment",
    newLabel: "New payment",
    view: "payables.view",
    manage: "payables.payment.manage",
  },
};

export const moneyListQuery = (
  kind: MoneyKind,
  filter: { partyId?: string; onAccount?: "true" } = {},
) =>
  queryOptions({
    queryKey: [...keys.collections, kind, filter],
    queryFn: () =>
      call<ReceiptListItem[]>(() =>
        api.GET(KIND[kind].path as "/api/receipts", { params: { query: filter } }),
      ),
  });
export const moneyQuery = (kind: MoneyKind, id: string) =>
  queryOptions({
    queryKey: [...keys.collections, kind, "detail", id],
    queryFn: () =>
      call<ReceiptDetail>(() =>
        api.GET(`${KIND[kind].path}/{id}` as "/api/receipts/{id}", { params: { path: { id } } }),
      ),
  });
export const openItemsQuery = (party: PartyType, id: string) =>
  queryOptions({
    queryKey: [...keys.collections, "open", party, id],
    queryFn: () =>
      call<OpenItemsResponse>(() =>
        api.GET(
          (party === "CUSTOMER"
            ? "/api/customers/{id}/open-items"
            : "/api/suppliers/{id}/open-items") as "/api/customers/{id}/open-items",
          { params: { path: { id } } },
        ),
      ),
    enabled: Boolean(id),
  });
export async function fetchSuggestion(party: PartyType, id: string, amount: string) {
  return call<AllocationSuggestion>(() =>
    api.GET(
      (party === "CUSTOMER"
        ? "/api/customers/{id}/allocation-suggestion"
        : "/api/suppliers/{id}/allocation-suggestion") as "/api/customers/{id}/allocation-suggestion",
      { params: { path: { id }, query: { amount } } },
    ),
  );
}
export const statementQuery = (
  party: PartyType,
  id: string,
  range: { from?: string; to?: string },
) =>
  queryOptions({
    queryKey: [...keys.collections, "statement", party, id, range],
    queryFn: () =>
      call<PartyStatement>(() =>
        api.GET(
          (party === "CUSTOMER"
            ? "/api/customers/{id}/statement"
            : "/api/suppliers/{id}/statement") as "/api/customers/{id}/statement",
          { params: { path: { id }, query: range } },
        ),
      ),
  });
export const agingQuery = (partyType: PartyType) =>
  queryOptions({
    queryKey: [...keys.collections, "aging", partyType],
    queryFn: () =>
      call<AgingReport>(() => api.GET("/api/aging", { params: { query: { partyType } } })),
  });
export const blockedOrdersQuery = queryOptions({
  queryKey: [...keys.collections, "blocked"],
  queryFn: () => call<BlockedOrderItem[]>(() => api.GET("/api/credit/blocked-orders")),
});
export const commissionSummaryQuery = queryOptions({
  queryKey: [...keys.collections, "commission", "summary"],
  queryFn: () => call<CommissionSummary[]>(() => api.GET("/api/commission/summary")),
});
export const commissionEntriesQuery = (filter: {
  salesmanId?: string;
  status?: "Accrued" | "Paid";
}) =>
  queryOptions({
    queryKey: [...keys.collections, "commission", "entries", filter],
    queryFn: () =>
      call<CommissionEntryItem[]>(() =>
        api.GET("/api/commission/entries", { params: { query: filter } }),
      ),
  });
export const payoutsQuery = (salesmanId?: string) =>
  queryOptions({
    queryKey: [...keys.collections, "commission", "payouts", salesmanId ?? "all"],
    queryFn: () =>
      call<PayoutListItem[]>(() =>
        api.GET("/api/commission/payouts", {
          params: { query: (salesmanId ? { salesmanId } : {}) as { salesmanId: string } },
        }),
      ),
  });
export const payoutQuery = (id: string) =>
  queryOptions({
    queryKey: [...keys.collections, "commission", "payout", id],
    queryFn: () =>
      call<PayoutDetail>(() =>
        api.GET("/api/commission/payouts/{id}", { params: { path: { id } } }),
      ),
  });

export const MONEY_TONE: Record<ReceiptListItem["status"], Tone> = {
  Draft: "neutral",
  Posted: "success",
  Reversed: "danger",
  Cancelled: "neutral",
};
export const MODE_LABEL: Record<ReceiptListItem["mode"], string> = {
  CASH: "Cash",
  NEFT: "NEFT",
  RTGS: "RTGS",
  UPI: "UPI",
  CHEQUE: "Cheque",
};

/** Opens any account PDF (statement, receipt, payout) in a new tab. */
export async function openAccountPdf(url: string): Promise<void> {
  const tab = window.open("", "_blank");
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    tab?.close();
    throw new ApiError(res.status, await res.json());
  }
  const href = URL.createObjectURL(await res.blob());
  if (tab) tab.location.href = href;
  else window.open(href, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(href), 60_000);
}
