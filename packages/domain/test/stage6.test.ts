import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { formatRollBarcode } from "../src/barcode.js";
import { D, sum } from "../src/money.js";
import {
  CsvError,
  type KnownParty,
  type KnownSku,
  checkAgainstBooks,
  checkOpeningInvoices,
  checkOpeningRolls,
  checkOpeningSkuTotals,
  dayBefore,
  goLiveBlockers,
  normaliseName,
  parseAmount,
  parseCsv,
  parseDate,
  partyMatcher,
  splitOpeningRolls,
} from "../src/opening.js";

const GO_LIVE = "2027-04-01";

describe("CSV", () => {
  it("reads Excel / Tally CSV: BOM, CRLF, quotes, embedded commas and newlines, blank lines", () => {
    const t = parseCsv(
      '﻿Party Name,Invoice No.,Amount\r\n"Shah, Sons",R/649,"1,23,456.50"\r\n\r\n"Line ""A""\nB",X-1,10\r\n',
    );
    expect(t.headers).toEqual(["party_name", "invoice_no", "amount"]);
    expect(t.rows).toEqual([
      { line: 2, values: { party_name: "Shah, Sons", invoice_no: "R/649", amount: "1,23,456.50" } },
      { line: 4, values: { party_name: 'Line "A"\nB', invoice_no: "X-1", amount: "10" } },
    ]);
  });

  it("refuses empty files, duplicate columns, unclosed quotes and extra values", () => {
    expect(() => parseCsv(" \n ")).toThrow(CsvError);
    expect(() => parseCsv("a,A\n1,2")).toThrow(/appears twice/);
    expect(() => parseCsv('a,b\n"open,2')).toThrow(/never closed/);
    expect(() => parseCsv("a,b\n1,2,3")).toThrow(/3 values/);
    expect(parseCsv("a,b\n1,2,").rows[0]!.values).toEqual({ a: "1", b: "2" });
    expect(parseCsv("a,b\n1").rows[0]!.values).toEqual({ a: "1", b: "" });
  });

  it("round-trips any table of cells", () => {
    const cell = fc.string({ maxLength: 12 }).map((s) => s.trim());
    fc.assert(
      fc.property(
        fc.array(fc.array(cell, { minLength: 3, maxLength: 3 }), { minLength: 1, maxLength: 8 }),
        (rows) => {
          const q = (v: string) => `"${v.replace(/"/g, '""')}"`;
          const text = ["a,b,c", ...rows.map((r) => r.map(q).join(","))].join("\r\n");
          const nonBlank = rows.filter((r) => r.some((v) => v !== ""));
          expect(parseCsv(text).rows.map((r) => [r.values.a, r.values.b, r.values.c])).toEqual(
            nonBlank,
          );
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe("values", () => {
  it("amounts in Indian notation, with ₹ or Rs.", () => {
    expect(parseAmount("1,23,456.50")?.toFixed(2)).toBe("123456.50");
    expect(parseAmount("₹ 1,234")?.toFixed(2)).toBe("1234.00");
    expect(parseAmount("Rs.99.5")?.toFixed(2)).toBe("99.50");
    expect(parseAmount("-10")?.toFixed(2)).toBe("-10.00");
    expect(parseAmount("12.345")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
  });

  it("dates ISO or day-first; impossible dates rejected", () => {
    expect(parseDate("2027-03-31")).toBe("2027-03-31");
    expect(parseDate("31-03-2027")).toBe("2027-03-31");
    expect(parseDate("1/4/2027")).toBe("2027-04-01");
    expect(parseDate("31.12.2026")).toBe("2026-12-31");
    expect(parseDate("30-02-2027")).toBeNull();
    expect(parseDate("2027/03/31")).toBeNull();
    expect(dayBefore("2027-03-01")).toBe("2027-02-28");
  });

  it("names match despite M/s, Pvt/Private, Ltd/Limited, & and punctuation", () => {
    expect(normaliseName("M/s. Shah & Sons Private Limited")).toBe(
      normaliseName("shah and sons pvt. ltd"),
    );
  });
});

const customers: KnownParty[] = [
  { id: "c1", code: "CUS-001", name: "Shah & Sons Pvt Ltd", gstin: "24AAAAA0000A1Z5" },
  { id: "c2", code: "CUS-002", name: "Patel Prints" },
  { id: "c3", code: "CUS-003", name: "Patel Prints" },
];

describe("party matching", () => {
  it("by code, GSTIN or a unique name; a shared name is ambiguous", () => {
    const m = partyMatcher(customers);
    expect(m("cus-001")).toEqual({ party: customers[0] });
    expect(m("24aaaaa0000a1z5")).toEqual({ party: customers[0] });
    expect(m("M/s Shah and Sons Private Limited")).toEqual({ party: customers[0] });
    expect(m("Patel Prints")).toEqual({ ambiguous: true });
    expect(m("Nobody")).toBeNull();
    expect(m(" ")).toBeNull();
  });
});

describe("opening receivables / payables (PRD §5.10)", () => {
  const ctx = {
    parties: customers,
    goLiveDate: GO_LIVE,
    partyLabel: "customer" as const,
    existing: new Set(["c1|OLD-1"]),
  };

  it("imports known parties, flags unknown ones before import, and catches bad rows", () => {
    const t = parseCsv(
      [
        "customer,invoice_no,date,amount,due_date",
        'CUS-001,R/649,15-03-2027,"8,260.00",14-04-2027',
        "Shah & Sons Pvt Ltd,R/650,2027-03-20,500,",
        "Unknown Traders,R/1,2027-03-01,100,",
        "Patel Prints,R/2,2027-03-01,100,",
        "CUS-001,R/649,2027-03-01,100,",
        "CUS-001,old-1,2027-03-01,100,",
        "CUS-001,R/3,2027-04-01,100,",
        "CUS-001,,31-02-2027,0,2027-01-01",
        "CUS-001,R/4,2027-03-10,-5,2027-03-01",
        "CUS-001,R/5,2027-03-10,5,soon",
      ].join("\n"),
    );
    const r = checkOpeningInvoices(t, ctx);
    expect(r.rows).toEqual([
      {
        line: 2,
        partyId: "c1",
        partyName: "Shah & Sons Pvt Ltd",
        invoiceNo: "R/649",
        date: "2027-03-15",
        dueDate: "2027-04-14",
        amount: "8260.00",
      },
      {
        line: 3,
        partyId: "c1",
        partyName: "Shah & Sons Pvt Ltd",
        invoiceNo: "R/650",
        date: "2027-03-20",
        dueDate: null,
        amount: "500.00",
      },
    ]);
    expect(r.warnings).toEqual([
      { line: 3, column: "due_date", message: expect.stringContaining("credit days") },
    ]);
    const byLine = (line: number) =>
      r.errors
        .filter((e) => e.line === line)
        .map((e) => e.message)
        .join(" | ");
    expect(byLine(4)).toMatch(/Unknown customer "Unknown Traders"/);
    expect(byLine(5)).toMatch(/More than one customer/);
    expect(byLine(6)).toMatch(/appears twice/);
    expect(byLine(7)).toMatch(/already imported/);
    expect(byLine(8)).toMatch(/before the go-live date/);
    expect(byLine(9)).toMatch(/Invoice number is missing.*not a date.*above zero/);
    expect(byLine(10)).toMatch(/above zero.*before the invoice date/);
    expect(byLine(11)).toMatch(/"soon" is not a date/);
  });

  it("names the missing columns", () => {
    const r = checkOpeningInvoices(parseCsv("customer,amount\nCUS-001,5"), ctx);
    expect(r.errors).toEqual([{ line: 1, message: "Missing columns: invoice_no, date" }]);
  });
});

const skus: KnownSku[] = [
  { id: "s1", code: "SUB-29-STD-44", gsm: 29, quality: "Standard", widthIn: "44.00" },
  { id: "s2", code: "SUB-29-STD-63", gsm: 29, quality: "Standard", widthIn: "63.5" },
];
const suppliers: KnownParty[] = [{ id: "p1", code: "SUP-001", name: "Orange O Tec Pvt Ltd" }];

describe("opening stock, roll by roll", () => {
  const good = formatRollBarcode({
    postedAt: "2026-10-27",
    supplierCode: "OOT",
    batchSeq: 1,
    rollSeq: 7,
  });
  const used = formatRollBarcode({
    postedAt: "2026-10-27",
    supplierCode: "OOT",
    batchSeq: 1,
    rollSeq: 8,
  });

  it("finds the SKU by code or by GSM + quality + width; keeps a valid unused barcode", () => {
    const t = parseCsv(
      [
        "barcode,supplier,sku,gsm,quality,width,metres,cost_per_m,received_date,batch",
        `${good},SUP-001,SUB-29-STD-44,,,,1000,4.9896,2027-01-15,B-12`,
        `,Orange O Tec Private Limited,,29,standard,63.5″,"1,000",₹5.10,,`,
        `${used},SUP-001,SUB-29-STD-44,,,,960,4.00,2027-01-15,`,
        `NOT-A-CODE,SUP-001,SUB-29-STD-44,,,,500,4.00,2027-01-15,`,
      ].join("\n"),
    );
    const r = checkOpeningRolls(t, {
      skus,
      suppliers,
      goLiveDate: GO_LIVE,
      existingBarcodes: new Set([used]),
    });
    expect(r.errors).toEqual([]);
    expect(
      r.rows.map((x) => [x.barcode, x.skuId, x.metres, x.costPerM, x.value, x.receivedDate]),
    ).toEqual([
      [good, "s1", 1000, "4.9896", "4989.60", "2027-01-15"],
      [null, "s2", 1000, "5.1000", "5100.00", "2027-03-31"],
      [null, "s1", 960, "4.0000", "3840.00", "2027-01-15"],
      [null, "s1", 500, "4.0000", "2000.00", "2027-01-15"],
    ]);
    expect(r.warnings.map((w) => w.message)).toEqual([
      expect.stringContaining("day before go-live"),
      expect.stringContaining("already in use"),
      expect.stringContaining("not a valid roll barcode"),
    ]);
  });

  it("rejects unknown items and suppliers, part metres, bad costs, late dates, repeated barcodes", () => {
    const t = parseCsv(
      [
        "barcode,supplier,sku,metres,cost_per_m,received_date",
        `${good},SUP-001,SUB-29-STD-44,1000,4,2027-01-01`,
        `${good},SUP-001,SUB-29-STD-44,1000,4,2027-01-01`,
        ",Someone,NOPE,10.5,free,2027-04-02",
        ",SUP-001,SUB-29-STD-44,0,0,31-31-2027",
      ].join("\n"),
    );
    const r = checkOpeningRolls(t, { skus, suppliers, goLiveDate: GO_LIVE });
    expect(r.rows).toHaveLength(1);
    const msgs = r.errors.map((e) => `${e.line}:${e.column}`);
    expect(msgs).toEqual([
      "3:barcode",
      "4:supplier",
      "4:sku",
      "4:metres",
      "4:cost_per_m",
      "4:received_date",
      "5:metres",
      "5:cost_per_m",
      "5:received_date",
    ]);
  });

  it("needs a supplier, metres, cost and an item column", () => {
    const r = checkOpeningRolls(parseCsv("barcode,metres\nX,1"), {
      skus,
      suppliers,
      goLiveDate: GO_LIVE,
    });
    expect(r.errors[0]!.message).toBe(
      "Missing columns: supplier, cost_per_m, sku (or gsm, quality and width)",
    );
  });
});

describe("opening stock, per SKU (Q41)", () => {
  it("reads totals and fills in a missing roll count from the standard length", () => {
    const t = parseCsv(
      [
        "supplier,sku,rolls,metres,value",
        'SUP-001,SUB-29-STD-44,,2500,"12,500.00"',
        "SUP-001,SUB-29-STD-63,3,3000,15000",
        "SUP-001,SUB-29-STD-63,9,5,1",
        "X,NOPE,a,b,c",
      ].join("\n"),
    );
    const r = checkOpeningSkuTotals(t, {
      skus,
      suppliers,
      goLiveDate: GO_LIVE,
      standardLengthM: 1000,
    });
    expect(r.rows.map((x) => [x.skuId, x.rolls, x.metres, x.value, x.receivedDate])).toEqual([
      ["s1", 3, 2500, "12500.00", "2027-03-31"],
      ["s2", 3, 3000, "15000.00", "2027-03-31"],
    ]);
    expect(r.warnings[0]!.message).toMatch(/3 rolls of up to 1000 m/);
    expect(r.errors.filter((e) => e.line === 4).map((e) => e.column)).toEqual(["rolls"]);
    expect(r.errors.filter((e) => e.line === 5).map((e) => e.column)).toEqual([
      "supplier",
      "sku",
      "metres",
      "value",
      "rolls",
    ]);
    expect(
      checkOpeningSkuTotals(parseCsv("sku\nX"), {
        skus,
        suppliers,
        goLiveDate: GO_LIVE,
        standardLengthM: 1000,
      }).errors[0]!.message,
    ).toBe("Missing columns: supplier, metres, value");
  });

  it("standard rolls with a shorter last one when the count fits, else as equal as possible", () => {
    expect(splitOpeningRolls(2500, 3, "12500", 1000).map((r) => r.lengthM)).toEqual([
      1000, 1000, 500,
    ]);
    expect(splitOpeningRolls(3000, 3, "15000", 1000).map((r) => r.lengthM)).toEqual([
      1000, 1000, 1000,
    ]);
    expect(splitOpeningRolls(2500, 4, "100", 1000).map((r) => r.lengthM)).toEqual([
      625, 625, 625, 625,
    ]);
    expect(splitOpeningRolls(10, 3, "10.01", 1000).map((r) => [r.lengthM, r.value])).toEqual([
      [4, "4.01"],
      [3, "3.00"],
      [3, "3.00"],
    ]);
    expect(() => splitOpeningRolls(10, 11, "1", 1000)).toThrow(RangeError);
    expect(() => splitOpeningRolls(0, 1, "1", 1000)).toThrow(RangeError);
  });

  it("the rolls always add up to the metres and the value to the paisa", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 60_000 }),
        fc.integer({ min: 1, max: 80 }),
        fc.integer({ min: 1, max: 100_000_000 }),
        fc.constantFrom(500, 1000, 1500),
        (metres, n, paise, std) => {
          const rolls = Math.min(n, metres);
          const value = (paise / 100).toFixed(2);
          const r = splitOpeningRolls(metres, rolls, value, std);
          expect(r).toHaveLength(rolls);
          expect(r.reduce((s, x) => s + x.lengthM, 0)).toBe(metres);
          expect(r.every((x) => x.lengthM > 0)).toBe(true);
          expect(sum(r.map((x) => x.value)).toFixed(2)).toBe(value);
        },
      ),
      { numRuns: 400 },
    );
  });
});

describe("books and the Go-Live lock", () => {
  it("totals must equal the books to the paisa (Q43)", () => {
    expect(checkAgainstBooks(["4989.60", "5100"], "10089.60")).toEqual({
      imported: "10089.60",
      books: "10089.60",
      difference: "0.00",
      matches: true,
    });
    expect(checkAgainstBooks(["0.10", "0.20"], D("0.31"))).toMatchObject({
      difference: "-0.01",
      matches: false,
    });
  });

  it("go live only when every chapter is confirmed or not needed, and only once (Q44)", () => {
    expect(
      goLiveBlockers(
        [
          { chapter: "STOCK", status: "Confirmed" },
          { chapter: "AR", status: "Draft" },
        ],
        null,
      ),
    ).toEqual([
      "Receivables is imported but not confirmed against the books",
      "Payables: import it or mark it as not needed",
      "Bank & cash: import it or mark it as not needed",
    ]);
    const all = (["STOCK", "AR", "AP", "CASH"] as const).map((chapter) => ({
      chapter,
      status: chapter === "CASH" ? ("NotNeeded" as const) : ("Confirmed" as const),
    }));
    expect(goLiveBlockers(all, null)).toEqual([]);
    expect(goLiveBlockers(all, "2027-04-01T03:00:00Z")).toEqual(["Already live"]);
  });
});
