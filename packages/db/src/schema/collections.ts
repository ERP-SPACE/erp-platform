import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { audited, createdOnly, id } from "./columns.js";
import { user } from "./identity.js";
import { purchaseReturns } from "./inventory.js";
import { customers, suppliers } from "./parties.js";
import { purchaseInvoices } from "./purchase.js";
import { customerNotes, salesInvoices } from "./sales.js";
import { commissionMethod, salesmen } from "./salesmen.js";
import { branches, companies } from "./tenancy.js";

/**
 * Stage 4: customer receipts and supplier payments, their allocation to invoices, and salesman
 * commission (PRD §5.6, §8; ADR-0004 posting events are written by the services).
 */

export const partyType = pgEnum("party_type", ["CUSTOMER", "SUPPLIER"]);
export const paymentMode = pgEnum("payment_mode", ["CASH", "NEFT", "RTGS", "UPI", "CHEQUE"]);
export const receiptStatus = pgEnum("receipt_status", ["Draft", "Posted", "Reversed", "Cancelled"]);
export const reversalKind = pgEnum("reversal_kind", ["BOUNCED", "MISTAKE"]);
export const settlementSource = pgEnum("settlement_source", [
  "RECEIPT",
  "PAYMENT",
  "CREDIT_NOTE",
  "DEBIT_NOTE",
]);
export const commissionEntryStatus = pgEnum("commission_entry_status", ["Accrued", "Paid"]);
export const commissionSource = pgEnum("commission_source", ["SI", "CN", "RC"]);
export const payoutStatus = pgEnum("payout_status", ["Draft", "Paid", "Cancelled"]);

const money = (name: string) => numeric(name, { precision: 14, scale: 2 });

/**
 * Money received from a customer (RC/…) or paid to a supplier (PY/…). Posted rows are never
 * edited: a bounce or mistake reverses them (CLAUDE.md rule 1).
 */
export const receipts = pgTable(
  "receipts",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    branchId: uuid("branch_id").references(() => branches.id),
    partyType: partyType("party_type").notNull(),
    customerId: uuid("customer_id").references(() => customers.id),
    supplierId: uuid("supplier_id").references(() => suppliers.id),
    docNo: text("doc_no"),
    date: date("date").notNull(),
    mode: paymentMode("mode").notNull(),
    amount: money("amount").notNull(),
    reference: text("reference"),
    bankName: text("bank_name"),
    instrumentDate: date("instrument_date"),
    notes: text("notes"),
    /** A draft's planned allocations; written to `allocations` (and cleared) on posting. */
    draftAllocations:
      jsonb("draft_allocations").$type<
        { invoiceId: string; amount: string; deduction?: string }[]
      >(),
    status: receiptStatus("status").notNull().default("Draft"),
    /** Supplier payments above the threshold need the Owner's approval before posting (Q33). */
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedBy: text("approved_by").references(() => user.id),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    postedBy: text("posted_by").references(() => user.id),
    reversedAt: timestamp("reversed_at", { withTimezone: true }),
    reversedBy: text("reversed_by").references(() => user.id),
    reversalKind: reversalKind("reversal_kind"),
    reversalReason: text("reversal_reason"),
    ...audited,
  },
  (t) => [
    uniqueIndex("receipts_no_uq")
      .on(t.companyId, t.partyType, t.docNo)
      .where(sql`${t.docNo} IS NOT NULL`),
    index("receipts_customer_idx").on(t.customerId, t.date),
    index("receipts_supplier_idx").on(t.supplierId, t.date),
    index("receipts_status_idx").on(t.companyId, t.partyType, t.status, t.date),
    check("receipts_amount_ck", sql`${t.amount} > 0`),
    check(
      "receipts_party_ck",
      sql`(${t.partyType} = 'CUSTOMER' AND ${t.customerId} IS NOT NULL AND ${t.supplierId} IS NULL)
       OR (${t.partyType} = 'SUPPLIER' AND ${t.supplierId} IS NOT NULL AND ${t.customerId} IS NULL)`,
    ),
    check(
      "receipts_reversal_ck",
      sql`(${t.status} = 'Reversed') = (${t.reversedAt} IS NOT NULL AND ${t.reversalKind} IS NOT NULL)`,
    ),
  ],
);

/**
 * One settlement of one invoice: money from a receipt / payment, or an unused note (a credit
 * note without an invoice, or a purchase debit note). A reversal stamps `reversed_at`; rows are
 * otherwise never changed. Notes raised against a specific invoice settle it directly and are
 * not allocated here.
 */
