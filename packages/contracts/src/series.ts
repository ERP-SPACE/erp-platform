import { z } from "zod";

/** Document series defaults (ADR-0003): `{TYPE}/{FY}/{SEQ5}`, reset every 1 April. */
export const DOC_TYPES = {
  PO: { label: "Purchase Order", numberedOn: "create", gst: false },
  GRN: { label: "Goods Receipt Note", numberedOn: "create", gst: false },
  PI: { label: "Purchase Invoice (internal ref)", numberedOn: "post", gst: false },
  PR: { label: "Purchase Return", numberedOn: "post", gst: false },
  DN: { label: "Debit Note", numberedOn: "post", gst: true },
  SO: { label: "Sales Order", numberedOn: "create", gst: false },
  PF: { label: "Proforma Invoice", numberedOn: "create", gst: false },
  DC: { label: "Delivery Challan", numberedOn: "create", gst: false },
  SI: { label: "Sales Invoice", numberedOn: "post", gst: true },
  SR: { label: "Sales Return", numberedOn: "post", gst: false },
  CN: { label: "Credit Note", numberedOn: "post", gst: true },
  RC: { label: "Receipt", numberedOn: "post", gst: false },
  PY: { label: "Payment", numberedOn: "post", gst: false },
  CP: { label: "Commission Payout", numberedOn: "post", gst: false },
  OB: { label: "Opening stock GRN", numberedOn: "post", gst: false },
  JV: { label: "Journal Voucher (accounting stage)", numberedOn: "post", gst: false },
} as const satisfies Record<string, { label: string; numberedOn: "create" | "post"; gst: boolean }>;

export type DocType = keyof typeof DOC_TYPES;
export const DOC_TYPE_CODES = Object.keys(DOC_TYPES) as DocType[];
export const docTypeSchema = z.enum(DOC_TYPE_CODES as [DocType, ...DocType[]]);

export function defaultSeries(type: DocType) {
  return {
    entityType: type,
    prefixTemplate: `${type}/{FY}/`,
    padding: 5,
    resetOnFy: true,
    numberedOn: DOC_TYPES[type].numberedOn,
  };
}

export const seriesUpdateSchema = z.object({
  prefixTemplate: z.string().min(1).max(24),
  padding: z.number().int().min(3).max(8),
  resetOnFy: z.boolean(),
  version: z.number().int().positive(),
});
export type SeriesUpdate = z.infer<typeof seriesUpdateSchema>;
