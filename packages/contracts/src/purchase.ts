import { z } from "zod";
import { isoDate } from "./masters.js";

/**
 * Stage 2 purchase contracts: purchase order → goods receipt (rolls) → purchase invoice →
 * landed cost → purchase return / debit note. Quantities are metres; rates are ₹ per metre
 * (suppliers bill per metre, priced from a 44″ rate — see the 44″ helper on the PO form).
 * Money and rates travel as decimal strings (ADR-0002).
 */

const money = z.string().regex(/^-?\d{1,12}(\.\d{1,2})?$/, "Enter an amount like 1250.50");
const ratePerM = z.string().regex(/^\d{1,8}(\.\d{1,4})?$/, "Enter a rate like 5.86");
const metres = z.number().int().positive("Metres must be more than 0");
const gstRate = z.enum(["0", "5", "12", "18", "28"]);
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
const versioned = { version: z.number().int().positive() };

export const PO_STATUSES = [
  "Draft",
  "Approved",
  "PartiallyReceived",
  "Closed",
  "Cancelled",
] as const;
export const GRN_STATUSES = ["Created", "Posted", "Cancelled"] as const;
export const PI_STATUSES = ["Draft", "Posted", "Cancelled"] as const;
export const PURCHASE_RETURN_STATUSES = ["Draft", "Posted", "Cancelled"] as const;
export const GST_REGIMES = ["CGST_SGST", "IGST"] as const;

/**
 * What a line is for: a catalogue SKU, or raw attributes when the item isn't in the catalogue
 * yet (its rolls arrive Unmapped and are mapped later — PRD §6.2).
 */
const itemSpec = {
  skuId: z.string().nullable().optional(),
  description: z.string().trim().min(2, "Describe the item").max(160),
  gsm: z.number().int().positive(),
  widthIn: z.number().positive().max(200),
  qualityName: optionalText(40),
};

// ── purchase order ────────────────────────────────────────────────────────────

export const poLineInput = z.object({
  ...itemSpec,
  quantityM: metres,
  ratePerM,
  gstRate,
  notes: optionalText(200),
});
export const poCreate = z.object({
  supplierId: z.string(),
  date: isoDate,
  expectedDate: isoDate.nullable().optional(),
  notes: optionalText(500),
  lines: z.array(poLineInput).min(1, "Add at least one line").max(200),
});
export const poUpdate = poCreate.extend(versioned);
export const poAction = z.object({ ...versioned });

export const poLineItem = poLineInput.extend({
  id: z.string(),
  skuId: z.string().nullable(),
  skuCode: z.string().nullable(),
  amount: z.string(),
  receivedM: z.number().int(),
  invoicedM: z.number().int(),
  balanceM: z.number().int(),
});
export const poListItem = z.object({
  id: z.string(),
  poNo: z.string(),
  date: z.string(),
  supplierId: z.string(),
  supplierName: z.string(),
  status: z.enum(PO_STATUSES),
  orderedM: z.number().int(),
  receivedM: z.number().int(),
  taxable: z.string(),
  version: z.number().int(),
});
export const poDetail = poListItem.extend({
  expectedDate: z.string().nullable(),
  notes: z.string().nullable(),
  regime: z.enum(GST_REGIMES),
  lines: z.array(poLineItem),
  totals: z.object({ taxable: z.string(), tax: z.string(), total: z.string() }),
  approvedAt: z.string().nullable(),
  approvedByName: z.string().nullable(),
});

// ── goods receipt (rolls are created when it is posted — ADR-0017) ───────────

export const grnLineInput = z.object({
  poLineId: z.string().nullable().optional(),
  ...itemSpec,
  /** Accepted rolls as the supplier lists them, e.g. "4 x 1000, 500, 450" (Q13: trusted). */
  rolls: z.string().trim().min(1, "Enter the roll lengths"),
  /** Rolls refused at the door (damaged, wrong spec); not stocked, kept for supplier claims. */
  rejectedRolls: optionalText(500),
  rejectReason: optionalText(200),
});
export const grnCreate = z.object({
  supplierId: z.string(),
  poId: z.string().nullable().optional(),
  date: isoDate,
  supplierInvoiceNo: optionalText(40),
  /** Supplier's lot / container reference printed on their invoice, e.g. "CONT-13". */
  supplierBatchRef: optionalText(40),
  vehicleNo: optionalText(20),
  notes: optionalText(500),
  lines: z.array(grnLineInput).min(1).max(200),
});
export const grnUpdate = grnCreate.extend(versioned);
/** Over-receipt beyond the PO (above the tolerance) also needs `purchase.over_receipt.approve` + reason. */
export const grnPost = z.object({ ...versioned, approveOverReceipt: z.boolean().default(false) });

