import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  agingBuckets,
  checkAllocation,
  invoiceOutstanding,
  nightlyBlockAction,
  payoutMachine,
  receiptMachine,
  suggestAllocation,
} from "../src/collections.js";
import {
  commissionDelta,
  commissionOnInvoice,
  creditNoteReversal,
  ruleOn,
} from "../src/commission.js";
import { D, sum } from "../src/money.js";

const inv = (id: string, dueDate: string, outstanding: string, date = dueDate) => ({
  id,
  date,
  dueDate,
  outstanding,
});

describe("receipt and payout state machines", () => {
  it("a posted receipt can only be reversed; a payout is paid once", () => {
    expect(receiptMachine.can("Draft", "Posted")).toBe(true);
    expect(receiptMachine.can("Posted", "Reversed")).toBe(true);
    expect(receiptMachine.can("Posted", "Cancelled")).toBe(false);
    expect(receiptMachine.can("Reversed", "Posted")).toBe(false);
    expect(payoutMachine.can("Draft", "Paid")).toBe(true);
    expect(payoutMachine.can("Paid", "Cancelled")).toBe(false);
  });
});

describe("allocation (PRD §8, UAT 11.5)", () => {
  const open = [
    inv("b", "2026-10-20", "5000.00"),
    inv("a", "2026-10-10", "3000.00"),
    inv("c", "2026-11-01", "4000.00"),
  ];

  it("suggests the oldest invoices first, filling each before the next", () => {
    const s = suggestAllocation("9500", open);
    expect(s.lines.map((l) => [l.invoiceId, l.amount.toFixed(2)])).toEqual([
      ["a", "3000.00"],
      ["b", "5000.00"],
      ["c", "1500.00"],
    ]);
    expect(s.unallocated.toFixed(2)).toBe("0.00");
  });

  it("UAT 11.5: a receipt that clears two invoices leaves nothing unallocated", () => {
    const s = suggestAllocation("8000", open);
    expect(s.lines).toHaveLength(2);
    expect(s.unallocated.isZero()).toBe(true);
  });

  it("money beyond every invoice stays on account; a negative amount is refused", () => {
    expect(suggestAllocation("15000", open).unallocated.toFixed(2)).toBe("3000.00");
    expect(() => suggestAllocation("-1", open)).toThrow(RangeError);
  });

  it("checks what is posted: over-allocation, repeats, unknown invoices, paise", () => {
    const owed = new Map([
      ["a", "3000.00"],
      ["b", "5000.00"],
    ]);
    expect(
      checkAllocation(
        "8000",
        [
          { invoiceId: "a", amount: "3000" },
          { invoiceId: "b", amount: "5000" },
        ],
        owed,
      ),
    ).toEqual([]);
    // TDS settles the rest of an invoice without money (Q32).
    expect(
      checkAllocation("2995", [{ invoiceId: "a", amount: "2995", deduction: "5" }], owed),
    ).toEqual([]);
    const bad = checkAllocation(
      "1000",
      [
        { invoiceId: "a", amount: "3000.001" },
        { invoiceId: "a", amount: "1" },
        { invoiceId: "z", amount: "1" },
        { invoiceId: "b", amount: "0" },
        { invoiceId: "b", amount: "6000", deduction: "-1" },
      ],
      owed,
    ).join(" | ");
    expect(bad).toMatch(/rupees and paise/);
    expect(bad).toMatch(/already on this receipt/);
    expect(bad).toMatch(/not open/);
    expect(bad).toMatch(/enter an amount/);
    expect(bad).toMatch(/cannot be negative/);
    expect(bad).toMatch(/more than the ₹5000.00 outstanding/);
    expect(bad).toMatch(/but the receipt is only ₹1000.00/);
  });

  it("outstanding never goes below zero", () => {
    expect(invoiceOutstanding("1180", ["1000", "100"]).toFixed(2)).toBe("80.00");
    expect(invoiceOutstanding("1180", ["2000"]).toFixed(2)).toBe("0.00");
  });

  it("property: a suggestion never over-allocates the receipt or any invoice", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            due: fc.integer({ min: 1, max: 28 }),
            paise: fc.integer({ min: 0, max: 5_000_000 }),
          }),
          { maxLength: 30 },
        ),
        fc.integer({ min: 0, max: 50_000_000 }),
        (rows, receiptPaise) => {
          const invoices = rows.map((r, i) =>
            inv(
              `i${i}`,
              `2026-10-${String(r.due).padStart(2, "0")}`,
              D(r.paise).dividedBy(100).toFixed(2),
            ),
          );
          const amount = D(receiptPaise).dividedBy(100);
          const s = suggestAllocation(amount, invoices);
          const applied = sum(s.lines.map((l) => l.amount));
          expect(applied.plus(s.unallocated).equals(amount)).toBe(true);
          const owed = new Map(invoices.map((x) => [x.id, x.outstanding]));
          for (const l of s.lines) {
            expect(l.amount.lessThanOrEqualTo(D(owed.get(l.invoiceId)!))).toBe(true);
          }
          expect(checkAllocation(amount, s.lines, owed)).toEqual([]);
          // Money is only left over when every invoice is fully paid.
          if (s.unallocated.greaterThan(0)) {
            expect(applied.equals(sum(invoices.map((x) => x.outstanding)))).toBe(true);
          }
        },
      ),
      { numRuns: 400 },
    );
  });
});

