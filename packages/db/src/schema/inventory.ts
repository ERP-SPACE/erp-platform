import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { audited, createdOnly, id } from "./columns.js";
import { skus } from "./catalogue.js";
import { user } from "./identity.js";
import { suppliers } from "./parties.js";
import {
  batches,
  goodsReceiptLines,
  goodsReceipts,
  gstRegimeEnum,
  landedCostCharges,
  purchaseDocStatus,
  purchaseInvoices,
  taxTotals,
} from "./purchase.js";
import { branches, companies } from "./tenancy.js";

export const rollStatus = pgEnum("roll_status", [
  "Unmapped",
  "Mapped",
  "Allocated",
  "Dispatched",
  "Returned",
  "ReturnedToSupplier",
  "Scrap",
]);

/**
 * One physical roll (PRD §5.3, ADR-0017/0018). Created only when a GRN is posted, with the
 * supplier's length (Q13). Cost per metre drives partial-length COGS: `base_cost_per_m` from the
 * PO (provisional) then the PI, `cost_per_m` = (base value + landed cost) ÷ original length.
 */
export const rolls = pgTable(
  "rolls",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    branchId: uuid("branch_id").references(() => branches.id),
    barcode: text("barcode").notNull(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => batches.id),
    rollSeq: integer("roll_seq").notNull(),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id),
    grnId: uuid("grn_id")
      .notNull()
      .references(() => goodsReceipts.id),
    grnLineId: uuid("grn_line_id")
      .notNull()
      .references(() => goodsReceiptLines.id),
    skuId: uuid("sku_id").references(() => skus.id),
    description: text("description").notNull(),
    gsm: integer("gsm").notNull(),
    widthIn: numeric("width_in", { precision: 5, scale: 2 }).notNull(),
    qualityName: text("quality_name"),
    originalLengthM: integer("original_length_m").notNull(),
    currentLengthM: integer("current_length_m").notNull(),
    status: rollStatus("status").notNull(),
    baseCostPerM: numeric("base_cost_per_m", { precision: 12, scale: 4 }),
    baseValue: numeric("base_value", { precision: 14, scale: 2 }).notNull().default("0"),
    landedCost: numeric("landed_cost", { precision: 14, scale: 2 }).notNull().default("0"),
    costPerM: numeric("cost_per_m", { precision: 12, scale: 4 }),
    piId: uuid("pi_id").references(() => purchaseInvoices.id),
    /** Set when this roll was cut from another (ADR-0018). */
    parentRollId: uuid("parent_roll_id").references((): AnyPgColumn => rolls.id),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    /** Its length changed (cut, return) since the label was printed (ADR-0018). */
    labelReprintDue: boolean("label_reprint_due").notNull().default(false),
    mappedAt: timestamp("mapped_at", { withTimezone: true }),
    ...audited,
  },
  (t) => [
    uniqueIndex("rolls_barcode_uq").on(t.barcode),
    uniqueIndex("rolls_batch_seq_uq").on(t.batchId, t.rollSeq),
    index("rolls_status_idx").on(t.companyId, t.status),
    index("rolls_sku_idx").on(t.skuId, t.status),
    index("rolls_supplier_idx").on(t.supplierId),
    index("rolls_grn_idx").on(t.grnId),
    index("rolls_pi_idx").on(t.piId),
    // Stock queries and FIFO picking (Stage 3) read in-stock rolls oldest first.
    index("rolls_in_stock_idx")
      .on(t.skuId, t.receivedAt)
      .where(sql`${t.status} IN ('Unmapped','Mapped','Allocated')`),
    check(
      "rolls_length_ck",
      sql`${t.originalLengthM} > 0 AND ${t.currentLengthM} >= 0 AND ${t.currentLengthM} <= ${t.originalLengthM}`,
    ),
    check("rolls_mapped_sku_ck", sql`${t.status} = 'Unmapped' OR ${t.skuId} IS NOT NULL`),
    check("rolls_money_ck", sql`${t.baseValue} >= 0 AND ${t.landedCost} >= 0`),
  ],
);

/** Every label print and reprint (ADR-0007). Append-only. */
export const labelPrints = pgTable(
  "label_prints",
  {
    id: id(),
    rollId: uuid("roll_id")
      .notNull()
      .references(() => rolls.id),
    reprint: boolean("reprint").notNull().default(false),
    reason: text("reason"),
    format: text("format").notNull(),
    ...createdOnly,
  },
  (t) => [index("label_prints_roll_idx").on(t.rollId)],
);

export const allocationKind = pgEnum("allocation_kind", ["ALLOCATE", "REVERSE", "VARIANCE"]);

/**
 * Each charge's share per roll (append-only). Reversing a charge adds REVERSE rows; a share that
 * lands on an already-dispatched roll is a VARIANCE row and does not change its cost (ADR-0017).
 */
export const landedCostAllocations = pgTable(
  "landed_cost_allocations",
  {
    id: id(),
    chargeId: uuid("charge_id")
      .notNull()
      .references(() => landedCostCharges.id),
    rollId: uuid("roll_id")
      .notNull()
      .references(() => rolls.id),
    kind: allocationKind("kind").notNull(),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    ...createdOnly,
  },
  (t) => [
    index("landed_cost_allocations_charge_idx").on(t.chargeId),
    index("landed_cost_allocations_roll_idx").on(t.rollId),
  ],
);

// ── purchase return + debit note ──────────────────────────────────────────────

export const purchaseReturns = pgTable(
  "purchase_returns",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    branchId: uuid("branch_id").references(() => branches.id),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id),
    /** PR and DN numbers are allocated on posting (ADR-0003). */
    prNo: text("pr_no"),
    dnNo: text("dn_no"),
    piId: uuid("pi_id").references(() => purchaseInvoices.id),
    date: date("date").notNull(),
    status: purchaseDocStatus("status").notNull().default("Draft"),
    regime: gstRegimeEnum("regime").notNull(),
    reason: text("reason").notNull(),
    ...taxTotals(),
    notes: text("notes"),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    postedBy: text("posted_by").references(() => user.id),
    ...audited,
  },
  (t) => [
    uniqueIndex("purchase_returns_pr_uq")
      .on(t.companyId, t.prNo)
      .where(sql`${t.prNo} IS NOT NULL`),
    uniqueIndex("purchase_returns_dn_uq")
      .on(t.companyId, t.dnNo)
      .where(sql`${t.dnNo} IS NOT NULL`),
    index("purchase_returns_supplier_idx").on(t.supplierId, t.date),
  ],
);

export const purchaseReturnRolls = pgTable(
  "purchase_return_rolls",
  {
    id: id(),
    returnId: uuid("return_id")
      .notNull()
      .references(() => purchaseReturns.id, { onDelete: "cascade" }),
    rollId: uuid("roll_id")
      .notNull()
      .references(() => rolls.id),
    lengthM: integer("length_m").notNull(),
    ratePerM: numeric("rate_per_m", { precision: 12, scale: 4 }).notNull(),
    gstRate: numeric("gst_rate", { precision: 5, scale: 2 }).notNull(),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    ...createdOnly,
  },
  (t) => [
    // A roll can be on only one return (port matrix 2.10); cancelling a draft deletes its rows.
    uniqueIndex("purchase_return_rolls_roll_uq").on(t.rollId),
    index("purchase_return_rolls_return_idx").on(t.returnId),
  ],
);
