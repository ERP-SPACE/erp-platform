import { validateGstin } from "./gst.js";
import { D, type Dec, sum } from "./money.js";
import { type SalesInvoiceResult, lineTaxes } from "./sales-invoice.js";

/**
 * E-invoice payload (ADR-0011): the IRP's JSON schema v1.1, built from the same invoice result
 * that is posted and printed, so the IRP's totals always equal ours. Item tax is the invoice's
 * per-rate tax split back onto lines (`lineTaxes`), so items sum exactly to the totals.
 */

export type EInvoiceDocType = "INV" | "CRN" | "DBN";
/** B2B; SEZ with payment of IGST; SEZ without payment (LUT). */
export type EInvoiceSupplyType = "B2B" | "SEZWP" | "SEZWOP";

export interface EInvoiceParty {
  gstin: string;
  legalName: string;
  tradeName?: string | null;
  address1: string;
  address2?: string | null;
  city: string;
  pincode: string;
  stateCode: string;
}

export interface EInvoiceItemMeta {
  description: string;
  hsnCode: string;
  isService: boolean;
  /** NIC unit code; metres are "MTR", charges "OTH". */
  unit: string;
  quantity: number;
  /** Rate per unit, before discounts. */
  unitPrice: string;
}

export interface EInvoiceInput {
  docType: EInvoiceDocType;
  docNo: string;
  /** ISO date. */
  docDate: string;
  supplyType: EInvoiceSupplyType;
  seller: EInvoiceParty;
  buyer: EInvoiceParty;
  /** Place of supply state code (the buyer's, or the shipping address's). */
  placeOfSupply: string;
  items: readonly EInvoiceItemMeta[];
  invoice: SalesInvoiceResult;
}

const money = (v: Dec) => Number(v.toFixed(2));
const nicDate = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};
const party = (p: EInvoiceParty) => ({
  Gstin: p.gstin,
  LglNm: p.legalName,
  ...(p.tradeName ? { TrdNm: p.tradeName } : {}),
  Addr1: p.address1,
  ...(p.address2 ? { Addr2: p.address2 } : {}),
  Loc: p.city,
  Pin: Number(p.pincode),
  Stcd: p.stateCode,
});

export function buildEInvoice(input: EInvoiceInput) {
  const { invoice } = input;
  if (input.items.length !== invoice.lines.length) {
    throw new Error("Every invoice line needs its e-invoice details");
  }
  const taxes = lineTaxes(invoice.lines, invoice.totals);
  const items = invoice.lines.map((line, i) => {
    const meta = input.items[i]!;
    const t = taxes[i]!;
    const discount = line.discount.plus(line.billDiscount);
    return {
      SlNo: String(i + 1),
      PrdDesc: meta.description,
      IsServc: meta.isService ? "Y" : "N",
      HsnCd: meta.hsnCode,
      Qty: meta.quantity,
      Unit: meta.unit,
      UnitPrice: Number(meta.unitPrice),
      TotAmt: money(line.gross),
      Discount: money(discount),
      AssAmt: money(line.taxable),
      GstRt: Number(line.gstRate.toString()),
      IgstAmt: money(t.igst),
      CgstAmt: money(t.cgst),
      SgstAmt: money(t.sgst),
      TotItemVal: money(line.taxable.plus(t.igst).plus(t.cgst).plus(t.sgst)),
    };
  });
  const tot = invoice.totals;
  return {
    Version: "1.1",
    TranDtls: { TaxSch: "GST", SupTyp: input.supplyType, RegRev: "N", IgstOnIntra: "N" },
    DocDtls: { Typ: input.docType, No: input.docNo, Dt: nicDate(input.docDate) },
    SellerDtls: party(input.seller),
    BuyerDtls: { ...party(input.buyer), Pos: input.placeOfSupply },
    ItemList: items,
    ValDtls: {
      AssVal: money(tot.taxable),
      CgstVal: money(tot.cgst),
      SgstVal: money(tot.sgst),
      IgstVal: money(tot.igst),
      RndOffAmt: money(tot.roundOff),
      TotInvVal: money(tot.total),
    },
  };
}

export type EInvoicePayload = ReturnType<typeof buildEInvoice>;

/**
 * Checks the IRP would reject before we call it: GSTINs, PIN codes, a document number of at most
 * 16 characters (ADR-0003), HSN codes, 1–1000 items and totals that add up. Returns plain-language
 * problems; empty means ready.
 */
export function validateEInvoice(p: EInvoicePayload): string[] {
  const problems: string[] = [];
  for (const [who, gstin] of [
    ["Seller", p.SellerDtls.Gstin],
    ["Buyer", p.BuyerDtls.Gstin],
  ] as const) {
    if (!validateGstin(gstin).valid) problems.push(`${who} GSTIN ${gstin} is not valid`);
  }
  for (const [who, pin] of [
    ["Seller", p.SellerDtls.Pin],
    ["Buyer", p.BuyerDtls.Pin],
  ] as const) {
    if (!/^[1-9]\d{5}$/.test(String(pin))) problems.push(`${who} PIN code ${pin} is not valid`);
  }
  if (!/^[A-Za-z1-9][A-Za-z0-9/-]{0,15}$/.test(p.DocDtls.No)) {
    problems.push(`Document number ${p.DocDtls.No} must be 1–16 letters, digits, / or -`);
  }
  if (p.ItemList.length < 1 || p.ItemList.length > 1000)
    problems.push("An e-invoice has 1 to 1000 items");
  for (const item of p.ItemList) {
    if (!/^\d{4}(\d{2}){0,2}$/.test(item.HsnCd)) {
      problems.push(`Item ${item.SlNo}: HSN ${item.HsnCd || "(missing)"} must be 4, 6 or 8 digits`);
    }
  }
  const items = (k: "AssAmt" | "CgstAmt" | "SgstAmt" | "IgstAmt") =>
    sum(p.ItemList.map((i) => D(i[k])));
  const checks: [string, Dec, number][] = [
    ["Taxable value", items("AssAmt"), p.ValDtls.AssVal],
    ["CGST", items("CgstAmt"), p.ValDtls.CgstVal],
    ["SGST", items("SgstAmt"), p.ValDtls.SgstVal],
    ["IGST", items("IgstAmt"), p.ValDtls.IgstVal],
  ];
  for (const [label, fromItems, total] of checks) {
    if (!fromItems.equals(D(total)))
      problems.push(`${label}: items add up to ${fromItems.toFixed(2)}, total says ${total}`);
  }
  const grand = D(p.ValDtls.AssVal)
    .plus(D(p.ValDtls.CgstVal))
    .plus(D(p.ValDtls.SgstVal))
    .plus(D(p.ValDtls.IgstVal))
    .plus(D(p.ValDtls.RndOffAmt));
  if (!grand.equals(D(p.ValDtls.TotInvVal))) problems.push("Invoice total does not add up");
  return problems;
}
