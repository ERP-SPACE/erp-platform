import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./identity.js";
import { audited, createdOnly, id } from "./columns.js";
import { skus } from "./catalogue.js";
import { openingBatches } from "./opening.js";
import { suppliers } from "./parties.js";
import { branches, companies } from "./tenancy.js";

/**
 * Stage 2 purchase documents (PRD §5.4, §6.2; ADR-0017). Quantities are whole metres, rates
 * are ₹ per metre (numeric(12,4)), amounts numeric(14,2). Document numbers come from
 * `document_series` (PO and GRN on create, PI / PR / DN on posting — ADR-0003).
 */

export const poStatus = pgEnum("po_status", [
  "Draft",
  "Approved",
  "PartiallyReceived",
  "Closed",
  "Cancelled",
]);
export const grnStatus = pgEnum("grn_status", ["Created", "Posted", "Cancelled"]);
export const purchaseDocStatus = pgEnum("purchase_doc_status", ["Draft", "Posted", "Cancelled"]);
export const gstRegimeEnum = pgEnum("gst_regime", ["CGST_SGST", "IGST"]);
export const landedCostBasis = pgEnum("landed_cost_basis", ["ROLL", "METER", "VALUE", "WEIGHT"]);

/** Columns describing what a line is for: a SKU, or raw attributes until it is mapped. */
const itemSpec = () => ({
  skuId: uuid("sku_id").references(() => skus.id),
  description: text("description").notNull(),
  gsm: integer("gsm").notNull(),
  widthIn: numeric("width_in", { precision: 5, scale: 2 }).notNull(),
  qualityName: text("quality_name"),
});

const docHeader = () => ({
  id: id(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id),
  branchId: uuid("branch_id").references(() => branches.id),
  supplierId: uuid("supplier_id")
    .notNull()
    .references(() => suppliers.id),
});

// ── batch (per-supplier lot; BATCH in the barcode — ADR-0007) ─────────────────

export const batches = pgTable(
  "batches",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id),
    /** Per-supplier sequence, 1–9999 (allocated with the supplier row locked). */
    batchSeq: integer("batch_seq").notNull(),
    /** Supplier's own lot / container reference, e.g. "CONT-13". */
    supplierBatchRef: text("supplier_batch_ref"),
    date: date("date").notNull(),
    /** Next roll sequence inside this batch (locked while allocating). */
    nextRollSeq: integer("next_roll_seq").notNull().default(1),
    notes: text("notes"),
    ...createdOnly,
  },
  (t) => [
    uniqueIndex("batches_supplier_seq_uq").on(t.supplierId, t.batchSeq),
    check("batches_seq_ck", sql`${t.batchSeq} BETWEEN 1 AND 9999`),
  ],
);

// ── purchase order ────────────────────────────────────────────────────────────

export const purchaseOrders = pgTable(
  "purchase_orders",
  {
    ...docHeader(),
    poNo: text("po_no").notNull(),
    date: date("date").notNull(),
    expectedDate: date("expected_date"),
    status: poStatus("status").notNull().default("Draft"),
    regime: gstRegimeEnum("regime").notNull(),
    notes: text("notes"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedBy: text("approved_by").references(() => user.id),
    ...audited,
  },
  (t) => [
    uniqueIndex("purchase_orders_no_uq").on(t.companyId, t.poNo),
    index("purchase_orders_supplier_idx").on(t.supplierId, t.date),
    index("purchase_orders_status_idx").on(t.status),
  ],
);

export const purchaseOrderLines = pgTable(
  "purchase_order_lines",
  {
    id: id(),
    poId: uuid("po_id")
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: "cascade" }),
    lineNo: integer("line_no").notNull(),
    ...itemSpec(),
    quantityM: integer("quantity_m").notNull(),
    ratePerM: numeric("rate_per_m", { precision: 12, scale: 4 }).notNull(),
    gstRate: numeric("gst_rate", { precision: 5, scale: 2 }).notNull(),
    notes: text("notes"),
    /** Running totals kept in the posting transactions of GRN / PI. */
    receivedM: integer("received_m").notNull().default(0),
    invoicedM: integer("invoiced_m").notNull().default(0),
    ...createdOnly,
  },
  (t) => [
    uniqueIndex("purchase_order_lines_no_uq").on(t.poId, t.lineNo),
    check("purchase_order_lines_qty_ck", sql`${t.quantityM} > 0 AND ${t.ratePerM} >= 0`),
    check("purchase_order_lines_done_ck", sql`${t.receivedM} >= 0 AND ${t.invoicedM} >= 0`),
  ],
);

