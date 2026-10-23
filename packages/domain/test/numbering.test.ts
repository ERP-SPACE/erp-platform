import { describe, expect, it } from "vitest";
import {
  InvalidSeriesError,
  formatDocNo,
  isValidGstDocNo,
  renderPrefix,
  validateGstSeries,
} from "../src/numbering.js";

const si = { prefixTemplate: "SI/{FY}/", padding: 5 };

describe("document numbering (ADR-0003)", () => {
  it("formats the stage-gate example", () => {
    expect(formatDocNo(si, "2026-10-23", 1)).toBe("SI/2627/00001");
    expect(formatDocNo(si, "2027-04-01", 42)).toBe("SI/2728/00042");
  });

  it("supports the long FY token", () => {
    expect(renderPrefix("SI/{FY_FULL}/", "2026-10-23")).toBe("SI/2026-27/");
  });

  it("rejects unknown tokens and bad sequence/padding", () => {
    expect(() => renderPrefix("SI/{YEAR}/", "2026-10-23")).toThrow(InvalidSeriesError);
    expect(() => formatDocNo(si, "2026-10-23", 0)).toThrow(InvalidSeriesError);
    expect(() => formatDocNo(si, "2026-10-23", 1.5)).toThrow(InvalidSeriesError);
    expect(() => formatDocNo({ ...si, padding: 0 }, "2026-10-23", 1)).toThrow(InvalidSeriesError);
  });

  it("validates GST invoice numbers (≤ 16 chars, A-Z 0-9 / -)", () => {
    expect(isValidGstDocNo("SI/2627/00001")).toBe(true);
    expect(isValidGstDocNo("SI 2627 00001")).toBe(false);
    expect(isValidGstDocNo("SALESINV/2026-27/00001")).toBe(false);
    expect(isValidGstDocNo("")).toBe(false);
  });

  it("validates a whole series against its longest possible number", () => {
    expect(validateGstSeries(si, "2026-10-23")).toEqual([]);
    expect(validateGstSeries({ prefixTemplate: "INVOICE/{FY_FULL}/", padding: 5 }, "2026-10-23")).toHaveLength(1);
    expect(validateGstSeries({ prefixTemplate: "SI#{FY}#", padding: 3 }, "2026-10-23")[0]).toMatch(/Only letters/);
    expect(validateGstSeries({ prefixTemplate: "SI/{BAD}/", padding: 3 }, "2026-10-23")[0]).toMatch(/Unknown token/);
  });
});
