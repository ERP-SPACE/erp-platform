import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { buildEInvoice, validateEInvoice } from "../src/einvoice.js";
import { gstinCheckChar } from "../src/gst.js";
import { D } from "../src/money.js";
import {
  type CreditInput,
  checkOverride,
  customerNoteMachine,
  deliveryChallanMachine,
  einvoiceMachine,
  evaluateCredit,
  proformaMachine,
  resolveRate,
  salesInvoiceMachine,
  salesOrderMachine,
  salesReturnMachine,
} from "../src/sales.js";
import {
  chargeGstRate,
  cutRoll,
  lineTaxes,
  partialReturn,
  rollCogs,
  salesInvoice,
} from "../src/sales-invoice.js";

describe("sales state machines (PRD §7, ADR-0014)", () => {
  it("SO: confirm or hold, release, fulfil, close", () => {
    expect(salesOrderMachine.can("Draft", "OnHold")).toBe(true);
    expect(salesOrderMachine.can("OnHold", "Confirmed")).toBe(true);
    expect(salesOrderMachine.can("Confirmed", "PartiallyFulfilled")).toBe(true);
    expect(salesOrderMachine.can("PartiallyFulfilled", "Cancelled")).toBe(false);
    expect(() => salesOrderMachine.assert("Closed", "Draft")).toThrow();
  });
  it("DC, SI, proforma, return, notes and IRN", () => {
    expect(deliveryChallanMachine.next("Draft")).toEqual(["Open", "Cancelled"]);
    expect(deliveryChallanMachine.can("Open", "Cancelled")).toBe(false);
    expect(deliveryChallanMachine.can("Closed", "Open")).toBe(true); // invoice cancelled in 24 h
    expect(salesInvoiceMachine.can("Posted", "Cancelled")).toBe(true);
    expect(salesInvoiceMachine.can("Posted", "Draft")).toBe(false);
    expect(proformaMachine.can("Sent", "Converted")).toBe(true);
    expect(proformaMachine.isTerminal("Converted")).toBe(true);
    expect(salesReturnMachine.can("Posted", "Cancelled")).toBe(false);
    expect(customerNoteMachine.can("Posted", "Cancelled")).toBe(true);
    expect(einvoiceMachine.can("Failed", "Pending")).toBe(true);
    expect(einvoiceMachine.can("Cancelled", "Pending")).toBe(false);
  });
});

describe("price resolution (ADR-0013, UAT 11.3)", () => {
  const rates = [
    { baseRate44: "5.86", validFrom: "2026-04-01", validTo: "2026-09-30" },
    { baseRate44: "6.10", validFrom: "2026-10-01", validTo: null },
  ];
  it("a 36″ order takes the customer's 44″ rate × 36/44", () => {
    const r = resolveRate({ partyRates: rates }, "2026-10-27", 36);
    expect(r.source).toBe("PARTY_RATE");
    expect(r.base44!.toString()).toBe("6.1");
    expect(r.ratePerM!.toFixed(2)).toBe("4.99"); // 6.10 × 36 / 44 = 4.9909…
  });
  it("the rate valid on the order date wins; then the salesman's default; then nothing", () => {
    expect(resolveRate({ partyRates: rates }, "2026-06-15", 44).ratePerM!.toFixed(2)).toBe("5.86");
    const fallback = resolveRate(
      { partyRates: rates, salesmanDefault44: "5.50" },
      "2026-01-01",
      60,
    );
    expect(fallback).toMatchObject({ source: "SALESMAN_DEFAULT" });
    expect(fallback.ratePerM!.toFixed(2)).toBe("7.50");
    expect(resolveRate({ partyRates: [] }, "2026-01-01", 44)).toEqual({
      source: "NONE",
      base44: null,
      ratePerM: null,
    });
  });
  it("an override beyond 5 % needs approval; with no derived rate it always does", () => {
    expect(checkOverride("5.00", "5.25", 5).needsApproval).toBe(false);
    const r = checkOverride("5.00", "5.30", 5);
    expect(r.needsApproval).toBe(true);
    expect(r.deviationPct.toString()).toBe("6");
    expect(checkOverride(null, "5", 5).needsApproval).toBe(true);
    expect(checkOverride("0", "5", 5).needsApproval).toBe(true);
  });
});

