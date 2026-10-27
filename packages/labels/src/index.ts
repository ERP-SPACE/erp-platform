import bwipjs from "bwip-js";
import { PDFDocument, type PDFFont, type PDFPage, StandardFonts, rgb } from "pdf-lib";

/**
 * Roll labels (ADR-0006/0007), shared by the API (small batches, on request) and the worker
 * (large batches in the background). PDF for any printer — one label per page or 2 × 5 on A4 —
 * or ZPL II for a 203 dpi thermal printer. The QR holds the barcode string only; labels never
 * carry cost.
 */
export interface LabelData {
  id: string;
  barcode: string;
  description: string;
  gsm: number;
  widthIn: string;
  lengthM: number;
  /** Our lot number, with the supplier's reference, e.g. "0001 (CONT-13)". */
  lot: string;
  /** Receipt date, DD-MM-YYYY. */
  received: string;
}

export interface LabelLayout {
  widthMm: number;
  heightMm: number;
  output: "PDF" | "ZPL";
  layout: "SINGLE" | "A4_2x5";
}

export class LabelLayoutError extends Error {
  readonly code = "VALIDATION_ERROR";
}

const MM = 72 / 25.4; // PDF points per millimetre
const A4 = { w: 210, h: 297 };

/** The three text lines every label carries. */
export function labelLines(l: LabelData) {
  return {
    title: l.description,
    spec: `${l.gsm} GSM · ${l.widthIn}″ · ${l.lengthM.toLocaleString("en-IN")} m`,
    lot: `Lot ${l.lot} · ${l.received}`,
  };
}

/**
 * Standard PDF fonts are WinAnsi: map the inch mark and quotes, and replace anything else they
 * can't encode (e.g. Devanagari) with "?" rather than failing the whole batch.
 */
// Built from an escaped string so formatters can't turn the escapes into invisible characters.
const NOT_WIN_ANSI = new RegExp("[^\u0020-\u007E\u00A0-\u00FF\u2022\u2013\u2014\u2026]", "g");

export function pdfSafe(s: string): string {
  return s.replace(/[″“”]/g, '"').replace(/[‘’]/g, "'").replace(NOT_WIN_ANSI, "?");
}

export interface RenderedLabels {
  body: Uint8Array;
  contentType: string;
  extension: "pdf" | "zpl";
}

export async function renderLabels(
  labels: readonly LabelData[],
  layout: LabelLayout,
  onProgress?: (done: number) => void,
): Promise<RenderedLabels> {
  if (layout.output === "ZPL") {
    const text = labels.map((l) => zpl(l, layout.widthMm, layout.heightMm)).join("\n");
    onProgress?.(labels.length);
    return {
      body: new TextEncoder().encode(text),
      contentType: "text/plain; charset=utf-8",
      extension: "zpl",
    };
  }
  return {
    body: await pdf(labels, layout, onProgress),
    contentType: "application/pdf",
    extension: "pdf",
  };
}

async function pdf(
  labels: readonly LabelData[],
  { widthMm: wMm, heightMm: hMm, layout }: LabelLayout,
  onProgress?: (done: number) => void,
): Promise<Uint8Array> {
  if (layout === "A4_2x5" && (wMm * 2 > A4.w || hMm * 5 > A4.h)) {
    throw new LabelLayoutError(
      `A ${wMm} × ${hMm} mm label does not fit 2 × 5 on A4; choose one per page.`,
    );
  }
  const doc = await PDFDocument.create();
  doc.setTitle("Roll labels");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const perSheet = layout === "A4_2x5" ? 10 : 1;
  let page: PDFPage | null = null;
  for (let i = 0; i < labels.length; i++) {
    const slot = i % perSheet;
    if (slot === 0) {
      page =
        layout === "A4_2x5"
          ? doc.addPage([A4.w * MM, A4.h * MM])
          : doc.addPage([wMm * MM, hMm * MM]);
    }
    const origin =
      layout === "A4_2x5"
        ? {
            x: ((A4.w - wMm * 2) / 2 + (slot % 2) * wMm) * MM,
            y: (A4.h - (A4.h - hMm * 5) / 2 - (Math.floor(slot / 2) + 1) * hMm) * MM,
          }
        : { x: 0, y: 0 };
    await drawLabel(doc, page!, origin, wMm, hMm, labels[i]!, font, bold);
    if ((i + 1) % 50 === 0) onProgress?.(i + 1);
  }
  onProgress?.(labels.length);
  return doc.save();
}

