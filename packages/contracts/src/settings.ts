import { z } from "zod";

/**
 * Settings registry (CLAUDE.md rule 9). Every configurable business value lives in the
 * `settings` table under one of these keys; the schema validates writes and the default seeds it.
 * Values marked "pending owner" are placeholders until the open question is answered.
 */
const positiveInts = z.array(z.number().int().positive()).min(1);
const decimalString = z.string().regex(/^\d+(\.\d{1,4})?$/, "Expected a non-negative decimal");

export const SETTINGS = {
  "catalogue.allowedWidthsIn": {
    label: "Allowed roll widths (inches)",
    group: "Catalogue",
    schema: z.array(z.number().positive().max(200)).min(1),
    default: [24, 36, 40, 44, 46, 48, 50, 60, 63],
  },
  "catalogue.allowedLengthsM": {
    label: "Standard roll lengths (metres)",
    group: "Catalogue",
    schema: positiveInts,
    default: [720, 800, 960, 1000, 1100, 1200, 1300, 1500, 2000],
  },
  "catalogue.gsmList": {
    label: "GSM values",
    group: "Catalogue",
    schema: positiveInts,
    default: [29, 30, 35, 45, 55, 65, 80, 100],
  },
  "pricing.rateDecimals": {
    label: "Decimals for derived per-metre rates",
    group: "Pricing",
    schema: z.number().int().min(0).max(4),
    default: 2,
  },
  "pricing.overrideTolerancePct": {
    label: "Rate override tolerance before approval (%)",
    group: "Pricing",
    schema: z.number().min(0).max(100),
    default: 5,
  },
  "invoice.roundOffTo": {
    label: "Invoice round-off (₹)",
    group: "Invoicing",
    schema: z.union([z.literal(0), z.literal(0.5), z.literal(1)]),
    default: 1,
  },
  "credit.defaults": {
    label: "Default credit policy for new customers",
    group: "Credit",
    schema: z.object({
      creditLimit: decimalString,
      creditDays: z.number().int().min(0).max(365),
      graceDays: z.number().int().min(0).max(180),
      blockRule: z.enum(["OVER_LIMIT", "OVER_DUE", "BOTH"]),
      autoBlock: z.boolean(),
    }),
    default: {
      creditLimit: "100000",
      creditDays: 30,
      graceDays: 15,
      blockRule: "BOTH",
      autoBlock: true,
    },
  },
  "inventory.aging": {
    label: "Stock aging",
    group: "Inventory",
    schema: z.object({
      bucketsDays: positiveInts,
      deadStockDays: z.number().int().positive(),
      unmappedAlertHours: z.number().int().positive(),
    }),
    default: { bucketsDays: [30, 60, 90, 180], deadStockDays: 180, unmappedAlertHours: 24 },
  },
  "inventory.allocation": {
    label: "Roll allocation & cutting (ADR-0018)",
    group: "Inventory",
    schema: z.object({
      standardLengthM: z.number().positive(),
      toleranceM: z.number().min(0),
      minUsableLengthM: z.number().min(0),
    }),
    default: { standardLengthM: 1000, toleranceM: 100, minUsableLengthM: 100 },
  },
  "labels.roll": {
    label: "Roll label",
    group: "Labels",
    schema: z.object({
      widthMm: z.number().int().min(30).max(150),
      heightMm: z.number().int().min(20).max(150),
      output: z.enum(["PDF", "ZPL"]),
      /** PDF only: one label per page (label printer) or 2 × 5 on an A4 sheet (office printer). */
      layout: z.enum(["SINGLE", "A4_2x5"]).default("SINGLE"),
    }),
    default: { widthMm: 100, heightMm: 50, output: "PDF", layout: "SINGLE" },
  },
  "purchase.landedCostCharges": {
    label: "Landed-cost charges and how each is split across rolls",
    group: "Purchase",
    schema: z
      .array(
        z.object({
          code: z.string().regex(/^[A-Z][A-Z0-9_]{1,23}$/, "Upper-case code, e.g. FREIGHT"),
          label: z.string().trim().min(2).max(60),
          basis: z.enum(["ROLL", "METER", "VALUE", "WEIGHT"]),
          active: z.boolean().default(true),
        }),
      )
      .min(1)
      .refine(
        (list) => new Set(list.map((c) => c.code)).size === list.length,
        "Codes must be unique",
      ),
    // Trade-standard split (Q16, delegated): weight-driven charges by WEIGHT, value-driven by VALUE.
    default: [
      { code: "FREIGHT", label: "Freight / transport inward", basis: "WEIGHT", active: true },
      { code: "LOADING", label: "Loading / unloading (hamali)", basis: "WEIGHT", active: true },
      { code: "INSURANCE", label: "Insurance", basis: "VALUE", active: true },
      { code: "CUSTOMS_DUTY", label: "Customs duty (BCD + SWS)", basis: "VALUE", active: true },
      {
        code: "CLEARING",
        label: "Clearing & forwarding (CHA), port / CFS",
        basis: "VALUE",
        active: true,
      },
      {
        code: "BROKERAGE",
        label: "Brokerage / commission on purchase",
        basis: "VALUE",
        active: true,
      },
      { code: "OTHER", label: "Other", basis: "VALUE", active: true },
    ],
  },
  "purchase.overReceiptTolerancePct": {
    label: "Goods receipt above PO quantity allowed without approval (%)",
    group: "Purchase",
    schema: z.number().min(0).max(50),
    default: 0,
  },
  "sales.proformaValidityDays": {
    label: "Proforma valid for (days)",
    group: "Sales",
    schema: z.number().int().min(1).max(90),
    default: 7,
  },
  "invoice.extraCharges": {
    label: "Extra charges on customer invoices (Q21)",
    group: "Invoicing",
    // Taxed at the goods' GST rate. HSN blank = the main goods' HSN (part of the same supply).
    schema: z
      .array(
        z.object({
          code: z.string().regex(/^[A-Z][A-Z0-9_]{1,23}$/, "Upper-case code, e.g. FREIGHT"),
          label: z.string().trim().min(2).max(60),
          hsnCode: z
            .string()
            .regex(/^\d{4}(\d{2}){0,2}$/, "4, 6 or 8 digits")
            .nullable(),
          active: z.boolean().default(true),
        }),
      )
      .refine(
        (list) => new Set(list.map((c) => c.code)).size === list.length,
        "Codes must be unique",
      ),
    default: [
      { code: "FREIGHT", label: "Freight", hsnCode: null, active: true },
      { code: "PACKING", label: "Packing", hsnCode: null, active: true },
      { code: "LOADING", label: "Loading", hsnCode: null, active: true },
    ],
  },
  "invoice.pdf": {
    label: "Invoice print (Q30: same content and order as R/649)",
    group: "Invoicing",
    schema: z.object({
      copies: z.array(z.string().trim().min(2).max(40)).min(1).max(4),
      /** List each roll's barcode and length under its line. */
      showRolls: z.boolean(),
      terms: z.array(z.string().trim().min(2).max(200)).max(8),
    }),
    default: {
      copies: ["Original for recipient", "Duplicate for transporter", "Triplicate for supplier"],
      showRolls: true,
      terms: [
        "Goods once sold will not be taken back without prior approval.",
        "Interest may be charged on payments received after the due date.",
        "Subject to Surat jurisdiction.",
      ],
    },
  },
  "einvoice.config": {
    label: "E-invoicing (ADR-0011)",
    group: "Compliance",
    schema: z.object({
      /** SANDBOX = NIC test portal; MANUAL = IRN typed in from the portal; GSP = live provider (Q27). */
      provider: z.enum(["SANDBOX", "MANUAL", "GSP"]),
      /** Days after the invoice date the IRP still accepts it (verify with the CA). */
      reportingWindowDays: z.number().int().min(1).max(365),
      /** Warn on drafts older than this many days. */
      warnAfterDays: z.number().int().min(1).max(365),
      cancelWindowHours: z.number().int().min(1).max(24),
    }),
    default: {
      provider: "SANDBOX",
      reportingWindowDays: 30,
      warnAfterDays: 25,
      cancelWindowHours: 24,
    },
  },
  "ewaybill.thresholdInr": {
    label: "E-way bill needed above this consignment value (₹)",
    group: "Compliance",
    schema: z.number().int().min(0),
    default: 50000,
  },
  "analytics.refresh": {
    label: "Analytics refresh (ADR-0005)",
    group: "System",
    schema: z.object({
      businessMinutes: z.number().int().min(1).max(60),
      offHoursMinutes: z.number().int().min(1).max(240),
      businessStart: z.string().regex(/^\d{2}:\d{2}$/),
      businessEnd: z.string().regex(/^\d{2}:\d{2}$/),
    }),
    default: {
      businessMinutes: 3,
      offHoursMinutes: 30,
      businessStart: "08:00",
      businessEnd: "20:00",
    },
  },
} as const satisfies Record<
  string,
  { label: string; group: string; schema: z.ZodType; default: unknown }
>;

export type SettingKey = keyof typeof SETTINGS;
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTINGS)[K]["schema"]>;
export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];

export function isSettingKey(key: string): key is SettingKey {
  return key in SETTINGS;
}

export function parseSetting<K extends SettingKey>(key: K, value: unknown): SettingValue<K> {
  return SETTINGS[key].schema.parse(value) as SettingValue<K>;
}

// The default values must satisfy their own schemas — checked by a unit test.