describe("credit check at Confirm (PRD §8.5, ADR-0016, Q7)", () => {
  const base: CreditInput = {
    policy: {
      creditLimit: "100000",
      creditDays: 30,
      graceDays: 15,
      autoBlock: true,
      blockRule: "BOTH",
    },
    manualBlock: false,
    openInvoices: [{ date: "2026-10-01", outstanding: "60000" }],
    otherOpenOrders: "25000",
    thisOrder: "20000",
    today: "2026-10-27",
  };
  it("UAT 11.3: exposure includes this order and puts it on hold", () => {
    const r = evaluateCredit(base);
    expect(r.exposure.toString()).toBe("105000");
    expect(r).toMatchObject({ blocked: true, reasons: ["OVER_LIMIT"] });
    expect(r.headroom.toString()).toBe("-5000");
    // Without this order it would have fitted.
    expect(evaluateCredit({ ...base, thisOrder: "15000" }).blocked).toBe(false);
  });
  it("overdue only beyond credit days + grace days", () => {
    const due = {
      ...base,
      thisOrder: "1",
      openInvoices: [{ date: "2026-09-12", outstanding: "100" }],
    };
    expect(evaluateCredit(due).reasons).toEqual([]); // 45 days: 30 + 15, not beyond
    const late = evaluateCredit({
      ...due,
      openInvoices: [{ date: "2026-09-11", outstanding: "100" }],
    });
    expect(late).toMatchObject({
      blocked: true,
      reasons: ["OVER_DUE"],
      overdueInvoices: 1,
      maxDaysPastDue: 16,
    });
    const paid = { date: "2026-01-01", outstanding: "0" };
    expect(evaluateCredit({ ...due, openInvoices: [paid] }).overdueInvoices).toBe(0);
  });
  it("the block rule picks which breaches count; credits reduce exposure", () => {
    const both = { ...base, openInvoices: [{ date: "2026-01-01", outstanding: "90000" }] };
    expect(
      evaluateCredit({ ...both, policy: { ...both.policy, blockRule: "OVER_LIMIT" } }).reasons,
    ).toEqual(["OVER_LIMIT"]);
    expect(
      evaluateCredit({ ...both, policy: { ...both.policy, blockRule: "OVER_DUE" } }).reasons,
    ).toEqual(["OVER_DUE"]);
    expect(evaluateCredit({ ...base, unappliedCredits: "10000" }).blocked).toBe(false);
  });
  it("auto-block off only warns; a manual block always holds", () => {
    const warn = evaluateCredit({ ...base, policy: { ...base.policy, autoBlock: false } });
    expect(warn).toMatchObject({ blocked: false, reasons: ["OVER_LIMIT"] });
    const manual = evaluateCredit({
      ...base,
      thisOrder: "0",
      manualBlock: true,
      policy: { ...base.policy, autoBlock: false },
    });
    expect(manual).toMatchObject({ blocked: true, reasons: ["MANUAL_BLOCK"] });
  });
});

