import { D, type Dec, type DecimalLike, round } from "./money.js";

/**
 * Salesman / broker commission (PRD §5.6, port matrix 4.8). Accrual is per document:
 * - ON_SI_POSTED: the whole commission when the invoice posts; credit notes against it reverse
 *   their share.
 * - ON_PAYMENT_RECEIVED: a share with each payment applied to the invoice (pro-rata, Q24);
 *   a bounced receipt reverses its share.
 * Shares are computed cumulatively (what is due after the event minus what was due before), so
 * any sequence of part payments, bounces and notes nets to the full commission or to zero —
 * never a stray paisa.
 */

export type CommissionMethod = "PER_METER" | "PERCENT_SALES";
export type CommissionTrigger = "ON_SI_POSTED" | "ON_PAYMENT_RECEIVED";

export interface CommissionRuleInput {
  method: CommissionMethod;
  /** ₹ per metre, or % of the taxable value (Q11). */
  rate: DecimalLike;
  trigger: CommissionTrigger;
  validFrom: string;
  validTo: string | null;
}

/** The rule in force on `date`: the latest `validFrom` on or before it, not yet expired. */
export function ruleOn<R extends CommissionRuleInput>(rules: readonly R[], date: string): R | null {
  return (
    [...rules]
      .filter((r) => r.validFrom <= date && (r.validTo === null || r.validTo >= date))
      .sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0] ?? null
  );
}

/** Full commission on an invoice: % of taxable value, or ₹ per billed metre. */
export function commissionOnInvoice(
  rule: Pick<CommissionRuleInput, "method" | "rate">,
  invoice: { taxable: DecimalLike; metres: number },
): Dec {
  const rate = D(rule.rate);
  if (rate.isNegative()) throw new RangeError("A commission rate cannot be negative");
  return rule.method === "PERCENT_SALES"
    ? round(D(invoice.taxable).times(rate).dividedBy(100), 2)
    : round(D(invoice.metres).times(rate), 2);
}

/**
 * The change in commission when the settled part of an invoice moves from `before` to `after`
 * (both clamped to [0, base]). Positive accrues, negative reverses.
 *
 * - Payments: base = invoice total, settled = money + deductions applied so far.
 * - Credit notes (ON_SI_POSTED): call with base = invoice taxable and the credited taxable as
 *   "settled", then negate — the credited share is taken back.
 */
export function commissionDelta(
  full: DecimalLike,
  base: DecimalLike,
  before: DecimalLike,
  after: DecimalLike,
): Dec {
  const b = D(base);
  if (b.lessThanOrEqualTo(0)) return D(0);
  const clamp = (v: DecimalLike) => {
    const x = D(v);
    return x.isNegative() ? D(0) : x.greaterThan(b) ? b : x;
  };
  const due = (v: DecimalLike) => round(D(full).times(clamp(v)).dividedBy(b), 2);
  return due(after).minus(due(before));
}

/**
 * What a credit note reverses under ON_SI_POSTED: the commission share of the credited taxable
 * value, as a negative amount. `creditedBefore` is taxable already credited by earlier notes.
 */
export function creditNoteReversal(
  full: DecimalLike,
  invoiceTaxable: DecimalLike,
  creditedBefore: DecimalLike,
  noteTaxable: DecimalLike,
): Dec {
  return commissionDelta(
    full,
    invoiceTaxable,
    creditedBefore,
    D(creditedBefore).plus(noteTaxable),
  ).negated();
}
