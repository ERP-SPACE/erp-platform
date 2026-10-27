import { z } from "zod";

/**
 * Stage 2 inventory contracts: rolls, stock views, mapping Unmapped rolls, the Roll Inspector,
 * scrap / length correction and labels. Cost fields are null unless the user has
 * `inventory.view_cost` (labels never carry cost — ADR-0006).
 */

export const ROLL_STATUSES = [
  "Unmapped",
  "Mapped",
  "Allocated",
  "Dispatched",
  "Returned",
  "ReturnedToSupplier",
  "Scrap",
] as const;

export const rollItem = z.object({
  id: z.string(),
  barcode: z.string(),
  status: z.enum(ROLL_STATUSES),
  skuId: z.string().nullable(),
  skuCode: z.string().nullable(),
  /** Product name when mapped, else the GRN line's description. */
  description: z.string(),
  gsm: z.number().int(),
  widthIn: z.string(),
  qualityName: z.string().nullable(),
  originalLengthM: z.number().int(),
  currentLengthM: z.number().int(),
  supplierId: z.string(),
  supplierName: z.string(),
  batchCode: z.string(),
  supplierBatchRef: z.string().nullable(),
  grnId: z.string(),
  grnNo: z.string(),
  receivedAt: z.string(),
  ageDays: z.number().int(),
  baseCostPerM: z.string().nullable(),
  landedCostPerM: z.string().nullable(),
  version: z.number().int(),
});

export const rollListQuery = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(ROLL_STATUSES).optional(),
  skuId: z.string().optional(),
  supplierId: z.string().optional(),
  grnId: z.string().optional(),
  inStock: z.enum(["true", "false"]).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(200),
  cursor: z.string().optional(),
});
export const rollPage = z.object({ items: z.array(rollItem), nextCursor: z.string().nullable() });

/** Roll Inspector (PRD UAT §11.2): supplier → batch → GRN → PI → cost → movements. */
export const rollEvent = z.object({
  at: z.string(),
  kind: z.enum(["STATUS", "LENGTH", "COST", "LABEL", "DOCUMENT"]),
  title: z.string(),
  detail: z.string().nullable(),
  byName: z.string().nullable(),
  docType: z.string().nullable(),
  docId: z.string().nullable(),
  docNo: z.string().nullable(),
});
export const rollInspector = rollItem.extend({
  piId: z.string().nullable(),
  piNo: z.string().nullable(),
  supplierInvoiceNo: z.string().nullable(),
  baseValue: z.string().nullable(),
  landedCost: z.string().nullable(),
  weightKg: z.string(),
  parentRollId: z.string().nullable(),
  childRollIds: z.array(z.string()),
  labelPrints: z.number().int(),
  events: z.array(rollEvent),
});

// ── actions ───────────────────────────────────────────────────────────────────

/** Map Unmapped rolls to an existing SKU, or create the product/SKU on the fly (PRD §6.2). */
export const mapRollsInput = z
  .object({
    rollIds: z.array(z.string()).min(1).max(2000),
    skuId: z.string().optional(),
    createSku: z
      .object({
        categoryId: z.string(),
        qualityId: z.string(),
        gsm: z.number().int().positive(),
        widthIn: z.number().positive(),
        defaultLengthM: z.number().int().positive(),
      })
      .optional(),
  })
  .refine((v) => Boolean(v.skuId) !== Boolean(v.createSku), "Choose a SKU or describe a new one");
export const mapRollsResult = z.object({ mapped: z.number().int(), skuId: z.string() });

/** Scrap needs `inventory.adjust`, step-up and a reason (X-Change-Reason); writes ROLL_SCRAPPED. */
export const scrapRollsInput = z.object({ rollIds: z.array(z.string()).min(1).max(500) });
export const scrapRollsResult = z.object({
  scrapped: z.number().int(),
  value: z.string().nullable(),
});

/** Correct a mis-keyed length (supplier lengths are trusted, but typos happen). Reason required. */
export const rollLengthCorrection = z.object({
  currentLengthM: z.number().int().positive(),
  version: z.number().int().positive(),
});

export const labelRequest = z
  .object({
    rollIds: z.array(z.string()).max(2000).default([]),
    grnId: z.string().optional(),
    /** Reprints are logged with this reason (damaged label, returned roll…). */
    reprint: z.boolean().default(false),
  })
  .refine((v) => v.rollIds.length > 0 || Boolean(v.grnId), "Choose rolls or a goods receipt");

// ── stock views (materialized, refreshed every 3 min — ADR-0005) ─────────────

export const stockRow = z.object({
  skuId: z.string().nullable(),
  skuCode: z.string().nullable(),
  description: z.string(),
  categoryName: z.string().nullable(),
  gsm: z.number().int(),
  widthIn: z.string(),
  rolls: z.number().int(),
  metres: z.number().int(),
  value: z.string().nullable(),
  oldestDays: z.number().int(),
});
export const stockSummary = z.object({
  asOf: z.string(),
  rows: z.array(stockRow),
  totals: z.object({
    rolls: z.number().int(),
    metres: z.number().int(),
    value: z.string().nullable(),
    unmappedRolls: z.number().int(),
    deadStockRolls: z.number().int(),
  }),
});
export const stockGroupBy = z.object({ by: z.enum(["sku", "batch", "supplier"]).default("sku") });

export type RollItem = z.infer<typeof rollItem>;
export type RollPage = z.infer<typeof rollPage>;
export type RollInspector = z.infer<typeof rollInspector>;
export type RollEvent = z.infer<typeof rollEvent>;
export type StockSummary = z.infer<typeof stockSummary>;
export type StockRow = z.infer<typeof stockRow>;

/** Large label batches render in the worker; poll the job, then download the file. */
export const labelJobCreated = z.object({ jobId: z.string(), count: z.number().int() });
export const labelJobStatus = z.object({
  jobId: z.string(),
  state: z.enum(["waiting", "active", "completed", "failed", "delayed", "unknown"]),
  /** Labels rendered so far. */
  done: z.number().int(),
  count: z.number().int(),
  fileName: z.string().nullable(),
  error: z.string().nullable(),
});
export type LabelJobStatus = z.infer<typeof labelJobStatus>;
