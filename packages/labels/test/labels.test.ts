import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { LabelLayoutError, type LabelData, pdfSafe, renderLabels, zpl } from "../src/index.js";

const label = (n: number): LabelData => ({
  id: String(n),
  barcode: `2610-SBC-0001-${String(n).padStart(4, "0")}-K`,
  description: "Sublimation Paper Eco 29 GSM 44″",
  gsm: 29,
  widthIn: "44",
  lengthM: 1000,
  lot: "0001 (CONT-13)",
  received: "27-10-2026",
});

describe("roll labels", () => {
  it("renders a PDF with one page per label, or 10 labels per A4 sheet", async () => {
    const single = await renderLabels([label(1), label(2)], {
      widthMm: 100,
      heightMm: 50,
      output: "PDF",
      layout: "SINGLE",
    });
    expect(single.contentType).toBe("application/pdf");
    expect(new TextDecoder().decode(single.body.slice(0, 5))).toBe("%PDF-");
    // pdf-lib compresses page objects, so count pages by loading the file.
    expect((await PDFDocument.load(single.body)).getPageCount()).toBe(2);

    const sheet = await renderLabels(
      Array.from({ length: 12 }, (_, i) => label(i + 1)),
      {
        widthMm: 100,
        heightMm: 50,
        output: "PDF",
        layout: "A4_2x5",
      },
    );
    expect((await PDFDocument.load(sheet.body)).getPageCount()).toBe(2);
  });

  it("refuses a label too big for 2 × 5 on A4", async () => {
    await expect(
      renderLabels([label(1)], { widthMm: 120, heightMm: 50, output: "PDF", layout: "A4_2x5" }),
    ).rejects.toThrow(LabelLayoutError);
  });

  it("reports progress as it goes", async () => {
    const seen: number[] = [];
    await renderLabels(
      Array.from({ length: 60 }, (_, i) => label(i + 1)),
      { widthMm: 100, heightMm: 50, output: "PDF", layout: "SINGLE" },
      (d) => seen.push(d),
    );
    expect(seen).toEqual([50, 60]);
  });

  it("ZPL carries the barcode, QR and spec but never cost", async () => {
    const out = await renderLabels([label(7)], {
      widthMm: 100,
      heightMm: 50,
      output: "ZPL",
      layout: "SINGLE",
    });
    const text = new TextDecoder().decode(out.body);
    expect(text).toContain("^BCN,80");
    expect(text).toContain("^FDMA,2610-SBC-0001-0007-K");
    expect(text).toContain('29 GSM - 44" - 1,000 m');
    expect(zpl(label(1), 100, 50)).not.toMatch(/₹|cost/i);
  });

  it("makes text safe for the standard PDF font", () => {
    expect(pdfSafe("44″ “Eco” ’s · Paper — ok")).toBe(`44" "Eco" 's · Paper — ok`);
    expect(pdfSafe("कागज़")).toBe("?????");
  });
});
