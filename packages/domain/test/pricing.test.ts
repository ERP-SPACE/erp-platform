import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  InvalidPricingError,
  deriveRatePerMetre,
  lineAmount,
  overrideDeviationPct,
  requiresApproval,
  reviseRate,
} from "../src/pricing.js";

const s = (v: { toFixed(n: number): string }) => v.toFixed(2);

describe("44″ benchmark pricing (PRD §8.1, ADR-0013)", () => {
  it("matches the PRD example ratio: 2,200 @ 44″ → 1,800 @ 36″", () => {
    expect(s(deriveRatePerMetre("2200", 36))).toBe("1800.00");
  });

  it("derives per-metre rates for the standard widths, rounded to 2 decimals (Q6)", () => {
    expect(s(deriveRatePerMetre("6.25", 44))).toBe("6.25");
    expect(s(deriveRatePerMetre("6.25", 36))).toBe("5.11"); // 5.1136…
    expect(s(deriveRatePerMetre("6.25", 24))).toBe("3.41"); // 3.4090…
    expect(s(deriveRatePerMetre("6.25", 63))).toBe("8.95"); // 8.9488…
  });

  it("supports other precisions", () => {
    expect(deriveRatePerMetre("6.25", 36, 0).toString()).toBe("5");
    expect(deriveRatePerMetre("6.25", 36, 4).toFixed(4)).toBe("5.1136");
  });

  it("rejects negative rates and non-positive widths", () => {
    expect(() => deriveRatePerMetre("-1", 36)).toThrow(InvalidPricingError);
    expect(() => deriveRatePerMetre("6", 0)).toThrow(InvalidPricingError);
  });
});

describe("override tolerance (Q6: > 5 % needs approval)", () => {
  it("computes signed deviation", () => {
    expect(s(overrideDeviationPct("5.00", "5.25"))).toBe("5.00");
    expect(s(overrideDeviationPct("5.00", "4.70"))).toBe("-6.00");
  });

  it("exactly 5 % is allowed; anything above needs approval, in either direction", () => {
    expect(requiresApproval("5.00", 5)).toBe(false);
    expect(requiresApproval("5.01", 5)).toBe(true);
    expect(requiresApproval("-5.01", 5)).toBe(true);
    expect(requiresApproval("-4.99", 5)).toBe(false);
  });

  it("rejects a zero derived rate", () => {
    expect(() => overrideDeviationPct("0", "1")).toThrow(InvalidPricingError);
  });
});

describe("bulk revision (PRD §6.4)", () => {
  it("applies percentages and flat ₹/m changes", () => {
    expect(s(reviseRate("6.25", { mode: "PERCENT", value: 4 }))).toBe("6.50");
    expect(s(reviseRate("6.25", { mode: "PERCENT", value: -10 }))).toBe("5.63"); // 5.625 half-up
    expect(s(reviseRate("6.25", { mode: "FLAT", value: "0.35" }))).toBe("6.60");
  });

  it("never goes below zero", () => {
    expect(s(reviseRate("1.00", { mode: "FLAT", value: "-5" }))).toBe("0.00");
    expect(s(reviseRate("1.00", { mode: "PERCENT", value: -150 }))).toBe("0.00");
  });

  it("property: derived rates scale monotonically with width", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100_000 }),
        fc.integer({ min: 1, max: 120 }),
        (paise, w) => {
          const base = (paise / 100).toFixed(2);
          expect(
            deriveRatePerMetre(base, w + 1).greaterThanOrEqualTo(deriveRatePerMetre(base, w)),
          ).toBe(true);
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe("line amount", () => {
  it("is metres × rate to the paisa", () => {
    expect(s(lineAmount(1000, "5.11"))).toBe("5110.00");
    expect(s(lineAmount("612.5", "5.11"))).toBe("3129.88"); // 3129.875 half-up
  });
});
