import bwipjs from "bwip-js";
import { inr, rupeesInWords } from "./words.js";

/**
 * Printable sales documents (Q30: the information and order of the owner's current bill R/649,
 * in a cleaner layout). Pure: data in, a self-contained A4 HTML page out. The API builds the
 * data; the worker turns the HTML into a PDF with headless Chromium (`./pdf`).
 */

export type SalesDocumentKind =
  "TAX_INVOICE" | "CREDIT_NOTE" | "DEBIT_NOTE" | "DELIVERY_CHALLAN" | "PROFORMA";

export interface DocParty {
  name: string;
  gstin: string | null;
  /** Address lines, already formatted. */
  address: string[];
  /** "Gujarat (24)". */
  state: string | null;
  phone?: string | null;
  email?: string | null;
}

export interface DocLine {
  description: string;
  /** Roll barcodes and lengths, printed small under the line (Settings → invoice.pdf). */
  detail?: string | null;
  hsn: string;
  /** "1,000 m", "1". */
  quantity: string;
  rate: string | null;
  discount: string | null;
  taxable: string | null;
  gstRate: string | null;
}

export interface DocTaxRow {
  gstRate: string;
  taxable: string;
  cgst: string;
  sgst: string;
  igst: string;
}

export interface SalesDocument {
  kind: SalesDocumentKind;
  number: string | null;
  date: string;
  /**
   * DRAFT: not yet posted; PROVISIONAL: posted, IRN pending (ADR-0011); CANCELLED. Null prints
   * clean.
   */
  watermark: "DRAFT" | "PROVISIONAL" | "CANCELLED" | null;
  seller: DocParty & {
    tradeName?: string | null;
    pan?: string | null;
    bank?: {
      bankName: string;
      accountName: string;
      accountNumber: string;
      ifsc: string;
      branch?: string | null;
    } | null;
    signatoryName?: string | null;
  };
  billTo: DocParty;
  shipTo?: DocParty | null;
  placeOfSupply: string | null;
  /** Reference rows printed beside the parties: order, challans, transport, e-way bill… */
  meta: [label: string, value: string][];
  einvoice?: { irn: string; ackNo: string; ackDate: string; qr: string | null } | null;
  /** False for a challan: quantities only. */
  priced: boolean;
  lines: DocLine[];
  taxes: DocTaxRow[];
  regime: "CGST_SGST" | "IGST";
  totals: {
    taxable: string;
    cgst: string;
    sgst: string;
    igst: string;
    roundOff: string;
    total: string;
  } | null;
  /** Reverse charge, zero-rated supply under LUT, reason for a note… */
  remarks: string[];
  terms: string[];
  copies: string[];
}

const TITLES: Record<SalesDocumentKind, string> = {
  TAX_INVOICE: "Tax Invoice",
  CREDIT_NOTE: "Credit Note",
  DEBIT_NOTE: "Debit Note",
  DELIVERY_CHALLAN: "Delivery Challan",
  PROFORMA: "Proforma Invoice",
};

