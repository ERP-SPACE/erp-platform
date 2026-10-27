/** Calendar-date arithmetic on `YYYY-MM-DD` strings (no time zone involved). */
export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** True when `date` falls inside [from, to] (`to` null = open-ended). */
export function inRange(date: string, from: string, to: string | null): boolean {
  return from <= date && (to === null || to >= date);
}
