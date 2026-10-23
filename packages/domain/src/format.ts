import { D, type DecimalLike, round } from "./money.js";

/** Indian digit grouping: 1234567 → 12,34,567. Operates on the digit string (no floats). */
export function groupIndian(integerDigits: string): string {
  if (integerDigits.length <= 3) return integerDigits;
  const last3 = integerDigits.slice(-3);
  const rest = integerDigits.slice(0, -3);
  return `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${last3}`;
}

export interface NumberFormatOptions {
  decimals?: number;
  /** Negative amounts shown as (1,200.00) — Part B of the brief. Default true. */
  parensForNegative?: boolean;
}

export function formatNumber(value: DecimalLike, options: NumberFormatOptions = {}): string {
  const { decimals = 2, parensForNegative = true } = options;
  const r = round(value, decimals);
  const [intPart = "0", fraction] = r.abs().toFixed(decimals).split(".");
  const body = fraction ? `${groupIndian(intPart)}.${fraction}` : groupIndian(intPart);
  if (!r.isNegative() || r.isZero()) return body;
  return parensForNegative ? `(${body})` : `-${body}`;
}

/** ₹ 4,82,300.00 */
export function formatINR(value: DecimalLike, options: NumberFormatOptions = {}): string {
  const formatted = formatNumber(value, options);
  return formatted.startsWith("(") ? `(₹ ${formatted.slice(1)}` : `₹ ${formatted}`;
}

/** Compact lakh/crore for briefs: ₹ 4.8 L, ₹ 1.25 Cr. */
export function formatINRCompact(value: DecimalLike): string {
  const v = D(value);
  const abs = v.abs();
  const sign = v.isNegative() ? "−" : "";
  if (abs.gte(1e7)) return `${sign}₹ ${trimZeros(abs.dividedBy(1e7).toFixed(2))} Cr`;
  if (abs.gte(1e5)) return `${sign}₹ ${trimZeros(abs.dividedBy(1e5).toFixed(1))} L`;
  return `${sign}₹ ${formatNumber(abs, { decimals: 0 })}`;
}

export type QuantityUnit = "m" | "in" | "rolls" | "kg";

/** 1,000 m · 44″ · 12 rolls */
export function formatQty(value: DecimalLike, unit: QuantityUnit, decimals?: number): string {
  const v = D(value);
  const places = decimals ?? (v.isInteger() ? 0 : 2);
  const n = formatNumber(v, { decimals: places, parensForNegative: false });
  switch (unit) {
    case "in":
      return `${n}″`;
    case "rolls":
      return `${n} ${v.equals(1) ? "roll" : "rolls"}`;
    default:
      return `${n} ${unit}`;
  }
}

function trimZeros(s: string): string {
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
}
