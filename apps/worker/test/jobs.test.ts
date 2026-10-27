import type { LabelJobData } from "@erp/labels";
import { labelFileKey } from "@erp/labels";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { ANALYTICS_REFRESH_FUNCTIONS, handlers } from "../src/jobs/handlers.js";
import { processLabelJob } from "../src/jobs/labels.js";

const log = pino({ level: "silent" });

const data = (n: number): LabelJobData => ({
  companyId: "c1",
  userId: "u1",
  reprint: false,
  reason: null,
  layout: { widthMm: 100, heightMm: 50, output: "PDF", layout: "A4_2x5" },
  labels: Array.from({ length: n }, (_, i) => ({
    id: `roll-${i}`,
    barcode: `2610-SBC-0001-${String(i + 1).padStart(4, "0")}-K`,
    description: "Sublimation Paper Eco 29 GSM 44″",
    gsm: 29,
    widthIn: "44",
    lengthM: 1000,
    lot: "0001 (CONT-13)",
    received: "27-10-2026",
  })),
});

describe("label job processor", () => {
  it("renders the batch, stores the file for an hour, logs every print and reports progress", async () => {
    const stored: { key: string; bytes: number; ttl: number }[] = [];
    const inserted: unknown[][] = [];
    const progress: number[] = [];
    const result = await processLabelJob(
      { id: "42", data: data(120), updateProgress: async (p) => progress.push(p) },
      {
        log,
        redis: {
          set: async (key, value, _mode, ttl) => stored.push({ key, bytes: value.length, ttl }),
        },
        db: {
          db: { insert: () => ({ values: async (rows: unknown[]) => inserted.push(rows) }) },
        } as never,
      },
    );
    expect(result).toMatchObject({ count: 120, contentType: "application/pdf" });
    expect(result.fileName).toMatch(/^roll-labels-\d{12}\.pdf$/);
    expect(stored).toEqual([{ key: labelFileKey("42"), bytes: result.bytes, ttl: 3600 }]);
    expect(inserted.flat()).toHaveLength(120);
    expect(inserted.flat()[0]).toMatchObject({
      rollId: "roll-0",
      format: "PDF-A4_2x5",
      createdBy: "u1",
    });
    expect(progress).toEqual([50, 100, 120]);
  });
});

describe("analytics refresh", () => {
  it("refreshes through the SECURITY DEFINER functions (the worker role can't REFRESH directly)", async () => {
    const executed: string[] = [];
    const redisSet: string[] = [];
    const result = await handlers["analytics.refresh"]({
      log,
      redis: { set: async (k: string) => redisSet.push(k) } as never,
      db: {
        db: {
          execute: async (q: { queryChunks?: { value?: string[] }[] }) => {
            executed.push(q.queryChunks?.map((c) => c.value?.join("") ?? "").join("") ?? "");
            return { rows: [] };
          },
        },
      } as never,
    });
    expect(ANALYTICS_REFRESH_FUNCTIONS).toContain("public.refresh_stock_views");
    expect(executed).toEqual(["SELECT public.refresh_stock_views()"]);
    expect(redisSet).toEqual(["erp:analytics:refreshed-at"]);
    expect(result).toEqual({ refreshed: 1 });
  });
});
