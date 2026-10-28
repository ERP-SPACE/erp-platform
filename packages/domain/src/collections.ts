import { D, type Dec, type DecimalLike, sum } from "./money.js";
import type { CreditResult } from "./sales.js";
import { defineMachine } from "./state.js";

/**
 * Stage 4 collections (PRD §8, §9): allocating receipts and payments to invoices, outstanding,
 * aging and the nightly credit decision. Pure; amounts are rupees to the paisa.
 */

// ─── documents ───────────────────────────────────────────────────────────────

export const RECEIPT_STATUSES = ["Draft", "Posted", "Reversed", "Cancelled"] as const;
export type ReceiptStatus = (typeof RECEIPT_STATUSES)[number];

/**
 * Customer receipts and supplier payments. Posted ones are never edited: a bounce or a mistake
 * reverses them (with a reason) and the money is entered again (CLAUDE.md rule 1).
 */
export const receiptMachine = defineMachine<ReceiptStatus>("Receipt", {
  Draft: ["Posted", "Cancelled"],
  Posted: ["Reversed"],
  Reversed: [],
  Cancelled: [],
});

export const PAYOUT_STATUSES = ["Draft", "Paid", "Cancelled"] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

/** A commission payout batch: settles specific accrued entries once paid (Q34). */
export const payoutMachine = defineMachine<PayoutStatus>("CommissionPayout", {
  Draft: ["Paid", "Cancelled"],
  Paid: [],
  Cancelled: [],
});

// ─── allocation ──────────────────────────────────────────────────────────────

export interface OpenInvoice {
  id: string;
  /** ISO dates. */
  date: string;
  dueDate: string;
  outstanding: DecimalLike;
}

export interface AllocationLine {
  invoiceId: string;
  /** Money applied to the invoice. */
  amount: DecimalLike;
  /** TDS or short payment that also settles the invoice without money (Q32). */
  deduction?: DecimalLike;
}

export interface SuggestedAllocation {
  lines: { invoiceId: string; amount: Dec }[];
  /** Left on account (an advance), flagged until used. */
  unallocated: Dec;
}

const byAge = (a: OpenInvoice, b: OpenInvoice) =>
  a.dueDate.localeCompare(b.dueDate) || a.date.localeCompare(b.date) || a.id.localeCompare(b.id);

/**
 * Suggests applying `amount` to the oldest invoices first (by due date, then date): each invoice
 * is filled before the next is touched, and nothing is applied beyond what it owes. The
 * accountant can change the result; `checkAllocation` validates whatever is posted.
 */
export function suggestAllocation(
  amount: DecimalLike,
  invoices: readonly OpenInvoice[],
): SuggestedAllocation {
  let left = D(amount);
  if (left.isNegative()) throw new RangeError("A receipt amount cannot be negative");
  const lines: SuggestedAllocation["lines"] = [];
  for (const inv of [...invoices].sort(byAge)) {
    if (left.isZero()) break;
    const owes = D(inv.outstanding);
    if (owes.lessThanOrEqualTo(0)) continue; // decimal.js: isPositive() is true for 0
    const take = owes.lessThan(left) ? owes : left;
    lines.push({ invoiceId: inv.id, amount: take });
    left = left.minus(take);
  }
  return { lines, unallocated: left };
}

/**
 * Checks an allocation before it is posted: amounts in paise and not negative, each invoice
 * settled at most up to its outstanding (money + deduction), invoices not repeated, and the money
 * applied not more than the receipt. Returns plain-language problems; empty means fine.
 */