describe("aging (PRD §9)", () => {
  it("buckets by days since the invoice date and totals add up", () => {
    const b = agingBuckets(
      "2026-10-28",
      [
        { date: "2026-10-28", outstanding: "100" },
        { date: "2026-09-28", outstanding: "200" }, // 30 days
        { date: "2026-09-27", outstanding: "300" }, // 31 days
        { date: "2026-07-01", outstanding: "400" }, // 119 days
        { date: "2026-10-01", outstanding: "0" },
      ],
      [30, 60, 90],
    );
    expect(b.map((x) => [x.label, x.amount.toFixed(2), x.count])).toEqual([
      ["0–30 days", "300.00", 2],
      ["31–60 days", "300.00", 1],
      ["61–90 days", "0.00", 0],
      ["90+ days", "400.00", 1],
    ]);
  });

  it("refuses buckets that are not increasing", () => {
    expect(() => agingBuckets("2026-10-28", [], [60, 30])).toThrow(RangeError);
    expect(() => agingBuckets("2026-10-28", [], [])).toThrow(RangeError);
  });
});

describe("nightly credit evaluation (Q35)", () => {
  const ok = { blocked: false, reasons: [] };
  const late = { blocked: true, reasons: ["OVER_DUE" as const] };
  it("blocks on a new breach, unblocks its own block once paid, never touches a manual block", () => {
    expect(nightlyBlockAction({ systemBlocked: false, manualBlock: false }, late)).toBe("block");
    expect(nightlyBlockAction({ systemBlocked: true, manualBlock: false }, late)).toBe("none");
    expect(nightlyBlockAction({ systemBlocked: true, manualBlock: false }, ok)).toBe("unblock");
    expect(nightlyBlockAction({ systemBlocked: false, manualBlock: false }, ok)).toBe("none");
    expect(nightlyBlockAction({ systemBlocked: false, manualBlock: true }, late)).toBe("none");
    expect(nightlyBlockAction({ systemBlocked: true, manualBlock: true }, ok)).toBe("none");
  });
});

describe("commission (PRD §5.6, UAT 11.6)", () => {
  const rules = [
    {
      method: "PERCENT_SALES" as const,
      rate: "1",
      trigger: "ON_SI_POSTED" as const,
      validFrom: "2026-04-01",
      validTo: "2026-09-30",
    },
    {
      method: "PERCENT_SALES" as const,
      rate: "1.5",
      trigger: "ON_SI_POSTED" as const,
      validFrom: "2026-10-01",
      validTo: null,
    },
  ];

  it("takes the rule in force on the invoice date", () => {
    expect(ruleOn(rules, "2026-09-15")?.rate).toBe("1");
    expect(ruleOn(rules, "2026-10-28")?.rate).toBe("1.5");
    expect(ruleOn(rules, "2026-03-31")).toBeNull();
  });

  it("% of taxable value, or ₹ per billed metre", () => {
    const invoice = { taxable: "27340", metres: 4300 };
    expect(commissionOnInvoice({ method: "PERCENT_SALES", rate: "1.5" }, invoice).toFixed(2)).toBe(
      "410.10",
    );
    expect(commissionOnInvoice({ method: "PER_METER", rate: "0.10" }, invoice).toFixed(2)).toBe(
      "430.00",
    );
    expect(() => commissionOnInvoice({ method: "PER_METER", rate: "-1" }, invoice)).toThrow();
  });

  it("UAT 11.6: a credit note takes back its share of the commission", () => {
    // ₹410.10 on ₹27,340 taxable; a ₹4,620 credit note reverses 4620/27340 of it.
    expect(creditNoteReversal("410.10", "27340", "0", "4620").toFixed(2)).toBe("-69.30");
    // Notes for everything reverse all of it, however they are split.
    const first = creditNoteReversal("410.10", "27340", "0", "10000");
    const rest = creditNoteReversal("410.10", "27340", "10000", "17340");
    expect(first.plus(rest).toFixed(2)).toBe("-410.10");
  });

  it("pro-rata on payment: part payments and a bounce net out exactly", () => {
    const full = "410.10";
    const total = "32261";
    const a = commissionDelta(full, total, "0", "10000");
    const bounce = commissionDelta(full, total, "10000", "0");
    const b = commissionDelta(full, total, "0", "20000");
    const c = commissionDelta(full, total, "20000", "32261");
    expect(a.plus(bounce).isZero()).toBe(true);
    expect(b.plus(c).toFixed(2)).toBe("410.10");
    // Overpayment never earns more than the full commission; no base, no commission.
    expect(commissionDelta(full, total, "32261", "40000").isZero()).toBe(true);
    expect(commissionDelta(full, "0", "0", "100").isZero()).toBe(true);
  });

  it("property: any sequence of settlements ends at the commission due on the final amount", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.integer({ min: 1, max: 100_000_000 }),
        fc.array(fc.integer({ min: 0, max: 120_000_000 }), { minLength: 1, maxLength: 12 }),
        (fullPaise, basePaise, steps) => {
          const full = D(fullPaise).dividedBy(100);
          const base = D(basePaise).dividedBy(100);
          let before = D(0);
          let total = D(0);
          for (const s of steps) {
            const after = D(s).dividedBy(100);
            total = total.plus(commissionDelta(full, base, before, after));
            before = after;
          }
          expect(total.equals(commissionDelta(full, base, 0, before))).toBe(true);
          expect(total.lessThanOrEqualTo(full)).toBe(true);
          expect(total.isNegative()).toBe(false);
        },
      ),
      { numRuns: 400 },
    );
  });
});