// ── goods receipt ─────────────────────────────────────────────────────────────

export const goodsReceipts = pgTable(
  "goods_receipts",
  {
    ...docHeader(),
    grnNo: text("grn_no").notNull(),
    poId: uuid("po_id").references(() => purchaseOrders.id),
    date: date("date").notNull(),
    status: grnStatus("status").notNull().default("Created"),
    supplierInvoiceNo: text("supplier_invoice_no"),
    supplierBatchRef: text("supplier_batch_ref"),
    vehicleNo: text("vehicle_no"),
    notes: text("notes"),
    /** Set at posting: the batch its rolls belong to. */
    batchId: uuid("batch_id").references(() => batches.id),
    /** Set on opening stock GRNs (Stage 6, series OB). */
    openingBatchId: uuid("opening_batch_id").references(() => openingBatches.id),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    postedBy: text("posted_by").references(() => user.id),
    overReceiptApprovedBy: text("over_receipt_approved_by").references(() => user.id),
    ...audited,
  },
  (t) => [
    uniqueIndex("goods_receipts_no_uq").on(t.companyId, t.grnNo),
    index("goods_receipts_supplier_idx").on(t.supplierId, t.date),
    index("goods_receipts_po_idx").on(t.poId),
  ],
);

export const goodsReceiptLines = pgTable(
  "goods_receipt_lines",
  {
    id: id(),
    grnId: uuid("grn_id")
      .notNull()
      .references(() => goodsReceipts.id, { onDelete: "cascade" }),
    lineNo: integer("line_no").notNull(),
    poLineId: uuid("po_line_id").references(() => purchaseOrderLines.id),
    ...itemSpec(),
    /** As typed: "4 x 1000, 500, 450" (Q13 — supplier lengths are trusted). */
    rollList: text("roll_list").notNull(),
    rejectedRollList: text("rejected_roll_list"),
    rejectReason: text("reject_reason"),
    rollCount: integer("roll_count").notNull(),
    acceptedM: integer("accepted_m").notNull(),
    rejectedCount: integer("rejected_count").notNull().default(0),
    rejectedM: integer("rejected_m").notNull().default(0),
    overReceiptM: integer("over_receipt_m").notNull().default(0),
    ...createdOnly,
  },
  (t) => [
    uniqueIndex("goods_receipt_lines_no_uq").on(t.grnId, t.lineNo),
    index("goods_receipt_lines_po_line_idx").on(t.poLineId),
    check("goods_receipt_lines_qty_ck", sql`${t.rollCount} > 0 AND ${t.acceptedM} > 0`),
  ],
);

// ── purchase invoice ──────────────────────────────────────────────────────────

const taxTotals = () => ({
  taxable: numeric("taxable", { precision: 14, scale: 2 }).notNull().default("0"),
  cgst: numeric("cgst", { precision: 14, scale: 2 }).notNull().default("0"),
  sgst: numeric("sgst", { precision: 14, scale: 2 }).notNull().default("0"),
  igst: numeric("igst", { precision: 14, scale: 2 }).notNull().default("0"),
  roundOff: numeric("round_off", { precision: 8, scale: 2 }).notNull().default("0"),
  total: numeric("total", { precision: 14, scale: 2 }).notNull().default("0"),
});

