import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  D,
  InvalidAmountError,
  allocateLargestRemainder,
  round,
  sum,
  toFixedString,
} from "../src/money.js";

const strings = (values: { toFixed(n: number): string }[]) => values.map((v) => v.toFixed(2));

describe("D / round / sum", () => {
  it("avoids float drift", () => {
    expect(D("0.1").plus("0.2").toString()).toBe("0.3");
    expect(sum(["0.1", "0.2", "0.3"]).toString()).toBe("0.6");
  });

  it("rounds half up to the paisa", () => {
    expect(round("2.345").toFixed(2)).toBe("2.35");
    expect(round("-2.345").toFixed(2)).toBe("-2.35");
    expect(toFixedString("1800")).toBe("1800.00");
  });

  it("rejects non-finite and garbage input", () => {
    expect(() => D(Number.NaN)).toThrow(InvalidAmountError);
    expect(() => D(Number.POSITIVE_INFINITY)).toThrow(InvalidAmountError);
    expect(() => D("12abc")).toThrow(InvalidAmountError);
  });
});

describe("allocateLargestRemainder", () => {
  it("splits ₹100 across three equal lines exactly", () => {
    expect(strings(allocateLargestRemainder("100.00", [1, 1, 1]))).toEqual([
      "33.34",
      "33.33",
      "33.33",
    ]);
  });

  it("splits proportionally to weights (PRD §8.3 METER basis)", () => {
    // freight ₹1,000 over rolls of 1000 m, 1500 m and 500 m
    expect(strings(allocateLargestRemainder("1000.00", [1000, 1500, 500]))).toEqual([
      "333.33",
      "500.00",
      "166.67",
    ]);
  });

  it("gives leftover paise to the largest fractional remainder, ties to the larger weight", () => {
    expect(strings(allocateLargestRemainder("0.05", [1, 2]))).toEqual(["0.02", "0.03"]);
  });

  it("splits equally when every weight is zero", () => {
    expect(strings(allocateLargestRemainder("10.00", [0, 0, 0]))).toEqual(["3.34", "3.33", "3.33"]);
  });

  it("handles negative totals (reversals) symmetrically", () => {
    expect(strings(allocateLargestRemainder("-100.00", [1, 1, 1]))).toEqual([
      "-33.34",
      "-33.33",
      "-33.33",
    ]);
  });

  it("supports other precisions", () => {
    expect(allocateLargestRemainder("10", [1, 1, 1], 0).map((v) => v.toString())).toEqual([
      "4",
      "3",
      "3",
    ]);
  });

  it("rejects bad input", () => {
    expect(() => allocateLargestRemainder("10.00", [])).toThrow(InvalidAmountError);
    expect(() => allocateLargestRemainder("10.001", [1, 2])).toThrow(InvalidAmountError);
    expect(() => allocateLargestRemainder("10.00", [1, -1])).toThrow(InvalidAmountError);
  });

  it("property: parts always sum exactly to the total and never differ from the ideal share by ≥ 1 paisa", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -10_000_000_00, max: 10_000_000_00 }),
        fc.array(fc.integer({ min: 0, max: 1_000_000 }), { minLength: 1, maxLength: 40 }),
        (totalPaise, weights) => {
          const total = D(totalPaise).dividedBy(100);
          const parts = allocateLargestRemainder(total, weights);
          expect(sum(parts).equals(total)).toBe(true);
          const weightSum = weights.reduce((a, b) => a + b, 0);
          parts.forEach((part, i) => {
            const ideal =
              weightSum === 0
                ? total.dividedBy(weights.length)
                : total.times(weights[i]!).dividedBy(weightSum);
            expect(part.minus(ideal).abs().lessThan("0.01")).toBe(true);
            expect(part.decimalPlaces()).toBeLessThanOrEqual(2);
          });
        },
      ),
      { numRuns: 500 },
    );
  });
});