describe("sales invoice engine (PRD §8.2, Q20, Q21)", () => {
  it("reproduces R/649 to the rupee", () => {
    const r = salesInvoice(
      [
        { kind: "GOODS", metres: 8000, ratePerM: "5.86", gstRate: 18 },
        { kind: "GOODS", metres: 8000, ratePerM: "5.10", gstRate: 18 },
        { kind: "GOODS", metres: 7000, ratePerM: "6.37", gstRate: 18 },
      ],
      { regime: "CGST_SGST" },
    );
    expect(r.totals.total.toFixed(2)).toBe("156079.00");
    expect(r.discountTotal.toFixed(2)).toBe("0.00");
  });

  it("a bill discount is spread over the lines by value and tax follows it", () => {
    const r = salesInvoice(
      [
        { kind: "GOODS", metres: 1000, ratePerM: "6.00", discountPct: 2, gstRate: 18 },
        { kind: "GOODS", metres: 500, ratePerM: "4.00", gstRate: 18 },
        { kind: "CHARGE", amount: "500" },
      ],
      { regime: "IGST", billDiscount: "100" },
    );
    // Taxable before the bill discount: 5880 + 2000 + 500 = 8380.
    expect(r.lines.map((l) => l.billDiscount.toFixed(2))).toEqual(["70.17", "23.86", "5.97"]);
    expect(r.lines[2]!.gstRate.toString()).toBe("18"); // charge at the goods' rate
    expect(r.totals.taxable.toFixed(2)).toBe("8280.00");
    expect(r.totals.igst.toFixed(2)).toBe("1490.40");
    expect(r.discountTotal.toFixed(2)).toBe("220.00"); // 120 line + 100 bill
  });

  it("charges take the highest goods rate (18 % with no goods); SEZ with LUT is zero-rated", () => {
    expect(chargeGstRate([12, 18]).toString()).toBe("18");
    expect(chargeGstRate([]).toString()).toBe("18");
    const sez = salesInvoice([{ kind: "GOODS", metres: 100, ratePerM: "5", gstRate: 18 }], {
      regime: "IGST",
      zeroRated: true,
    });
    expect(sez.totals.igst.toString()).toBe("0");
    expect(sez.totals.total.toFixed(2)).toBe("500.00");
  });

  it("refuses an invoice with no goods or a bill discount above its value", () => {
    expect(() => salesInvoice([{ kind: "CHARGE", amount: "10" }], { regime: "IGST" })).toThrow();
    expect(() =>
      salesInvoice([{ kind: "GOODS", metres: 1, ratePerM: "5", gstRate: 18 }], {
        regime: "IGST",
        billDiscount: "6",
      }),
    ).toThrow();
  });

  it("property: lines' tax adds up to the invoice's tax, and the bill discount is fully used", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            metres: fc.integer({ min: 1, max: 20000 }),
            paise: fc.integer({ min: 100, max: 2000 }),
            gst: fc.constantFrom(12, 18),
          }),
          { minLength: 1, maxLength: 12 },
        ),
        fc.integer({ min: 0, max: 100 }),
        fc.boolean(),
        (ls, pct, intra) => {
          const lines = ls.map((l) => ({
            kind: "GOODS" as const,
            metres: l.metres,
            ratePerM: D(l.paise).dividedBy(100),
            gstRate: l.gst,
          }));
          const value = lines.reduce((s, l) => s.plus(l.ratePerM.times(l.metres)), D(0));
          const bill = value.times(pct).dividedBy(1000).toDecimalPlaces(2, 1);
          const r = salesInvoice(lines, {
            regime: intra ? "CGST_SGST" : "IGST",
            billDiscount: bill,
          });
          const taxes = lineTaxes(r.lines, r.totals);
          const total = (k: "cgst" | "sgst" | "igst") => taxes.reduce((s, t) => s.plus(t[k]), D(0));
          expect(total("cgst").equals(r.totals.cgst)).toBe(true);
          expect(total("sgst").equals(r.totals.sgst)).toBe(true);
          expect(total("igst").equals(r.totals.igst)).toBe(true);
          expect(r.lines.reduce((s, l) => s.plus(l.billDiscount), D(0)).equals(bill)).toBe(true);
        },
      ),
    );
  });
});

describe("cost: COGS, cuts and partial returns (ADR-0015, ADR-0018)", () => {
  it("COGS is the landed cost of the metres shipped", () => {
    expect(rollCogs(1000, "5.0123").toFixed(2)).toBe("5012.30");
  });

  it("a cut splits the parent's cost over the piece, the waste and the rest, to the paisa", () => {
    const r = cutRoll({ lengthM: 1000, landedCostTotal: "5000.01" }, 300, 10);
    expect(r.parentLengthAfter).toBe(690);
    expect([r.childCost, r.wasteCost, r.parentCostAfter].map((c) => c.toFixed(2))).toEqual([
      "1500.00",
      "50.00",
      "3450.01",
    ]);
    expect(() => cutRoll({ lengthM: 1000, landedCostTotal: 1 }, 1000)).toThrow();
    expect(() => cutRoll({ lengthM: 1000, landedCostTotal: 1 }, 0)).toThrow();
    expect(() => cutRoll({ lengthM: 1000, landedCostTotal: 1 }, 10.5)).toThrow();
  });

  it("property: a cut never loses or creates cost", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 3, max: 3000 }),
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.double({ min: 0.01, max: 0.98, noNaN: true }),
        (length, paise, frac) => {
          const cut = Math.max(1, Math.floor(length * frac));
          fc.pre(cut < length - 1);
          const total = D(paise).dividedBy(100);
          const r = cutRoll({ lengthM: length, landedCostTotal: total }, cut, 1);
          expect(r.childCost.plus(r.wasteCost).plus(r.parentCostAfter).equals(total)).toBe(true);
        },
      ),
    );
  });

  it("UAT 11.2 / 11.4: 700 m of a 1000 m roll back → 70 % of its value and of its cost", () => {
    const r = partialReturn(700, 1000, { taxable: "5860.00", cogs: "5000.00" });
    expect(r.taxable.toFixed(2)).toBe("4102.00");
    expect(r.cost.toFixed(2)).toBe("3500.00");
    expect(() => partialReturn(1001, 1000, { taxable: 1, cogs: 1 })).toThrow();
    expect(() => partialReturn(0, 1000, { taxable: 1, cogs: 1 })).toThrow();
  });
});

