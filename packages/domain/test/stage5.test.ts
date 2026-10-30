import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { D, sum } from "../src/money.js";
import {
  NEEDS_YOU_BY_ROLE,
  NEEDS_YOU_KINDS,
  PIVOT_DIMENSIONS,
  type PivotDimension,
  type PivotFact,
  ageBand,
  daysBetween,
  dso,
  isChurnRisk,
  marginPercent,
  periodKey,
  periodRange,
  pivot,
  rankNeedsYou,
  todaySentence,
  totalsOf,
  utilisationPercent,
} from "../src/reports.js";

describe("periods", () => {
  it("buckets dates by day, month, FY quarter and FY", () => {
    expect(periodKey("2026-10-28", "day")).toBe("2026-10-28");
    expect(periodKey("2026-10-28", "month")).toBe("2026-10");
    expect(periodKey("2026-04-01", "quarter")).toBe("2026-27 Q1");
    expect(periodKey("2026-10-28", "quarter")).toBe("2026-27 Q3");
    expect(periodKey("2027-03-31", "quarter")).toBe("2026-27 Q4");
    expect(periodKey("2027-03-31", "fy")).toBe("2026-27");
  });

  it("gives each period's first and last day", () => {
    expect(periodRange("2026-10-28", "day")).toEqual({ from: "2026-10-28", to: "2026-10-28" });
    expect(periodRange("2028-02-10", "month")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(periodRange("2026-05-15", "quarter")).toEqual({ from: "2026-04-01", to: "2026-06-30" });
    expect(periodRange("2026-11-15", "quarter")).toEqual({ from: "2026-10-01", to: "2026-12-31" });
    expect(periodRange("2027-02-15", "quarter")).toEqual({ from: "2027-01-01", to: "2027-03-31" });
    expect(periodRange("2027-02-15", "fy")).toEqual({ from: "2026-04-01", to: "2027-03-31" });
  });

  it("every date lies inside its own period, and the key matches at both ends", () => {
    const date = fc
      .date({
        min: new Date("2020-01-01T00:00:00Z"),
        max: new Date("2035-12-31T00:00:00Z"),
        noInvalidDate: true,
      })
      .map((d) => d.toISOString().slice(0, 10));
    fc.assert(
      fc.property(date, fc.constantFrom("day", "month", "quarter", "fy" as const), (d, g) => {
        const { from, to } = periodRange(d, g);
        expect(from <= d && d <= to).toBe(true);
        expect(periodKey(from, g)).toBe(periodKey(d, g));
        expect(periodKey(to, g)).toBe(periodKey(d, g));
      }),
      { numRuns: 400 },
    );
  });

  it("counts whole days", () => {
    expect(daysBetween("2026-10-01", "2026-10-28")).toBe(27);
    expect(daysBetween("2026-10-28", "2026-10-01")).toBe(-27);
    expect(daysBetween("2027-02-28", "2027-03-01")).toBe(1);
  });
});

describe("ratios", () => {
  it("margin %, DSO and utilisation, with null where they mean nothing", () => {
    expect(marginPercent("1000", "750")?.toFixed(1)).toBe("25.0");
    expect(marginPercent("1000", "1100")?.toFixed(1)).toBe("-10.0");
    expect(marginPercent("0", "10")).toBeNull();
    expect(dso("150000", "300000", 30)?.toFixed(0)).toBe("15");
    expect(dso("-500", "300000", 30)?.toFixed(0)).toBe("0");
    expect(dso("100", "0", 30)).toBeNull();
    expect(dso("100", "10", 0)).toBeNull();
    expect(utilisationPercent("375000", "500000")?.toFixed(1)).toBe("75.0");
    expect(utilisationPercent("1", "0")).toBeNull();
  });

  it("churn risk only for customers who ordered before (Q38)", () => {
    expect(isChurnRisk(null, "2026-10-28", 60)).toBe(false);
    expect(isChurnRisk("2026-08-29", "2026-10-28", 60)).toBe(false);
    expect(isChurnRisk("2026-08-28", "2026-10-28", 60)).toBe(true);
  });

  it("age bands from the highlight days", () => {
    expect(ageBand(30, [90, 180])).toBe(0);
    expect(ageBand(91, [180, 90])).toBe(1);
    expect(ageBand(181, [90, 180])).toBe(2);
  });
});

describe("pivot", () => {
  const fact = (
    dims: PivotFact["dims"],
    metres: string,
    value: string,
    cogs: string,
    rolls = 1,
  ): PivotFact => ({
    dims,
    metres,
    rolls,
    value,
    cogs,
  });

  it("cross-tabs with row, column and grand totals", () => {
    const r = pivot(
      [
        fact({ customer: "B Prints", month: "2026-10" }, "1000", "7000", "5000"),
        fact({ customer: "A Traders", month: "2026-09" }, "500", "3500", "2600"),
        fact({ customer: "A Traders", month: "2026-10" }, "1000", "7000", "5100", 2),
        fact({ month: "2026-10" }, "100", "700", "800"),
      ],
      ["customer"],
      ["month"],
    );
    expect(r.rowKeys).toEqual([["A Traders"], ["B Prints"], ["—"]]);
    expect(r.colKeys).toEqual([["2026-09"], ["2026-10"]]);
    expect(r.cells[1]![0]).toBeNull();
    expect(r.cells[0]![1]).toMatchObject({ value: "7000.00", margin: "1900.00", rolls: 2 });
    expect(r.rowTotals[0]).toMatchObject({
      metres: "1500.00",
      value: "10500.00",
      marginPct: "26.7",
    });
    expect(r.rowTotals[2]).toMatchObject({ margin: "-100.00", marginPct: "-14.3" });
    expect(r.colTotals[1]).toMatchObject({ value: "14700.00" });
    expect(r.grandTotal).toMatchObject({
      metres: "2600.00",
      rolls: 5,
      value: "18200.00",
      cogs: "13500.00",
    });
  });

  it("no dimensions → one cell with the grand total; no facts → nothing", () => {
    const r = pivot([fact({}, "10", "70", "50")], [], []);
    expect(r.rowKeys).toEqual([[]]);
    expect(r.cells[0]![0]).toEqual(r.grandTotal);
    const none = pivot([], ["sku"], ["month"]);
    expect(none.rowKeys).toEqual([]);
    expect(none.grandTotal).toMatchObject({ value: "0.00", marginPct: null });
  });

  it("cells add up to row totals, row totals to the grand total, under any grouping", () => {
    const money = fc.integer({ min: 0, max: 10_000_000 }).map((p) => (p / 100).toFixed(2));
    const label = fc.constantFrom("a", "b", "c", "d");
    const factArb = fc.record({
      dims: fc.record(
        Object.fromEntries(PIVOT_DIMENSIONS.map((d) => [d, label])) as Record<
          PivotDimension,
          fc.Arbitrary<string>
        >,
        { requiredKeys: [] },
      ),
      metres: money,
      rolls: fc.integer({ min: 0, max: 20 }),
      value: money,
      cogs: money,
    });
    const dims = fc.subarray([...PIVOT_DIMENSIONS], { maxLength: 2 });
    fc.assert(
      fc.property(fc.array(factArb, { maxLength: 40 }), dims, dims, (facts, rows, cols) => {
        const r = pivot(facts, rows, cols);
        const grand = sum(facts.map((f) => f.value)).toFixed(2);
        expect(r.grandTotal.value).toBe(grand);
        expect(sum(r.rowTotals.map((t) => t.value)).toFixed(2)).toBe(grand);
        expect(sum(r.colTotals.map((t) => t.value)).toFixed(2)).toBe(grand);
        r.cells.forEach((row, i) => {
          expect(sum(row.map((c) => c?.value ?? 0)).toFixed(2)).toBe(r.rowTotals[i]!.value);
          expect(row.reduce((n, c) => n + (c?.rolls ?? 0), 0)).toBe(r.rowTotals[i]!.rolls);
        });
        expect(D(r.grandTotal.margin).equals(D(r.grandTotal.value).minus(r.grandTotal.cogs))).toBe(
          true,
        );
      }),
      { numRuns: 300 },
    );
  });
});

describe("Today", () => {
  it("writes the summary sentence", () => {
    expect(
      todaySentence({
        invoicedToday: "480000",
        invoiceCount: 12,
        collectedToday: "210000",
        heldOrders: 3,
        heldExposure: "240000",
      }),
    ).toBe(
      "₹ 4.8 L invoiced today across 12 invoices; ₹ 2.1 L collected; 3 orders on hold (₹ 2.4 L exposure).",
    );
    expect(
      todaySentence({
        invoicedToday: "8260",
        invoiceCount: 1,
        collectedToday: "0",
        heldOrders: 1,
        heldExposure: "9000",
      }),
    ).toBe(
      "₹ 8,260 invoiced today across 1 invoice; no collections yet; 1 order on hold (₹ 9,000 exposure).",
    );
    expect(
      todaySentence({
        invoicedToday: "0",
        invoiceCount: 0,
        collectedToday: "0",
        heldOrders: 0,
        heldExposure: "0",
      }),
    ).toBe("Nothing invoiced yet today; no collections yet; no orders on hold.");
  });

  it("ranks Needs-you: blocking work first, then oldest, then largest; drops empty and fresh unmapped", () => {
    const ranked = rankNeedsYou([
      { kind: "moneyOnAccount", count: 2, amount: "5000", oldestHours: 100 },
      { kind: "unmappedRolls", count: 4, oldestHours: 3 },
      { kind: "challanToInvoice", count: 1, oldestHours: 30 },
      { kind: "creditHold", count: 1, amount: "9000", oldestHours: 2 },
      { kind: "rateApproval", count: 1, amount: "9000", oldestHours: 2 },
      { kind: "irnFailed", count: 0, oldestHours: 0 },
      { kind: "challanToPick", count: 2, oldestHours: 30, amount: "100" },
      { kind: "supplierPaymentApproval", count: 1, amount: "600000", oldestHours: 5 },
    ]);
    expect(ranked.map((i) => i.kind)).toEqual([
      "creditHold",
      "rateApproval",
      "supplierPaymentApproval",
      "challanToPick",
      "challanToInvoice",
      "moneyOnAccount",
    ]);
    expect(rankNeedsYou([{ kind: "unmappedRolls", count: 1, oldestHours: 25 }])).toHaveLength(1);
  });

  it("every role's rows are known kinds; warehouse never sees money", () => {
    for (const kinds of Object.values(NEEDS_YOU_BY_ROLE))
      for (const k of kinds) expect(NEEDS_YOU_KINDS).toContain(k);
    expect(NEEDS_YOU_BY_ROLE.warehouse).not.toContain("moneyOnAccount");
  });

  it("totals a report's money columns exactly", () => {
    expect(
      totalsOf(
        [
          { a: "0.10", b: "1" },
          { a: "0.20", b: null },
        ],
        ["a", "b"],
      ),
    ).toEqual({ a: "0.30", b: "1.00" });
  });
});
