import { toIstCalendarDate } from "./fy.js";

/**
 * Roll barcode `YYMM-SUP-BATCH-SEQ-CHECK` (ADR-0007), e.g. `2610-SHR-0042-0007-K`.
 * The check character is Luhn mod 36 over the alphanumerics, so a single wrong character or a
 * swap of two neighbours is caught at scan time (the legacy ASCII-sum mod 10 missed swaps).
 */
const CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const N = CHARSET.length;

export class InvalidBarcodeError extends Error {
  readonly code = "INVALID_BARCODE";
}

function codePoints(input: string): number[] {
  return [...input.toUpperCase()].map((ch) => {
    const cp = CHARSET.indexOf(ch);
    if (cp < 0) throw new InvalidBarcodeError(`"${ch}" is not allowed in a barcode`);
    return cp;
  });
}

/** Luhn mod-N check character for an alphanumeric string. */
export function luhnMod36(input: string): string {
  const cps = codePoints(input);
  let factor = 2;
  let total = 0;
  for (let i = cps.length - 1; i >= 0; i--) {
    let addend = factor * cps[i]!;
    factor = factor === 2 ? 1 : 2;
    addend = Math.floor(addend / N) + (addend % N);
    total += addend;
  }
  return CHARSET[(N - (total % N)) % N]!;
}

/** True when the last character is the Luhn mod-36 check of the rest. */
export function isLuhnMod36Valid(withCheck: string): boolean {
  const cps = codePoints(withCheck);
  let factor = 1;
  let total = 0;
  for (let i = cps.length - 1; i >= 0; i--) {
    let addend = factor * cps[i]!;
    factor = factor === 2 ? 1 : 2;
    addend = Math.floor(addend / N) + (addend % N);
    total += addend;
  }
  return total % N === 0;
}

export interface RollBarcodeParts {
  /** GRN posting date; YYMM is taken in IST. */
  postedAt: Date | string;
  /** 3-character supplier short code (supplier master). */
  supplierCode: string;
  /** Per-supplier batch sequence (1–9999). */
  batchSeq: number;
  /** Per-batch roll sequence (1–9999). */
  rollSeq: number;
}

const pad4 = (n: number, what: string) => {
  if (!Number.isInteger(n) || n < 1 || n > 9999) {
    throw new InvalidBarcodeError(`${what} must be 1–9999, got ${n}`);
  }
  return String(n).padStart(4, "0");
};

export function formatRollBarcode(parts: RollBarcodeParts): string {
  // A full timestamp is converted to its IST calendar date; "YYYY-MM-DD" is used as-is.
  const at =
    typeof parts.postedAt === "string" && parts.postedAt.length > 10
      ? new Date(parts.postedAt)
      : parts.postedAt;
  const { year, month } = toIstCalendarDate(at);
  const yymm = `${String(year % 100).padStart(2, "0")}${String(month).padStart(2, "0")}`;
  const sup = parts.supplierCode.toUpperCase();
  if (!/^[A-Z0-9]{3}$/.test(sup)) {
    throw new InvalidBarcodeError(
      `Supplier code must be 3 letters/digits, got "${parts.supplierCode}"`,
    );
  }
  const body = [yymm, sup, pad4(parts.batchSeq, "Batch"), pad4(parts.rollSeq, "Roll sequence")];
  return `${body.join("-")}-${luhnMod36(body.join(""))}`;
}

const BARCODE_PATTERN = /^(\d{4})-([A-Z0-9]{3})-(\d{4})-(\d{4})-([0-9A-Z])$/;

/** Parses and checks a scanned barcode; tolerant of lower case and stray whitespace. */
export function parseRollBarcode(
  scanned: string,
):
  | { valid: true; yymm: string; supplierCode: string; batchSeq: number; rollSeq: number }
  | { valid: false; error: string } {
  const value = scanned.trim().toUpperCase();
  const m = BARCODE_PATTERN.exec(value);
  if (!m) return { valid: false, error: "Not a roll barcode (expected YYMM-SUP-BATCH-SEQ-C)" };
  if (!isLuhnMod36Valid(value.replace(/-/g, ""))) {
    return { valid: false, error: "Check character does not match — rescan the label" };
  }
  return {
    valid: true,
    yymm: m[1]!,
    supplierCode: m[2]!,
    batchSeq: Number(m[3]),
    rollSeq: Number(m[4]),
  };
}
