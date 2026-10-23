import { describe, expect, it } from "vitest";
import { GST_STATES, gstRegime, gstinCheckChar, validateGstin } from "../src/gst.js";

// Built from a valid-shaped stem; the check character is computed, then verified independently.
const stem = "24AAACB1234C1Z";
const valid = stem + gstinCheckChar(stem);

describe("GSTIN", () => {
  it("accepts a GSTIN with the correct check character and extracts state and PAN", () => {
    expect(validateGstin(valid)).toEqual({ valid: true, stateCode: "24", pan: "AAACB1234C" });
    expect(validateGstin(` ${valid.toLowerCase()} `).valid).toBe(true);
  });

  it("matches the published example 27AAPFU0939F1ZV", () => {
    expect(gstinCheckChar("27AAPFU0939F1Z")).toBe("V");
  });

  it("rejects a wrong check character, a bad format and an unknown state", () => {
    const wrong = stem + (valid.endsWith("A") ? "B" : "A");
    expect(validateGstin(wrong)).toMatchObject({
      valid: false,
      error: expect.stringMatching(/check character/),
    });
    expect(validateGstin("24AAACB1234C1X5").valid).toBe(false);
    expect(validateGstin("99AAACB1234C1Z5")).toMatchObject({
      valid: false,
      error: "Unknown state code 99",
    });
  });

  it("knows Gujarat and decides the GST regime", () => {
    expect(GST_STATES["24"]).toBe("Gujarat");
    expect(gstRegime("24", "24")).toBe("CGST_SGST");
    expect(gstRegime("24", "27")).toBe("IGST");
  });
});
