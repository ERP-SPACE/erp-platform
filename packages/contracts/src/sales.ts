import { z } from "zod";
import { isoDate } from "./masters.js";
import { GST_REGIMES, taxTotals } from "./purchase.js";

/**
 * Stage 3 sales contracts: sales order (credit check) → delivery challan (picking, cuts) → sales
 * invoice (IRN) → sales return / credit & debit notes; plus proformas and the customer ledger.
 * Quantities are metres; rates are ₹ per metre (ADR-0013); money travels as decimal strings.
 */

const money = z.string().regex(/^\d{1,12}(\.\d{1,2})?$/, "Enter an amount like 1250.50");
const ratePerM = z.string().regex(/^\d{1,8}(\.\d{1,4})?$/, "Enter a rate like 5.86");
const discountPct = z
  .string()
  .regex(/^\d{1,2}(\.\d{1,2})?$|^100$/, "Enter a discount from 0 to 100 %");
const metres = z.number().int().positive("Metres must be more than 0");
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
const versioned = { version: z.number().int().positive() };
const vehicleNo = z
  .string()
  .trim()
  .toUpperCase()
  .regex(
    /^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}$|^TM[A-Z0-9]{6,}$/,
    "Enter a vehicle number like GJ05AB1234",
  );

export const SO_STATUSES = [
  "Draft",
  "Confirmed",
  "OnHold",
  "PartiallyFulfilled",
  "Closed",
  "Cancelled",
] as const;
export const DC_STATUSES = ["Draft", "Open", "Closed", "Cancelled"] as const;
export const SI_STATUSES = ["Draft", "Posted", "Cancelled"] as const;
export const PROFORMA_STATUSES = ["Draft", "Sent", "Converted", "Cancelled"] as const;
export const SALES_RETURN_STATUSES = ["Draft", "Posted", "Cancelled"] as const;
export const NOTE_STATUSES = ["Draft", "Posted", "Cancelled"] as const;
export const EINVOICE_STATUSES = [
  "NotRequired",
  "Pending",
  "Generated",
  "Failed",
  "Cancelled",
] as const;
export const SO_RATE_SOURCES = ["PARTY_RATE", "SALESMAN_DEFAULT", "NONE"] as const;
export const CREDIT_REASONS = ["MANUAL_BLOCK", "OVER_LIMIT", "OVER_DUE"] as const;

// ── shared ───────────────────────────────────────────────────────────────────

/** Extra charges on an invoice (Q21): codes from the `invoice.extraCharges` setting. */
export const chargeInput = z.object({ code: z.string(), amount: money });
export const chargeItem = chargeInput.extend({ label: z.string(), taxable: z.string() });

/** The invoice-style totals every sales document shows. */
export const salesTotals = taxTotals.extend({
  gross: z.string(),
  discount: z.string(),
  regime: z.enum(GST_REGIMES),
});

export const creditCheck = z.object({
  blocked: z.boolean(),
  reasons: z.array(z.enum(CREDIT_REASONS)),
  outstanding: z.string(),
  otherOpenOrders: z.string(),
  thisOrder: z.string(),
  exposure: z.string(),
  limit: z.string(),
  headroom: z.string(),
  overdueInvoices: z.number().int(),
  maxDaysPastDue: z.number().int(),
  autoBlock: z.boolean(),
  checkedAt: z.string(),
});

const rollRef = z.object({
  rollId: z.string(),
  barcode: z.string(),
  lengthM: z.number().int(),
});

// ── rates & allocation ───────────────────────────────────────────────────────

export const rateQuery = z.object({
  customerId: z.string(),
  skuId: z.string(),
  date: isoDate.optional(),
});
export const rateQuote = z.object({
  source: z.enum(SO_RATE_SOURCES),
  base44: z.string().nullable(),
  ratePerM: z.string().nullable(),
  widthIn: z.string(),
  gstRate: z.string().nullable(),
  /** Mapped metres in stock for this SKU right now (ADR-0005: live). */
  availableM: z.number().int(),
});

export const allocationLine = z.object({
  soLineId: z.string(),
  status: z.enum(["FULFILLED", "PARTIAL", "NO_INVENTORY"]),
  rolls: z.array(rollRef.extend({ ageDays: z.number().int() })),
  cut: z
    .object({
      rollId: z.string(),
      barcode: z.string(),
      cutM: z.number().int(),
      leftoverM: z.number().int(),
    })
    .nullable(),
  groups: z.array(z.object({ lengthM: z.number().int(), qty: z.number().int() })),
  requiredM: z.number().int(),
  allocatedM: z.number().int(),
  remainingM: z.number().int(),
});
export const allocationPreview = z.object({ lines: z.array(allocationLine) });

