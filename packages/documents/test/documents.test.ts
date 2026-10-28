import { afterAll, describe, expect, it } from "vitest";
import {
  type SalesDocument,
  documentFileName,
  indianWords,
  inr,
  renderSalesDocumentHtml,
  rupeesInWords,
} from "../src/index.js";
import { closePdfBrowser, htmlToPdf } from "../src/pdf.js";

const doc = (over: Partial<SalesDocument> = {}): SalesDocument => ({
  kind: "TAX_INVOICE",
  number: "SI/2627/00001",
  date: "2026-10-28",
  watermark: null,
  seller: {
    name: "Gulmohar Creation",
    gstin: "24AAOFG2101Q1ZB",
    address: ["Plot A-1/4, Hojiwala Industrial Estate", "Surat 394230, Gujarat"],
    state: "Gujarat (24)",
  },
  billTo: {
    name: "Shree <Sales> & Prints",
    gstin: "24AAQCS1111Q1Z5",
    address: ["12 Ring Road"],
    state: "Gujarat (24)",
  },
  placeOfSupply: "Gujarat (24)",
  meta: [["Order", "SO/2627/00001"]],
  einvoice: {
    irn: "f".repeat(64),
    ackNo: "112610000000001",
    ackDate: "28-10-2026 11:30",
    qr: "eyJhbGciOiJub25lIn0.e30.",
  },
  priced: true,
  lines: [
    {
      description: "Sublimation 100 GSM 44″",
      detail: "2610-QSL-0001-001-K 1,000 m",
      hsn: "48239090",
      quantity: "1,000 m",
      rate: "6.60",
      discount: "0.00",
      taxable: "6600.00",
      gstRate: "18",
    },
  ],
  taxes: [{ gstRate: "18", taxable: "6600.00", cgst: "594.00", sgst: "594.00", igst: "0.00" }],
  regime: "CGST_SGST",
  totals: {
    taxable: "6600.00",
    cgst: "594.00",
    sgst: "594.00",
    igst: "0.00",
    roundOff: "0.00",
    total: "7788.00",
  },
  remarks: [],
  terms: ["Subject to Surat jurisdiction."],
  copies: ["Original for recipient", "Duplicate for transporter"],
  ...over,
});

describe("amounts", () => {
  it("formats rupees the Indian way", () => {
    expect(inr("482300")).toBe("4,82,300.00");
    expect(inr("12345678.5")).toBe("1,23,45,678.50");
    expect(inr("999.99")).toBe("999.99");
    expect(inr("-1250.00")).toBe("(1,250.00)");
  });

  it("writes amounts in Indian words", () => {
    expect(indianWords(0n)).toBe("Zero");
    expect(indianWords(32261n)).toBe("Thirty Two Thousand Two Hundred Sixty One");
    expect(indianWords(1_23_45_678n)).toBe(
      "One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight",
    );
    expect(indianWords(100_00_00_000n)).toBe("One Hundred Crore");
    expect(rupeesInWords("7788.00")).toBe("Rupees Seven Thousand Seven Hundred Eighty Eight Only");
    expect(rupeesInWords("10.50")).toBe("Rupees Ten and Fifty Paise Only");
  });
});

describe("renderSalesDocumentHtml", () => {
  it("prints one page per copy, escapes text, and shows the IRN with its QR", () => {
    const html = renderSalesDocumentHtml(doc());
    expect(html.match(/<article class="page">/g)).toHaveLength(2);
    expect(html).toContain("Shree &#60;Sales&#62; &#38; Prints");
    expect(html).toContain("f".repeat(64));
    expect(html).toContain("<svg");
    expect(html).toContain("7,788.00");
    expect(html).toContain("Rupees Seven Thousand Seven Hundred Eighty Eight Only");
    expect(html).not.toContain('watermark">');
  });

  it("watermarks a provisional invoice and leaves prices off a challan", () => {
    expect(renderSalesDocumentHtml(doc({ watermark: "PROVISIONAL", einvoice: null }))).toContain(
      "Provisional — IRN pending",
    );
    const dc = renderSalesDocumentHtml(
      doc({ kind: "DELIVERY_CHALLAN", priced: false, totals: null, taxes: [], einvoice: null }),
    );
    expect(dc).toContain("Delivery Challan");
    expect(dc).not.toContain("Taxable ₹");
    expect(
      documentFileName({ kind: "TAX_INVOICE", number: "SI/2627/00001", watermark: "PROVISIONAL" }),
    ).toBe("invoice-SI-2627-00001-provisional.pdf");
  });
});

describe("htmlToPdf (headless Chromium)", () => {
  afterAll(() => closePdfBrowser());

  it("renders an A4 PDF, two pages for two copies", async () => {
    const pdf = Buffer.from(await htmlToPdf(renderSalesDocumentHtml(doc())));
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g)).toHaveLength(2);
  }, 60_000);
});
