import { D, type Dec, type DecimalLike, round } from "./money.js";

/**
 * Roll quantities as suppliers write them on invoices ("10 X 1000 MTRS",
 * "4 X 1000, 500+450 MTRS") — the GRN takes these lengths as-is (Q13: trust the supplier).
 */
export class InvalidRollListError extends Error {
  readonly code = "INVALID_ROLL_LIST";
}

/** Upper bound per entry, to catch typos like 10000 rolls. */
export const MAX_ROLLS_PER_ENTRY = 2000;

/**
 * Parses a roll list into individual lengths in metres.
 * Accepts `N x L` (x, X, *, ×), plain lengths, and separators `,` `+` `;` or new lines; a
 * trailing unit (m, mtr, mtrs, meters) is ignored. "4x1000, 500+450" → [1000,1000,1000,1000,500,450].
 */
export function parseRollList(input: string): number[] {
  const cleaned = input
    .toLowerCase()
    .replace(/\b(m|mtr|mtrs|meter|meters|metre|metres)\b\.?/g, " ");
  const tokens = cleaned
    .split(/[,+;\n]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (tokens.length === 0) throw new InvalidRollListError("Enter roll lengths, e.g. 4 x 1000, 500");
  const lengths: number[] = [];
  for (const token of tokens) {
    const multi = /^(\d+)\s*[x*×]\s*(\d+(?:\.\d+)?)$/.exec(token);
    const single = /^(\d+(?:\.\d+)?)$/.exec(token);
    let count: number;
    let length: number;
    if (multi) {
      count = Number(multi[1]);
      length = Number(multi[2]);
    } else if (single) {
      count = 1;
      length = Number(single[1]);
    } else {
      throw new InvalidRollListError(`Can't read "${token}" — use forms like 4 x 1000 or 500`);
    }
    if (!Number.isInteger(length) || length <= 0) {
      throw new InvalidRollListError(
        `Roll length must be a whole number of metres, got "${token}"`,
      );
    }
    if (count < 1 || count > MAX_ROLLS_PER_ENTRY) {
      throw new InvalidRollListError(`Roll count must be 1–${MAX_ROLLS_PER_ENTRY}, got "${token}"`);
    }
    for (let i = 0; i < count; i++) lengths.push(length);
  }
  return lengths;
}

/** Compact form for display: [1000,1000,1000,500,450] → "3 × 1000, 500, 450". Keeps first-seen order. */
export function formatRollList(lengths: readonly number[]): string {
  const counts = new Map<number, number>();
  for (const l of lengths) counts.set(l, (counts.get(l) ?? 0) + 1);
  return [...counts]
    .map(([length, count]) => (count > 1 ? `${count} × ${length}` : String(length)))
    .join(", ");
}

const INCH_M = D("0.0254");

/**
 * Nominal roll weight in kg from its paper spec: GSM (g/m²) × width (m) × length (m) ÷ 1000.
 * A 29 GSM, 44″, 1000 m roll ≈ 32.4 kg. Used to split freight/loading by weight (landed cost).
 */
export function rollWeightKg(gsm: DecimalLike, widthIn: DecimalLike, lengthM: DecimalLike): Dec {
  return round(D(gsm).times(D(widthIn).times(INCH_M)).times(D(lengthM)).dividedBy(1000), 3);
}
