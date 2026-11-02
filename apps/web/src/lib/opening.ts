import type {
  CashAccount,
  OpeningBatchKind,
  OpeningChapterCode,
  OpeningCheckReport,
  OpeningStatus,
} from "@erp/contracts";
import { D } from "@erp/domain";
import { queryOptions } from "@tanstack/react-query";
import { api, call } from "./api.js";

/** Stage 6: the Opening Balance Wizard (PRD §5.10). */
export const openingKeys = { all: ["opening"] as const };

export const openingQuery = queryOptions({
  queryKey: openingKeys.all,
  queryFn: () => call<OpeningStatus>(() => api.GET("/api/opening")),
});

export const uploadOpening = (body: {
  kind: OpeningBatchKind;
  fileName: string;
  csv: string;
  dryRun: boolean;
}) => call<OpeningCheckReport>(() => api.POST("/api/opening/uploads", { body }));

export const discardBatch = (id: string, reason: string) =>
  call(() =>
    api.POST("/api/opening/batches/{id}/discard", { params: { path: { id } }, body: { reason } }),
  );

export const confirmChapter = (chapter: OpeningChapterCode, booksTotal: string) =>
  call<OpeningStatus>(() =>
    api.POST("/api/opening/chapters/{chapter}/confirm", {
      params: { path: { chapter } },
      body: { booksTotal },
    }),
  );

export const chapterNotNeeded = (chapter: OpeningChapterCode, reason: string) =>
  call<OpeningStatus>(() =>
    api.POST("/api/opening/chapters/{chapter}/not-needed", {
      params: { path: { chapter } },
      body: { reason },
    }),
  );

export type CashInput = {
  name: string;
  kind: "BANK" | "CASH";
  bankName?: string | null;
  accountLast4?: string | null;
  balance: string;
  asOf: string;
};
export const addCash = (body: CashInput) =>
  call<CashAccount[]>(() => api.POST("/api/opening/cash", { body }));
export const updateCash = (id: string, body: CashInput & { version: number }) =>
  call<CashAccount[]>(() => api.PUT("/api/opening/cash/{id}", { params: { path: { id } }, body }));
export const removeCash = (id: string) =>
  call<CashAccount[]>(() => api.DELETE("/api/opening/cash/{id}", { params: { path: { id } } }));
export const confirmCash = (id: string, version: number) =>
  call<CashAccount[]>(() =>
    api.POST("/api/opening/cash/{id}/confirm", { params: { path: { id } }, body: { version } }),
  );

export const goLive = () =>
  call<OpeningStatus>(() => api.POST("/api/opening/go-live", { body: { confirm: "GO LIVE" } }));

/** Template download URL (served by the API, same origin through the proxy). */
export const templateUrl = (kind: OpeningBatchKind) => `/api/opening/templates/${kind}`;

export const CHAPTER_LABEL: Record<OpeningChapterCode, string> = {
  STOCK: "Stock",
  AR: "Receivables",
  AP: "Payables",
  CASH: "Bank & cash",
};

/** Money in a books field: "1,23,456.50" or "₹ 1234" → "123456.50"; null when not money. */
export function normaliseAmount(raw: string): string | null {
  const t = raw.replace(/[₹,\s]/g, "");
  return /^-?\d+(\.\d{1,2})?$/.test(t) ? D(t).toFixed(2) : null;
}