// ── sales order ──────────────────────────────────────────────────────────────

export const lengthMixEntry = z.object({
  lengthM: metres,
  rolls: z.number().int().positive(),
});
export const soLineInput = z
  .object({
    skuId: z.string(),
    totalM: metres,
    /** e.g. 3 × 1000 + 2 × 1500 (ADR-0012); optional. */
    lengthMix: z.array(lengthMixEntry).max(10).nullable().optional(),
    allowCut: z.boolean().optional(),
    /** The rate actually charged; differs from the derived rate when overridden. */
    ratePerM,
    discountPct: discountPct.optional(),
    notes: optionalText(200),
  })
  .refine(
    (l) =>
      !l.lengthMix?.length || l.lengthMix.reduce((s, m) => s + m.lengthM * m.rolls, 0) === l.totalM,
    { message: "The length mix must add up to the total metres", path: ["lengthMix"] },
  );
export const soCreate = z.object({
  customerId: z.string(),
  date: isoDate,
  shippingAddressId: z.string().nullable().optional(),
  customerRef: optionalText(60),
  billDiscount: money.optional(),
  charges: z.array(chargeInput).max(5).optional(),
  notes: optionalText(500),
  lines: z.array(soLineInput).min(1, "Add at least one line").max(100),
});
export const soUpdate = soCreate.extend(versioned);
export const soAction = z.object({ ...versioned });

export const soLineItem = z.object({
  id: z.string(),
  skuId: z.string(),
  skuCode: z.string(),
  description: z.string(),
  widthIn: z.string(),
  gsm: z.number().int(),
  hsnCode: z.string().nullable(),
  gstRate: z.string().nullable(),
  totalM: z.number().int(),
  lengthMix: z.array(lengthMixEntry).nullable(),
  qtyRolls: z.number().int(),
  allowCut: z.boolean(),
  rateSource: z.enum(SO_RATE_SOURCES),
  base44: z.string().nullable(),
  derivedRatePerM: z.string().nullable(),
  ratePerM: z.string(),
  deviationPct: z.string().nullable(),
  needsApproval: z.boolean(),
  approvedByName: z.string().nullable(),
  discountPct: z.string(),
  amount: z.string(),
  dispatchedM: z.number().int(),
  invoicedM: z.number().int(),
  balanceM: z.number().int(),
  notes: z.string().nullable(),
});
export const soListItem = z.object({
  id: z.string(),
  soNo: z.string(),
  date: z.string(),
  customerId: z.string(),
  customerName: z.string(),
  salesmanName: z.string().nullable(),
  status: z.enum(SO_STATUSES),
  orderedM: z.number().int(),
  dispatchedM: z.number().int(),
  total: z.string(),
  pendingApproval: z.boolean(),
  heldReasons: z.array(z.enum(CREDIT_REASONS)),
  version: z.number().int(),
});
export const soDetail = soListItem.extend({
  customerRef: z.string().nullable(),
  shippingAddressId: z.string().nullable(),
  placeOfSupply: z.string(),
  notes: z.string().nullable(),
  lines: z.array(soLineItem),
  charges: z.array(chargeItem),
  totals: salesTotals,
  credit: creditCheck.nullable(),
  releasedByName: z.string().nullable(),
  dcs: z.array(z.object({ id: z.string(), dcNo: z.string(), status: z.enum(DC_STATUSES) })),
  invoices: z.array(
    z.object({ id: z.string(), siNo: z.string().nullable(), status: z.enum(SI_STATUSES) }),
  ),
});

