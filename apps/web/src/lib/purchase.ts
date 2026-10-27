import type {
  GrnDetail,
  GrnListItem,
  LandedCostChargeItem,
  LabelJobStatus,
  PiDetail,
  PiListItem,
  PoDetail,
  PoListItem,
  PurchaseReturnDetail,
  PurchaseReturnItem,
  RollInspector,
  RollPage,
  StockSummary,
} from "@erp/contracts";
import { queryOptions } from "@tanstack/react-query";
import { ApiError, api, call, reasonHeader } from "./api.js";
import { keys } from "./queries.js";

/** Query options for the Stage 2 screens; keys nest under keys.purchase / keys.inventory. */
export const poListQuery = queryOptions({
  queryKey: [...keys.purchase, "po"],
  queryFn: () =>
    call<PoListItem[]>(() => api.GET("/api/purchase-orders", { params: { query: {} } })),
});
export const poQuery = (id: string) =>
  queryOptions({
    queryKey: [...keys.purchase, "po", id],
    queryFn: () =>
      call<PoDetail>(() => api.GET("/api/purchase-orders/{id}", { params: { path: { id } } })),
  });

export const grnListQuery = queryOptions({
  queryKey: [...keys.purchase, "grn"],
  queryFn: () =>
    call<GrnListItem[]>(() => api.GET("/api/goods-receipts", { params: { query: {} } })),
});
export const grnQuery = (id: string) =>
  queryOptions({
    queryKey: [...keys.purchase, "grn", id],
    queryFn: () =>
      call<GrnDetail>(() => api.GET("/api/goods-receipts/{id}", { params: { path: { id } } })),
  });

export const piListQuery = queryOptions({
  queryKey: [...keys.purchase, "pi"],
  queryFn: () =>
    call<PiListItem[]>(() => api.GET("/api/purchase-invoices", { params: { query: {} } })),
});
export const piQuery = (id: string) =>
  queryOptions({
    queryKey: [...keys.purchase, "pi", id],
    queryFn: () =>
      call<PiDetail>(() => api.GET("/api/purchase-invoices/{id}", { params: { path: { id } } })),
  });
export const landedChargesQuery = (piId: string) =>
  queryOptions({
    queryKey: [...keys.purchase, "pi", piId, "landed"],
    queryFn: () =>
      call<LandedCostChargeItem[]>(() =>
        api.GET("/api/purchase-invoices/{id}/landed-cost", { params: { path: { id: piId } } }),
      ),
  });

export const returnListQuery = queryOptions({
  queryKey: [...keys.purchase, "pr"],
  queryFn: () => call<PurchaseReturnItem[]>(() => api.GET("/api/purchase-returns")),
});
export const returnQuery = (id: string) =>
  queryOptions({
    queryKey: [...keys.purchase, "pr", id],
    queryFn: () =>
      call<PurchaseReturnDetail>(() =>
        api.GET("/api/purchase-returns/{id}", { params: { path: { id } } }),
      ),
  });

export const rollsQuery = (filters: {
  status?: string;
  grnId?: string;
  supplierId?: string;
  inStock?: "true" | "false";
  q?: string;
  limit?: number;
}) =>
  queryOptions({
    queryKey: [...keys.inventory, "rolls", filters],
    queryFn: () =>
      call<RollPage>(() =>
        api.GET("/api/rolls", { params: { query: { limit: 500, ...filters } as never } }),
      ),
  });
export const rollQuery = (idOrBarcode: string) =>
  queryOptions({
    queryKey: [...keys.inventory, "roll", idOrBarcode],
    queryFn: () =>
      call<RollInspector>(() =>
        api.GET("/api/rolls/{idOrBarcode}", { params: { path: { idOrBarcode } } }),
      ),
    retry: false,
  });
export const stockQuery = (by: "sku" | "batch" | "supplier") =>
  queryOptions({
    queryKey: [...keys.inventory, "stock", by],
    queryFn: () =>
      call<StockSummary>(() => api.GET("/api/inventory/stock", { params: { query: { by } } })),
  });

export const PO_TONE = {
  Draft: "neutral",
  Approved: "info",
  PartiallyReceived: "warning",
  Closed: "success",
  Cancelled: "danger",
} as const;
export const DOC_TONE = {
  Draft: "neutral",
  Created: "neutral",
  Posted: "success",
  Cancelled: "danger",
} as const;
export const ROLL_TONE = {
  Unmapped: "warning",
  Mapped: "success",
  Allocated: "info",
  Dispatched: "primary",
  Returned: "warning",
  ReturnedToSupplier: "neutral",
  Scrap: "danger",
} as const;
export const ROLL_LABEL: Record<string, string> = {
  ReturnedToSupplier: "Returned to supplier",
  PartiallyReceived: "Partly received",
};

/**
 * Labels as a file. Up to 300 render at once; bigger batches are queued for the worker and
 * polled until ready. No Idempotency-Key: the response is a file, not JSON (API note).
 */
export async function printLabels(
  body: { rollIds?: string[]; grnId?: string; reprint?: boolean },
  reason?: string,
  onProgress?: (status: LabelJobStatus) => void,
): Promise<void> {
  const request = {
    rollIds: body.rollIds ?? [],
    grnId: body.grnId,
    reprint: body.reprint ?? false,
  };
  const headers = { "content-type": "application/json", ...reasonHeader(reason) };
  let res = await fetch("/api/labels", {
    method: "POST",
    headers,
    credentials: "include",
    body: JSON.stringify(request),
  });
  if (res.status === 400) {
    const problem = await res.clone().json();
    if (String(problem.title).includes("background printing")) {
      res = await queued(request, headers, onProgress);
    }
  }
  if (!res.ok) throw new ApiError(res.status, await res.json());
  const blob = await res.blob();
  const name =
    /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ??
    "roll-labels.pdf";
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  if (blob.type.includes("pdf")) {
    window.open(url, "_blank", "noopener");
  } else {
    a.href = url;
    a.download = name;
    a.click();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function queued(
  request: object,
  headers: Record<string, string>,
  onProgress?: (status: LabelJobStatus) => void,
): Promise<Response> {
  const created = await fetch("/api/labels/jobs", {
    method: "POST",
    headers,
    credentials: "include",
    body: JSON.stringify(request),
  });
  if (!created.ok) return created;
  const { jobId } = (await created.json()) as { jobId: string };
  for (;;) {
    await new Promise((r) => setTimeout(r, 1500));
    const status = (await (
      await fetch(`/api/labels/jobs/${jobId}`, { credentials: "include" })
    ).json()) as LabelJobStatus;
    onProgress?.(status);
    if (status.state === "completed")
      return fetch(`/api/labels/jobs/${jobId}/file`, { credentials: "include" });
    if (status.state === "failed" || status.state === "unknown") {
      return new Response(
        JSON.stringify({
          title: status.error ?? "Label job failed",
          status: 500,
          code: "INTERNAL_ERROR",
        }),
        {
          status: 500,
          headers: { "content-type": "application/json" },
        },
      );
    }
  }
}
