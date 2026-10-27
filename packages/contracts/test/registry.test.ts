import { formatDocNo, validateGstSeries } from "@erp/domain";
import { describe, expect, it } from "vitest";
import {
  DOC_TYPE_CODES,
  DOC_TYPES,
  PERMISSION_CODES,
  SETTINGS,
  SETTING_KEYS,
  SYSTEM_ROLES,
  defaultSeries,
  expandGrants,
  isSettingKey,
  parseSetting,
} from "../src/index.js";

describe("settings registry", () => {
  it("every default satisfies its own schema", () => {
    for (const key of SETTING_KEYS) {
      expect(() => SETTINGS[key].schema.parse(SETTINGS[key].default), key).not.toThrow();
    }
  });

  it("rejects invalid values", () => {
    expect(() => parseSetting("pricing.overrideTolerancePct", -1)).toThrow();
    expect(() => parseSetting("catalogue.allowedWidthsIn", [])).toThrow();
    expect(isSettingKey("nope")).toBe(false);
  });
});

describe("permission catalogue", () => {
  it("expands wildcards", () => {
    expect(expandGrants(["*"])).toEqual(PERMISSION_CODES);
    expect(expandGrants(["settings.*"])).toContain("settings.series.update");
    expect(expandGrants(["settings.*"])).not.toContain("users.view");
  });

  it("every system role grant is valid", () => {
    for (const role of SYSTEM_ROLES) expect(() => expandGrants(role.grants)).not.toThrow();
    expect(() => expandGrants(["bogus.code"])).toThrow(/Unknown permission/);
  });
});

describe("default document series (ADR-0003)", () => {
  it("renders SI/2627/00001 and every GST series fits 16 characters", () => {
    expect(formatDocNo(defaultSeries("SI"), "2026-10-23", 1)).toBe("SI/2627/00001");
    for (const type of DOC_TYPE_CODES.filter((t) => DOC_TYPES[t].gst)) {
      expect(validateGstSeries(defaultSeries(type), "2026-10-23"), type).toEqual([]);
    }
  });
});

describe("Stage 2 additions", () => {
  it("landed-cost charges default to the trade split and reject duplicate codes", () => {
    const charges = SETTINGS["purchase.landedCostCharges"].default;
    const basis = Object.fromEntries(charges.map((c) => [c.code, c.basis]));
    expect(basis).toMatchObject({
      FREIGHT: "WEIGHT",
      LOADING: "WEIGHT",
      INSURANCE: "VALUE",
      CUSTOMS_DUTY: "VALUE",
    });
    expect(() =>
      parseSetting("purchase.landedCostCharges", [
        { code: "FREIGHT", label: "Freight", basis: "METER" },
        { code: "FREIGHT", label: "Freight again", basis: "VALUE" },
      ]),
    ).toThrow(/unique/);
  });

  it("an old roll-label value without a layout still parses (defaults to one per page)", () => {
    expect(
      parseSetting("labels.roll", { widthMm: 100, heightMm: 50, output: "PDF" }),
    ).toMatchObject({
      layout: "SINGLE",
    });
  });

  it("warehouse staff can receive and map but not see cost or approve over-receipt", () => {
    const warehouse = SYSTEM_ROLES.find((r) => r.code === "warehouse")!;
    const codes = expandGrants(warehouse.grants);
    expect(codes).toEqual(
      expect.arrayContaining(["purchase.receipt.manage", "inventory.map", "labels.print"]),
    );
    expect(codes).not.toContain("inventory.view_cost");
    expect(codes).not.toContain("purchase.over_receipt.approve");
  });
});
