import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  InvalidBarcodeError,
  InvalidRollListError,
  InvalidTransitionError,
  allocateCharge,
  chargesTotal,
  formatRollBarcode,
  formatRollList,
  grnMachine,
  invoiceTotals,
  isLuhnMod36Valid,
  landedCostPerRoll,
  luhnMod36,
  parseRollBarcode,
  parseRollList,
  purchaseInvoiceMachine,
  purchaseOrderMachine,
  purchaseReturnMachine,
  rollMachine,
  rollWeightKg,
  roundToStep,
  sum,
  taxLine,
} from "../src/index.js";

describe("state machines", () => {
  it("roll: born Unmapped/Mapped, picked, dispatched, returned, inspected", () => {
    expect(rollMachine.can("Unmapped", "Mapped")).toBe(true);
    expect(rollMachine.can("Mapped", "Allocated")).toBe(true);
    expect(rollMachine.can("Allocated", "Mapped")).toBe(true); // un-picked from a draft DC
    expect(rollMachine.can("Allocated", "Dispatched")).toBe(true);
    expect(rollMachine.can("Dispatched", "Returned")).toBe(true);
    expect(rollMachine.can("Returned", "Mapped")).toBe(true);
    expect(rollMachine.can("Returned", "Scrap")).toBe(true);
    expect(rollMachine.can("Mapped", "ReturnedToSupplier")).toBe(true);
  });

  it("roll: illegal moves throw; Scrap and ReturnedToSupplier are final", () => {
    expect(() => rollMachine.assert("Unmapped", "Dispatched")).toThrow(InvalidTransitionError);
    expect(() => rollMachine.assert("Dispatched", "Mapped")).toThrow(/cannot move/);
    expect(rollMachine.isTerminal("Scrap")).toBe(true);
    expect(rollMachine.isTerminal("ReturnedToSupplier")).toBe(true);
  });

  it("purchase order can only be cancelled before anything is received", () => {
    expect(purchaseOrderMachine.can("Draft", "Approved")).toBe(true);
    expect(purchaseOrderMachine.can("Approved", "Cancelled")).toBe(true);
    expect(purchaseOrderMachine.can("PartiallyReceived", "Cancelled")).toBe(false);
    expect(purchaseOrderMachine.can("PartiallyReceived", "Closed")).toBe(true);
    expect(purchaseOrderMachine.can("Draft", "PartiallyReceived")).toBe(false);
  });

  it("GRN, PI and purchase return: draft → posted, posted is final", () => {
    for (const m of [purchaseInvoiceMachine, purchaseReturnMachine]) {
      expect(m.can("Draft", "Posted")).toBe(true);
      expect(m.isTerminal("Posted")).toBe(true);
    }
    expect(grnMachine.can("Created", "Posted")).toBe(true);
    expect(grnMachine.can("Posted", "Cancelled")).toBe(false);
  });
});

describe("roll barcode (ADR-0007)", () => {
  const parts = {
    postedAt: "2026-10-27T10:00:00+05:30",
    supplierCode: "shr",
    batchSeq: 42,
    rollSeq: 7,
  };

  it("formats YYMM-SUP-BATCH-SEQ-CHECK in IST with a valid check character", () => {
    const code = formatRollBarcode(parts);
    expect(code).toMatch(/^2610-SHR-0042-0007-[0-9A-Z]$/);
    expect(isLuhnMod36Valid(code.replace(/-/g, ""))).toBe(true);
    expect(parseRollBarcode(` ${code.toLowerCase()} `)).toEqual({
      valid: true,
      yymm: "2610",
      supplierCode: "SHR",
      batchSeq: 42,
      rollSeq: 7,
    });
  });

  it("uses the IST month at the month boundary", () => {
    // 31 Oct 2026 20:00 UTC is already 1 Nov in Surat.
    expect(formatRollBarcode({ ...parts, postedAt: "2026-10-31T20:00:00Z" })).toMatch(/^2611-/);
  });

  it("catches any single wrong character and any swap of two neighbours", () => {
    const code = formatRollBarcode(parts).replace(/-/g, "");
    const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    for (let i = 0; i < code.length; i++) {
      for (const ch of chars) {
        if (ch === code[i]) continue;
        expect(isLuhnMod36Valid(code.slice(0, i) + ch + code.slice(i + 1))).toBe(false);
      }
    }
    for (let i = 0; i < code.length - 1; i++) {
      if (code[i] === code[i + 1]) continue;
      const swapped = code.slice(0, i) + code[i + 1] + code[i] + code.slice(i + 2);
      expect(isLuhnMod36Valid(swapped)).toBe(false);
    }
  });

  it("rejects malformed scans and bad parts", () => {
    expect(parseRollBarcode("2610-SHR-0042-0007")).toMatchObject({ valid: false });
    const code = formatRollBarcode(parts);
    const tampered = code.slice(0, -1) + (code.endsWith("0") ? "1" : "0");
    expect(parseRollBarcode(tampered)).toMatchObject({ valid: false, error: /Check character/ });
    expect(() => formatRollBarcode({ ...parts, supplierCode: "SH" })).toThrow(InvalidBarcodeError);
    expect(() => formatRollBarcode({ ...parts, rollSeq: 10000 })).toThrow(InvalidBarcodeError);
    expect(() => luhnMod36("AB-1")).toThrow(InvalidBarcodeError);
  });
});

