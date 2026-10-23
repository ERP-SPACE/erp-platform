import { describe, expect, it } from "vitest";
import {
  formatINR,
  formatINRCompact,
  formatNumber,
  formatQty,
  groupIndian,
} from "../src/format.js";

describe("Indian formatting", () => {
  it("groups digits in lakh/crore style", () => {
    expect(groupIndian("1")).toBe("1");
    expect(groupIndian("1000")).toBe("1,000");
    expect(groupIndian("482300")).toBe("4,82,300");
    expect(groupIndian("123456789")).toBe("12,34,56,789");
  });

  it("formats rupees with parentheses for negatives", () => {
    expect(formatINR("482300")).toBe("₹ 4,82,300.00");
    expect(formatINR("-1200.5")).toBe("(₹ 1,200.50)");
    expect(formatINR("-0.001")).toBe("₹ 0.00");
    expect(formatNumber("-5", { parensForNegative: false, decimals: 0 })).toBe("-5");
  });

  it("formats compact amounts for the Today brief", () => {
    expect(formatINRCompact("482300")).toBe("₹ 4.8 L");
    expect(formatINRCompact("12500000")).toBe("₹ 1.25 Cr");
    expect(formatINRCompact("10000000")).toBe("₹ 1 Cr");
    expect(formatINRCompact("99999")).toBe("₹ 99,999");
    expect(formatINRCompact("-240000")).toBe("−₹ 2.4 L");
  });

  it("formats quantities with units", () => {
    expect(formatQty(1000, "m")).toBe("1,000 m");
    expect(formatQty("612.5", "m")).toBe("612.50 m");
    expect(formatQty(44, "in")).toBe("44″");
    expect(formatQty(1, "rolls")).toBe("1 roll");
    expect(formatQty(12, "rolls")).toBe("12 rolls");
  });
});
