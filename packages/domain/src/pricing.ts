import { D, type DecimalLike, type Dec, round } from "./money.js";

/**
 * Pricing (PRD §6.4, §8.1; ADR-0013): customer rates are quoted **per metre at the 44″
 * benchmark width**; every other width is derived by ratio. Ported from legacy
 * `pricingService.calculateWidthRate` with decimal maths instead of floats.
 */
export const BENCHMARK_WIDTH_IN = 44;

export class InvalidPricingError extends Error {
  readonly code = "INVALID_AMOUNT";
}

/** derived_rate(W) = base_rate_44 × W / 44, rounded to `decimals` (Q6: 2). */
export function deriveRatePerMetre(base44: DecimalLike, widthIn: DecimalLike, decimals = 2): Dec {
  const base = D(base44);
  const width = D(widthIn);
  if (base.isNegative()) throw new InvalidPricingError("Rate cannot be negative");
  if (width.lessThanOrEqualTo(0)) throw new InvalidPricingError("Width must be greater than zero");
  return round(base.times(width).dividedBy(BENCHMARK_WIDTH_IN), decimals);
}

/** Signed deviation of an override from the derived rate, in percent (2 dp). */
export function overrideDeviationPct(derived: DecimalLike, override: DecimalLike): Dec {
  const d = D(derived);
  if (d.isZero()) throw new InvalidPricingError("Derived rate is zero; deviation is undefined");
  return round(D(override).minus(d).dividedBy(d).times(100), 2);
}

/** An override needs Sales Manager / Owner approval when it differs by MORE than the tolerance (Q6: 5 %). */
export function requiresApproval(deviationPct: DecimalLike, tolerancePct: DecimalLike): boolean {
  return D(deviationPct).abs().greaterThan(D(tolerancePct));
}

export type RevisionMode = "PERCENT" | "FLAT";

/**
 * Bulk rate revision (PRD §6.4): change a per-metre rate by a percentage or a flat ₹/m amount.
 * The result is rounded to `decimals` and never goes below zero.
 */
export function reviseRate(
  rate: DecimalLike,
  change: { mode: RevisionMode; value: DecimalLike },
  decimals = 2,
): Dec {
  const current = D(rate);
  const next =
    change.mode === "PERCENT"
      ? current.times(D(100).plus(D(change.value))).dividedBy(100)
      : current.plus(D(change.value));
  const rounded = round(next, decimals);
  return rounded.isNegative() ? D(0) : rounded;
}

/** Amount for a quantity in metres at a per-metre rate (ADR-0013: line amount = metres × rate). */
export function lineAmount(metres: DecimalLike, ratePerMetre: DecimalLike): Dec {
  return round(D(metres).times(D(ratePerMetre)), 2);
}