export const salesListQuery = z.object({
  q: z.string().trim().max(100).optional(),
  customerId: z.string().optional(),
  status: z.string().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

// ── delivery challan ─────────────────────────────────────────────────────────

export const dcCreate = z.object({ soId: z.string(), date: isoDate });
export const transportInput = z.object({
  transporterId: z.string().nullable().optional(),
  vehicleNo: vehicleNo.nullable().optional(),
  lrNo: optionalText(30),
  lrDate: isoDate.nullable().optional(),
  distanceKm: z.number().int().min(0).max(4000).nullable().optional(),
  ewayBillNo: z
    .string()
    .regex(/^\d{12}$/, "An e-way bill number has 12 digits")
    .nullable()
    .optional(),
  ewayBillDate: isoDate.nullable().optional(),
});
export const dcUpdate = transportInput.extend({
  date: isoDate,
  notes: optionalText(500),
  ...versioned,
});
/** Pick by scan (barcode) or by choosing a suggested roll (id). Moves it Mapped → Allocated. */
export const dcPick = z
  .object({ soLineId: z.string(), rollId: z.string().optional(), barcode: z.string().optional() })
  .refine((p) => Boolean(p.rollId) !== Boolean(p.barcode), "Give a roll id or a barcode");
export const dcUnpick = z.object({ rollId: z.string() });
/** Cut at picking (ADR-0018): the cut piece is picked; the parent stays Mapped, shorter. */
export const dcCut = z.object({
  soLineId: z.string(),
  rollId: z.string(),
  cutM: metres,
  wasteM: z.number().int().min(0).default(0),
});
export const dcCutResult = z.object({
  child: rollRef,
  parent: rollRef,
  /** Labels to print now: the cut piece and the parent's new length. */
  labelRollIds: z.array(z.string()),
});
export const dcPost = z.object({ ...versioned });

export const dcRollItem = rollRef.extend({
  soLineId: z.string(),
  description: z.string(),
  cutFromBarcode: z.string().nullable(),
});
export const dcListItem = z.object({
  id: z.string(),
  dcNo: z.string(),
  date: z.string(),
  soId: z.string(),
  soNo: z.string(),
  customerId: z.string(),
  customerName: z.string(),
  status: z.enum(DC_STATUSES),
  rollCount: z.number().int(),
  metres: z.number().int(),
  vehicleNo: z.string().nullable(),
  invoiced: z.boolean(),
  version: z.number().int(),
});
export const dcDetail = dcListItem.extend(transportInput.shape).extend({
  transporterName: z.string().nullable(),
  notes: z.string().nullable(),
  value: z.string(),
  ewayBillRequired: z.boolean(),
  lines: z.array(
    z.object({
      soLineId: z.string(),
      description: z.string(),
      orderedM: z.number().int(),
      pickedM: z.number().int(),
      balanceM: z.number().int(),
      allowCut: z.boolean(),
    }),
  ),
  rolls: z.array(dcRollItem),
});

// ── sales invoice ────────────────────────────────────────────────────────────

const rollPick = z.object({ lineId: z.string(), rollId: z.string() });
/**
 * Where the invoice comes from: open DCs of one customer (Q29), a direct sale from an SO
 * without a DC (Q22, rolls scanned on the invoice), or a proforma.
 */
export const siCreate = z.discriminatedUnion("source", [
  z.object({ source: z.literal("DC"), dcIds: z.array(z.string()).min(1).max(20), date: isoDate }),
  z.object({
    source: z.literal("DIRECT"),
    soId: z.string(),
    date: isoDate,
    rolls: z.array(rollPick).min(1).max(2000),
  }),
  z.object({
    source: z.literal("PROFORMA"),
    proformaId: z.string(),
    date: isoDate,
    rolls: z.array(rollPick).min(1).max(2000),
  }),
]);
export const siUpdate = z.object({
  date: isoDate,
  billDiscount: money,
  charges: z.array(chargeInput).max(5),
  lineDiscounts: z.array(z.object({ lineId: z.string(), discountPct })).max(100),
  notes: optionalText(500),
  ...versioned,
});
export const siAction = z.object({ ...versioned });

export const einvoiceInfo = z.object({
  status: z.enum(EINVOICE_STATUSES),
  irn: z.string().nullable(),
  ackNo: z.string().nullable(),
  ackDate: z.string().nullable(),
  signedQr: z.string().nullable(),
  attempts: z.number().int(),
  lastError: z.string().nullable(),
  /** Until when the IRN can still be cancelled (24 h). */
  cancellableUntil: z.string().nullable(),
});

export const siLineItem = z.object({
  id: z.string(),
  kind: z.enum(["GOODS", "CHARGE"]),
  soLineId: z.string().nullable(),
  description: z.string(),
  hsnCode: z.string(),
  widthIn: z.string().nullable(),
  metres: z.number().int().nullable(),
  ratePerM: z.string().nullable(),
  discountPct: z.string(),
  gross: z.string(),
  discount: z.string(),
  taxable: z.string(),
  gstRate: z.string(),
  cgst: z.string(),
  sgst: z.string(),
  igst: z.string(),
  /** Hidden without `inventory.view_cost`. */
  cogs: z.string().nullable(),
  rolls: z.array(rollRef),
});
export const siListItem = z.object({
  id: z.string(),
  siNo: z.string().nullable(),
  date: z.string(),
  customerId: z.string(),
  customerName: z.string(),
  status: z.enum(SI_STATUSES),
  total: z.string(),
  einvoiceStatus: z.enum(EINVOICE_STATUSES),
  dueDate: z.string(),
  outstanding: z.string(),
  version: z.number().int(),
});
export const siDetail = siListItem.extend({
  source: z.enum(["DC", "DIRECT", "PROFORMA"]),
  dcs: z.array(z.object({ id: z.string(), dcNo: z.string() })),
  soIds: z.array(z.string()),
  proformaId: z.string().nullable(),
  placeOfSupply: z.string(),
  billingAddress: z.string(),
  shippingAddress: z.string(),
  customerGstin: z.string().nullable(),
  supplyType: z.enum(["B2B", "B2C", "SEZWP", "SEZWOP"]),
  billDiscount: z.string(),
  notes: z.string().nullable(),
  lines: z.array(siLineItem),
  totals: salesTotals,
  /** Hidden without `inventory.view_cost`. */
  cogs: z.string().nullable(),
  einvoice: einvoiceInfo,
  transport: transportInput.extend({ transporterName: z.string().nullable() }),
  /** Plain-language reasons the invoice can't be posted yet (missing HSN, IRN window…). */
  blockers: z.array(z.string()),
});

// ── proforma ─────────────────────────────────────────────────────────────────

export const proformaLineInput = z.object({
  skuId: z.string(),
  metres,
  ratePerM,
  discountPct: discountPct.optional(),
});
export const proformaCreate = z.object({
  customerId: z.string(),
  soId: z.string().nullable().optional(),
  date: isoDate,
  validUntil: isoDate.nullable().optional(),
  billDiscount: money.optional(),
  charges: z.array(chargeInput).max(5).optional(),
  notes: optionalText(500),
  lines: z.array(proformaLineInput).min(1).max(100),
});
export const proformaUpdate = proformaCreate.extend(versioned);
export const proformaListItem = z.object({
  id: z.string(),
  proformaNo: z.string(),
  date: z.string(),
  validUntil: z.string(),
  customerId: z.string(),
  customerName: z.string(),
  status: z.enum(PROFORMA_STATUSES),
  total: z.string(),
  convertedSiId: z.string().nullable(),
  convertedSiNo: z.string().nullable(),
  version: z.number().int(),
});
export const proformaDetail = proformaListItem.extend({
  soId: z.string().nullable(),
  notes: z.string().nullable(),
  lines: z.array(
    proformaLineInput.extend({
      id: z.string(),
      description: z.string(),
      widthIn: z.string(),
      hsnCode: z.string().nullable(),
      gstRate: z.string().nullable(),
      discountPct: z.string(),
      taxable: z.string(),
    }),
  ),
  charges: z.array(chargeItem),
  totals: salesTotals,
});

// ── sales return & notes ─────────────────────────────────────────────────────

export const salesReturnCreate = z.object({
  siId: z.string(),
  date: isoDate,
  reason: z.string().trim().min(3).max(300),
  rolls: z
    .array(z.object({ rollId: z.string(), returnedM: metres }))
    .min(1)
    .max(500),
  notes: optionalText(500),
});
export const salesReturnUpdate = salesReturnCreate.extend(versioned);
/** Inspection of a returned roll (ADR-0015): back to stock (possibly re-mapped) or scrap. */
export const returnInspection = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("RESTOCK"), rollId: z.string(), skuId: z.string().optional() }),
  z.object({ outcome: z.literal("SCRAP"), rollId: z.string() }),
]);
export const salesReturnItem = z.object({
  id: z.string(),
  srNo: z.string().nullable(),
  cnId: z.string().nullable(),
  cnNo: z.string().nullable(),
  date: z.string(),
  siId: z.string(),
  siNo: z.string(),
  customerId: z.string(),
  customerName: z.string(),
  status: z.enum(SALES_RETURN_STATUSES),
  reason: z.string(),
  rollCount: z.number().int(),
  returnedM: z.number().int(),
  awaitingInspection: z.number().int(),
  total: z.string(),
  version: z.number().int(),
});
export const salesReturnDetail = salesReturnItem.extend({
  notes: z.string().nullable(),
  rolls: z.array(
    rollRef.extend({
      description: z.string(),
      dispatchedM: z.number().int(),
      returnedM: z.number().int(),
      taxable: z.string(),
      /** Hidden without `inventory.view_cost`. */
      cost: z.string().nullable(),
      rollStatus: z.string(),
      suggestScrap: z.boolean(),
    }),
  ),
  totals: salesTotals,
});