async function drawLabel(
  doc: PDFDocument,
  page: PDFPage,
  origin: { x: number; y: number },
  wMm: number,
  hMm: number,
  label: LabelData,
  font: PDFFont,
  bold: PDFFont,
) {
  const w = wMm * MM;
  const h = hMm * MM;
  const pad = 3 * MM;
  const raw = labelLines(label);
  const text = { title: pdfSafe(raw.title), spec: pdfSafe(raw.spec), lot: pdfSafe(raw.lot) };
  const qrSize = Math.min(h - 2 * pad, w * 0.32);
  const [code128, qr] = await Promise.all([
    bwipjs.toBuffer({
      bcid: "code128",
      text: label.barcode,
      scale: 3,
      height: 10,
      includetext: false,
    }),
    bwipjs.toBuffer({ bcid: "qrcode", text: label.barcode, scale: 4 }),
  ]);
  const [barImg, qrImg] = await Promise.all([doc.embedPng(code128), doc.embedPng(qr)]);
  // QR on the right, full height.
  page.drawImage(qrImg, {
    x: origin.x + w - pad - qrSize,
    y: origin.y + (h - qrSize) / 2,
    width: qrSize,
    height: qrSize,
  });
  const textW = w - 3 * pad - qrSize;
  const fit = (s: string, f: PDFFont, size: number) => {
    let out = s;
    while (out.length > 4 && f.widthOfTextAtSize(out, size) > textW) out = `${out.slice(0, -2)}…`;
    return out;
  };
  const x = origin.x + pad;
  let y = origin.y + h - pad - 9;
  page.drawText(fit(pdfSafe(label.barcode), bold, 10), { x, y, size: 10, font: bold });
  y -= 13;
  page.drawText(fit(text.title, font, 8), { x, y, size: 8, font });
  y -= 11;
  page.drawText(fit(text.spec, bold, 9), { x, y, size: 9, font: bold });
  y -= 11;
  page.drawText(fit(text.lot, font, 7), { x, y, size: 7, font, color: rgb(0.25, 0.25, 0.25) });
  const barH = Math.max(8 * MM, y - origin.y - pad - 2);
  page.drawImage(barImg, { x, y: origin.y + pad, width: textW, height: Math.min(barH, 14 * MM) });
}

/** ZPL II for 203 dpi thermal printers (8 dots/mm). */
export function zpl(l: LabelData, wMm: number, hMm: number): string {
  const dots = (mm: number) => Math.round(mm * 8);
  const t = labelLines(l);
  const safe = (s: string) => s.replace(/[\^~]/g, " ").replace(/″/g, '"').replace(/·/g, "-");
  return [
    "^XA",
    "^CI28",
    `^PW${dots(wMm)}`,
    `^LL${dots(hMm)}`,
    `^FO24,20^A0N,34,34^FD${safe(l.barcode)}^FS`,
    `^FO24,62^A0N,24,24^FD${safe(t.title).slice(0, 40)}^FS`,
    `^FO24,92^A0N,28,28^FD${safe(t.spec)}^FS`,
    `^FO24,126^A0N,20,20^FD${safe(t.lot)}^FS`,
    `^FO24,${dots(hMm) - 110}^BY2^BCN,80,N,N,N^FD${safe(l.barcode)}^FS`,
    `^FO${dots(wMm) - 190},${Math.max(10, (dots(hMm) - 180) / 2)}^BQN,2,6^FDMA,${safe(l.barcode)}^FS`,
    "^XZ",
  ].join("\n");
}

// ── background label jobs (API enqueues, worker renders) ─────────────────────

/** BullMQ queue for large label batches. */
export const LABEL_QUEUE = "erp-labels";
/** Finished files wait in Redis for an hour, then expire. */
export const LABEL_FILE_TTL_SECONDS = 3600;
export const labelFileKey = (jobId: string) => `erp:labels:file:${jobId}`;

export interface LabelJobData {
  companyId: string;
  userId: string;
  labels: LabelData[];
  layout: LabelLayout;
  reprint: boolean;
  reason: string | null;
}

export interface LabelJobResult {
  count: number;
  bytes: number;
  contentType: string;
  fileName: string;
}