describe("roll lists as suppliers write them (Q13)", () => {
  it("reads the Shree Balajee invoice lines", () => {
    expect(parseRollList("10 X 1000 MTRS")).toEqual(Array(10).fill(1000));
    expect(parseRollList("4 X 1000, 500+450 MTRS")).toEqual([1000, 1000, 1000, 1000, 500, 450]);
  });

  it("accepts *, ×, new lines and plain lengths", () => {
    expect(parseRollList("2*960\n1×720; 1300")).toEqual([960, 960, 720, 1300]);
  });

  it("rejects unreadable, fractional and absurd entries", () => {
    expect(() => parseRollList("")).toThrow(InvalidRollListError);
    expect(() => parseRollList("four rolls")).toThrow(/Can't read/);
    expect(() => parseRollList("2 x 999.5")).toThrow(/whole number/);
    expect(() => parseRollList("5000 x 1000")).toThrow(/Roll count/);
    expect(() => parseRollList("0")).toThrow(/whole number/);
  });

  it("formats back compactly and round-trips", () => {
    const lengths = [1000, 1000, 1000, 500, 450];
    expect(formatRollList(lengths)).toBe("3 × 1000, 500, 450");
    expect(parseRollList(formatRollList(lengths))).toEqual(lengths);
  });

  it("roll weight: 29 GSM × 44″ × 1000 m ≈ 32.4 kg", () => {
    expect(rollWeightKg(29, 44, 1000).toString()).toBe("32.41");
    expect(rollWeightKg(30, 63, 1500).toFixed(3)).toBe("72.009");
  });
});

describe("landed cost (PRD §8.3, ADR-0017)", () => {
  const rolls = [
    { id: "a", lengthM: 1000, baseValue: "4900.00", gsm: 29, widthIn: 44 },
    { id: "b", lengthM: 1000, baseValue: "6680.00", gsm: 29, widthIn: 60 },
    { id: "c", lengthM: 450, baseValue: "3006.00", gsm: 29, widthIn: 60 },
  ];

  it("METER basis splits by length (UAT §11.1)", () => {
    const parts = allocateCharge("1225.00", "METER", rolls);
    expect([...parts.values()].map((p) => p.toFixed(2))).toEqual(["500.00", "500.00", "225.00"]);
  });

  it("ROLL, VALUE and WEIGHT bases", () => {
    expect([...allocateCharge("100.00", "ROLL", rolls).values()].map((p) => p.toFixed(2))).toEqual([
      "33.34",
      "33.33",
      "33.33",
    ]);
    const byValue = allocateCharge("1458.60", "VALUE", rolls);
    expect(byValue.get("a")!.toFixed(2)).toBe("490.00");
    // 60″ rolls weigh more than the 44″ roll of the same length.
    const byWeight = allocateCharge("1000.00", "WEIGHT", rolls);
    expect(byWeight.get("b")!.greaterThan(byWeight.get("a")!)).toBe(true);
  });

  it("per-roll totals and cost per metre", () => {
    const result = landedCostPerRoll(
      [
        { id: "freight", amount: "1225.00", basis: "METER" },
        { id: "insurance", amount: "145.86", basis: "VALUE" },
      ],
      rolls,
    );
    expect(result[0]).toMatchObject({ rollId: "a" });
    expect(result[0]!.landedCost.toFixed(2)).toBe("549.00");
    expect(result[0]!.costPerMetre.toFixed(4)).toBe("5.4490");
  });

  it("property: every charge's shares sum to the charge to the paisa", () => {
    const roll = fc.record({
      lengthM: fc.integer({ min: 1, max: 2000 }),
      baseValue: fc.integer({ min: 0, max: 5_000_000 }).map((p) => (p / 100).toFixed(2)),
      gsm: fc.integer({ min: 20, max: 120 }),
      widthIn: fc.integer({ min: 12, max: 72 }),
    });
    fc.assert(
      fc.property(
        fc.array(roll, { minLength: 1, maxLength: 60 }),
        fc.integer({ min: 0, max: 50_000_000 }),
        fc.constantFrom("ROLL", "METER", "VALUE", "WEIGHT" as const),
        (rs, paise, basis) => {
          const amount = (paise / 100).toFixed(2);
          const withIds = rs.map((r, i) => ({ ...r, id: String(i) }));
          const parts = [...allocateCharge(amount, basis, withIds).values()];
          return sum(parts).toFixed(2) === amount && parts.every((p) => !p.isNegative());
        },
      ),
      { numRuns: 300 },
    );
  });

  it("chargesTotal adds up the invoice's charges", () => {
    expect(
      chargesTotal([
        { id: "1", amount: "1225.00", basis: "METER" },
        { id: "2", amount: "0.10", basis: "ROLL" },
      ]).toFixed(2),
    ).toBe("1225.10");
  });
});

describe("GST invoice maths against the owner's real invoices", () => {
  it("Gulmohar sales invoice R/649 (intra-state, 18 %)", () => {
    const lines = [
      taxLine({ quantity: 8000, rate: "5.86", gstRate: 18 }),
      taxLine({ quantity: 8000, rate: "5.10", gstRate: 18 }),
      taxLine({ quantity: 7000, rate: "6.37", gstRate: 18 }),
    ];
    expect(lines.map((l) => l.taxable.toFixed(2))).toEqual(["46880.00", "40800.00", "44590.00"]);
    const t = invoiceTotals(lines, "CGST_SGST", 1);
    expect(t.taxable.toFixed(2)).toBe("132270.00");
    expect(t.cgst.toFixed(2)).toBe("11904.30");
    expect(t.sgst.toFixed(2)).toBe("11904.30");
    expect(t.roundOff.toFixed(2)).toBe("0.40");
    expect(t.total.toFixed(2)).toBe("156079.00");
  });

  it("Shree Balajee purchase invoice 2455", () => {
    const t = invoiceTotals(
      [
        taxLine({ quantity: 10000, rate: "4.90", gstRate: 18 }),
        taxLine({ quantity: 4950, rate: "6.68", gstRate: 18 }),
      ],
      "CGST_SGST",
    );
    expect(t.taxable.toFixed(2)).toBe("82066.00");
    expect(t.cgst.toFixed(2)).toBe("7385.94");
    expect(t.roundOff.toFixed(2)).toBe("0.12");
    expect(t.total.toFixed(2)).toBe("96838.00");
  });

  it("Orange O Tec PAPER/022: tax on the summed taxable value; negative round-off", () => {
    const t = invoiceTotals(
      [{ ...taxLine({ quantity: 1, rate: "4008303.80", gstRate: 18 }) }],
      "CGST_SGST",
    );
    expect(t.cgst.toFixed(2)).toBe("360747.34");
    expect(t.roundOff.toFixed(2)).toBe("-0.48");
    expect(t.total.toFixed(2)).toBe("4729798.00");
  });

  it("inter-state uses IGST at the full rate; mixed rates are summarised per rate", () => {
    const t = invoiceTotals(
      [
        taxLine({ quantity: 1000, rate: "5.00", gstRate: 18 }),
        taxLine({ quantity: 1000, rate: "5.00", gstRate: 12, discountPct: 10 }),
      ],
      "IGST",
      0,
    );
    expect(
      t.byRate.map((b) => [b.gstRate.toString(), b.taxable.toFixed(2), b.igst.toFixed(2)]),
    ).toEqual([
      ["18", "5000.00", "900.00"],
      ["12", "4500.00", "540.00"],
    ]);
    expect(t.cgst.isZero() && t.sgst.isZero()).toBe(true);
    expect(t.roundOff.isZero()).toBe(true);
    expect(t.total.toFixed(2)).toBe("10940.00");
  });

  it("round-off steps: rupee, half-rupee, none", () => {
    expect(roundToStep("100.49", 1).toFixed(2)).toBe("100.00");
    expect(roundToStep("100.50", 1).toFixed(2)).toBe("101.00");
    expect(roundToStep("100.26", "0.5").toFixed(2)).toBe("100.50");
    expect(roundToStep("100.26", 0).toFixed(2)).toBe("100.26");
  });
});
