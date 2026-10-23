/**
 * Indian financial year (1 April – 31 March), evaluated in IST.
 * India has no daylight saving, so IST is a fixed UTC+05:30 offset.
 */
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface CalendarDate {
  year: number;
  month: number; // 1–12
  day: number;
}

/** A `YYYY-MM-DD` string is taken as an IST calendar date; a Date is converted to IST. */
export function toIstCalendarDate(input: Date | string): CalendarDate {
  if (typeof input === "string") {
    const match = ISO_DATE.exec(input);
    if (!match) throw new RangeError(`Expected YYYY-MM-DD, got "${input}"`);
    return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  }
  if (Number.isNaN(input.getTime())) throw new RangeError("Invalid Date");
  const ist = new Date(input.getTime() + IST_OFFSET_MS);
  return { year: ist.getUTCFullYear(), month: ist.getUTCMonth() + 1, day: ist.getUTCDate() };
}

export function fyStartYear(input: Date | string): number {
  const { year, month } = toIstCalendarDate(input);
  return month >= 4 ? year : year - 1;
}

/** `2627` for FY 2026-27 — the `{FY}` token in document numbers (ADR-0003). */
export function fyCode(input: Date | string): string {
  const start = fyStartYear(input);
  return `${String(start % 100).padStart(2, "0")}${String((start + 1) % 100).padStart(2, "0")}`;
}

/** `2026-27` — human label. */
export function fyLabel(input: Date | string): string {
  const start = fyStartYear(input);
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

export function fyRange(input: Date | string): { from: string; to: string } {
  const start = fyStartYear(input);
  return { from: `${start}-04-01`, to: `${start + 1}-03-31` };
}

/** Today's IST calendar date as `YYYY-MM-DD`. */
export function istToday(now: Date = new Date()): string {
  const { year, month, day } = toIstCalendarDate(now);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
