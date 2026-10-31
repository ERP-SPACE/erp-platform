import { parseRollBarcode } from "./barcode.js";
import { D, type Dec, type DecimalLike, allocateLargestRemainder, sum } from "./money.js";

/**
 * Opening Balance Wizard (PRD §5.10, Stage 6): pure CSV parsing, row validation, opening
 * stock → rolls, totals against the books, and the Go-Live lock rules. No I/O — the API looks
 * up SKUs, suppliers and customers and hands them in as plain maps.
 */

// ── CSV ──────────────────────────────────────────────────────────────────────

export interface CsvTable {
  /** Normalised headers: lower case, spaces/dashes → underscore. */
  headers: string[];
  /** One record per data row, keyed by normalised header; `line` is the 1-based file line. */
  rows: { line: number; values: Record<string, string> }[];
}

export class CsvError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(message);
    this.name = "CsvError";
  }
}

export const normaliseHeader = (h: string) =>
  h
    .trim()
    .toLowerCase()
    .replace(/[\s\-./]+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/^_+|_+$/g, "");

/**
 * RFC 4180 CSV (as Excel and Tally save it): commas, double-quoted fields with "" escapes and
 * embedded newlines, CRLF or LF, an optional UTF-8 BOM. Blank lines are skipped; cells trimmed.
 */
export function parseCsv(text: string): CsvTable {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records: { line: number; cells: string[] }[] = [];
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  let line = 1;
  let startLine = 1;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else {
        if (c === "\n") line++;
        cell += c;
      }
      continue;
    }
    if (c === '"' && cell.trim() === "") {
      cell = "";
      quoted = true;
    } else if (c === ",") {
      cells.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      cells.push(cell);
      records.push({ line: startLine, cells });
      cells = [];
      cell = "";
      line++;
      startLine = line;
    } else cell += c;
  }
  if (quoted) throw new CsvError("A quoted value is never closed", startLine);
  if (cell !== "" || cells.length) {
    cells.push(cell);
    records.push({ line: startLine, cells });
  }
  const nonBlank = records.filter((r) => r.cells.some((x) => x.trim() !== ""));
  if (!nonBlank.length) throw new CsvError("The file is empty", 1);
  const [head, ...body] = nonBlank;
  const headers = head!.cells.map(normaliseHeader);
  const dup = headers.find((h, i) => h && headers.indexOf(h) !== i);
  if (dup) throw new CsvError(`Column "${dup}" appears twice`, head!.line);
  return {
    headers,
    rows: body.map((r) => {
      if (r.cells.length > headers.length && r.cells.slice(headers.length).some((x) => x.trim())) {
        throw new CsvError(
          `Row has ${r.cells.length} values but the header has ${headers.length}`,
          r.line,
        );
      }
      return {
        line: r.line,
        values: Object.fromEntries(headers.map((h, i) => [h, (r.cells[i] ?? "").trim()])),
      };
    }),
  };
}

/** Headers a file must have (any of the aliases). Returns the missing ones' first names. */
export function missingColumns(
  headers: readonly string[],
  required: readonly (readonly string[])[],
): string[] {
  return required.filter((aliases) => !aliases.some((a) => headers.includes(a))).map((a) => a[0]!);
}

/** First non-empty value among a header's aliases. */
export const pick = (values: Record<string, string>, aliases: readonly string[]) =>
  aliases.map((a) => values[a]).find((v) => v !== undefined && v !== "") ?? "";

// ── values ───────────────────────────────────────────────────────────────────

/** "1,23,456.50", "₹ 1,234", "1234" → decimal; null when not a number or more than 2 decimals. */
export function parseAmount(raw: string): Dec | null {
  const t = raw.replace(/[₹,\s]/g, "").replace(/^Rs\.?/i, "");
  if (!/^-?\d+(\.\d{1,2})?$/.test(t)) return null;
  return D(t);
}

