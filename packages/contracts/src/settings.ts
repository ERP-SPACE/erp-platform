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
    default: [24, 36, 44, 63],
  },
  "catalogue.allowedLengthsM": {
    label: "Standard roll lengths (metres)",
    group: "Catalogue",
    schema: positiveInts,
    default: [1000, 1500, 2000],
  },
  "catalogue.gsmList": {
    label: "GSM values",
    group: "Catalogue",
    schema: positiveInts,
    default: [30, 35, 45, 55, 65, 80, 100],
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
    }),
    default: { widthMm: 100, heightMm: 50, output: "PDF" },
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