export const grnLineItem = grnLineInput.extend({
  id: z.string(),
  skuId: z.string().nullable(),
  skuCode: z.string().nullable(),
  rollCount: z.number().int(),
  acceptedM: z.number().int(),
  rejectedCount: z.number().int(),
  rejectedM: z.number().int(),
  /** Metres above the PO line balance at the time of posting (0 when within). */
  overReceiptM: z.number().int(),
});
export const grnListItem = z.object({
  id: z.string(),
  grnNo: z.string(),
  date: z.string(),
  supplierId: z.string(),
  supplierName: z.string(),
  poId: z.string().nullable(),
  poNo: z.string().nullable(),
  status: z.enum(GRN_STATUSES),
  rollCount: z.number().int(),
  acceptedM: z.number().int(),
  unmappedRolls: z.number().int(),
  version: z.number().int(),
});
export const grnDetail = grnListItem.extend({
  supplierInvoiceNo: z.string().nullable(),
  supplierBatchRef: z.string().nullable(),
  batchCode: z.string().nullable(),
  vehicleNo: z.string().nullable(),
  notes: z.string().nullable(),
  lines: z.array(grnLineItem),
  postedAt: z.string().nullable(),
  overReceiptApprovedByName: z.string().nullable(),
});

// ── purchase invoice ──────────────────────────────────────────────────────────

export const piLineInput = z.object({
  poLineId: z.string().nullable().optional(),
  ...itemSpec,
  hsnCode: z.string().regex(/^\d{4}(\d{2}){0,2}$/, "HSN is 4, 6 or 8 digits"),
  quantityM: metres,
  ratePerM,
  discountPct: z
    .string()
    .regex(/^\d{1,2}(\.\d{1,2})?$|^100$/)
    .default("0"),
  gstRate,
});
export const piCreate = z.object({
  supplierId: z.string(),
  supplierInvoiceNo: z.string().trim().min(1).max(40),
  supplierInvoiceDate: isoDate,
  poId: z.string().nullable().optional(),
  /** Goods receipts this invoice covers; their rolls take this invoice's rates (ADR-0017). */
  grnIds: z.array(z.string()).default([]),
  irn: optionalText(64),
  ewayBillNo: optionalText(20),
  /** Supplier's printed round-off, so the total matches their invoice exactly. */
  roundOff: money.default("0"),
  notes: optionalText(500),
  lines: z.array(piLineInput).min(1).max(200),
});
export const piUpdate = piCreate.extend(versioned);
/** A line without a PO line needs a reason (PRD §6.2), sent as X-Change-Reason when posting. */
export const piPost = z.object({ ...versioned });

export const piLineItem = piLineInput.extend({
  id: z.string(),
  skuId: z.string().nullable(),
  taxable: z.string(),
  withoutPo: z.boolean(),
});
export const taxTotals = z.object({
  taxable: z.string(),
  cgst: z.string(),
  sgst: z.string(),
  igst: z.string(),
  roundOff: z.string(),
  total: z.string(),
});
export const piListItem = z.object({
  id: z.string(),
  piNo: z.string().nullable(),
  supplierInvoiceNo: z.string(),
  supplierInvoiceDate: z.string(),
  supplierId: z.string(),
  supplierName: z.string(),
  status: z.enum(PI_STATUSES),
  total: z.string(),
  rollCount: z.number().int(),
  landedCostAllocated: z.boolean(),
  version: z.number().int(),
});
export const piDetail = piListItem.extend({
  poId: z.string().nullable(),
  poNo: z.string().nullable(),
  grnIds: z.array(z.string()),
  irn: z.string().nullable(),
  ewayBillNo: z.string().nullable(),
  regime: z.enum(GST_REGIMES),
  notes: z.string().nullable(),
  lines: z.array(piLineItem),
  totals: taxTotals,
  /** Lines without a PO link — posting asks for a reason when this is not empty. */
  linesWithoutPo: z.number().int(),
  postedAt: z.string().nullable(),
});

