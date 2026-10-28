import { DOCUMENT_CSS, escapeHtml as esc, printDate } from "./sales-document.js";

/**
 * Account documents (Stage 4): customer / supplier statements, receipt and payment advices,
 * commission payout advices. One A4 layout: company header, the party, reference rows, a table,
 * a totals box and optional aging. Values arrive formatted (the API uses `inr`).
 */
export interface AccountDocument {
  /** "Statement of account", "Payment receipt", "Commission payout"… */
  title: string;
  number: string | null;
  /** ISO date printed under the number. */
  date: string;
  /** e.g. "Reversed (cheque bounced)" — printed across the page. */
  watermark?: string | null;
  seller: {
    name: string;
    gstin: string | null;
    address: string[];
    phone?: string | null;
    email?: string | null;
  };
  party: { label: string; name: string; gstin?: string | null; address?: string[] };
  meta: [label: string, value: string][];
  columns: { key: string; label: string; numeric?: boolean }[];
  rows: Record<string, string>[];
  /** Totals box; the last row is printed bold. */
  summary: [label: string, value: string][];
  aging?: { label: string; amount: string }[] | null;
  notes?: string[];
  signatory?: string | null;
}

const EXTRA_CSS = `
  .account th { text-align: left; } .account th.r { text-align: right; }
  .account td { white-space: nowrap; }
  .sums .totals { width: 95mm; } .sums .totals td { white-space: nowrap; }
  .account td.wrap { white-space: normal; }
  .aging { display: flex; gap: 6px; margin-top: 10px; page-break-inside: avoid; }
  .aging div { flex: 1; border: 1px solid #E4E7EC; border-radius: 6px; padding: 4px 6px; }
  .aging span { display: block; font-size: 7pt; color: #475467; text-transform: uppercase; letter-spacing: .04em; }
  .aging b { font-variant-numeric: tabular-nums; }
  .empty { padding: 10px 4px; color: #667085; }
`;

export function renderAccountDocumentHtml(d: AccountDocument): string {
  const s = d.seller;
  const head = d.columns
    .map((c) => `<th class="${c.numeric ? "r" : ""}">${esc(c.label)}</th>`)
    .join("");
  const body = d.rows.length
    ? d.rows
        .map(
          (r) =>
            `<tr>${d.columns
              .map((c) => `<td class="${c.numeric ? "r" : "wrap"}">${esc(r[c.key] ?? "")}</td>`)
              .join("")}</tr>`,
        )
        .join("")
    : `<tr><td class="empty" colspan="${d.columns.length}">Nothing in this period.</td></tr>`;
  const summary = d.summary
    .map(
      ([k, v], i) =>
        `<tr class="${i === d.summary.length - 1 ? "grand" : ""}"><th>${esc(k)}</th><td>${esc(v)}</td></tr>`,
    )
    .join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(d.title)} ${esc(d.number ?? "")}</title>
<style>${DOCUMENT_CSS}${EXTRA_CSS}</style></head>
<body><article class="page">
  ${d.watermark ? `<div class="watermark">${esc(d.watermark)}</div>` : ""}
  <header>
    <div>
      <h1>${esc(s.name)}</h1>
      ${s.address.map((a) => `<p>${esc(a)}</p>`).join("")}
      ${s.gstin ? `<p>GSTIN <span class="mono">${esc(s.gstin)}</span></p>` : ""}
      ${s.phone || s.email ? `<p>${[s.phone, s.email].filter(Boolean).map(esc).join(" · ")}</p>` : ""}
    </div>
    <div class="doc">
      <h2>${esc(d.title)}</h2>
      <table class="kv">
        ${d.number ? `<tr><th>No.</th><td class="mono">${esc(d.number)}</td></tr>` : ""}
        <tr><th>Date</th><td>${printDate(d.date)}</td></tr>
      </table>
    </div>
  </header>
  <div class="parties">
    <section class="party">
      <h3>${esc(d.party.label)}</h3>
      <p class="name">${esc(d.party.name)}</p>
      ${(d.party.address ?? []).map((a) => `<p>${esc(a)}</p>`).join("")}
      ${d.party.gstin ? `<p>GSTIN: <span class="mono">${esc(d.party.gstin)}</span></p>` : ""}
    </section>
    ${
      d.meta.length
        ? `<section class="party"><h3>Details</h3><table class="kv">${d.meta
            .map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`)
            .join("")}</table></section>`
        : ""
    }
  </div>
  <table class="lines account"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
  <div class="sums"><div></div><table class="totals">${summary}</table></div>
  ${
    d.aging?.length
      ? `<div class="aging">${d.aging
          .map((a) => `<div><span>${esc(a.label)}</span><b>${esc(a.amount)}</b></div>`)
          .join("")}</div>`
      : ""
  }
  ${d.notes?.length ? `<section class="remarks">${d.notes.map((n) => `<p>${esc(n)}</p>`).join("")}</section>` : ""}
  <footer>
    <div></div>
    <div class="sign">
      <p>For ${esc(s.name)}</p>
      <p class="line">${esc(d.signatory ?? "Authorised signatory")}</p>
    </div>
  </footer>
</article></body></html>`;
}

/** "statement-CUST-0001-2026-10-28.pdf"-style names: letters, digits and dashes only. */
export function accountFileName(...parts: (string | null | undefined)[]): string {
  return `${parts
    .filter(Boolean)
    .join("-")
    .replace(/[^A-Za-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")}.pdf`;
}