describe("e-invoice payload (ADR-0011, NIC schema 1.1)", () => {
  const buyerGstin = (() => {
    const first14 = "27AABCS1234D1Z";
    return first14 + gstinCheckChar(first14);
  })();
  const seller = {
    gstin: "24AAOFG2101Q1ZB",
    legalName: "Gulmohar Creation",
    address1: "Hojiwala Industrial Estate",
    city: "Surat",
    pincode: "394230",
    stateCode: "24",
  };
  const buyer = {
    gstin: buyerGstin,
    legalName: "Sai Prints",
    tradeName: "Sai Prints",
    address1: "Bhiwandi",
    address2: "Unit 4",
    city: "Thane",
    pincode: "421302",
    stateCode: "27",
  };
  const invoice = salesInvoice(
    [
      { kind: "GOODS", metres: 3000, ratePerM: "6.10", gstRate: 18 },
      { kind: "GOODS", metres: 1000, ratePerM: "8.32", discountPct: 1, gstRate: 18 },
      { kind: "CHARGE", amount: "750" },
    ],
    { regime: "IGST", billDiscount: "50" },
  );
  const items = [
    {
      description: "Sublimation paper 29 GSM 44″",
      hsnCode: "48099000",
      isService: false,
      unit: "MTR",
      quantity: 3000,
      unitPrice: "6.10",
    },
    {
      description: "Sublimation paper 29 GSM 60″",
      hsnCode: "48099000",
      isService: false,
      unit: "MTR",
      quantity: 1000,
      unitPrice: "8.32",
    },
    {
      description: "Freight",
      hsnCode: "996511",
      isService: true,
      unit: "OTH",
      quantity: 1,
      unitPrice: "750",
    },
  ];
  const payload = buildEInvoice({
    docType: "INV",
    docNo: "SI/2627/00001",
    docDate: "2026-10-27",
    supplyType: "B2B",
    seller,
    buyer,
    placeOfSupply: "27",
    items,
    invoice,
  });

  it("builds an inter-state B2B invoice the IRP accepts", () => {
    expect(payload.DocDtls).toEqual({ Typ: "INV", No: "SI/2627/00001", Dt: "27/10/2026" });
    expect(payload.BuyerDtls).toMatchObject({
      Pos: "27",
      Stcd: "27",
      Pin: 421302,
      TrdNm: "Sai Prints",
    });
    expect(payload.ItemList[1]).toMatchObject({
      TotAmt: 8320,
      Discount: 98.29, // 83.20 line + 15.09 bill share
      GstRt: 18,
      CgstAmt: 0,
    });
    expect(payload.ItemList[2]).toMatchObject({ IsServc: "Y", Unit: "OTH" });
    expect(payload.ValDtls).toEqual({
      AssVal: 27236.8, // 18300 + 8236.80 + 750 − 50
      CgstVal: 0,
      SgstVal: 0,
      IgstVal: 4902.62,
      RndOffAmt: -0.42,
      TotInvVal: 32139,
    });
    expect(validateEInvoice(payload)).toEqual([]);
  });

  it("names every problem the IRP would reject", () => {
    const bad = structuredClone(payload);
    bad.SellerDtls.Gstin = "24AAOFG2101Q1ZX";
    bad.BuyerDtls.Pin = 12345;
    bad.DocDtls.No = "SI/2627/0000000001";
    bad.ItemList[0]!.HsnCd = "480";
    bad.ItemList[0]!.IgstAmt += 1;
    bad.ValDtls.TotInvVal += 1;
    const problems = validateEInvoice(bad);
    expect(problems).toHaveLength(6);
    expect(problems.join("\n")).toMatch(
      /Seller GSTIN.*\n.*Buyer PIN.*\n.*Document number.*\n.*Item 1: HSN.*\n.*IGST: items add up.*\n.*Invoice total/s,
    );
    expect(validateEInvoice({ ...payload, ItemList: [] })).toContain(
      "An e-invoice has 1 to 1000 items",
    );
    expect(() =>
      buildEInvoice({
        docType: "INV",
        docNo: "X",
        docDate: "2026-10-27",
        supplyType: "B2B",
        seller,
        buyer,
        placeOfSupply: "27",
        items: [],
        invoice,
      }),
    ).toThrow();
  });
});