// ── landed cost (PRD §8.3, ADR-0017) ──────────────────────────────────────────

export const LANDED_COST_BASES = ["ROLL", "METER", "VALUE", "WEIGHT"] as const;

export const landedCostChargeInput = z.object({
  /** One of the `purchase.landedCostCharges` setting codes. */
  code: z.string(),
  amount: money.refine((v) => !v.startsWith("-"), "Amount can't be negative"),
  /** Defaults to the setting's basis for this code; can be changed per invoice. */
  basis: z.enum(LANDED_COST_BASES).optional(),
  /** Who billed it (transporter, CHA…) and their bill number, for the audit trail. */
  vendorName: optionalText(120),
  billRef: optionalText(40),
});
export const landedCostRequest = z.object({
  charges: z.array(landedCostChargeInput).min(1).max(20),
});
export const landedCostPreviewRow = z.object({
  rollId: z.string(),
  barcode: z.string(),
  description: z.string(),
  lengthM: z.number().int(),
  baseValue: z.string(),
  shares: z.record(z.string(), z.string()),
  landedCost: z.string(),
  costPerMetre: z.string(),
  dispatched: z.boolean(),
});
export const landedCostPreview = z.object({
  rows: z.array(landedCostPreviewRow),
  /** Per charge: amount, basis used and the sum of the roll shares (always equal). */
  charges: z.array(
    z.object({
      code: z.string(),
      basis: z.enum(LANDED_COST_BASES),
      amount: z.string(),
      allocated: z.string(),
    }),
  ),
  /** Amount landing on rolls already dispatched → variance event instead of a cost change. */
  varianceAmount: z.string(),
});
export const landedCostChargeItem = z.object({
  id: z.string(),
  code: z.string(),
  label: z.string(),
  basis: z.enum(LANDED_COST_BASES),
  amount: z.string(),
  vendorName: z.string().nullable(),
  billRef: z.string().nullable(),
  allocated: z.boolean(),
  allocatedAt: z.string().nullable(),
  reversedAt: z.string().nullable(),
});

// ── purchase return + debit note ──────────────────────────────────────────────

export const purchaseReturnCreate = z.object({
  supplierId: z.string(),
  piId: z.string().nullable().optional(),
  date: isoDate,
  reason: z.string().trim().min(3).max(300),
  rollIds: z.array(z.string()).min(1).max(500),
  notes: optionalText(500),
});
export const purchaseReturnUpdate = purchaseReturnCreate.extend(versioned);
export const purchaseReturnPost = z.object({ ...versioned });
export const purchaseReturnItem = z.object({
  id: z.string(),
  prNo: z.string().nullable(),
  dnNo: z.string().nullable(),
  date: z.string(),
  supplierId: z.string(),
  supplierName: z.string(),
  piId: z.string().nullable(),
  status: z.enum(PURCHASE_RETURN_STATUSES),
  reason: z.string(),
  rollCount: z.number().int(),
  metres: z.number().int(),
  totals: taxTotals,
  version: z.number().int(),
});
export const purchaseReturnDetail = purchaseReturnItem.extend({
  notes: z.string().nullable(),
  rolls: z.array(
    z.object({
      rollId: z.string(),
      barcode: z.string(),
      description: z.string(),
      lengthM: z.number().int(),
      ratePerM: z.string(),
      amount: z.string(),
    }),
  ),
});

export const purchaseListQuery = z.object({
  q: z.string().trim().max(100).optional(),
  supplierId: z.string().optional(),
  status: z.string().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

export type PoDetail = z.infer<typeof poDetail>;
export type PoListItem = z.infer<typeof poListItem>;
export type GrnDetail = z.infer<typeof grnDetail>;
export type GrnListItem = z.infer<typeof grnListItem>;
export type PiDetail = z.infer<typeof piDetail>;
export type PiListItem = z.infer<typeof piListItem>;
export type LandedCostPreview = z.infer<typeof landedCostPreview>;
export type LandedCostChargeItem = z.infer<typeof landedCostChargeItem>;
export type PurchaseReturnItem = z.infer<typeof purchaseReturnItem>;
export type PurchaseReturnDetail = z.infer<typeof purchaseReturnDetail>;