/** "2026-03-31", "31-03-2026", "31/03/2026", "31.03.2026" (Indian day-first) → ISO date; null if invalid. */
export function parseDate(raw: string): string | null {
  const t = raw.trim();
  let y: number;
  let m: number;
  let d: number;
  let iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else {
    iso = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(t);
    if (!iso) return null;
    [d, m, y] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

/** Name matching that ignores case, punctuation, "M/s" and Pvt/Private/Ltd/Limited spellings. */
export function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/^m\/s\.?\s*/, "")
    .replace(/\bprivate\b/g, "pvt")
    .replace(/\blimited\b/g, "ltd")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// ── row checks ───────────────────────────────────────────────────────────────

export interface Issue {
  line: number;
  column?: string;
  message: string;
}

export interface Checked<T> {
  rows: (T & { line: number })[];
  errors: Issue[];
  warnings: Issue[];
}

/** A party the API knows, for matching a CSV row (code, GSTIN or name). */
export interface KnownParty {
  id: string;
  code: string;
  name: string;
  gstin?: string | null;
}

/** Resolves a party by code, then GSTIN, then exact normalised name. Ambiguous names don't match. */
export function partyMatcher(parties: readonly KnownParty[]) {
  const byCode = new Map(parties.map((p) => [p.code.toUpperCase(), p]));
  const byGstin = new Map(parties.filter((p) => p.gstin).map((p) => [p.gstin!.toUpperCase(), p]));
  const byName = new Map<string, KnownParty[]>();
  for (const p of parties) {
    const k = normaliseName(p.name);
    byName.set(k, [...(byName.get(k) ?? []), p]);
  }
  return (raw: string): { party: KnownParty } | { ambiguous: true } | null => {
    const t = raw.trim();
    if (!t) return null;
    const hit = byCode.get(t.toUpperCase()) ?? byGstin.get(t.toUpperCase());
    if (hit) return { party: hit };
    const named = byName.get(normaliseName(t)) ?? [];
    if (named.length === 1) return { party: named[0]! };
    return named.length > 1 ? { ambiguous: true } : null;
  };
}

export const LEDGER_COLUMNS = {
  party: ["party", "customer", "supplier", "name", "party_name", "code"],
  invoiceNo: ["invoice_no", "invoice", "bill_no", "ref", "reference", "voucher_no"],
  date: ["date", "invoice_date", "bill_date"],
  amount: ["amount", "outstanding", "balance", "pending_amount"],
  dueDate: ["due_date", "due"],
} as const;

export interface OpeningInvoiceRow {
  partyId: string;
  partyName: string;
  invoiceNo: string;
  date: string;
  dueDate: string | null;
  amount: string;
}

/**
 * Opening AR / AP rows: a known party (unrecognised ones are errors — PRD §5.10 "flagged before
 * import"), an invoice number unique per party in the file and not already used, a date before
 * the go-live date, a positive amount, a due date not before the invoice date.
 */
export function checkOpeningInvoices(
  table: CsvTable,
  ctx: {
    parties: readonly KnownParty[];
    goLiveDate: string;
    /** "partyId|invoiceNo" already in the books. */
    existing?: ReadonlySet<string>;
    partyLabel: "customer" | "supplier";
  },
): Checked<OpeningInvoiceRow> {
  const out: Checked<OpeningInvoiceRow> = { rows: [], errors: [], warnings: [] };
  const missing = missingColumns(table.headers, [
    LEDGER_COLUMNS.party,
    LEDGER_COLUMNS.invoiceNo,
    LEDGER_COLUMNS.date,
    LEDGER_COLUMNS.amount,
  ]);
  if (missing.length) {
    out.errors.push({
      line: 1,
      message: `Missing column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`,
    });
    return out;
  }
  const match = partyMatcher(ctx.parties);
  const seen = new Set<string>();
  for (const { line, values } of table.rows) {
    const err = (column: string, message: string) => out.errors.push({ line, column, message });
    const rawParty = pick(values, LEDGER_COLUMNS.party);
    const m = match(rawParty);
    const invoiceNo = pick(values, LEDGER_COLUMNS.invoiceNo);
    const date = parseDate(pick(values, LEDGER_COLUMNS.date));
    const amount = parseAmount(pick(values, LEDGER_COLUMNS.amount));
    const rawDue = pick(values, LEDGER_COLUMNS.dueDate);
    const due = rawDue ? parseDate(rawDue) : null;
    const before = out.errors.length;
    if (!m)
      err("party", `Unknown ${ctx.partyLabel} "${rawParty}" — add them first or use their code`);
    else if ("ambiguous" in m)
      err("party", `More than one ${ctx.partyLabel} is called "${rawParty}" — use the code`);
    if (!invoiceNo) err("invoice_no", "Invoice number is missing");
    if (!date)
      err(
        "date",
        `"${pick(values, LEDGER_COLUMNS.date)}" is not a date (use YYYY-MM-DD or DD-MM-YYYY)`,
      );
    else if (date >= ctx.goLiveDate)
      err("date", `Opening invoices must be dated before the go-live date ${ctx.goLiveDate}`);
    if (!amount) err("amount", `"${pick(values, LEDGER_COLUMNS.amount)}" is not an amount`);
    else if (!amount.greaterThan(0))
      err("amount", "Amount must be above zero (enter advances as receipts after go-live)");
    if (rawDue && !due) err("due_date", `"${rawDue}" is not a date`);
    else if (due && date && due < date) err("due_date", "Due date is before the invoice date");
    if (m && "party" in m && invoiceNo) {
      const key = `${m.party.id}|${invoiceNo.toUpperCase()}`;
      if (seen.has(key))
        err("invoice_no", `Invoice ${invoiceNo} for ${m.party.name} appears twice in the file`);
      else if (ctx.existing?.has(key))
        err("invoice_no", `Invoice ${invoiceNo} for ${m.party.name} is already imported`);
      seen.add(key);
    }
    if (out.errors.length > before || !m || !("party" in m)) continue;
    if (!rawDue)
      out.warnings.push({
        line,
        column: "due_date",
        message: "No due date — the party's credit days will be used",
      });
    out.rows.push({
      line,
      partyId: m.party.id,
      partyName: m.party.name,
      invoiceNo,
      date: date!,
      dueDate: due,
      amount: amount!.toFixed(2),
    });
  }
  return out;
}

export const STOCK_COLUMNS = {
  barcode: ["barcode", "roll_barcode", "roll_no"],
  supplier: ["supplier", "supplier_code", "vendor"],
  sku: ["sku", "sku_code", "item_code"],
  gsm: ["gsm"],
  quality: ["quality"],
  width: ["width", "width_in", "width_inch"],
  metres: ["metres", "meters", "length", "length_m", "qty_m"],
  costPerM: ["cost_per_m", "landed_cost_per_m", "rate", "rate_per_m", "cost"],
  receivedDate: ["received_date", "date", "grn_date"],
  batchRef: ["batch", "batch_ref", "lot"],
  rolls: ["rolls", "roll_count", "qty_rolls"],
  value: ["value", "stock_value", "amount"],
} as const;

export interface KnownSku {
  id: string;
  code: string;
  gsm: number;
  quality: string;
  widthIn: string;
}

export interface OpeningRollRow {
  barcode: string | null;
  supplierId: string;
  skuId: string;
  metres: number;
  costPerM: string;
  value: string;
  receivedDate: string;
  batchRef: string | null;
}

function skuFinder(skus: readonly KnownSku[]) {
  const byCode = new Map(skus.map((s) => [s.code.toUpperCase(), s]));
  const byParts = new Map(
    skus.map((s) => [`${s.gsm}|${normaliseName(s.quality)}|${D(s.widthIn).toString()}`, s]),
  );
  return (values: Record<string, string>) => {
    const code = pick(values, STOCK_COLUMNS.sku);
    if (code) return byCode.get(code.toUpperCase()) ?? null;
    const gsm = pick(values, STOCK_COLUMNS.gsm);
    const width = pick(values, STOCK_COLUMNS.width).replace(/["″in\s]+$/i, "");
    const quality = pick(values, STOCK_COLUMNS.quality);
    if (!gsm || !width || !quality || Number.isNaN(Number(width))) return null;
    return byParts.get(`${Number(gsm)}|${normaliseName(quality)}|${D(width).toString()}`) ?? null;
  };
}

/**
 * Roll-by-roll opening stock: known supplier and SKU (by code, or GSM + quality + width), whole
 * metres above zero, a landed cost per metre, a receipt date before go-live; an old barcode is
 * kept only if it is a valid roll barcode not used elsewhere (otherwise a new one is issued).
 */
export function checkOpeningRolls(
  table: CsvTable,
  ctx: {
    skus: readonly KnownSku[];
    suppliers: readonly KnownParty[];
    goLiveDate: string;
    existingBarcodes?: ReadonlySet<string>;
  },
): Checked<OpeningRollRow> {
  const out: Checked<OpeningRollRow> = { rows: [], errors: [], warnings: [] };
  const missing = missingColumns(table.headers, [
    STOCK_COLUMNS.supplier,
    STOCK_COLUMNS.metres,
    STOCK_COLUMNS.costPerM,
  ]);
  if (
    !table.headers.some((h) => (STOCK_COLUMNS.sku as readonly string[]).includes(h)) &&
    missingColumns(table.headers, [STOCK_COLUMNS.gsm, STOCK_COLUMNS.quality, STOCK_COLUMNS.width])
      .length
  ) {
    missing.push("sku (or gsm, quality and width)");
  }
  if (missing.length) {
    out.errors.push({
      line: 1,
      message: `Missing column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`,
    });
    return out;
  }
  const supplier = partyMatcher(ctx.suppliers);
  const sku = skuFinder(ctx.skus);
  const seen = new Set<string>();
  for (const { line, values } of table.rows) {
    const err = (column: string, message: string) => out.errors.push({ line, column, message });
    const before = out.errors.length;
    const sup = supplier(pick(values, STOCK_COLUMNS.supplier));
    if (!sup || "ambiguous" in sup)
      err("supplier", `Unknown supplier "${pick(values, STOCK_COLUMNS.supplier)}"`);
    const s = sku(values);
    if (!s) err("sku", "No catalogue SKU matches this item — add it to the catalogue first");
    const rawM = pick(values, STOCK_COLUMNS.metres);
    const metres = /^\d+$/.test(rawM.replace(/,/g, "")) ? Number(rawM.replace(/,/g, "")) : NaN;
    if (!(metres > 0)) err("metres", `"${rawM}" is not a whole number of metres above zero`);
    // ₹ per metre keeps 4 decimals (ADR-0013).
    const rawCost = pick(values, STOCK_COLUMNS.costPerM).replace(/[₹,\s]/g, "");
    const costPerM = /^\d+(\.\d{1,4})?$/.test(rawCost) ? D(rawCost) : null;
    if (!costPerM || !costPerM.greaterThan(0))
      err("cost_per_m", `"${pick(values, STOCK_COLUMNS.costPerM)}" is not a cost per metre`);
    const rawDate = pick(values, STOCK_COLUMNS.receivedDate);
    const received = rawDate ? parseDate(rawDate) : null;
    if (rawDate && !received) err("received_date", `"${rawDate}" is not a date`);
    else if (received && received >= ctx.goLiveDate)
      err("received_date", `Must be before the go-live date ${ctx.goLiveDate}`);
    let barcode: string | null = pick(values, STOCK_COLUMNS.barcode).toUpperCase() || null;
    if (barcode) {
      if (seen.has(barcode)) err("barcode", `Barcode ${barcode} appears twice in the file`);
      else if (ctx.existingBarcodes?.has(barcode)) {
        out.warnings.push({
          line,
          column: "barcode",
          message: `Barcode ${barcode} is already in use — a new one will be printed`,
        });
        barcode = null;
      } else if (!parseRollBarcode(barcode).valid) {
        out.warnings.push({
          line,
          column: "barcode",
          message: `${barcode} is not a valid roll barcode — a new one will be printed`,
        });
        barcode = null;
      }
      if (barcode) seen.add(barcode);
    }
    if (out.errors.length > before) continue;
    if (!received)
      out.warnings.push({
        line,
        column: "received_date",
        message: "No received date — the day before go-live is used, so aging starts there",
      });
    out.rows.push({
      line,
      barcode,
      supplierId: (sup as { party: KnownParty }).party.id,
      skuId: s!.id,
      metres,
      costPerM: costPerM!.toFixed(4),
      value: costPerM!.times(metres).toDecimalPlaces(2).toFixed(2),
      receivedDate: received ?? dayBefore(ctx.goLiveDate),
      batchRef: pick(values, STOCK_COLUMNS.batchRef) || null,
    });
  }
  return out;
}

export interface OpeningSkuRow {
  supplierId: string;
  skuId: string;
  rolls: number;
  metres: number;
  value: string;
  receivedDate: string;
}

/** Per-SKU opening stock (Q41): SKU, roll count, total metres and total value per supplier. */
export function checkOpeningSkuTotals(
  table: CsvTable,
  ctx: {
    skus: readonly KnownSku[];
    suppliers: readonly KnownParty[];
    goLiveDate: string;
    standardLengthM: number;
  },
): Checked<OpeningSkuRow> {
  const out: Checked<OpeningSkuRow> = { rows: [], errors: [], warnings: [] };
  const missing = missingColumns(table.headers, [
    STOCK_COLUMNS.supplier,
    STOCK_COLUMNS.metres,
    STOCK_COLUMNS.value,
  ]);
  if (missing.length) {
    out.errors.push({
      line: 1,
      message: `Missing column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`,
    });
    return out;
  }
  const supplier = partyMatcher(ctx.suppliers);
  const sku = skuFinder(ctx.skus);
  for (const { line, values } of table.rows) {
    const err = (column: string, message: string) => out.errors.push({ line, column, message });
    const before = out.errors.length;
    const sup = supplier(pick(values, STOCK_COLUMNS.supplier));
    if (!sup || "ambiguous" in sup)
      err("supplier", `Unknown supplier "${pick(values, STOCK_COLUMNS.supplier)}"`);
    const s = sku(values);
    if (!s) err("sku", "No catalogue SKU matches this item — add it to the catalogue first");
    const rawM = pick(values, STOCK_COLUMNS.metres).replace(/,/g, "");
    const metres = /^\d+$/.test(rawM) ? Number(rawM) : NaN;
    if (!(metres > 0)) err("metres", `"${rawM}" is not a whole number of metres above zero`);
    const value = parseAmount(pick(values, STOCK_COLUMNS.value));
    if (!value || !value.greaterThan(0))
      err("value", `"${pick(values, STOCK_COLUMNS.value)}" is not a stock value`);
    const rawRolls = pick(values, STOCK_COLUMNS.rolls);
    const rolls = rawRolls
      ? Number(rawRolls)
      : metres > 0
        ? Math.ceil(metres / ctx.standardLengthM)
        : NaN;
    if (!Number.isInteger(rolls) || rolls <= 0)
      err("rolls", `"${rawRolls}" is not a number of rolls`);
    else if (metres > 0 && rolls > metres) err("rolls", "More rolls than metres");
    if (out.errors.length > before) continue;
    if (!rawRolls)
      out.warnings.push({
        line,
        column: "rolls",
        message: `No roll count — ${rolls} rolls of up to ${ctx.standardLengthM} m will be made`,
      });
    out.rows.push({
      line,
      supplierId: (sup as { party: KnownParty }).party.id,
      skuId: s!.id,
      rolls,
      metres,
      value: value!.toFixed(2),
      receivedDate: dayBefore(ctx.goLiveDate),
    });
  }
  return out;
}

// ── per-SKU totals → rolls ───────────────────────────────────────────────────

/**
 * Splits `metres` into `rolls` rolls (Q41): every roll the standard length except a shorter
 * last one when the count allows it, otherwise as equal as possible; the value is split over
 * the rolls by metres with largest remainder, so it adds up to the paisa.
 */
export function splitOpeningRolls(
  metres: number,
  rolls: number,
  value: DecimalLike,
  standardLengthM: number,
): { lengthM: number; value: string; costPerM: string }[] {
  if (!Number.isInteger(metres) || metres <= 0)
    throw new RangeError("Metres must be a whole number above zero");
  if (!Number.isInteger(rolls) || rolls <= 0 || rolls > metres)
    throw new RangeError("Roll count must be between 1 and the metres");
  let lengths: number[];
  const full = Math.floor(metres / standardLengthM);
  const rest = metres - full * standardLengthM;
  if ((rest === 0 && full === rolls) || (rest > 0 && full + 1 === rolls)) {
    lengths = [...Array<number>(full).fill(standardLengthM), ...(rest ? [rest] : [])];
  } else {
    const base = Math.floor(metres / rolls);
    const extra = metres - base * rolls;
    lengths = Array.from({ length: rolls }, (_, i) => base + (i < extra ? 1 : 0));
  }
  const values = allocateLargestRemainder(value, lengths);
  return lengths.map((lengthM, i) => ({
    lengthM,
    value: values[i]!.toFixed(2),
    costPerM: values[i]!.dividedBy(lengthM).toDecimalPlaces(4).toFixed(4),
  }));
}

// ── totals against the books ─────────────────────────────────────────────────

export interface BookCheck {
  imported: string;
  books: string;
  difference: string;
  matches: boolean;
}

/** Imported total against the figure from the old books (Q43: must match to the paisa). */
export function checkAgainstBooks(amounts: readonly DecimalLike[], books: DecimalLike): BookCheck {
  const imported = sum(amounts);
  const diff = imported.minus(books);
  return {
    imported: imported.toFixed(2),
    books: D(books).toFixed(2),
    difference: diff.toFixed(2),
    matches: diff.isZero(),
  };
}

// ── Go-Live lock ─────────────────────────────────────────────────────────────

export const OPENING_CHAPTERS = ["STOCK", "AR", "AP", "CASH"] as const;
export type OpeningChapter = (typeof OPENING_CHAPTERS)[number];

export interface ChapterState {
  chapter: OpeningChapter;
  /** Confirmed batches' totals match the books, or the chapter is marked "not needed". */
  status: "Empty" | "Draft" | "Confirmed" | "NotNeeded";
}

/** Day before an ISO date (opening documents are dated the day before go-live). */
export function dayBefore(iso: string): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

/**
 * Whether the Owner may press "Go live": every chapter confirmed or marked not needed (Q44).
 * Returns the reasons it can't, empty when it can.
 */
export function goLiveBlockers(
  chapters: readonly ChapterState[],
  lockedAt: string | null,
): string[] {
  if (lockedAt) return ["Already live"];
  const LABEL: Record<OpeningChapter, string> = {
    STOCK: "Stock",
    AR: "Receivables",
    AP: "Payables",
    CASH: "Bank & cash",
  };
  return OPENING_CHAPTERS.flatMap((ch) => {
    const s = chapters.find((c) => c.chapter === ch)?.status ?? "Empty";
    if (s === "Confirmed" || s === "NotNeeded") return [];
    return [
      s === "Draft"
        ? `${LABEL[ch]} is imported but not confirmed against the books`
        : `${LABEL[ch]}: import it or mark it as not needed`,
    ];
  });
}

/** Live document types whose posting locks the wizard (PRD §5.10 "first live transaction"). */
export const LIVE_POSTINGS = [
  "GRN",
  "PI",
  "SI",
  "CN",
  "DN",
  "RC",
  "PY",
  "ROLL_ADJUSTMENT",
] as const;
