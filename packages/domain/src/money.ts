import { Decimal } from "decimal.js";

/**
 * All money and quantity arithmetic goes through this module (ADR-0002).
 * Storage is Postgres `numeric`; values cross the wire as strings and become Decimal here.
 */
export const Dec = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type Dec = InstanceType<typeof Dec>;
export type DecimalLike = Dec | string | number;

export class InvalidAmountError extends Error {
  readonly code = "INVALID_AMOUNT";
}

export function D(value: DecimalLike): Dec {
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new InvalidAmountError(`Not a finite number: ${value}`);
  }
  try {
    return new Dec(value);
  } catch {
    throw new InvalidAmountError(`Not a decimal value: ${String(value)}`);
  }
}

export function round(value: DecimalLike, decimals = 2): Dec {
  return D(value).toDecimalPlaces(decimals, Dec.ROUND_HALF_UP);
}

export function sum(values: readonly DecimalLike[]): Dec {
  return values.reduce<Dec>((acc, v) => acc.plus(D(v)), D(0));
}

/** Serialise for storage / transport: fixed decimals, no exponent notation. */
export function toFixedString(value: DecimalLike, decimals = 2): string {
  return round(value, decimals).toFixed(decimals);
}

/**
 * Split `total` across `weights` so the parts sum exactly to `total` at `decimals` precision.
 * Largest-remainder method: floor each proportional share, then hand the leftover smallest
 * units to the largest fractional remainders (ties: larger weight, then earlier index).
 * Used for bill-discount → lines, landed cost → rolls, and tax splits (PRD §8.2, §8.3).
 * When every weight is zero the total is split equally.
 */
export function allocateLargestRemainder(
  total: DecimalLike,
  weights: readonly DecimalLike[],
  decimals = 2,
): Dec[] {
  if (weights.length === 0) {
    throw new InvalidAmountError("Cannot allocate across zero weights");
  }
  const t = D(total);
  if (!t.equals(t.toDecimalPlaces(decimals))) {
    throw new InvalidAmountError(`Total ${t.toString()} has more than ${decimals} decimals`);
  }
  const w = weights.map(D);
  if (w.some((x) => x.isNegative())) {
    throw new InvalidAmountError("Weights must not be negative");
  }

  const scale = D(10).pow(decimals);
  const sign = t.isNegative() ? -1 : 1;
  const units = t.abs().times(scale);
  const weightSum = sum(w);
  const effective = weightSum.isZero() ? w.map(() => D(1)) : w;
  const effectiveSum = weightSum.isZero() ? D(w.length) : weightSum;

  const shares = effective.map((weight, index) => {
    const raw = units.times(weight).dividedBy(effectiveSum);
    const floor = raw.floor();
    return { index, weight, floor, fraction: raw.minus(floor) };
  });

  let leftover = units.minus(sum(shares.map((s) => s.floor))).toNumber();
  const order = [...shares].sort(
    (a, b) => b.fraction.comparedTo(a.fraction) || b.weight.comparedTo(a.weight) || a.index - b.index,
  );
  const bumps = new Set<number>();
  for (const share of order) {
    if (leftover <= 0) break;
    bumps.add(share.index);
    leftover -= 1;
  }

  return shares.map((s) =>
    s.floor
      .plus(bumps.has(s.index) ? 1 : 0)
      .dividedBy(scale)
      .times(sign),
  );
}
