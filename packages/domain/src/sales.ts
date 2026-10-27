import { D, type DecimalLike, type Dec, sum } from "./money.js";
import { deriveRatePerMetre, overrideDeviationPct, requiresApproval } from "./pricing.js";
import { defineMachine } from "./state.js";

/**
 * Stage 3 sales rules (PRD §6.5, §7, §8.1, §8.5; ADR-0011/0012/0014/0016): state machines, price
 * resolution and the credit check at Confirm. Pure — the API supplies the rows.
 */

// ─── State machines ──────────────────────────────────────────────────────────

export const SO_STATUSES = [
  "Draft",
  "Confirmed",
  "OnHold",
  "PartiallyFulfilled",
  "Closed",
  "Cancelled",
] as const;
export type SoStatus = (typeof SO_STATUSES)[number];

/**
 * Sales order. Confirm runs the credit check → Confirmed or OnHold; OnHold is released (with a
 * reason) or re-checked into Confirmed. Cancelling once anything has been dispatched is refused by
 * the service (the machine allows it only from states with nothing shipped).
 */
export const salesOrderMachine = defineMachine<SoStatus>("SalesOrder", {
  Draft: ["Confirmed", "OnHold", "Cancelled"],
  OnHold: ["Confirmed", "Cancelled"],
  Confirmed: ["OnHold", "PartiallyFulfilled", "Closed", "Cancelled"],
  PartiallyFulfilled: ["Closed"],
  Closed: [],
  Cancelled: [],
});

/** SO statuses whose undelivered value counts towards credit exposure (OnHold never does). */
export const EXPOSURE_SO_STATUSES: readonly SoStatus[] = ["Confirmed", "PartiallyFulfilled"];

export const DC_STATUSES = ["Draft", "Open", "Closed", "Cancelled"] as const;
export type DcStatus = (typeof DC_STATUSES)[number];

/**
 * Delivery challan: Draft is picking (rolls Allocated); Open = dispatched; Closed = invoiced.
 * Closed → Open only when its invoice is cancelled within the IRN window, to be billed again.
 */
export const deliveryChallanMachine = defineMachine<DcStatus>("DeliveryChallan", {
  Draft: ["Open", "Cancelled"],
  Open: ["Closed"],
  Closed: ["Open"],
  Cancelled: [],
});

export const SI_STATUSES = ["Draft", "Posted", "Cancelled"] as const;
export type SiStatus = (typeof SI_STATUSES)[number];

/**
 * Sales invoice. Posted is immutable; Posted → Cancelled only through IRN cancellation within
 * 24 h (ADR-0011) — the number is never reused. Later corrections are credit/debit notes.
 */
export const salesInvoiceMachine = defineMachine<SiStatus>("SalesInvoice", {
  Draft: ["Posted", "Cancelled"],
  Posted: ["Cancelled"],
  Cancelled: [],
});

export const PROFORMA_STATUSES = ["Draft", "Sent", "Converted", "Cancelled"] as const;
export type ProformaStatus = (typeof PROFORMA_STATUSES)[number];

/** Proforma: no accounting effect at any stage; Converted when an SI is made from it. */
export const proformaMachine = defineMachine<ProformaStatus>("Proforma", {
  Draft: ["Sent", "Converted", "Cancelled"],
  Sent: ["Converted", "Cancelled"],
  Converted: [],
  Cancelled: [],
});

export const SALES_RETURN_STATUSES = ["Draft", "Posted", "Cancelled"] as const;
export type SalesReturnStatus = (typeof SALES_RETURN_STATUSES)[number];

/** Sales return: posting moves its rolls Dispatched → Returned and issues the credit note. */
export const salesReturnMachine = defineMachine<SalesReturnStatus>("SalesReturn", {
  Draft: ["Posted", "Cancelled"],
  Posted: [],
  Cancelled: [],
});

export const NOTE_STATUSES = ["Draft", "Posted", "Cancelled"] as const;
export type NoteStatus = (typeof NOTE_STATUSES)[number];

/** Credit / debit note to a customer; like an SI, cancellable after posting only via its IRN. */
export const customerNoteMachine = defineMachine<NoteStatus>("CustomerNote", {
  Draft: ["Posted", "Cancelled"],
  Posted: ["Cancelled"],
  Cancelled: [],
});

export const EINVOICE_STATUSES = ["Pending", "Generated", "Failed", "Cancelled"] as const;
export type EInvoiceStatus = (typeof EINVOICE_STATUSES)[number];

/** IRN lifecycle on an SI / CN / DN (ADR-0011): retries move Failed back to Pending. */
export const einvoiceMachine = defineMachine<EInvoiceStatus>("EInvoice", {
  Pending: ["Generated", "Failed"],
  Failed: ["Pending"],
  Generated: ["Cancelled"],
  Cancelled: [],
});

// ─── Price resolution ────────────────────────────────────────────────────────

export type RateSource = "PARTY_RATE" | "SALESMAN_DEFAULT" | "NONE";

