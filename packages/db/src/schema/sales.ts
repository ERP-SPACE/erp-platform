import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { skus } from "./catalogue.js";
import { audited, createdOnly, id } from "./columns.js";
import { user } from "./identity.js";
import { rolls } from "./inventory.js";
import { customerShippingAddresses, customers, transporters } from "./parties.js";
import { gstRegimeEnum, purchaseDocStatus, taxTotals } from "./purchase.js";
import { salesmen } from "./salesmen.js";
import { branches, companies } from "./tenancy.js";

/**
 * Stage 3 sales documents (PRD §5.7, §5.8, §6.5, §6.6; ADR-0011/0012/0014/0015/0018). Whole
 * metres, ₹ per metre rates numeric(12,4), amounts numeric(14,2). SO / PF / DC are numbered on
 * create; SI / SR / CN / DN on posting (ADR-0003). `purchase_doc_status` (Draft/Posted/Cancelled)
 * is reused for every simple post-once document.
 */

export const soStatus = pgEnum("so_status", [
  "Draft",
  "Confirmed",
  "OnHold",
  "PartiallyFulfilled",
  "Closed",
  "Cancelled",
]);
export const dcStatus = pgEnum("dc_status", ["Draft", "Open", "Closed", "Cancelled"]);
export const proformaStatus = pgEnum("proforma_status", [
  "Draft",
  "Sent",
  "Converted",
  "Cancelled",
]);
export const soRateSource = pgEnum("so_rate_source", ["PARTY_RATE", "SALESMAN_DEFAULT", "NONE"]);
export const einvoiceStatus = pgEnum("einvoice_status", [
  "NotRequired",
  "Pending",
  "Generated",
  "Failed",
  "Cancelled",
]);
export const supplyType = pgEnum("supply_type", ["B2B", "B2C", "SEZWP", "SEZWOP"]);
export const siSource = pgEnum("si_source", ["DC", "DIRECT", "PROFORMA"]);
export const salesLineKind = pgEnum("sales_line_kind", ["GOODS", "CHARGE"]);
export const noteKind = pgEnum("note_kind", ["CREDIT", "DEBIT"]);
export const noteReason = pgEnum("note_reason", [
  "RETURN",
  "RATE_DIFFERENCE",
  "DISCOUNT",
  "SHORTAGE",
  "OTHER",
]);
export const returnOutcome = pgEnum("return_outcome", ["RESTOCK", "SCRAP"]);
export const lengthChangeKind = pgEnum("length_change_kind", ["CORRECTION", "CUT", "RETURN"]);

const header = () => ({
  id: id(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id),
  branchId: uuid("branch_id").references(() => branches.id),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => customers.id),
});

/** Gross before discounts and the discount total, beside the shared tax totals. */
const salesTotals = () => ({
  gross: numeric("gross", { precision: 14, scale: 2 }).notNull().default("0"),
  discount: numeric("discount", { precision: 14, scale: 2 }).notNull().default("0"),
  billDiscount: numeric("bill_discount", { precision: 14, scale: 2 }).notNull().default("0"),
  ...taxTotals(),
});

/** The IRN on an SI / CN / DN (ADR-0011). */
const einvoiceColumns = () => ({
  einvoiceStatus: einvoiceStatus("einvoice_status").notNull().default("NotRequired"),
  irn: text("irn"),
  ackNo: text("ack_no"),
  ackDate: timestamp("ack_date", { withTimezone: true }),
  signedInvoice: text("signed_invoice"),
  signedQr: text("signed_qr"),
  irnAttempts: integer("irn_attempts").notNull().default(0),
  irnLastError: text("irn_last_error"),
  irnCancelledAt: timestamp("irn_cancelled_at", { withTimezone: true }),
});

