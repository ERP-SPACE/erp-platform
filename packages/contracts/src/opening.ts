import { z } from "zod";
import { isoDate } from "./masters.js";

/**
 * Stage 6 contracts: the Opening Balance Wizard (PRD §5.10) — CSV uploads checked before
 * anything is saved, batches that can be discarded until go-live, chapter confirmation against
 * the books (Q43), bank / cash balances as data for the Accounting stage, and the Go-Live lock.
 */

const money = z.string().regex(/^\d{1,13}(\.\d{1,2})?$/, "Enter an amount like 1250.50");

export const OPENING_CHAPTERS = ["STOCK", "AR", "AP", "CASH"] as const;
export type OpeningChapterCode = (typeof OPENING_CHAPTERS)[number];

/** What a CSV upload is: stock roll by roll or per SKU (Q41), receivables, payables. */
export const OPENING_BATCH_KINDS = ["STOCK_ROLLS", "STOCK_SKU", "AR", "AP"] as const;
export type OpeningBatchKind = (typeof OPENING_BATCH_KINDS)[number];
export const BATCH_CHAPTER: Record<OpeningBatchKind, OpeningChapterCode> = {
  STOCK_ROLLS: "STOCK",
  STOCK_SKU: "STOCK",
  AR: "AR",
  AP: "AP",
};

export const CHAPTER_STATUSES = ["Empty", "Draft", "Confirmed", "NotNeeded"] as const;
export const BATCH_STATUSES = ["Imported", "Discarded"] as const;

/** Templates offered for download; headers match the domain parser's aliases. */
export const OPENING_TEMPLATES: Record<OpeningBatchKind, { fileName: string; csv: string }> = {
  STOCK_ROLLS: {
    fileName: "opening-stock-rolls.csv",
    csv:
      "barcode,supplier,sku,gsm,quality,width,metres,cost_per_m,received_date,batch\r\n" +
      ",SUP-001,,29,Standard,44,1000,4.9896,15-01-2027,B-12\r\n",
  },
  STOCK_SKU: {
    fileName: "opening-stock-by-sku.csv",
    csv: "supplier,sku,rolls,metres,value\r\nSUP-001,SUB-29-STD-44,3,2500,12500.00\r\n",
  },
  AR: {
    fileName: "opening-receivables.csv",
    csv: "customer,invoice_no,date,amount,due_date\r\nCUS-001,R/649,15-03-2027,8260.00,14-04-2027\r\n",
  },
  AP: {
    fileName: "opening-payables.csv",
    csv: "supplier,invoice_no,date,amount,due_date\r\nSUP-001,INV-2231,10-03-2027,59000.00,09-04-2027\r\n",
  },
};

/** CSV files up to 5 MB (≈ 50,000 rolls). */
export const openingUpload = z.object({
  kind: z.enum(OPENING_BATCH_KINDS),
  fileName: z.string().trim().max(200),
  csv: z.string().min(1, "The file is empty").max(5_000_000, "The file is larger than 5 MB"),
  /** Only check and report; save nothing. */
  dryRun: z.boolean().default(true),
});
export type OpeningUpload = z.infer<typeof openingUpload>;

const issue = z.object({
  line: z.number().int(),
  column: z.string().optional(),
  message: z.string(),
});

/** What an upload would create (dry run) or created. */
export const openingCheckReport = z.object({
  kind: z.enum(OPENING_BATCH_KINDS),
  rowCount: z.number().int(),
  okCount: z.number().int(),
  errors: z.array(issue),
  warnings: z.array(issue),
  /** Σ value (stock) or Σ amount (AR / AP) of the good rows. */
  total: z.string(),
  metres: z.number().int().nullable(),
  /** Rolls that would be created (stock). */
  rolls: z.number().int().nullable(),
  /** First rows as they will be saved, for the screen. */
  preview: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.null()]))),
  /** Set when saved (dryRun false and no errors). */
  batchId: z.string().nullable(),
});
export type OpeningCheckReport = z.infer<typeof openingCheckReport>;