export const purchaseInvoices = pgTable(
  "purchase_invoices",
  {
    ...docHeader(),
    /** Internal reference, numbered on posting. */
    piNo: text("pi_no"),
    /** Set on opening payables (Stage 6): no lines, no GST; the supplier invoice no. is the old one. */
    openingBatchId: uuid("opening_batch_id").references(() => openingBatches.id),
    supplierInvoiceNo: text("supplier_invoice_no").notNull(),
    supplierInvoiceDate: date("supplier_invoice_date").notNull(),
    poId: uuid("po_id").references(() => purchaseOrders.id),
    status: purchaseDocStatus("status").notNull().default("Draft"),
    regime: gstRegimeEnum("regime").notNull(),
    irn: text("irn"),
    ewayBillNo: text("eway_bill_no"),
    ...taxTotals(),
    notes: text("notes"),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    postedBy: text("posted_by").references(() => user.id),
    ...audited,
  },
  (t) => [
    uniqueIndex("purchase_invoices_no_uq")
      .on(t.companyId, t.piNo)
      .where(sql`${t.piNo} IS NOT NULL`),
    // The same supplier invoice can't be entered twice (cancelled drafts excepted).
    uniqueIndex("purchase_invoices_supplier_no_uq")
      .on(t.supplierId, t.supplierInvoiceNo)
      .where(sql`${t.status} <> 'Cancelled'`),
    index("purchase_invoices_po_idx").on(t.poId),
  ],
);

export const purchaseInvoiceLines = pgTable(
  "purchase_invoice_lines",
  {
    id: id(),
    piId: uuid("pi_id")
      .notNull()
      .references(() => purchaseInvoices.id, { onDelete: "cascade" }),
    lineNo: integer("line_no").notNull(),
    poLineId: uuid("po_line_id").references(() => purchaseOrderLines.id),
    ...itemSpec(),
    hsnCode: text("hsn_code").notNull(),
    quantityM: integer("quantity_m").notNull(),
    ratePerM: numeric("rate_per_m", { precision: 12, scale: 4 }).notNull(),
    discountPct: numeric("discount_pct", { precision: 5, scale: 2 }).notNull().default("0"),
    gstRate: numeric("gst_rate", { precision: 5, scale: 2 }).notNull(),
    taxable: numeric("taxable", { precision: 14, scale: 2 }).notNull(),
    ...createdOnly,
  },
  (t) => [
    uniqueIndex("purchase_invoice_lines_no_uq").on(t.piId, t.lineNo),
    check("purchase_invoice_lines_qty_ck", sql`${t.quantityM} > 0 AND ${t.ratePerM} >= 0`),
  ],
);

/** Goods receipts covered by a purchase invoice (a PI may span several GRNs, and vice versa). */
export const purchaseInvoiceGrns = pgTable(
  "purchase_invoice_grns",
  {
    piId: uuid("pi_id")
      .notNull()
      .references(() => purchaseInvoices.id, { onDelete: "cascade" }),
    grnId: uuid("grn_id")
      .notNull()
      .references(() => goodsReceipts.id),
  },
  (t) => [primaryKey({ columns: [t.piId, t.grnId] })],
);

// ── landed-cost charges (PRD §8.3) ────────────────────────────────────────────

export const landedCostCharges = pgTable(
  "landed_cost_charges",
  {
    id: id(),
    piId: uuid("pi_id")
      .notNull()
      .references(() => purchaseInvoices.id),
    code: text("code").notNull(),
    label: text("label").notNull(),
    basis: landedCostBasis("basis").notNull(),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    vendorName: text("vendor_name"),
    billRef: text("bill_ref"),
    allocatedAt: timestamp("allocated_at", { withTimezone: true }),
    allocatedBy: text("allocated_by").references(() => user.id),
    reversedAt: timestamp("reversed_at", { withTimezone: true }),
    reversedBy: text("reversed_by").references(() => user.id),
    ...audited,
  },
  (t) => [
    index("landed_cost_charges_pi_idx").on(t.piId),
    check("landed_cost_charges_amount_ck", sql`${t.amount} >= 0`),
  ],
);

export { taxTotals };