/** Who the document is to, frozen when it is posted (masters may change later). */
const partySnapshot = () => ({
  regime: gstRegimeEnum("regime").notNull(),
  placeOfSupply: text("place_of_supply").notNull(),
  supplyType: supplyType("supply_type").notNull(),
  customerName: text("customer_name").notNull(),
  customerGstin: text("customer_gstin"),
  billingAddress: text("billing_address").notNull(),
  shippingAddress: text("shipping_address").notNull(),
});

/** Extra charges on an SO / proforma (Q21); on an SI they become CHARGE lines. */
export interface DocCharge {
  code: string;
  label: string;
  amount: string;
}

// ── sales order ──────────────────────────────────────────────────────────────

export const salesOrders = pgTable(
  "sales_orders",
  {
    ...header(),
    soNo: text("so_no").notNull(),
    date: date("date").notNull(),
    status: soStatus("status").notNull().default("Draft"),
    regime: gstRegimeEnum("regime").notNull(),
    placeOfSupply: text("place_of_supply").notNull(),
    shippingAddressId: uuid("shipping_address_id").references(() => customerShippingAddresses.id),
    salesmanId: uuid("salesman_id").references(() => salesmen.id),
    customerRef: text("customer_ref"),
    charges: jsonb("charges").$type<DocCharge[]>().notNull().default([]),
    ...salesTotals(),
    /** The last credit check (CreditCheck in contracts), kept for the Sales Board. */
    creditCheck: jsonb("credit_check"),
    heldReasons: text("held_reasons")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    confirmedBy: text("confirmed_by").references(() => user.id),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    releasedBy: text("released_by").references(() => user.id),
    notes: text("notes"),
    ...audited,
  },
  (t) => [
    uniqueIndex("sales_orders_no_uq").on(t.companyId, t.soNo),
    index("sales_orders_customer_idx").on(t.customerId, t.date),
    index("sales_orders_status_idx").on(t.companyId, t.status),
  ],
);

export const salesOrderLines = pgTable(
  "sales_order_lines",
  {
    id: id(),
    soId: uuid("so_id")
      .notNull()
      .references(() => salesOrders.id, { onDelete: "cascade" }),
    lineNo: integer("line_no").notNull(),
    skuId: uuid("sku_id")
      .notNull()
      .references(() => skus.id),
    description: text("description").notNull(),
    gsm: integer("gsm").notNull(),
    widthIn: numeric("width_in", { precision: 5, scale: 2 }).notNull(),
    hsnCode: text("hsn_code"),
    gstRate: numeric("gst_rate", { precision: 5, scale: 2 }),
    totalM: integer("total_m").notNull(),
    /** [{lengthM, rolls}] (ADR-0012); null = the product's default length. */
    lengthMix: jsonb("length_mix").$type<{ lengthM: number; rolls: number }[]>(),
    qtyRolls: integer("qty_rolls").notNull(),
    allowCut: boolean("allow_cut").notNull(),
    rateSource: soRateSource("rate_source").notNull(),
    base44: numeric("base_44", { precision: 12, scale: 4 }),
    derivedRatePerM: numeric("derived_rate_per_m", { precision: 12, scale: 4 }),
    ratePerM: numeric("rate_per_m", { precision: 12, scale: 4 }).notNull(),
    deviationPct: numeric("deviation_pct", { precision: 7, scale: 2 }),
    needsApproval: boolean("needs_approval").notNull().default(false),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedBy: text("approved_by").references(() => user.id),
    discountPct: numeric("discount_pct", { precision: 5, scale: 2 }).notNull().default("0"),
    /** Metres × rate less the line discount (before any bill discount). */
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    /** Running totals kept by DC posting / SI posting. */
    dispatchedM: integer("dispatched_m").notNull().default(0),
    invoicedM: integer("invoiced_m").notNull().default(0),
    notes: text("notes"),
    ...createdOnly,
  },
  (t) => [
    uniqueIndex("sales_order_lines_no_uq").on(t.soId, t.lineNo),
    index("sales_order_lines_sku_idx").on(t.skuId),
    check(
      "sales_order_lines_qty_ck",
      sql`${t.totalM} > 0 AND ${t.qtyRolls} > 0 AND ${t.ratePerM} >= 0`,
    ),
    check("sales_order_lines_discount_ck", sql`${t.discountPct} BETWEEN 0 AND 100`),
    check("sales_order_lines_done_ck", sql`${t.dispatchedM} >= 0 AND ${t.invoicedM} >= 0`),
  ],
);

