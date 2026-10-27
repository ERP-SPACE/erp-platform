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
  STEP_UP_PERMISSIONS,
  dcPick,
  parseSetting,
  siCreate,
  soLineInput,
  transportInput,
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

describe("Stage 3 additions", () => {
  const roles = Object.fromEntries(SYSTEM_ROLES.map((r) => [r.code, expandGrants(r.grants)]));

  it("roles: who sells, who dispatches, who invoices", () => {
    expect(roles.sales_executive).toEqual(
      expect.arrayContaining(["sales.view", "sales.order.manage"]),
    );
    expect(roles.sales_executive).not.toContain("sales.credit.release");
    expect(roles.warehouse).toEqual(
      expect.arrayContaining([
        "sales.dispatch.manage",
        "inventory.roll.cut",
        "sales.return.manage",
      ]),
    );
    expect(roles.warehouse).not.toContain("sales.invoice.manage");
    expect(roles.accountant).toEqual(
      expect.arrayContaining([
        "sales.invoice.manage",
        "sales.note.manage",
        "compliance.einvoice.manage",
      ]),
    );
    expect(roles.sales_manager).toContain("sales.credit.release");
    expect(roles.admin).toEqual(
      expect.arrayContaining(["sales.invoice.cancel", "compliance.einvoice.manage"]),
    );
  });

  it("releasing credit holds, rate approvals, cancellations and notes need a fresh login", () => {
    expect(STEP_UP_PERMISSIONS).toEqual(
      expect.arrayContaining([
        "pricing.override.approve",
        "sales.credit.release",
        "sales.invoice.cancel",
        "sales.note.manage",
      ]),
    );
  });

  it("e-invoice and invoice defaults", () => {
    expect(SETTINGS["einvoice.config"].default).toMatchObject({
      provider: "SANDBOX",
      cancelWindowHours: 24,
    });
    expect(SETTINGS["ewaybill.thresholdInr"].default).toBe(50000);
    expect(SETTINGS["invoice.extraCharges"].default.map((c) => c.code)).toEqual([
      "FREIGHT",
      "PACKING",
      "LOADING",
    ]);
    expect(() =>
      parseSetting("invoice.extraCharges", [
        { code: "FREIGHT", label: "Freight", hsnCode: "99", active: true },
      ]),
    ).toThrow();
  });

  it("an SO line's length mix must add up to its metres", () => {
    const line = { skuId: "s", totalM: 5000, ratePerM: "6.10" };
    expect(
      soLineInput.safeParse({
        ...line,
        lengthMix: [
          { lengthM: 1000, rolls: 3 },
          { lengthM: 1000, rolls: 2 },
        ],
      }).success,
    ).toBe(true);
    expect(
      soLineInput.safeParse({ ...line, lengthMix: [{ lengthM: 1000, rolls: 4 }] }).success,
    ).toBe(false);
    expect(soLineInput.safeParse({ ...line, discountPct: "101" }).success).toBe(false);
  });

  it("pick by roll id or barcode, not both; invoices come from DCs, a direct sale or a proforma", () => {
    expect(dcPick.safeParse({ soLineId: "l", barcode: "2610-SBC-0001-0001-K" }).success).toBe(true);
    expect(dcPick.safeParse({ soLineId: "l" }).success).toBe(false);
    expect(dcPick.safeParse({ soLineId: "l", rollId: "r", barcode: "b" }).success).toBe(false);
    expect(
      siCreate.safeParse({ source: "DC", dcIds: ["a", "b"], date: "2026-10-27" }).success,
    ).toBe(true);
    expect(
      siCreate.safeParse({ source: "DIRECT", soId: "s", date: "2026-10-27", rolls: [] }).success,
    ).toBe(false);
  });

  it("vehicle numbers are normalised and checked; e-way bills have 12 digits", () => {
    expect(transportInput.parse({ vehicleNo: "gj05ab1234" }).vehicleNo).toBe("GJ05AB1234");
    expect(transportInput.safeParse({ vehicleNo: "GJ-05" }).success).toBe(false);
    expect(transportInput.safeParse({ ewayBillNo: "12345" }).success).toBe(false);
  });
});
