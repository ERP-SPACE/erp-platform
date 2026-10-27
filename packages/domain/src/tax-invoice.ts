import { D, Dec, type DecimalLike, round, sum } from "./money.js";

/**
 * GST invoice maths shared by purchase invoices (Stage 2) and sales invoices (Stage 3).
 * Verified against real invoices (Gulmohar R/649, Shree Balajee 2455, Orange O Tec PAPER/022):
 * - line amount = metres × rate per metre, rounded to the paisa (ADR-0013);
 * - tax is computed per GST rate on the summed taxable value (as on the HSN summary), CGST and
 *   SGST each at half the rate, IGST at the full rate;
 * - the bill is rounded to the nearest rupee (setting `invoice.roundOffTo`) with a round-off line.
 */
export type GstRegime = "CGST_SGST" | "IGST";

export interface TaxLineInput {
  quantity: DecimalLike;
  rate: DecimalLike;
  /** Line discount %, 0–100. */
  discountPct?: DecimalLike;
  /** GST rate %, e.g. 18. */
  gstRate: DecimalLike;
}

export interface TaxLine {
  gross: Dec;
  discount: Dec;
  taxable: Dec;
  gstRate: Dec;
}

export function taxLine(input: TaxLineInput): TaxLine {
  const gross = round(D(input.quantity).times(D(input.rate)), 2);
  const discount = round(gross.times(D(input.discountPct ?? 0)).dividedBy(100), 2);
  return { gross, discount, taxable: gross.minus(discount), gstRate: D(input.gstRate) };
}

export interface TaxRateSummary {
  gstRate: Dec;
  taxable: Dec;
  cgst: Dec;
  sgst: Dec;
  igst: Dec;
}

export interface InvoiceTotals {
  taxable: Dec;
  cgst: Dec;
  sgst: Dec;
  igst: Dec;
  /** Taxable + all GST, before rounding the bill. */
  beforeRoundOff: Dec;
  roundOff: Dec;
  total: Dec;
  byRate: TaxRateSummary[];
}

/** Rounds to the nearest multiple of `step` (1 = rupee, 0.5, or 0 for no rounding). */
export function roundToStep(value: DecimalLike, step: DecimalLike): Dec {
  const s = D(step);
  if (s.isZero()) return D(value);
  return D(value).dividedBy(s).toDecimalPlaces(0, Dec.ROUND_HALF_UP).times(s);
}

export function invoiceTotals(
  lines: readonly TaxLine[],
  regime: GstRegime,
  roundOffTo: DecimalLike = 1,
): InvoiceTotals {
  const rates = new Map<string, Dec>();
  for (const line of lines) {
    const key = line.gstRate.toString();
    rates.set(key, (rates.get(key) ?? D(0)).plus(line.taxable));
  }
  const byRate: TaxRateSummary[] = [...rates].map(([rate, taxable]) => {
    const r = D(rate);
    if (regime === "IGST") {
      return {
        gstRate: r,
        taxable,
        cgst: D(0),
        sgst: D(0),
        igst: round(taxable.times(r).dividedBy(100), 2),
      };
    }
    const half = round(taxable.times(r).dividedBy(200), 2);
    return { gstRate: r, taxable, cgst: half, sgst: half, igst: D(0) };
  });
  const taxable = sum(byRate.map((b) => b.taxable));
  const cgst = sum(byRate.map((b) => b.cgst));
  const sgst = sum(byRate.map((b) => b.sgst));
  const igst = sum(byRate.map((b) => b.igst));
  const beforeRoundOff = taxable.plus(cgst).plus(sgst).plus(igst);
  const total = roundToStep(beforeRoundOff, roundOffTo);
  return {
    taxable,
    cgst,
    sgst,
    igst,
    beforeRoundOff,
    roundOff: total.minus(beforeRoundOff),
    total,
    byRate,
  };
}
