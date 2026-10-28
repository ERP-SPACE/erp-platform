import { z } from "zod";
import { isoDate } from "./masters.js";

/**
 * Stage 4 contracts: customer receipts and supplier payments with invoice allocation, statements,
 * AR / AP aging, the blocked-orders view and salesman commission (accruals, payouts, statement).
 * Money travels as decimal strings in rupees and paise.
 */

const money = z.string().regex(/^\d{1,12}(\.\d{1,2})?$/, "Enter an amount like 1250.50");
const positiveMoney = money.refine((v) => Number(v) > 0, "Enter an amount above zero");
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
const versioned = { version: z.number().int().positive() };

export const PARTY_TYPES = ["CUSTOMER", "SUPPLIER"] as const;
export const PAYMENT_MODES = ["CASH", "NEFT", "RTGS", "UPI", "CHEQUE"] as const;
export const RECEIPT_STATUSES = ["Draft", "Posted", "Reversed", "Cancelled"] as const;
/** What can settle an invoice: money received / paid, or an unused note. */
export const SETTLEMENT_SOURCES = ["RECEIPT", "PAYMENT", "CREDIT_NOTE", "DEBIT_NOTE"] as const;

// ── receipts (customers) and payments (suppliers) ────────────────────────────

export const allocationInput = z.object({
  invoiceId: z.string(),
  /** Money applied to the invoice. */
  amount: money,
  /** TDS or short payment that settles the rest without money (Q32). */
  deduction: money.optional(),
});

const moneyDocFields = {
  partyId: z.string(),
  date: isoDate,
  mode: z.enum(PAYMENT_MODES),
  amount: positiveMoney,
  /** UTR, UPI reference or cheque number. */
  reference: optionalText(40),
  bankName: optionalText(60),
  /** Cheque date; may be later than `date` (post-dated). */
  instrumentDate: isoDate.nullable().optional(),
  notes: optionalText(500),
  allocations: z.array(allocationInput).max(200).default([]),
};
const needsReference = (v: { mode: string; reference?: string | null }) =>
  v.mode === "CASH" || Boolean(v.reference?.trim());
const referenceIssue = {
  message: "Enter the UTR / UPI reference or cheque number",
  path: ["reference"],
};

export const receiptCreate = z.object(moneyDocFields).refine(needsReference, referenceIssue);
export const receiptUpdate = z
  .object({ ...moneyDocFields, ...versioned })
  .refine(needsReference, referenceIssue);
export const receiptAction = z.object({ ...versioned });
/** Bounce or mistake: the reason travels in X-Change-Reason (step-up). */
export const receiptReverse = z.object({
  ...versioned,
  kind: z.enum(["BOUNCED", "MISTAKE"]),
});

export const allocationItem = z.object({
  id: z.string(),
  invoiceId: z.string(),
  invoiceNo: z.string(),
  invoiceDate: z.string(),
  amount: z.string(),
  deduction: z.string(),
  /** Set when the allocation was undone by a reversal. */
  reversedAt: z.string().nullable(),
});

export const receiptListItem = z.object({
  id: z.string(),
  /** RC/2627/… for receipts, PY/2627/… for payments; null while Draft. */
  docNo: z.string().nullable(),
  partyType: z.enum(PARTY_TYPES),
  date: z.string(),
  partyId: z.string(),
  partyName: z.string(),
  mode: z.enum(PAYMENT_MODES),
  reference: z.string().nullable(),
  amount: z.string(),
  allocated: z.string(),
  /** On account until used; flagged in lists (PRD §8). */
  unallocated: z.string(),
  status: z.enum(RECEIPT_STATUSES),
  version: z.number().int(),
});
export const receiptDetail = receiptListItem.extend({
  bankName: z.string().nullable(),
  instrumentDate: z.string().nullable(),
  notes: z.string().nullable(),
  allocations: z.array(allocationItem),
  postedAt: z.string().nullable(),
  reversedAt: z.string().nullable(),
  reversalKind: z.enum(["BOUNCED", "MISTAKE"]).nullable(),
  reversalReason: z.string().nullable(),
});

/** A party's open invoices with what each still owes, for the allocation table. */
export const openItem = z.object({
  id: z.string(),
  docNo: z.string(),
  date: z.string(),
  dueDate: z.string(),
  total: z.string(),
  outstanding: z.string(),
  daysPastDue: z.number().int(),
});
/** Unused money and notes a party has, to settle invoices later. */
export const unusedCredit = z.object({
  source: z.enum(SETTLEMENT_SOURCES),
  id: z.string(),
  docNo: z.string(),
  date: z.string(),
  available: z.string(),
});
export const openItemsResponse = z.object({
  invoices: z.array(openItem),
  credits: z.array(unusedCredit),
});
export const allocationSuggestQuery = z.object({ amount: positiveMoney });
export const allocationSuggestion = z.object({
  lines: z.array(z.object({ invoiceId: z.string(), amount: z.string() })),
  unallocated: z.string(),
});

/** Use on-account money or an unused note against invoices, without a new receipt. */
export const applyCredit = z.object({
  source: z.enum(SETTLEMENT_SOURCES),
  sourceId: z.string(),
  allocations: z.array(allocationInput).min(1).max(200),
});

export const moneyListQuery = z.object({
  q: z.string().trim().max(100).optional(),
  partyId: z.string().optional(),
  status: z.string().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  /** Only those with money still on account. */
  onAccount: z.enum(["true", "false"]).optional(),
});

// ── statements & aging ───────────────────────────────────────────────────────