const esc = (s: string | null | undefined) =>
  (s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const ddmmyyyy = (iso: string) => iso.slice(0, 10).split("-").reverse().join("-");

/** QR as inline SVG; the e-invoice QR is the IRP's signed JWT, printed as-is (ADR-0011). */
export function qrSvg(text: string): string {
  return bwipjs.toSVG({ bcid: "qrcode", text, scale: 2 });
}

const party = (title: string, p: DocParty) => `
  <section class="party">
    <h3>${title}</h3>
    <p class="name">${esc(p.name)}</p>
    ${p.address.map((a) => `<p>${esc(a)}</p>`).join("")}
    ${p.state ? `<p>State: ${esc(p.state)}</p>` : ""}
    ${p.gstin ? `<p>GSTIN: <span class="mono">${esc(p.gstin)}</span></p>` : "<p>Unregistered</p>"}
  </section>`;

function page(d: SalesDocument, copy: string): string {
  const s = d.seller;
  const igst = d.regime === "IGST";
  const money = (v: string | null) => (v === null ? "" : inr(v));
  const lines = d.lines
    .map(
      (l, i) => `
      <tr>
        <td class="c">${i + 1}</td>
        <td>${esc(l.description)}${l.detail ? `<div class="detail">${esc(l.detail)}</div>` : ""}</td>
        <td class="c mono">${esc(l.hsn)}</td>
        <td class="r">${esc(l.quantity)}</td>
        ${
          d.priced
            ? `<td class="r">${l.rate === null ? "" : esc(l.rate)}</td>
               <td class="r">${money(l.discount)}</td>
               <td class="r">${l.gstRate === null ? "" : `${esc(l.gstRate)}%`}</td>
               <td class="r">${money(l.taxable)}</td>`
            : ""
        }
      </tr>`,
    )
    .join("");
  const taxRows = d.taxes
    .map(
      (t) =>
        `<tr><td class="r">${esc(t.gstRate)}%</td><td class="r">${inr(t.taxable)}</td>${
          igst
            ? `<td class="r">${inr(t.igst)}</td>`
            : `<td class="r">${inr(t.cgst)}</td><td class="r">${inr(t.sgst)}</td>`
        }</tr>`,
    )
    .join("");
  const t = d.totals;
  return `
  <article class="page">
    ${d.watermark ? `<div class="watermark">${d.watermark === "PROVISIONAL" ? "Provisional — IRN pending" : d.watermark === "DRAFT" ? "Draft" : "Cancelled"}</div>` : ""}
    <header>
      <div>
        <h1>${esc(s.tradeName || s.name)}</h1>
        ${s.tradeName && s.tradeName !== s.name ? `<p>${esc(s.name)}</p>` : ""}
        ${s.address.map((a) => `<p>${esc(a)}</p>`).join("")}
        <p>${s.gstin ? `GSTIN <span class="mono">${esc(s.gstin)}</span>` : ""}${s.pan ? ` · PAN <span class="mono">${esc(s.pan)}</span>` : ""}</p>
        ${s.phone || s.email ? `<p>${[s.phone, s.email].filter(Boolean).map(esc).join(" · ")}</p>` : ""}
      </div>
      <div class="doc">
        <p class="copy">${esc(copy)}</p>
        <h2>${TITLES[d.kind]}</h2>
        <table class="kv">
          <tr><th>No.</th><td class="mono">${esc(d.number ?? "—")}</td></tr>
          <tr><th>Date</th><td>${ddmmyyyy(d.date)}</td></tr>
          ${d.placeOfSupply ? `<tr><th>Place of supply</th><td>${esc(d.placeOfSupply)}</td></tr>` : ""}
        </table>
      </div>
    </header>
    ${
      d.einvoice
        ? `<section class="irn">
            <div>
              <p><b>IRN</b> <span class="mono">${esc(d.einvoice.irn)}</span></p>
              <p><b>Ack No.</b> <span class="mono">${esc(d.einvoice.ackNo)}</span> · <b>Ack Date</b> ${esc(d.einvoice.ackDate)}</p>
            </div>
            ${d.einvoice.qr ? `<div class="qr">${qrSvg(d.einvoice.qr)}</div>` : ""}
          </section>`
        : ""
    }
    <div class="parties">
      ${party("Bill to", d.billTo)}
      ${d.shipTo ? party("Ship to", d.shipTo) : ""}
      ${
        d.meta.length
          ? `<section class="party"><h3>Details</h3><table class="kv">${d.meta
              .map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`)
              .join("")}</table></section>`
          : ""
      }
    </div>
    <table class="lines">
      <thead><tr>
        <th class="c">#</th><th>Description</th><th class="c">HSN</th><th class="r">Qty</th>
        ${d.priced ? `<th class="r">Rate</th><th class="r">Discount</th><th class="r">GST</th><th class="r">Taxable ₹</th>` : ""}
      </tr></thead>
      <tbody>${lines}</tbody>
    </table>
    ${
      t
        ? `<div class="sums">
            ${
              d.taxes.length
                ? `<table class="tax">
              <thead><tr><th class="r">GST</th><th class="r">Taxable ₹</th>${igst ? `<th class="r">IGST ₹</th>` : `<th class="r">CGST ₹</th><th class="r">SGST ₹</th>`}</tr></thead>
              <tbody>${taxRows}</tbody>
            </table>`
                : "<div></div>"
            }
            <table class="totals">
              <tr><th>Taxable value</th><td>${inr(t.taxable)}</td></tr>
              ${igst ? `<tr><th>IGST</th><td>${inr(t.igst)}</td></tr>` : `<tr><th>CGST</th><td>${inr(t.cgst)}</td></tr><tr><th>SGST</th><td>${inr(t.sgst)}</td></tr>`}
              ${t.roundOff !== "0.00" ? `<tr><th>Round off</th><td>${inr(t.roundOff)}</td></tr>` : ""}
              <tr class="grand"><th>Total ₹</th><td>${inr(t.total)}</td></tr>
            </table>
          </div>
          <p class="words">${esc(rupeesInWords(t.total))}</p>`
        : ""
    }
    ${d.remarks.length ? `<section class="remarks">${d.remarks.map((r) => `<p>${esc(r)}</p>`).join("")}</section>` : ""}
    <footer>
      <div>
        ${
          s.bank
            ? `<h3>Bank details</h3><p>${esc(s.bank.accountName)}</p><p>${esc(s.bank.bankName)}${s.bank.branch ? `, ${esc(s.bank.branch)}` : ""}</p><p>A/c <span class="mono">${esc(s.bank.accountNumber)}</span> · IFSC <span class="mono">${esc(s.bank.ifsc)}</span></p>`
            : ""
        }
        ${d.terms.length ? `<h3>Terms</h3><ol>${d.terms.map((x) => `<li>${esc(x)}</li>`).join("")}</ol>` : ""}
      </div>
      <div class="sign">
        <p>For ${esc(s.tradeName || s.name)}</p>
        <p class="line">${esc(s.signatoryName ?? "Authorised signatory")}</p>
      </div>
    </footer>
  </article>`;
}

const CSS = `
  @page { size: A4; margin: 10mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 9pt/1.35 "Inter", "Segoe UI", Arial, sans-serif; color: #101828; }
  .page { position: relative; page-break-after: always; }
  .page:last-child { page-break-after: auto; }
  .mono { font-family: "JetBrains Mono", Consolas, monospace; font-size: 8.5pt; }
  p { margin: 0; }
  h1 { font-size: 15pt; margin: 0 0 2px; color: #1F4FD8; }
  h2 { font-size: 13pt; margin: 2px 0 6px; text-align: right; }
  h3 { font-size: 7.5pt; text-transform: uppercase; letter-spacing: .05em; color: #475467; margin: 0 0 3px; }
  header { display: flex; justify-content: space-between; gap: 16px; padding-bottom: 8px; border-bottom: 2px solid #1F4FD8; }
  .doc { min-width: 62mm; }
  .copy { text-align: right; font-size: 7.5pt; color: #475467; }
  table { border-collapse: collapse; width: 100%; }
  .kv th { text-align: left; font-weight: 500; color: #475467; padding: 1px 8px 1px 0; white-space: nowrap; vertical-align: top; }
  .kv td { padding: 1px 0; }
  .irn { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-top: 8px; padding: 6px 8px; border: 1px solid #D0D5DD; border-radius: 6px; }
  .irn .mono { word-break: break-all; }
  .qr svg { width: 30mm; height: 30mm; }
  .parties { display: flex; gap: 8px; margin: 8px 0; }
  .party { flex: 1; padding: 6px 8px; border: 1px solid #E4E7EC; border-radius: 6px; }
  .party .name { font-weight: 600; }
  .lines th { background: #F2F4F7; font-size: 7.5pt; text-transform: uppercase; letter-spacing: .03em; color: #475467; padding: 4px; border-bottom: 1px solid #D0D5DD; }
  .lines td { padding: 4px; border-bottom: 1px solid #E4E7EC; vertical-align: top; }
  .lines tr { page-break-inside: avoid; }
  .detail { font-size: 7pt; color: #667085; margin-top: 1px; }
  .c { text-align: center; } .r { text-align: right; font-variant-numeric: tabular-nums; }
  .sums { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-top: 8px; page-break-inside: avoid; }
  .tax { width: auto; } .tax th, .tax td { padding: 2px 8px; border-bottom: 1px solid #E4E7EC; font-size: 8pt; }
  .tax th { color: #475467; font-weight: 500; }
  .totals { width: 70mm; } .totals th { text-align: left; font-weight: 500; color: #475467; padding: 2px 0; }
  .totals td { text-align: right; font-variant-numeric: tabular-nums; padding: 2px 0; }
  .totals .grand th, .totals .grand td { font-size: 11pt; font-weight: 700; color: #101828; border-top: 1px solid #101828; padding-top: 4px; }
  .words { margin-top: 6px; font-weight: 500; }
  .remarks { margin-top: 6px; font-size: 8pt; }
  footer { display: flex; justify-content: space-between; gap: 16px; margin-top: 12px; padding-top: 8px; border-top: 1px solid #E4E7EC; page-break-inside: avoid; }
  footer ol { margin: 0; padding-left: 14px; font-size: 7.5pt; color: #475467; }
  .sign { text-align: right; min-width: 55mm; display: flex; flex-direction: column; justify-content: space-between; }
  .sign .line { margin-top: 28px; border-top: 1px solid #101828; padding-top: 2px; }
  .watermark { position: absolute; top: 40%; left: 0; right: 0; text-align: center; transform: rotate(-24deg); font-size: 38pt; font-weight: 700; color: rgba(180, 35, 24, .14); pointer-events: none; }
`;

/** One A4 HTML document with a page per copy (Original / Duplicate / Triplicate). */
export function renderSalesDocumentHtml(d: SalesDocument): string {
  const copies = d.copies.length ? d.copies : [""];
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(TITLES[d.kind])} ${esc(d.number ?? "")}</title>
<style>${CSS}</style></head>
<body>${copies.map((c) => page(d, c)).join("")}</body></html>`;
}

export function documentFileName(d: Pick<SalesDocument, "kind" | "number" | "watermark">): string {
  const base = (d.number ?? "draft").replace(/[^A-Za-z0-9-]+/g, "-");
  const prefix = {
    TAX_INVOICE: "invoice",
    CREDIT_NOTE: "credit-note",
    DEBIT_NOTE: "debit-note",
    DELIVERY_CHALLAN: "challan",
    PROFORMA: "proforma",
  }[d.kind];
  return `${prefix}-${base}${d.watermark === "PROVISIONAL" ? "-provisional" : ""}.pdf`;
}
