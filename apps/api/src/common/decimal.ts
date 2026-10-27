/**
 * Trailing-zero trim for Postgres numeric strings without going through a JS float
 * (ADR-0002): "100000.00" → "100000", "6.2500" → "6.25", "18.00" → "18".
 */
export function trimDecimal(value: string): string;
export function trimDecimal(value: string | null): string | null;
export function trimDecimal(value: string | null): string | null {
  if (value === null) return null;
  return value.includes(".") ? value.replace(/\.?0+$/, "") : value;
}
