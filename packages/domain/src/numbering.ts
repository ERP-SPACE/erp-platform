import { fyCode, fyLabel } from "./fy.js";

/**
 * Document number formatting (ADR-0003). A series has a prefix template such as `SI/{FY}/`
 * and a zero-padded sequence: `SI/2627/00001`.
 *   {FY}       → 2627
 *   {FY_FULL}  → 2026-27
 */
export interface SeriesFormat {
  prefixTemplate: string;
  padding: number;
}

export const GST_DOC_NO_MAX_LENGTH = 16;
const GST_DOC_NO_PATTERN = /^[A-Za-z0-9/-]+$/;
const KNOWN_TOKENS = /\{(FY|FY_FULL)\}/g;

export class InvalidSeriesError extends Error {
  readonly code = "INVALID_SERIES";
}

export function renderPrefix(prefixTemplate: string, date: Date | string): string {
  const rendered = prefixTemplate.replace(KNOWN_TOKENS, (_m, token: string) =>
    token === "FY" ? fyCode(date) : fyLabel(date),
  );
  if (/[{}]/.test(rendered)) {
    throw new InvalidSeriesError(`Unknown token in "${prefixTemplate}" (allowed: {FY}, {FY_FULL})`);
  }
  return rendered;
}

export function formatDocNo(format: SeriesFormat, date: Date | string, seq: number): string {
  if (!Number.isInteger(seq) || seq < 1) {
    throw new InvalidSeriesError(`Sequence must be a positive integer, got ${seq}`);
  }
  if (!Number.isInteger(format.padding) || format.padding < 1 || format.padding > 10) {
    throw new InvalidSeriesError(`Padding must be 1–10, got ${format.padding}`);
  }
  return `${renderPrefix(format.prefixTemplate, date)}${String(seq).padStart(format.padding, "0")}`;
}

export function isValidGstDocNo(docNo: string): boolean {
  return (
    docNo.length > 0 && docNo.length <= GST_DOC_NO_MAX_LENGTH && GST_DOC_NO_PATTERN.test(docNo)
  );
}

/**
 * Validate a series for GST documents (SI, CN, DN): the longest number it can produce in a year
 * (sequence = 10^padding − 1) must still be a valid GST invoice number.
 */
export function validateGstSeries(format: SeriesFormat, date: Date | string): string[] {
  const errors: string[] = [];
  let longest: string;
  try {
    longest = formatDocNo(format, date, 10 ** format.padding - 1);
  } catch (error) {
    return [(error as Error).message];
  }
  if (longest.length > GST_DOC_NO_MAX_LENGTH) {
    errors.push(
      `Numbers can reach ${longest.length} characters ("${longest}"); GST allows ${GST_DOC_NO_MAX_LENGTH}.`,
    );
  }
  if (!GST_DOC_NO_PATTERN.test(longest)) {
    errors.push("Only letters, digits, '/' and '-' are allowed in GST document numbers.");
  }
  return errors;
}
