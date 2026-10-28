import { D, type DecimalLike, type Dec, allocateLargestRemainder, round, sum } from "./money.js";
import {
  type GstRegime,
  type InvoiceTotals,
  type TaxLine,
  invoiceTotals,
  taxLine,
} from "./tax-invoice.js";

/**
 * Sales invoice engine (PRD §8.2, §8.4, §8.6; ADR-0013/0015/0018; Q20/Q21), shared by the API and
 * the invoice preview:
 * - goods lines: billed metres × rate per metre, less a line discount %;
 * - charge lines (freight, packing, loading — Q21): a taxable amount at the goods' GST rate;
 * - a bill discount in ₹ spread over all lines by taxable value (largest remainder), so GST per
 *   line stays right;
 * - tax per rate on the summed taxable value and the rupee round-off, as on R/649.
 */

export interface SalesGoodsLine {
  kind: "GOODS";
  metres: DecimalLike;
  ratePerM: DecimalLike;
  discountPct?: DecimalLike;
  gstRate: DecimalLike;
}

export interface SalesChargeLine {
  kind: "CHARGE";
  amount: DecimalLike;
  /** Defaults to the goods' rate (`chargeGstRate`). */
  gstRate?: DecimalLike;
}

export type SalesLineInput = SalesGoodsLine | SalesChargeLine;

export interface SalesLine extends TaxLine {
  kind: "GOODS" | "CHARGE";
  /** Share of the bill discount; already taken off `taxable`. */
  billDiscount: Dec;
}

export interface SalesInvoiceResult {
  lines: SalesLine[];
  /** Line discounts + bill discount. */
  discountTotal: Dec;
  totals: InvoiceTotals;
}

export class InvalidInvoiceError extends Error {
  readonly code = "INVALID_INVOICE";
}

/**
 * Extra charges follow the principal supply (Q21): they take the highest GST rate among the
 * goods lines, and 18 % when there are none.
 */
export function chargeGstRate(goodsRates: readonly DecimalLike[]): Dec {
  return goodsRates.length ? goodsRates.map(D).reduce((a, b) => (b.greaterThan(a) ? b : a)) : D(18);
}

export function salesInvoice(
  inputs: readonly SalesLineInput[],
  options: {
    regime: GstRegime;
    /** Bill discount in ₹ (Q20). */
    billDiscount?: DecimalLike;
    /** SEZ with LUT: zero-rated, IGST at 0 % (ADR-0009). */
    zeroRated?: boolean;
    roundOffTo?: DecimalLike;
  },
): SalesInvoiceResult {
  if (!inputs.some((l) => l.kind === "GOODS")) {
    throw new InvalidInvoiceError("An invoice needs at least one goods line");
  }
  const goodsRate = chargeGstRate(
    inputs.filter((l): l is SalesGoodsLine => l.kind === "GOODS").map((l) => l.gstRate),
  );
  const base = inputs.map((l) => {
    const t =
      l.kind === "GOODS"
        ? taxLine({
            quantity: l.metres,
            rate: l.ratePerM,
            discountPct: l.discountPct,
            gstRate: l.gstRate,
          })
        : taxLine({ quantity: 1, rate: round(l.amount, 2), gstRate: l.gstRate ?? goodsRate });
    return { ...t, kind: l.kind, gstRate: options.zeroRated ? D(0) : t.gstRate };
  });

  const bill = round(options.billDiscount ?? 0, 2);
  const before = sum(base.map((l) => l.taxable));
  if (bill.isNegative() || bill.greaterThan(before)) {
    throw new InvalidInvoiceError("The bill discount must be between zero and the invoice value");
  }
  const shares = bill.isZero()
    ? base.map(() => D(0))
    : allocateLargestRemainder(
        bill,
        base.map((l) => l.taxable),
        2,
      );
  const lines: SalesLine[] = base.map((l, i) => ({
    ...l,
    billDiscount: shares[i]!,
    taxable: l.taxable.minus(shares[i]!),
  }));
  return {
    lines,
    discountTotal: sum(lines.map((l) => l.discount.plus(l.billDiscount))),
    totals: invoiceTotals(lines, options.regime, options.roundOffTo ?? 1),
  };
}

/**
 * Splits each rate's GST back onto its lines by taxable value (largest remainder), so per-line tax
 * (e-invoice items, credit notes) sums exactly to the invoice's tax.
 */
export function lineTaxes(
  lines: readonly TaxLine[],
  totals: InvoiceTotals,
): { cgst: Dec; sgst: Dec; igst: Dec }[] {
  const out = lines.map(() => ({ cgst: D(0), sgst: D(0), igst: D(0) }));
  for (const rate of totals.byRate) {
    const idx = lines.flatMap((l, i) => (l.gstRate.equals(rate.gstRate) ? [i] : []));
    for (const head of ["cgst", "sgst", "igst"] as const) {
      if (rate[head].isZero()) continue;
      const parts = allocateLargestRemainder(
        rate[head],
        idx.map((i) => lines[i]!.taxable),
        2,
      );
      idx.forEach((i, k) => (out[i]![head] = parts[k]!));
    }
  }
  return out;
}

// ─── Cost ────────────────────────────────────────────────────────────────────

/** COGS of a billed roll (PRD §8.4): its landed cost for the metres shipped. */
export function rollCogs(lengthM: DecimalLike, landedCostPerM: DecimalLike): Dec {
  return round(D(lengthM).times(D(landedCostPerM)), 2);
}

export interface CutResult {
  childCost: Dec;
  wasteCost: Dec;
  parentCostAfter: Dec;
  parentLengthAfter: number;
}

/**
 * A cut (ADR-0018): the parent's remaining cost is split over the cut piece, the trim waste and
 * what stays on the parent by metres, to the paisa (largest remainder) — nothing is lost.
 */
export function cutRoll(
  parent: { lengthM: number; landedCostTotal: DecimalLike },
  cutM: number,
  wasteM = 0,
): CutResult {
  if (!Number.isInteger(cutM) || cutM <= 0 || !Number.isInteger(wasteM) || wasteM < 0) {
    throw new InvalidInvoiceError("Cut and waste are whole metres; the cut must be positive");
  }
  const parentLengthAfter = parent.lengthM - cutM - wasteM;
  if (parentLengthAfter <= 0) {
    throw new InvalidInvoiceError(
      "A cut must leave something on the roll — send the whole roll instead",
    );
  }
  const [childCost, wasteCost, parentCostAfter] = allocateLargestRemainder(
    round(parent.landedCostTotal, 2),
    [cutM, wasteM, parentLengthAfter],
    2,
  ) as [Dec, Dec, Dec];
  return { childCost, wasteCost, parentCostAfter, parentLengthAfter };
}

/**
 * A partial return (PRD §8.4, ADR-0015): the returned metres' share of what was billed (the credit
 * note's taxable value) and of the roll's COGS (its cost back in stock). 700 m of 1000 m → 70 %.
 */
export function partialReturn(
  returnedM: DecimalLike,
  dispatchedM: DecimalLike,
  line: { taxable: DecimalLike; cogs: DecimalLike },
): { taxable: Dec; cost: Dec } {
  const r = D(returnedM);
  const d = D(dispatchedM);
  if (r.lessThanOrEqualTo(0) || r.greaterThan(d)) {
    throw new InvalidInvoiceError(
      "Returned metres must be more than zero and at most what was sent",
    );
  }
  const share = (v: DecimalLike) => round(D(v).times(r).dividedBy(d), 2);
  return { taxable: share(line.taxable), cost: share(line.cogs) };
}
