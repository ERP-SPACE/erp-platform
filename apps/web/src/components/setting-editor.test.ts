import { SETTINGS, SETTING_KEYS } from "@erp/contracts";
import { describe, expect, it } from "vitest";
import { fromDraft, summarise, toDraft } from "./setting-editor.js";

describe("schema-driven setting editor", () => {
  it("round-trips every registered default through a draft unchanged", () => {
    for (const key of SETTING_KEYS) {
      const { schema, default: value } = SETTINGS[key];
      const back = fromDraft(schema, toDraft(schema, value));
      expect(schema.parse(back), key).toEqual(value);
    }
  });

  it("parses comma- or space-separated number lists", () => {
    const schema = SETTINGS["catalogue.allowedWidthsIn"].schema;
    expect(fromDraft(schema, "24, 36,44  63 72")).toEqual([24, 36, 44, 63, 72]);
  });

  it("keeps literal unions numeric (invoice round-off)", () => {
    const schema = SETTINGS["invoice.roundOffTo"].schema;
    expect(fromDraft(schema, "0.5")).toBe(0.5);
    expect(schema.safeParse(fromDraft(schema, "0.5")).success).toBe(true);
  });

  it("lets invalid input fail validation instead of silently passing", () => {
    const schema = SETTINGS["pricing.overrideTolerancePct"].schema;
    expect(schema.safeParse(fromDraft(schema, "")).success).toBe(false);
    expect(schema.safeParse(fromDraft(schema, "150")).success).toBe(false);
  });

  it("edits a list of records row by row (landed-cost charges)", () => {
    const schema = SETTINGS["purchase.landedCostCharges"].schema;
    const rows = toDraft(schema, SETTINGS["purchase.landedCostCharges"].default) as Record<
      string,
      unknown
    >[];
    expect(rows[0]).toMatchObject({ code: "FREIGHT", basis: "WEIGHT", active: true });
    const edited = [{ ...rows[0], basis: "METER" }, ...rows.slice(1)];
    const value = schema.parse(fromDraft(schema, edited as never));
    expect(value[0]).toMatchObject({ code: "FREIGHT", basis: "METER" });
  });

  it("summarises values for the register", () => {
    expect(summarise([24, 36, 44])).toBe("24, 36, 44");
    expect(summarise({ standardLengthM: 1000, toleranceM: 100 })).toMatch(/1000.*100/);
  });
});
