import { EINVOICE_DOC_TYPES } from "@erp/contracts";
import {
  type Db,
  type PostalAddress,
  type Tx,
  companies,
  customerNoteLines,
  customerNotes,
  customers,
  salesInvoiceLines,
  salesInvoices,
} from "@erp/db";
import {
  D,
  type EInvoiceDocType,
  type EInvoiceItemMeta,
  type EInvoiceParty,
  type EInvoicePayload,
  type SalesInvoiceResult,
  type SalesLine,
  type TaxRateSummary,
  buildEInvoice,
  sum,
  validateEInvoice,
} from "@erp/domain";
import { asc, eq } from "drizzle-orm";
import { notFound } from "../../common/errors.js";

export type EDocType = (typeof EINVOICE_DOC_TYPES)[number];

type SiRow = typeof salesInvoices.$inferSelect;
type NoteRow = typeof customerNotes.$inferSelect;

/** The IRN-bearing columns shared by invoices and notes, plus what the queue needs. */
export interface EDoc {
  docType: EDocType;
  id: string;
  companyId: string;
  customerId: string;
  docNo: string | null;
  date: string;
  status: string;
  supplyType: string;
  einvoiceStatus: SiRow["einvoiceStatus"];
  irn: string | null;
  ackDate: Date | null;
  postedAt: Date | null;
  postedBy: string | null;
  total: string;
  row: SiRow | NoteRow;
}

const table = (t: EDocType) => (t === "SI" ? salesInvoices : customerNotes);

function toDoc(docType: EDocType, r: SiRow | NoteRow): EDoc {
  return {
    docType,
    id: r.id,
    companyId: r.companyId,
    customerId: r.customerId,
    docNo: "siNo" in r ? r.siNo : r.noteNo,
    date: r.date,
    status: r.status,
    supplyType: r.supplyType,
    einvoiceStatus: r.einvoiceStatus,
    irn: r.irn,
    ackDate: r.ackDate,
    postedAt: r.postedAt,
    postedBy: r.postedBy,
    total: r.total,
    row: r,
  };
}

/** Locks the document row (callers run inside a UnitOfWork); `lock: false` just reads it. */
export async function lockDoc(
  tx: Tx | Db,
  docType: EDocType,
  id: string,
  { lock = true } = {},
): Promise<EDoc> {
  const t = table(docType);
  const q = tx.select().from(t).where(eq(t.id, id));
  const [row] = lock ? await q.for("update") : await q;
  if (!row) throw notFound(docType === "SI" ? "Sales invoice" : "Note");
  if (docType !== "SI" && (row as NoteRow).kind !== (docType === "CN" ? "CREDIT" : "DEBIT")) {
    throw notFound("Note");
  }
  return toDoc(docType, row);
}

/** Updates the e-invoice columns of a document (no version bump: not a user edit). */
export async function setEinvoice(
  tx: Tx,
  doc: EDoc,
  values: Partial<
    Pick<
      SiRow,
      | "einvoiceStatus"
      | "irn"
      | "ackNo"
      | "ackDate"
      | "signedInvoice"
      | "signedQr"
      | "irnAttempts"
      | "irnLastError"
      | "irnCancelledAt"
    >
  >,
) {
  const t = table(doc.docType);
  await tx
    .update(t)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(t.id, doc.id));
}

const party = (
  gstin: string,
  legalName: string,
  tradeName: string | null,
  a: PostalAddress,
  stateCode: string,
): EInvoiceParty => ({
  gstin,
  legalName,
  tradeName,
  address1: a.line1,
  address2: a.line2 ?? null,
  city: a.city,
  pincode: a.pincode,
  stateCode,
});

interface StoredTax {
  rate: string;
  cgst: string;
  sgst: string;
  igst: string;
}

/** Per-rate totals from the stored lines, so the IRP split is exactly what was posted. */
function invoiceResult(
  lines: SalesLine[],
  taxes: StoredTax[],
  stored: { roundOff: string; total: string },
): SalesInvoiceResult {
  const rates = [...new Set(taxes.map((t) => t.rate))];
  const byRate: TaxRateSummary[] = rates.map((rate) => {
    const at = taxes.flatMap((t, i) => (t.rate === rate ? [{ t, l: lines[i]! }] : []));
    return {
      gstRate: D(rate),
      taxable: sum(at.map((x) => x.l.taxable)),
      cgst: sum(at.map((x) => x.t.cgst)),
      sgst: sum(at.map((x) => x.t.sgst)),
      igst: sum(at.map((x) => x.t.igst)),
    };
  });
  const taxable = sum(byRate.map((r) => r.taxable));
  const cgst = sum(byRate.map((r) => r.cgst));
  const sgst = sum(byRate.map((r) => r.sgst));
  const igst = sum(byRate.map((r) => r.igst));
  return {
    lines,
    discountTotal: sum(lines.map((l) => l.discount.plus(l.billDiscount))),
    totals: {
      taxable,
      cgst,
      sgst,
      igst,
      beforeRoundOff: taxable.plus(cgst).plus(sgst).plus(igst),
      roundOff: D(stored.roundOff),
      total: D(stored.total),
      byRate,
    },
  };
}