export const NOTE_KINDS = ["CREDIT", "DEBIT"] as const;
export const NOTE_REASONS = ["RATE_DIFFERENCE", "DISCOUNT", "SHORTAGE", "OTHER"] as const;
/** A credit / debit note not tied to a return (returns create their credit note on posting). */
export const noteCreate = z.object({
  kind: z.enum(NOTE_KINDS),
  customerId: z.string(),
  siId: z.string().nullable().optional(),
  date: isoDate,
  reasonCode: z.enum(NOTE_REASONS),
  reason: z.string().trim().min(3).max(300),
  lines: z
    .array(
      z.object({
        description: z.string().trim().min(2).max(160),
        hsnCode: z.string().regex(/^\d{4}(\d{2}){0,2}$/, "4, 6 or 8 digits"),
        taxable: money,
        gstRate: z.enum(["0", "5", "12", "18", "28"]),
      }),
    )
    .min(1)
    .max(50),
});
export const noteUpdate = noteCreate.extend(versioned);
export const noteItem = z.object({
  id: z.string(),
  kind: z.enum(NOTE_KINDS),
  noteNo: z.string().nullable(),
  date: z.string(),
  customerId: z.string(),
  customerName: z.string(),
  siId: z.string().nullable(),
  siNo: z.string().nullable(),
  salesReturnId: z.string().nullable(),
  reasonCode: z.enum([...NOTE_REASONS, "RETURN"]),
  reason: z.string(),
  status: z.enum(NOTE_STATUSES),
  total: z.string(),
  einvoiceStatus: z.enum(EINVOICE_STATUSES),
  version: z.number().int(),
});
export const noteDetail = noteItem.extend({
  lines: z.array(
    z.object({
      description: z.string(),
      hsnCode: z.string(),
      taxable: z.string(),
      gstRate: z.string(),
      cgst: z.string(),
      sgst: z.string(),
      igst: z.string(),
    }),
  ),
  totals: salesTotals,
  einvoice: einvoiceInfo,
});