export const statementQuery = z.object({ from: isoDate.optional(), to: isoDate.optional() });
export const statementEntry = z.object({
  date: z.string(),
  docType: z.enum(["OPENING", "SI", "CN", "DN", "PI", "RC", "PY", "REV"]),
  docId: z.string().nullable(),
  docNo: z.string(),
  description: z.string(),
  debit: z.string(),
  credit: z.string(),
  balance: z.string(),
});
export const agingBucketItem = z.object({ label: z.string(), amount: z.string() });
export const partyStatement = z.object({
  partyType: z.enum(PARTY_TYPES),
  partyId: z.string(),
  partyName: z.string(),
  gstin: z.string().nullable(),
  from: z.string(),
  to: z.string(),
  opening: z.string(),
  entries: z.array(statementEntry),
  closing: z.string(),
  onAccount: z.string(),
  aging: z.array(agingBucketItem),
});

export const agingQuery = z.object({
  partyType: z.enum(PARTY_TYPES),
  asOf: isoDate.optional(),
  q: z.string().trim().max(100).optional(),
});
export const agingRow = z.object({
  partyId: z.string(),
  partyName: z.string(),
  /** One amount per bucket, in the order of `buckets`. */
  buckets: z.array(z.string()),
  total: z.string(),
  onAccount: z.string(),
  oldestDays: z.number().int(),
});
export const agingReport = z.object({
  partyType: z.enum(PARTY_TYPES),
  asOf: z.string(),
  buckets: z.array(z.string()),
  rows: z.array(agingRow),
  totals: z.array(z.string()),
  total: z.string(),
});

// ── credit control ───────────────────────────────────────────────────────────

export const blockedOrderItem = z.object({
  soId: z.string(),
  soNo: z.string(),
  date: z.string(),
  customerId: z.string(),
  customerName: z.string(),
  total: z.string(),
  reasons: z.array(z.enum(["MANUAL_BLOCK", "OVER_LIMIT", "OVER_DUE"])),
  exposure: z.string(),
  limit: z.string(),
  maxDaysPastDue: z.number().int(),
  lastReceiptDate: z.string().nullable(),
  lastReceiptAmount: z.string().nullable(),
  heldSince: z.string().nullable(),
  version: z.number().int(),
});

// ── commission ───────────────────────────────────────────────────────────────

export const COMMISSION_ENTRY_STATUSES = ["Accrued", "Paid"] as const;
export const COMMISSION_SOURCES = ["SI", "CN", "RC"] as const;
export const PAYOUT_STATUSES = ["Draft", "Paid", "Cancelled"] as const;

export const commissionEntryItem = z.object({
  id: z.string(),
  salesmanId: z.string(),
  customerId: z.string(),
  customerName: z.string(),
  /** The document that caused it: invoice posted, credit note, receipt (or its reversal). */
  sourceType: z.enum(COMMISSION_SOURCES),
  sourceId: z.string(),
  sourceNo: z.string(),
  invoiceId: z.string(),
  invoiceNo: z.string(),
  date: z.string(),
  method: z.enum(["PER_METER", "PERCENT_SALES"]),
  rate: z.string(),
  /** Negative for a reversal. */
  amount: z.string(),
  reversalReason: z.string().nullable(),
  status: z.enum(COMMISSION_ENTRY_STATUSES),
  payoutId: z.string().nullable(),
  payoutNo: z.string().nullable(),
});
export const commissionQuery = z.object({
  salesmanId: z.string().optional(),
  status: z.enum(COMMISSION_ENTRY_STATUSES).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

export const payoutCreate = z.object({
  salesmanId: z.string(),
  /** Settles every accrued entry dated on or before this day (Q34: monthly). */
  upTo: isoDate,
  notes: optionalText(500),
});
export const payoutPay = z.object({
  ...versioned,
  paidOn: isoDate,
  mode: z.enum(PAYMENT_MODES),
  reference: optionalText(40),
  /** TDS deducted on the commission, if any (Q34). */
  tds: money.optional(),
});
export const payoutAction = z.object({ ...versioned });
export const payoutListItem = z.object({
  id: z.string(),
  payoutNo: z.string(),
  salesmanId: z.string(),
  salesmanName: z.string(),
  upTo: z.string(),
  status: z.enum(PAYOUT_STATUSES),
  gross: z.string(),
  tds: z.string(),
  net: z.string(),
  entryCount: z.number().int(),
  paidOn: z.string().nullable(),
  version: z.number().int(),
});
export const payoutDetail = payoutListItem.extend({
  mode: z.enum(PAYMENT_MODES).nullable(),
  reference: z.string().nullable(),
  notes: z.string().nullable(),
  entries: z.array(commissionEntryItem),
});
export const commissionSummary = z.object({
  salesmanId: z.string(),
  salesmanName: z.string(),
  accrued: z.string(),
  paid: z.string(),
  /** Accrued and not yet in a paid batch. */
  outstanding: z.string(),
});

export type ReceiptListItem = z.infer<typeof receiptListItem>;
export type ReceiptDetail = z.infer<typeof receiptDetail>;
export type OpenItem = z.infer<typeof openItem>;
export type OpenItemsResponse = z.infer<typeof openItemsResponse>;
export type AllocationSuggestion = z.infer<typeof allocationSuggestion>;
export type PartyStatement = z.infer<typeof partyStatement>;
export type AgingReport = z.infer<typeof agingReport>;
export type BlockedOrderItem = z.infer<typeof blockedOrderItem>;
export type CommissionEntryItem = z.infer<typeof commissionEntryItem>;
export type PayoutListItem = z.infer<typeof payoutListItem>;
export type PayoutDetail = z.infer<typeof payoutDetail>;
export type CommissionSummary = z.infer<typeof commissionSummary>;