export const openingBatch = z.object({
  id: z.string(),
  kind: z.enum(OPENING_BATCH_KINDS),
  status: z.enum(BATCH_STATUSES),
  fileName: z.string(),
  rowCount: z.number().int(),
  total: z.string(),
  metres: z.number().int().nullable(),
  /** Opening GRN numbers (stock) — rolls and labels hang off them. */
  documents: z.array(z.object({ id: z.string(), docNo: z.string() })),
  createdAt: z.string(),
  createdByName: z.string().nullable(),
  discardedAt: z.string().nullable(),
  discardReason: z.string().nullable(),
  /** False once a roll was picked / an invoice was paid: then it can't be discarded. */
  discardable: z.boolean(),
});
export type OpeningBatch = z.infer<typeof openingBatch>;

export const batchDiscard = z.object({ reason: z.string().trim().min(3).max(300) });

/** Confirm a chapter against the figure in the old books (Q43). */
export const chapterConfirm = z.object({ booksTotal: money });
export const chapterNotNeeded = z.object({ reason: z.string().trim().min(3).max(300) });

export const CASH_KINDS = ["BANK", "CASH"] as const;
const cashAccountFields = z.object({
  name: z.string().trim().min(2).max(80),
  kind: z.enum(CASH_KINDS),
  bankName: z.string().trim().max(80).nullable().optional(),
  accountLast4: z
    .string()
    .regex(/^\d{4}$/, "Last 4 digits")
    .nullable()
    .optional(),
  /** Overdrawn bank accounts are entered as negative. */
  balance: z.string().regex(/^-?\d{1,13}(\.\d{1,2})?$/, "Enter an amount like 1250.50"),
  asOf: isoDate,
});
const needsBank = (a: { kind: string; bankName?: string | null }) =>
  a.kind === "CASH" || !!a.bankName;
export const cashAccountInput = cashAccountFields.refine(needsBank, {
  message: "Enter the bank's name",
  path: ["bankName"],
});
export const cashAccountUpdate = cashAccountFields
  .extend({ version: z.number().int().positive() })
  .refine(needsBank, { message: "Enter the bank's name", path: ["bankName"] });
export const cashAccount = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(CASH_KINDS),
  bankName: z.string().nullable(),
  accountLast4: z.string().nullable(),
  balance: z.string(),
  asOf: z.string(),
  confirmedAt: z.string().nullable(),
  confirmedByName: z.string().nullable(),
  version: z.number().int(),
});
export type CashAccount = z.infer<typeof cashAccount>;

export const openingChapter = z.object({
  chapter: z.enum(OPENING_CHAPTERS),
  status: z.enum(CHAPTER_STATUSES),
  /** Σ of imported, not discarded batches (CASH: Σ balances). */
  total: z.string(),
  booksTotal: z.string().nullable(),
  difference: z.string().nullable(),
  notNeededReason: z.string().nullable(),
  confirmedAt: z.string().nullable(),
  confirmedByName: z.string().nullable(),
  batches: z.array(openingBatch),
});
export type OpeningChapter = z.infer<typeof openingChapter>;

export const openingStatus = z.object({
  goLiveDate: z.string().nullable(),
  /** Opening documents are dated this day (the day before go-live). */
  openingDate: z.string().nullable(),
  lockedAt: z.string().nullable(),
  lockedByName: z.string().nullable(),
  /** "manual" (Go live pressed) or the first live document that locked it. */
  lockedBy: z.string().nullable(),
  chapters: z.array(openingChapter),
  cash: z.array(cashAccount),
  /** Why "Go live" is not available yet; empty when it is. */
  blockers: z.array(z.string()),
});
export type OpeningStatus = z.infer<typeof openingStatus>;

export const goLiveRequest = z.object({
  /** Typed by the Owner to avoid a slip of the mouse. */
  confirm: z.literal("GO LIVE"),
});