// ── delivery challan ─────────────────────────────────────────────────────────

export const deliveryChallans = pgTable(
  "delivery_challans",
  {
    ...header(),
    dcNo: text("dc_no").notNull(),
    soId: uuid("so_id")
      .notNull()
      .references(() => salesOrders.id),
    date: date("date").notNull(),
    status: dcStatus("status").notNull().default("Draft"),
    transporterId: uuid("transporter_id").references(() => transporters.id),
    vehicleNo: text("vehicle_no"),
    lrNo: text("lr_no"),
    lrDate: date("lr_date"),
    distanceKm: integer("distance_km"),
    ewayBillNo: text("eway_bill_no"),
    ewayBillDate: date("eway_bill_date"),
    ewayBillValidUntil: date("eway_bill_valid_until"),
    /** Taxable value of the rolls at the order's rates (e-way bill threshold). */
    value: numeric("value", { precision: 14, scale: 2 }).notNull().default("0"),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    postedBy: text("posted_by").references(() => user.id),
    notes: text("notes"),
    ...audited,
  },
  (t) => [
    uniqueIndex("delivery_challans_no_uq").on(t.companyId, t.dcNo),
    index("delivery_challans_so_idx").on(t.soId),
    index("delivery_challans_customer_idx").on(t.customerId, t.status),
    check("delivery_challans_distance_ck", sql`${t.distanceKm} IS NULL OR ${t.distanceKm} >= 0`),
  ],
);

/** Rolls on a challan; a whole roll, or the child of a cut made for it (ADR-0014/0018). */
export const deliveryChallanRolls = pgTable(
  "delivery_challan_rolls",
  {
    id: id(),
    dcId: uuid("dc_id")
      .notNull()
      .references(() => deliveryChallans.id, { onDelete: "cascade" }),
    soLineId: uuid("so_line_id")
      .notNull()
      .references(() => salesOrderLines.id),
    rollId: uuid("roll_id")
      .notNull()
      .references(() => rolls.id),
    lengthM: integer("length_m").notNull(),
    ...createdOnly,
  },
  (t) => [
    uniqueIndex("delivery_challan_rolls_uq").on(t.dcId, t.rollId),
    index("delivery_challan_rolls_roll_idx").on(t.rollId),
    index("delivery_challan_rolls_line_idx").on(t.soLineId),
    check("delivery_challan_rolls_length_ck", sql`${t.lengthM} > 0`),
  ],
);

/** A cut (ADR-0018): parent → child, with the waste and the challan it was made for. */
export const rollCuts = pgTable(
  "roll_cuts",
  {
    id: id(),
    parentRollId: uuid("parent_roll_id")
      .notNull()
      .references(() => rolls.id),
    childRollId: uuid("child_roll_id")
      .notNull()
      .references(() => rolls.id),
    cutM: integer("cut_m").notNull(),
    wasteM: integer("waste_m").notNull().default(0),
    parentLengthBefore: integer("parent_length_before").notNull(),
    parentLengthAfter: integer("parent_length_after").notNull(),
    childCost: numeric("child_cost", { precision: 14, scale: 2 }).notNull(),
    wasteCost: numeric("waste_cost", { precision: 14, scale: 2 }).notNull().default("0"),
    dcId: uuid("dc_id").references(() => deliveryChallans.id),
    soLineId: uuid("so_line_id").references(() => salesOrderLines.id),
    reason: text("reason"),
    ...createdOnly,
  },
  (t) => [
    uniqueIndex("roll_cuts_child_uq").on(t.childRollId),
    index("roll_cuts_parent_idx").on(t.parentRollId),
    check(
      "roll_cuts_length_ck",
      sql`${t.cutM} > 0 AND ${t.wasteM} >= 0 AND ${t.parentLengthAfter} > 0 AND ${t.parentLengthBefore} = ${t.cutM} + ${t.wasteM} + ${t.parentLengthAfter}`,
    ),
  ],
);