/**
 * Builds the IRP payload (NIC schema v1.1) for a posted SI / CN / DN from what was stored at
 * posting — frozen party snapshot, line values and taxes — with structured addresses from the
 * company and customer masters. Returns plain-language problems instead of throwing.
 */
export async function buildPayload(
  tx: Tx,
  doc: EDoc,
): Promise<{ payload: EInvoicePayload | null; problems: string[] }> {
  const [co] = await tx.select().from(companies).where(eq(companies.id, doc.companyId));
  const [cust] = await tx.select().from(customers).where(eq(customers.id, doc.customerId));
  const r = doc.row;
  const problems: string[] = [];
  if (!co?.gstin) problems.push("Add the company GSTIN in Settings → Company first");
  if (!r.customerGstin) problems.push(`${r.customerName} has no GSTIN; B2B e-invoices need one`);
  if (!doc.docNo) problems.push("The document has no number yet");
  if (doc.supplyType === "B2C") problems.push("B2C documents don't need an IRN");
  if (problems.length || !co || !cust) return { payload: null, problems };

  let lines: SalesLine[];
  let lineTax: StoredTax[];
  let items: EInvoiceItemMeta[];
  if (doc.docType === "SI") {
    const rows = await tx
      .select()
      .from(salesInvoiceLines)
      .where(eq(salesInvoiceLines.siId, doc.id))
      .orderBy(asc(salesInvoiceLines.lineNo));
    lines = rows.map((l) => ({
      kind: l.kind,
      gross: D(l.gross),
      discount: D(l.discount),
      billDiscount: D(l.billDiscount),
      taxable: D(l.taxable),
      gstRate: D(l.gstRate),
    }));
    lineTax = rows.map((l) => ({
      rate: D(l.gstRate).toString(),
      cgst: l.cgst,
      sgst: l.sgst,
      igst: l.igst,
    }));
    items = rows.map((l) =>
      l.kind === "GOODS"
        ? {
            description: l.description,
            hsnCode: l.hsnCode,
            isService: false,
            unit: "MTR",
            quantity: l.metres!,
            unitPrice: l.ratePerM!,
          }
        : {
            description: l.description,
            hsnCode: l.hsnCode,
            isService: true,
            unit: "OTH",
            quantity: 1,
            unitPrice: l.gross,
          },
    );
  } else {
    const rows = await tx
      .select()
      .from(customerNoteLines)
      .where(eq(customerNoteLines.noteId, doc.id))
      .orderBy(asc(customerNoteLines.lineNo));
    lines = rows.map((l) => ({
      kind: "GOODS" as const,
      gross: D(l.taxable),
      discount: D(0),
      billDiscount: D(0),
      taxable: D(l.taxable),
      gstRate: D(l.gstRate),
    }));
    lineTax = rows.map((l) => ({
      rate: D(l.gstRate).toString(),
      cgst: l.cgst,
      sgst: l.sgst,
      igst: l.igst,
    }));
    items = rows.map((l) => ({
      description: l.description,
      hsnCode: l.hsnCode,
      isService: false,
      unit: "OTH",
      quantity: 1,
      unitPrice: l.taxable,
    }));
  }
  const result = invoiceResult(lines, lineTax, r);

  const typ: EInvoiceDocType = doc.docType === "SI" ? "INV" : doc.docType === "CN" ? "CRN" : "DBN";
  const payload = buildEInvoice({
    docType: typ,
    docNo: doc.docNo!,
    docDate: doc.date,
    supplyType: doc.supplyType as "B2B" | "SEZWP" | "SEZWOP",
    seller: party(co.gstin!, co.legalName, co.tradeName, co.address, co.stateCode),
    buyer: party(
      r.customerGstin!,
      cust.legalName,
      cust.tradeName,
      cust.billingAddress,
      cust.stateCode,
    ),
    placeOfSupply: r.placeOfSupply,
    items,
    invoice: result,
  });
  return { payload, problems: validateEInvoice(payload) };
}