export const allocations = pgTable(
  "allocations",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    source: settlementSource("source").notNull(),
    receiptId: uuid("receipt_id").references(() => receipts.id),
    customerNoteId: uuid("customer_note_id").references(() => customerNotes.id),
    purchaseReturnId: uuid("purchase_return_id").references(() => purchaseReturns.id),
    salesInvoiceId: uuid("sales_invoice_id").references(() => salesInvoices.id),
    purchaseInvoiceId: uuid("purchase_invoice_id").references(() => purchaseInvoices.id),
    date: date("date").notNull(),
    amount: money("amount").notNull(),
    /** TDS / short payment settling the invoice without money (Q32). */
    deduction: money("deduction").notNull().default("0"),
    reversedAt: timestamp("reversed_at", { withTimezone: true }),
    reversedBy: text("reversed_by").references(() => user.id),
    ...createdOnly,
  },
  (t) => [
    index("allocations_si_idx")
      .on(t.salesInvoiceId)
      .where(sql`${t.reversedAt} IS NULL`),
    index("allocations_pi_idx")
      .on(t.purchaseInvoiceId)
      .where(sql`${t.reversedAt} IS NULL`),
    index("allocations_receipt_idx").on(t.receiptId),
    index("allocations_note_idx").on(t.customerNoteId),
    index("allocations_pr_idx").on(t.purchaseReturnId),
    check(
      "allocations_amount_ck",
      sql`${t.amount} >= 0 AND ${t.deduction} >= 0 AND ${t.amount} + ${t.deduction} > 0`,
    ),
    check(
      "allocations_source_ck",
      sql`(${t.source} IN ('RECEIPT', 'PAYMENT') AND ${t.receiptId} IS NOT NULL AND ${t.customerNoteId} IS NULL AND ${t.purchaseReturnId} IS NULL)
       OR (${t.source} = 'CREDIT_NOTE' AND ${t.customerNoteId} IS NOT NULL AND ${t.receiptId} IS NULL AND ${t.purchaseReturnId} IS NULL)
       OR (${t.source} = 'DEBIT_NOTE' AND ${t.purchaseReturnId} IS NOT NULL AND ${t.receiptId} IS NULL AND ${t.customerNoteId} IS NULL)`,
    ),
    check(
      "allocations_target_ck",
      sql`(${t.salesInvoiceId} IS NULL) <> (${t.purchaseInvoiceId} IS NULL)`,
    ),
    // Deductions (TDS) only come with money.
    check(
      "allocations_deduction_ck",
      sql`${t.deduction} = 0 OR ${t.source} IN ('RECEIPT', 'PAYMENT')`,
    ),
  ],
);

/**
 * Commission ledger (PRD §5.6): one row per accrual or reversal, caused by an invoice posting,
 * a credit note or a receipt (or its reversal). Amounts are negative for reversals. A payout
 * batch marks them Paid; nothing else changes a row.
 */
export const commissionEntries = pgTable(
  "commission_entries",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    salesmanId: uuid("salesman_id")
      .notNull()
      .references(() => salesmen.id),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    salesInvoiceId: uuid("sales_invoice_id")
      .notNull()
      .references(() => salesInvoices.id),
    sourceType: commissionSource("source_type").notNull(),
    sourceId: uuid("source_id").notNull(),
    date: date("date").notNull(),
    method: commissionMethod("method").notNull(),
    rate: numeric("rate", { precision: 12, scale: 4 }).notNull(),
    /** Taxable value (or metres) the commission was worked on. */
    base: numeric("base", { precision: 14, scale: 2 }).notNull(),
    amount: money("amount").notNull(),
    reversalReason: text("reversal_reason"),
    status: commissionEntryStatus("status").notNull().default("Accrued"),
    payoutId: uuid("payout_id").references(() => commissionPayouts.id),
    ...createdOnly,
  },
  (t) => [
    index("commission_entries_salesman_idx").on(t.salesmanId, t.status, t.date),
    index("commission_entries_si_idx").on(t.salesInvoiceId),
    index("commission_entries_source_idx").on(t.sourceType, t.sourceId),
    check("commission_entries_nonzero_ck", sql`${t.amount} <> 0`),
    check(
      "commission_entries_reversal_ck",
      sql`${t.amount} > 0 OR ${t.reversalReason} IS NOT NULL`,
    ),
    check("commission_entries_paid_ck", sql`(${t.status} = 'Paid') = (${t.payoutId} IS NOT NULL)`),
  ],
);

/** A payout batch settles one salesman's accrued entries up to a date (Q34). */
export const commissionPayouts = pgTable(
  "commission_payouts",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    payoutNo: text("payout_no"),
    salesmanId: uuid("salesman_id")
      .notNull()
      .references(() => salesmen.id),
    upTo: date("up_to").notNull(),
    status: payoutStatus("status").notNull().default("Draft"),
    gross: money("gross").notNull().default("0"),
    tds: money("tds").notNull().default("0"),
    net: money("net").notNull().default("0"),
    paidOn: date("paid_on"),
    mode: paymentMode("mode"),
    reference: text("reference"),
    notes: text("notes"),
    paidBy: text("paid_by").references(() => user.id),
    ...audited,
  },
  (t) => [
    uniqueIndex("commission_payouts_no_uq")
      .on(t.companyId, t.payoutNo)
      .where(sql`${t.payoutNo} IS NOT NULL`),
    index("commission_payouts_salesman_idx").on(t.salesmanId, t.status),
    check("commission_payouts_net_ck", sql`${t.net} = ${t.gross} - ${t.tds} AND ${t.tds} >= 0`),
    check(
      "commission_payouts_paid_ck",
      sql`(${t.status} = 'Paid') = (${t.paidOn} IS NOT NULL AND ${t.payoutNo} IS NOT NULL)`,
    ),
  ],
);