/** Every change to a roll's length — correction, cut or return (ADR-0015). Append-only. */
export const rollLengthChanges = pgTable(
  "roll_length_changes",
  {
    id: id(),
    rollId: uuid("roll_id")
      .notNull()
      .references(() => rolls.id),
    kind: lengthChangeKind("kind").notNull(),
    fromM: integer("from_m").notNull(),
    toM: integer("to_m").notNull(),
    reason: text("reason"),
    refType: text("ref_type"),
    refId: uuid("ref_id"),
    ...createdOnly,
  },
  (t) => [index("roll_length_changes_roll_idx").on(t.rollId, t.createdAt)],
);

// ── proforma ─────────────────────────────────────────────────────────────────

export const proformas = pgTable(
  "proformas",
  {
    ...header(),
    proformaNo: text("proforma_no").notNull(),
    soId: uuid("so_id").references(() => salesOrders.id),
    date: date("date").notNull(),
    validUntil: date("valid_until").notNull(),
    status: proformaStatus("status").notNull().default("Draft"),
    regime: gstRegimeEnum("regime").notNull(),
    placeOfSupply: text("place_of_supply").notNull(),
    charges: jsonb("charges").$type<DocCharge[]>().notNull().default([]),
    ...salesTotals(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    notes: text("notes"),
    ...audited,
  },
  (t) => [
    uniqueIndex("proformas_no_uq").on(t.companyId, t.proformaNo),
    index("proformas_customer_idx").on(t.customerId, t.date),
  ],
);

export const proformaLines = pgTable(
  "proforma_lines",
  {
    id: id(),
    proformaId: uuid("proforma_id")
      .notNull()
      .references(() => proformas.id, { onDelete: "cascade" }),
    lineNo: integer("line_no").notNull(),
    skuId: uuid("sku_id")
      .notNull()
      .references(() => skus.id),
    description: text("description").notNull(),
    widthIn: numeric("width_in", { precision: 5, scale: 2 }).notNull(),
    hsnCode: text("hsn_code"),
    gstRate: numeric("gst_rate", { precision: 5, scale: 2 }),
    metres: integer("metres").notNull(),
    ratePerM: numeric("rate_per_m", { precision: 12, scale: 4 }).notNull(),
    discountPct: numeric("discount_pct", { precision: 5, scale: 2 }).notNull().default("0"),
    taxable: numeric("taxable", { precision: 14, scale: 2 }).notNull(),
    ...createdOnly,
  },
  (t) => [
    uniqueIndex("proforma_lines_no_uq").on(t.proformaId, t.lineNo),
    check("proforma_lines_qty_ck", sql`${t.metres} > 0 AND ${t.ratePerM} >= 0`),
  ],
);

// ── sales invoice ────────────────────────────────────────────────────────────

export const salesInvoices = pgTable(
  "sales_invoices",
  {
    ...header(),
    /** Numbered on posting (ADR-0003); ≤ 16 characters for GST. */
    siNo: text("si_no"),
    date: date("date").notNull(),
    dueDate: date("due_date").notNull(),
    status: purchaseDocStatus("status").notNull().default("Draft"),
    source: siSource("source").notNull(),
    proformaId: uuid("proforma_id").references(() => proformas.id),
    ...partySnapshot(),
    ...salesTotals(),
    /** Σ landed cost of the billed rolls (PRD §8.4); fixed at posting. */
    cogs: numeric("cogs", { precision: 14, scale: 2 }),
    ...einvoiceColumns(),
    transporterId: uuid("transporter_id").references(() => transporters.id),
    vehicleNo: text("vehicle_no"),
    lrNo: text("lr_no"),
    lrDate: date("lr_date"),
    distanceKm: integer("distance_km"),
    ewayBillNo: text("eway_bill_no"),
    ewayBillDate: date("eway_bill_date"),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    postedBy: text("posted_by").references(() => user.id),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledBy: text("cancelled_by").references(() => user.id),
    cancelReason: text("cancel_reason"),
    notes: text("notes"),
    ...audited,
  },
  (t) => [
    uniqueIndex("sales_invoices_no_uq")
      .on(t.companyId, t.siNo)
      .where(sql`${t.siNo} IS NOT NULL`),
    uniqueIndex("sales_invoices_irn_uq")
      .on(t.irn)
      .where(sql`${t.irn} IS NOT NULL`),
    index("sales_invoices_customer_idx").on(t.customerId, t.date),
    index("sales_invoices_status_idx").on(t.companyId, t.status, t.date),
    index("sales_invoices_einvoice_idx")
      .on(t.einvoiceStatus)
      .where(sql`${t.einvoiceStatus} IN ('Pending','Failed')`),
    check("sales_invoices_si_no_ck", sql`${t.siNo} IS NULL OR length(${t.siNo}) <= 16`),
    check("sales_invoices_due_ck", sql`${t.dueDate} >= ${t.date}`),
  ],
);

/** Challans billed on an invoice (Q29: one SI may cover several DCs of one customer). */
export const salesInvoiceDcs = pgTable(
  "sales_invoice_dcs",
  {
    siId: uuid("si_id")
      .notNull()
      .references(() => salesInvoices.id, { onDelete: "cascade" }),
    dcId: uuid("dc_id")
      .notNull()
      .references(() => deliveryChallans.id),
  },
  (t) => [primaryKey({ columns: [t.siId, t.dcId] }), index("sales_invoice_dcs_dc_idx").on(t.dcId)],
);

export const salesInvoiceLines = pgTable(
  "sales_invoice_lines",
  {
    id: id(),
    siId: uuid("si_id")
      .notNull()
      .references(() => salesInvoices.id, { onDelete: "cascade" }),
    lineNo: integer("line_no").notNull(),
    kind: salesLineKind("kind").notNull(),
    soLineId: uuid("so_line_id").references(() => salesOrderLines.id),
    proformaLineId: uuid("proforma_line_id").references(() => proformaLines.id),
    skuId: uuid("sku_id").references(() => skus.id),
    chargeCode: text("charge_code"),
    description: text("description").notNull(),
    hsnCode: text("hsn_code").notNull(),
    widthIn: numeric("width_in", { precision: 5, scale: 2 }),
    metres: integer("metres"),
    ratePerM: numeric("rate_per_m", { precision: 12, scale: 4 }),
    discountPct: numeric("discount_pct", { precision: 5, scale: 2 }).notNull().default("0"),
    gross: numeric("gross", { precision: 14, scale: 2 }).notNull(),
    discount: numeric("discount", { precision: 14, scale: 2 }).notNull().default("0"),
    billDiscount: numeric("bill_discount", { precision: 14, scale: 2 }).notNull().default("0"),
    taxable: numeric("taxable", { precision: 14, scale: 2 }).notNull(),
    gstRate: numeric("gst_rate", { precision: 5, scale: 2 }).notNull(),
    cgst: numeric("cgst", { precision: 14, scale: 2 }).notNull().default("0"),
    sgst: numeric("sgst", { precision: 14, scale: 2 }).notNull().default("0"),
    igst: numeric("igst", { precision: 14, scale: 2 }).notNull().default("0"),
    /** Σ COGS of this line's rolls (port matrix 2.11). */
    cogs: numeric("cogs", { precision: 14, scale: 2 }),
    ...createdOnly,
  },
  (t) => [
    uniqueIndex("sales_invoice_lines_no_uq").on(t.siId, t.lineNo),
    index("sales_invoice_lines_so_line_idx").on(t.soLineId),
    check(
      "sales_invoice_lines_kind_ck",
      sql`(${t.kind} = 'GOODS' AND ${t.skuId} IS NOT NULL AND ${t.metres} > 0 AND ${t.ratePerM} IS NOT NULL) OR (${t.kind} = 'CHARGE' AND ${t.chargeCode} IS NOT NULL)`,
    ),
    check("sales_invoice_lines_discount_ck", sql`${t.discountPct} BETWEEN 0 AND 100`),
  ],
);

/** Rolls billed on each goods line, with their COGS (returns and margin need it per roll). */
export const salesInvoiceRolls = pgTable(
  "sales_invoice_rolls",
  {
    id: id(),
    siId: uuid("si_id")
      .notNull()
      .references(() => salesInvoices.id, { onDelete: "cascade" }),
    siLineId: uuid("si_line_id")
      .notNull()
      .references(() => salesInvoiceLines.id, { onDelete: "cascade" }),
    rollId: uuid("roll_id")
      .notNull()
      .references(() => rolls.id),
    lengthM: integer("length_m").notNull(),
    costPerM: numeric("cost_per_m", { precision: 12, scale: 4 }),
    cogs: numeric("cogs", { precision: 14, scale: 2 }),
    ...createdOnly,
  },
  (t) => [
    uniqueIndex("sales_invoice_rolls_uq").on(t.siId, t.rollId),
    index("sales_invoice_rolls_roll_idx").on(t.rollId),
    check("sales_invoice_rolls_length_ck", sql`${t.lengthM} > 0`),
  ],
);

// ── sales return ─────────────────────────────────────────────────────────────

export const salesReturns = pgTable(
  "sales_returns",
  {
    ...header(),
    srNo: text("sr_no"),
    siId: uuid("si_id")
      .notNull()
      .references(() => salesInvoices.id),
    date: date("date").notNull(),
    status: purchaseDocStatus("status").notNull().default("Draft"),
    reason: text("reason").notNull(),
    ...salesTotals(),
    /** Cost back into stock (Σ partial COGS). */
    cost: numeric("cost", { precision: 14, scale: 2 }).notNull().default("0"),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    postedBy: text("posted_by").references(() => user.id),
    notes: text("notes"),
    ...audited,
  },
  (t) => [
    uniqueIndex("sales_returns_no_uq")
      .on(t.companyId, t.srNo)
      .where(sql`${t.srNo} IS NOT NULL`),
    index("sales_returns_si_idx").on(t.siId),
    index("sales_returns_customer_idx").on(t.customerId, t.date),
  ],
);

export const salesReturnRolls = pgTable(
  "sales_return_rolls",
  {
    id: id(),
    returnId: uuid("return_id")
      .notNull()
      .references(() => salesReturns.id, { onDelete: "cascade" }),
    siRollId: uuid("si_roll_id")
      .notNull()
      .references(() => salesInvoiceRolls.id),
    rollId: uuid("roll_id")
      .notNull()
      .references(() => rolls.id),
    dispatchedM: integer("dispatched_m").notNull(),
    returnedM: integer("returned_m").notNull(),
    taxable: numeric("taxable", { precision: 14, scale: 2 }).notNull(),
    gstRate: numeric("gst_rate", { precision: 5, scale: 2 }).notNull(),
    cost: numeric("cost", { precision: 14, scale: 2 }),
    outcome: returnOutcome("outcome"),
    inspectedAt: timestamp("inspected_at", { withTimezone: true }),
    inspectedBy: text("inspected_by").references(() => user.id),
    /** Set when inspected or when the draft is cancelled; open rows block a second return. */
    closedAt: timestamp("closed_at", { withTimezone: true }),
    ...createdOnly,
  },
  (t) => [
    // A roll can be on only one open return at a time (port matrix 2.10).
    uniqueIndex("sales_return_rolls_open_uq")
      .on(t.rollId)
      .where(sql`${t.closedAt} IS NULL`),
    index("sales_return_rolls_return_idx").on(t.returnId),
    check(
      "sales_return_rolls_length_ck",
      sql`${t.returnedM} > 0 AND ${t.returnedM} <= ${t.dispatchedM}`,
    ),
  ],
);

// ── credit & debit notes ─────────────────────────────────────────────────────

export const customerNotes = pgTable(
  "customer_notes",
  {
    ...header(),
    kind: noteKind("kind").notNull(),
    /** CN… / DN… numbered on posting (ADR-0003). */
    noteNo: text("note_no"),
    siId: uuid("si_id").references(() => salesInvoices.id),
    salesReturnId: uuid("sales_return_id").references(() => salesReturns.id),
    date: date("date").notNull(),
    status: purchaseDocStatus("status").notNull().default("Draft"),
    reasonCode: noteReason("reason_code").notNull(),
    reason: text("reason").notNull(),
    ...partySnapshot(),
    ...salesTotals(),
    ...einvoiceColumns(),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    postedBy: text("posted_by").references(() => user.id),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledBy: text("cancelled_by").references(() => user.id),
    ...audited,
  },
  (t) => [
    uniqueIndex("customer_notes_no_uq")
      .on(t.companyId, t.kind, t.noteNo)
      .where(sql`${t.noteNo} IS NOT NULL`),
    uniqueIndex("customer_notes_irn_uq")
      .on(t.irn)
      .where(sql`${t.irn} IS NOT NULL`),
    uniqueIndex("customer_notes_return_uq")
      .on(t.salesReturnId)
      .where(sql`${t.salesReturnId} IS NOT NULL`),
    index("customer_notes_customer_idx").on(t.customerId, t.date),
    index("customer_notes_si_idx").on(t.siId),
    check("customer_notes_no_ck", sql`${t.noteNo} IS NULL OR length(${t.noteNo}) <= 16`),
    check(
      "customer_notes_return_ck",
      sql`(${t.reasonCode} = 'RETURN') = (${t.salesReturnId} IS NOT NULL)`,
    ),
  ],
);

export const customerNoteLines = pgTable(
  "customer_note_lines",
  {
    id: id(),
    noteId: uuid("note_id")
      .notNull()
      .references(() => customerNotes.id, { onDelete: "cascade" }),
    lineNo: integer("line_no").notNull(),
    description: text("description").notNull(),
    hsnCode: text("hsn_code").notNull(),
    taxable: numeric("taxable", { precision: 14, scale: 2 }).notNull(),
    gstRate: numeric("gst_rate", { precision: 5, scale: 2 }).notNull(),
    cgst: numeric("cgst", { precision: 14, scale: 2 }).notNull().default("0"),
    sgst: numeric("sgst", { precision: 14, scale: 2 }).notNull().default("0"),
    igst: numeric("igst", { precision: 14, scale: 2 }).notNull().default("0"),
    ...createdOnly,
  },
  (t) => [
    uniqueIndex("customer_note_lines_no_uq").on(t.noteId, t.lineNo),
    check("customer_note_lines_taxable_ck", sql`${t.taxable} > 0`),
  ],
);

// ── e-invoice requests (ADR-0011) ────────────────────────────────────────────

/** Every call to the IRP / e-way bill system, with what was sent and received. Append-only. */
export const einvoiceRequests = pgTable(
  "einvoice_requests",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    docType: text("doc_type").notNull(),
    docId: uuid("doc_id").notNull(),
    action: text("action").notNull(),
    provider: text("provider").notNull(),
    request: jsonb("request"),
    response: jsonb("response"),
    ok: boolean("ok").notNull(),
    error: text("error"),
    durationMs: integer("duration_ms"),
    ...createdOnly,
  },
  (t) => [
    index("einvoice_requests_doc_idx").on(t.docType, t.docId, t.createdAt),
    check("einvoice_requests_doc_type_ck", sql`${t.docType} IN ('SI','CN','DN')`),
    check(
      "einvoice_requests_action_ck",
      sql`${t.action} IN ('GENERATE','CANCEL','EWAY_BILL','MANUAL')`,
    ),
  ],
);
