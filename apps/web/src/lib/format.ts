const IST = "Asia/Kolkata";

/** "Friday, 23 October" in IST. */
export function longDate(date: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: IST,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(date);
}

/** "14:32" in IST. */
export function clock(date: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: IST,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

/** "23 Oct 2026, 14:32" in IST. */
export function dateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: IST,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}

export function greeting(date: Date = new Date()): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-IN", { timeZone: IST, hour: "numeric", hourCycle: "h23" }).format(
      date,
    ),
  );
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}
