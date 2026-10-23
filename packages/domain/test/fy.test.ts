import { describe, expect, it } from "vitest";
import { fyCode, fyLabel, fyRange, fyStartYear, istToday, toIstCalendarDate } from "../src/fy.js";

describe("financial year", () => {
  it("1 April starts a new FY", () => {
    expect(fyCode("2026-04-01")).toBe("2627");
    expect(fyCode("2026-03-31")).toBe("2526");
    expect(fyLabel("2026-10-23")).toBe("2026-27");
    expect(fyRange("2027-01-15")).toEqual({ from: "2026-04-01", to: "2027-03-31" });
  });

  it("evaluates Date instants in IST, not UTC", () => {
    // 31 Mar 2027 18:30 UTC is already 1 Apr 2027 00:00 IST → FY 2027-28
    expect(fyCode(new Date("2027-03-31T18:30:00Z"))).toBe("2728");
    // one minute earlier is still 31 Mar IST → FY 2026-27
    expect(fyCode(new Date("2027-03-31T18:29:00Z"))).toBe("2627");
    expect(istToday(new Date("2026-10-22T19:00:00Z"))).toBe("2026-10-23");
  });

  it("handles the century wrap", () => {
    expect(fyCode("2099-06-01")).toBe("9900");
    expect(fyStartYear("2100-02-01")).toBe(2099);
  });

  it("rejects malformed input", () => {
    expect(() => toIstCalendarDate("23/10/2026")).toThrow(RangeError);
    expect(() => toIstCalendarDate(new Date("nope"))).toThrow(RangeError);
  });
});