// ── customer ledger (sub-ledger; receipts arrive in Stage 4) ─────────────────

export const ledgerQuery = z.object({ from: isoDate.optional(), to: isoDate.optional() });
export const ledgerEntry = z.object({
  date: z.string(),
  docType: z.enum(["SI", "CN", "DN", "OPENING"]),
  docId: z.string().nullable(),
  docNo: z.string(),
  debit: z.string(),
  credit: z.string(),
  balance: z.string(),
  dueDate: z.string().nullable(),
});
export const customerLedger = z.object({
  customerId: z.string(),
  opening: z.string(),
  entries: z.array(ledgerEntry),
  closing: z.string(),
  aging: z.array(z.object({ bucket: z.string(), amount: z.string() })),
});

// ── compliance ───────────────────────────────────────────────────────────────

/** IRN entered by hand from the portal (ADR-0011 manual fallback). */
export const manualIrn = z.object({
  irn: z.string().regex(/^[0-9a-f]{64}$/, "An IRN is 64 hexadecimal characters"),
  ackNo: z.string().regex(/^\d{12,20}$/, "Enter the acknowledgement number"),
  ackDate: z.iso.datetime({ offset: true }),
  signedQr: z.string().min(10).max(4000).nullable().optional(),
});
export const ewayBillInput = z.object({
  ewayBillNo: z.string().regex(/^\d{12}$/, "An e-way bill number has 12 digits"),
  ewayBillDate: isoDate,
  validUntil: isoDate.nullable().optional(),
});

export type CreditCheck = z.infer<typeof creditCheck>;
export type RateQuote = z.infer<typeof rateQuote>;
export type AllocationPreview = z.infer<typeof allocationPreview>;
export type SoListItem = z.infer<typeof soListItem>;
export type SoDetail = z.infer<typeof soDetail>;
export type SoLineItem = z.infer<typeof soLineItem>;
export type DcListItem = z.infer<typeof dcListItem>;
export type DcDetail = z.infer<typeof dcDetail>;
export type DcCutResult = z.infer<typeof dcCutResult>;
export type SiListItem = z.infer<typeof siListItem>;
export type SiDetail = z.infer<typeof siDetail>;
export type EInvoiceInfo = z.infer<typeof einvoiceInfo>;
export type ProformaListItem = z.infer<typeof proformaListItem>;
export type ProformaDetail = z.infer<typeof proformaDetail>;
export type SalesReturnItem = z.infer<typeof salesReturnItem>;
export type SalesReturnDetail = z.infer<typeof salesReturnDetail>;
export type NoteItem = z.infer<typeof noteItem>;
export type NoteDetail = z.infer<typeof noteDetail>;
export type CustomerLedger = z.infer<typeof customerLedger>;