export function checkAllocation(
  receiptAmount: DecimalLike,
  lines: readonly AllocationLine[],
  outstandingById: ReadonlyMap<string, DecimalLike>,
): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  const paise = (v: Dec) => v.equals(v.toDecimalPlaces(2));
  for (const [i, l] of lines.entries()) {
    const amount = D(l.amount);
    const deduction = D(l.deduction ?? 0);
    const n = i + 1;
    if (seen.has(l.invoiceId)) problems.push(`Line ${n}: that invoice is already on this receipt`);
    seen.add(l.invoiceId);
    if (amount.isNegative() || deduction.isNegative())
      problems.push(`Line ${n}: amounts cannot be negative`);
    if (!paise(amount) || !paise(deduction))
      problems.push(`Line ${n}: amounts are in rupees and paise`);
    if (amount.plus(deduction).isZero()) problems.push(`Line ${n}: enter an amount`);
    const owes = outstandingById.get(l.invoiceId);
    if (owes === undefined) {
      problems.push(`Line ${n}: that invoice is not open for this party`);
    } else if (amount.plus(deduction).greaterThan(D(owes))) {
      problems.push(`Line ${n}: more than the ₹${D(owes).toFixed(2)} outstanding`);
    }
  }
  const applied = sum(lines.map((l) => l.amount));
  if (applied.greaterThan(D(receiptAmount))) {
    problems.push(
      `₹${applied.toFixed(2)} is allocated but the receipt is only ₹${D(receiptAmount).toFixed(2)}`,
    );
  }
  return problems;
}

/** What an invoice still owes after its settlements (receipts, deductions, credit notes). */
export function invoiceOutstanding(total: DecimalLike, settled: readonly DecimalLike[]): Dec {
  const left = D(total).minus(sum(settled));
  return left.isNegative() ? D(0) : left;
}

// ─── aging ───────────────────────────────────────────────────────────────────

const days = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

export interface AgingBucket {
  label: string;
  /** Inclusive day range; `to` is null for the last bucket. */
  from: number;
  to: number | null;
  amount: Dec;
  count: number;
}

/**
 * AR / AP aging (PRD §9): each open item goes in a bucket by its age in days since `basis`
 * (invoice date by default) on `asOf`. Buckets come from settings, e.g. [30, 60, 90] →
 * 0–30, 31–60, 61–90, 90+. Bucket totals always add up to the total outstanding.
 */
export function agingBuckets(
  asOf: string,
  items: readonly { date: string; outstanding: DecimalLike }[],
  limits: readonly number[],
): AgingBucket[] {
  if (!limits.length || limits.some((d, i) => d <= (limits[i - 1] ?? -1))) {
    throw new RangeError("Aging buckets must be increasing day counts");
  }
  const buckets: AgingBucket[] = [
    ...limits.map((to, i) => ({
      label: `${i ? limits[i - 1]! + 1 : 0}–${to} days`,
      from: i ? limits[i - 1]! + 1 : 0,
      to,
      amount: D(0),
      count: 0,
    })),
    { label: `${limits.at(-1)}+ days`, from: limits.at(-1)! + 1, to: null, amount: D(0), count: 0 },
  ];
  for (const item of items) {
    const owes = D(item.outstanding);
    if (owes.isZero()) continue;
    const age = Math.max(0, days(item.date, asOf));
    const b = buckets.find((x) => x.to === null || age <= x.to)!;
    b.amount = b.amount.plus(owes);
    b.count += 1;
  }
  return buckets;
}

// ─── nightly credit evaluation (Q35) ─────────────────────────────────────────

export type BlockAction = "block" | "unblock" | "none";

/**
 * What the nightly job does with a customer, given today's credit result: block when the
 * auto-block rule now breaches, lift a block the system placed once it no longer does, and never
 * touch a block a person placed.
 */
export function nightlyBlockAction(
  current: { systemBlocked: boolean; manualBlock: boolean },
  result: Pick<CreditResult, "blocked" | "reasons">,
): BlockAction {
  if (current.manualBlock) return "none";
  const breach = result.blocked && result.reasons.some((r) => r !== "MANUAL_BLOCK");
  if (breach && !current.systemBlocked) return "block";
  if (!breach && current.systemBlocked) return "unblock";
  return "none";
}