export interface RateCandidates {
  /** The customer's 44″ rates for this product (party_rates rows). */
  partyRates: readonly { baseRate44: DecimalLike; validFrom: string; validTo: string | null }[];
  /** The customer's salesman's default 44″ rate for this product, if any. */
  salesmanDefault44?: DecimalLike | null;
}

export interface ResolvedRate {
  source: RateSource;
  base44: Dec | null;
  ratePerM: Dec | null;
}

/**
 * The rate an order line starts with (ADR-0013): the customer's rate valid on the order date
 * (latest start wins), else the salesman's default, derived to the line's width.
 */
export function resolveRate(
  candidates: RateCandidates,
  onDate: string,
  widthIn: DecimalLike,
  decimals = 2,
): ResolvedRate {
  const valid = candidates.partyRates
    .filter((r) => r.validFrom <= onDate && (r.validTo === null || r.validTo >= onDate))
    .sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0];
  const [source, base44]: [RateSource, DecimalLike | null] = valid
    ? ["PARTY_RATE", valid.baseRate44]
    : candidates.salesmanDefault44 != null
      ? ["SALESMAN_DEFAULT", candidates.salesmanDefault44]
      : ["NONE", null];
  return {
    source,
    base44: base44 === null ? null : D(base44),
    ratePerM: base44 === null ? null : deriveRatePerMetre(base44, widthIn, decimals),
  };
}

export interface OverrideCheck {
  deviationPct: Dec;
  needsApproval: boolean;
}

/** A typed rate against the derived one: approval is needed beyond the tolerance (Q6: 5 %). */
export function checkOverride(
  derived: DecimalLike | null,
  override: DecimalLike,
  tolerancePct: DecimalLike,
): OverrideCheck {
  // With nothing to compare against, any typed rate is a manager's call.
  if (derived === null || D(derived).isZero()) return { deviationPct: D(100), needsApproval: true };
  const deviationPct = overrideDeviationPct(derived, override);
  return { deviationPct, needsApproval: requiresApproval(deviationPct, tolerancePct) };
}

// ─── Credit check ────────────────────────────────────────────────────────────

export type BlockRule = "OVER_LIMIT" | "OVER_DUE" | "BOTH";
export type CreditReason = "MANUAL_BLOCK" | "OVER_LIMIT" | "OVER_DUE";

export interface CreditInput {
  policy: {
    creditLimit: DecimalLike;
    creditDays: number;
    graceDays: number;
    autoBlock: boolean;
    blockRule: BlockRule;
  };
  manualBlock: boolean;
  /** Unpaid posted invoices: invoice date and what is still owed on each. */
  openInvoices: readonly { date: string; outstanding: DecimalLike }[];
  /** Unapplied credit notes (and, from Stage 4, on-account receipts) — reduce exposure. */
  unappliedCredits?: DecimalLike;
  /** Undelivered value of the customer's other Confirmed / PartiallyFulfilled orders. */
  otherOpenOrders: DecimalLike;
  /** This order's value (ADR-0016: it counts). */
  thisOrder: DecimalLike;
  today: string;
}

export interface CreditResult {
  blocked: boolean;
  /** Every rule that is breached, even when auto-block is off (shown as a warning). */
  reasons: CreditReason[];
  outstanding: Dec;
  exposure: Dec;
  limit: Dec;
  /** Limit − exposure; negative when over. */
  headroom: Dec;
  overdueInvoices: number;
  maxDaysPastDue: number;
}

const DAY_MS = 86_400_000;
const days = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

/**
 * PRD §8.5 with ADR-0016: exposure = outstanding AR + other open orders + this order.
 * OVER_LIMIT when exposure > limit; OVER_DUE when any invoice is unpaid beyond credit days +
 * grace days. A manual block always holds; the rules hold only with auto-block on.
 */
export function evaluateCredit(input: CreditInput): CreditResult {
  const { policy } = input;
  const owed = input.openInvoices.filter((i) => D(i.outstanding).greaterThan(0));
  const outstanding = sum(owed.map((i) => i.outstanding)).minus(D(input.unappliedCredits ?? 0));
  const exposure = outstanding.plus(D(input.otherOpenOrders)).plus(D(input.thisOrder));
  const limit = D(policy.creditLimit);
  const pastDue = owed
    .map((i) => days(i.date, input.today) - policy.creditDays)
    .filter((d) => d > policy.graceDays);

  const reasons: CreditReason[] = [];
  if (input.manualBlock) reasons.push("MANUAL_BLOCK");
  const overLimit = exposure.greaterThan(limit);
  const overDue = pastDue.length > 0;
  if (overLimit && policy.blockRule !== "OVER_DUE") reasons.push("OVER_LIMIT");
  if (overDue && policy.blockRule !== "OVER_LIMIT") reasons.push("OVER_DUE");

  const blocked = input.manualBlock || (policy.autoBlock && reasons.length > 0);
  return {
    blocked,
    reasons,
    outstanding,
    exposure,
    limit,
    headroom: limit.minus(exposure),
    overdueInvoices: pastDue.length,
    maxDaysPastDue: pastDue.length ? Math.max(...pastDue) : 0,
  };
}
