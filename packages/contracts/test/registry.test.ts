import type { ReportMeta } from "../src/reports.js";
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
  agingQuery,
  applyCredit,
  dcPick,
  payoutPay,
  receiptCreate,
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
    // Each source needs its own fields.
    expect(siCreate.safeParse({ source: "DIRECT", soId: "s", date: "2026-10-27" }).success).toBe(
      false,
    );
    expect(siCreate.safeParse({ source: "DC", date: "2026-10-27" }).success).toBe(false);
  });

  it("vehicle numbers are normalised and checked; e-way bills have 12 digits", () => {
    expect(transportInput.parse({ vehicleNo: "gj05ab1234" }).vehicleNo).toBe("GJ05AB1234");
    expect(transportInput.safeParse({ vehicleNo: "GJ-05" }).success).toBe(false);
    expect(transportInput.safeParse({ ewayBillNo: "12345" }).success).toBe(false);
  });
});

describe("Stage 4 additions", () => {
  const roles = Object.fromEntries(SYSTEM_ROLES.map((r) => [r.code, expandGrants(r.grants)]));
  const receipt = {
    partyId: "c1",
    date: "2026-10-28",
    mode: "NEFT",
    amount: "8000",
    reference: "UTR123",
    allocations: [
      { invoiceId: "i1", amount: "3000" },
      { invoiceId: "i2", amount: "4995", deduction: "5" },
    ],
  };

  it("roles: accountants handle money; managers see it; bounces and big payments need a fresh login", () => {
    expect(roles.accountant).toEqual(
      expect.arrayContaining([
        "collections.receipt.manage",
        "payables.payment.manage",
        "commission.payout.manage",
      ]),
    );
    expect(roles.accountant).not.toContain("payables.payment.approve");
    expect(roles.sales_manager).toEqual(
      expect.arrayContaining(["collections.view", "commission.view"]),
    );
    expect(roles.sales_manager).not.toContain("collections.receipt.manage");
    expect(roles.admin).toEqual(
      expect.arrayContaining(["payables.payment.approve", "commission.payout.manage"]),
    );
    expect(STEP_UP_PERMISSIONS).toEqual(
      expect.arrayContaining([
        "collections.receipt.reverse",
        "payables.payment.approve",
        "commission.payout.manage",
      ]),
    );
  });

  it("settings and series: aging buckets must grow; commission payouts are numbered CP", () => {
    expect(parseSetting("ar.agingBuckets", [30, 60, 90])).toEqual([30, 60, 90]);
    expect(() => parseSetting("ar.agingBuckets", [60, 30])).toThrow();
    expect(() => parseSetting("credit.nightlyCheck", { enabled: true, time: "25:00" })).toThrow();
    expect(SETTINGS["payables.approvalThresholdInr"].default).toBe(500000);
    expect(DOC_TYPES.CP).toMatchObject({ numberedOn: "post", gst: false });
  });

  it("a receipt needs a reference unless it is cash; amounts are rupees and paise", () => {
    expect(receiptCreate.safeParse(receipt).success).toBe(true);
    expect(receiptCreate.safeParse({ ...receipt, reference: "" }).success).toBe(false);
    expect(receiptCreate.safeParse({ ...receipt, mode: "CASH", reference: null }).success).toBe(
      true,
    );
    expect(receiptCreate.safeParse({ ...receipt, amount: "0" }).success).toBe(false);
    expect(receiptCreate.safeParse({ ...receipt, amount: "10.555" }).success).toBe(false);
    // No allocations: everything stays on account.
    expect(receiptCreate.parse({ ...receipt, allocations: undefined }).allocations).toEqual([]);
    expect(
      applyCredit.safeParse({ source: "RECEIPT", sourceId: "r1", allocations: [] }).success,
    ).toBe(false);
    expect(agingQuery.safeParse({ partyType: "SUPPLIER" }).success).toBe(true);
    expect(
      payoutPay.safeParse({ version: 1, paidOn: "2026-10-31", mode: "NEFT", tds: "41.01" }).success,
    ).toBe(true);
  });
});

describe("Stage 5 additions", async () => {
  const c = await import("../src/index.js");
  const roles = Object.fromEntries(c.SYSTEM_ROLES.map((r) => [r.code, c.expandGrants(r.grants)]));

  it("roles: cost and margin only for owner, managers, admin and accounts (Q36)", () => {
    for (const r of ["owner", "admin", "purchase_manager", "sales_manager", "accountant"])
      expect(roles[r]).toContain("reports.margin.view");
    for (const r of ["sales_executive", "warehouse"]) {
      expect(roles[r]).toContain("reports.view");
      expect(roles[r]).not.toContain("reports.margin.view");
      expect(roles[r]).not.toContain("reports.export");
    }
  });

  it("catalogue: every report names a section and PRD row; cost reports say so", () => {
    expect(c.REPORT_IDS.length).toBeGreaterThanOrEqual(25);
    for (const id of c.REPORT_IDS) {
      const r: ReportMeta = c.REPORTS[id];
      expect(c.REPORT_SECTIONS).toContain(r.section);
      expect(r.prd).toMatch(/^9\.[1-6]$/);
      if (r.permission === "reports.margin.view") expect(r.hasCost).toBe(true);
      if (r.permission) expect(Object.keys(c.PERMISSIONS)).toContain(r.permission);
    }
  });

  it("report query: dates in order, paging bounded", () => {
    expect(c.reportQuery.parse({}).page).toBe(1);
    expect(c.reportQuery.safeParse({ from: "2026-10-28", to: "2026-10-01" }).success).toBe(false);
    expect(c.reportQuery.safeParse({ pageSize: 5000 }).success).toBe(false);
  });

  it("pivot spec: a dimension once, at least one measure, dates in order", () => {
    const spec = {
      rows: ["customer"],
      cols: ["month"],
      measures: ["value"],
      from: "2026-04-01",
      to: "2026-10-31",
    };
    expect(c.pivotSpec.safeParse(spec).success).toBe(true);
    expect(c.pivotSpec.safeParse({ ...spec, cols: ["customer"] }).success).toBe(false);
    expect(c.pivotSpec.safeParse({ ...spec, measures: [] }).success).toBe(false);
    expect(
      c.pivotSpec.safeParse({ ...spec, rows: ["fy"], cols: ["month"], to: "2026-01-01" }).success,
    ).toBe(false);
    expect(c.savedPivotInput.parse({ name: "Monthly by customer", spec }).sharedWithRoles).toEqual(
      [],
    );
  });

  it("settings: churn 60 days, aging highlights grow, links last 7 days", () => {
    expect(c.SETTINGS["reports.churnDays"].default).toBe(60);
    expect(() => c.parseSetting("reports.agingHighlightDays", [180, 90])).toThrow();
    expect(c.SETTINGS["reports.exportLinkDays"].default).toBe(7);
  });

  it("exports: a report or a pivot, in CSV / XLSX / PDF", () => {
    expect(
      c.exportRequest.safeParse({
        kind: "report",
        reportId: "gross-margin",
        query: {},
        format: "xlsx",
      }).success,
    ).toBe(true);
    expect(
      c.exportRequest.safeParse({ kind: "report", reportId: "nope", query: {}, format: "xlsx" })
        .success,
    ).toBe(false);
  });
});
