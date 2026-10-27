import { batches, goodsReceipts, labelPrints, rolls } from "@erp/db";
import { Injectable } from "@nestjs/common";
import bwipjs from "bwip-js";
import { and, asc, eq, inArray } from "drizzle-orm";
import { PDFDocument, type PDFFont, type PDFPage, StandardFonts, rgb } from "pdf-lib";
import { actor, ctx } from "../../common/context.js";
import { trimDecimal } from "../../common/decimal.js";
import { notFound, reasonRequired, validationError } from "../../common/errors.js";
import { UnitOfWork } from "../../db/unit-of-work.js";
import { SettingsService } from "../settings/settings.service.js";
import type { LabelRequestDto } from "./inventory.dto.js";

const MM = 72 / 25.4; // PDF points per millimetre
const A4 = { w: 210, h: 297 };
const MAX_LABELS = 2000;

interface LabelData {
  id: string;
  barcode: string;
  description: string;
  gsm: number;
  widthIn: string;
  lengthM: number;
  lot: string;
  received: string;
}

/** A roll label: what the godown needs to pick and check — never cost (ADR-0006). */
function lines(l: LabelData) {
  return {
    title: l.description,
    spec: `${l.gsm} GSM · ${l.widthIn}″ · ${l.lengthM.toLocaleString("en-IN")} m`,
    lot: `Lot ${l.lot} · ${l.received}`,
  };
}

/**
 * Roll labels (ADR-0006/0007): PDF for any printer (one label per page, or 2 × 5 on A4 sheets),
 * or ZPL text for a thermal printer. The QR holds the barcode string only. Every print is
 * logged to `label_prints`; reprints need a reason.
 */
@Injectable()
export class LabelsService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly settings: SettingsService,
  ) {}

  async render(
    dto: LabelRequestDto,
  ): Promise<{ body: Buffer; contentType: string; fileName: string }> {
    const reason = ctx().reason?.trim() ?? null;
    if (dto.reprint && !reason) throw reasonRequired();
    const labels = await this.load(dto);
    const setting = await this.settings.value("labels.roll");
    const body =
      setting.output === "ZPL"
        ? Buffer.from(
            labels.map((l) => zpl(l, setting.widthMm, setting.heightMm)).join("\n"),
            "utf8",
          )
        : Buffer.from(await this.pdf(labels, setting.widthMm, setting.heightMm, setting.layout));
    await this.uow.run(async (tx) => {
      await tx.insert(labelPrints).values(
        labels.map((l) => ({
          rollId: l.id,
          reprint: dto.reprint,
          reason,
          format: setting.output === "ZPL" ? "ZPL" : `PDF-${setting.layout}`,
          createdBy: actor().userId,
        })),
      );
    });
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
    return setting.output === "ZPL"
      ? { body, contentType: "text/plain; charset=utf-8", fileName: `roll-labels-${stamp}.zpl` }
      : { body, contentType: "application/pdf", fileName: `roll-labels-${stamp}.pdf` };
  }

  private async load(dto: LabelRequestDto): Promise<LabelData[]> {
    const filters = [eq(rolls.companyId, actor().companyId)];
    if (dto.grnId) filters.push(eq(rolls.grnId, dto.grnId));
    if (dto.rollIds.length) filters.push(inArray(rolls.id, dto.rollIds));
    const rows = await this.uow.db
      .select({
        roll: rolls,
        batchSeq: batches.batchSeq,
        ref: batches.supplierBatchRef,
        grnDate: goodsReceipts.date,
      })
      .from(rolls)
      .innerJoin(batches, eq(batches.id, rolls.batchId))
      .innerJoin(goodsReceipts, eq(goodsReceipts.id, rolls.grnId))
      .where(and(...filters))
      .orderBy(asc(rolls.barcode));
    if (rows.length === 0) throw notFound("Rolls");
    if (dto.rollIds.length && rows.length !== new Set(dto.rollIds).size) throw notFound("Roll");
    if (rows.length > MAX_LABELS)
      throw validationError(`Print at most ${MAX_LABELS} labels at a time.`);
    return rows.map(({ roll, batchSeq, ref, grnDate }) => ({
      id: roll.id,
      barcode: roll.barcode,
      description: roll.description,
      gsm: roll.gsm,
      widthIn: trimDecimal(roll.widthIn),
      lengthM: roll.currentLengthM,
      lot: `${String(batchSeq).padStart(4, "0")}${ref ? ` (${ref})` : ""}`,
      received: grnDate.split("-").reverse().join("-"),
    }));
  }

  private async pdf(labels: LabelData[], wMm: number, hMm: number, layout: "SINGLE" | "A4_2x5") {
    const doc = await PDFDocument.create();
    doc.setTitle("Roll labels");
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const perSheet = layout === "A4_2x5" ? 10 : 1;
    if (layout === "A4_2x5" && (wMm * 2 > A4.w || hMm * 5 > A4.h)) {
      throw validationError(
        `A ${wMm} × ${hMm} mm label does not fit 2 × 5 on A4; choose one per page.`,
      );
    }
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
    }
    return doc.save();
  }
}

/** Standard PDF fonts are WinAnsi: map the inch mark and drop anything they can't encode. */
function pdfSafe(s: string): string {
  return s
    .replace(/[″”“]/g, '"')
    .replace(/[’‘]/g, "'")
    .replace(/[^ -~�-�•·–—…]/g, "?");
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
  const raw = lines(label);
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
  let y = origin.y + h - pad - 9;
  page.drawText(fit(label.barcode, bold, 10), { x: origin.x + pad, y, size: 10, font: bold });
  y -= 13;
  page.drawText(fit(text.title, font, 8), { x: origin.x + pad, y, size: 8, font });
  y -= 11;
  page.drawText(fit(text.spec, bold, 9), { x: origin.x + pad, y, size: 9, font: bold });
  y -= 11;
  page.drawText(fit(text.lot, font, 7), {
    x: origin.x + pad,
    y,
    size: 7,
    font,
    color: rgb(0.25, 0.25, 0.25),
  });
  const barH = Math.max(8 * MM, y - origin.y - pad - 2);
  page.drawImage(barImg, {
    x: origin.x + pad,
    y: origin.y + pad,
    width: textW,
    height: Math.min(barH, 14 * MM),
  });
}

/** ZPL II for 203 dpi thermal printers (8 dots/mm). */
function zpl(l: LabelData, wMm: number, hMm: number): string {
  const dots = (mm: number) => Math.round(mm * 8);
  const t = lines(l);
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
