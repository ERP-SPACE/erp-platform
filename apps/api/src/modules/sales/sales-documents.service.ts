import {
  type DocLine,
  type DocParty,
  type DocTaxRow,
  type SalesDocument,
  documentFileName,
  renderSalesDocumentHtml,
} from "@erp/documents";
import { companies, customerNotes, customers, salesInvoices, salesOrders } from "@erp/db";
import { D, GST_STATES, sum } from "@erp/domain";
import { Injectable } from "@nestjs/common";
import { eq, inArray } from "drizzle-orm";
import { actor } from "../../common/context.js";
import { trimDecimal } from "../../common/decimal.js";
import { UnitOfWork } from "../../db/unit-of-work.js";
import { SettingsService } from "../settings/settings.service.js";
import { ChallansService } from "./challans.service.js";
import { NotesService } from "./notes.service.js";
import { PdfService } from "./pdf.service.js";
import { ProformasService } from "./proformas.service.js";
import { formatAddress } from "./sales-common.js";
import { SalesInvoicesService } from "./sales-invoices.service.js";

export type DocKind = "SI" | "NOTE" | "DC" | "PF";

export interface RenderedDocument {
  body: Buffer;
  contentType: string;
  fileName: string;
}

const state = (code: string | null | undefined) =>
  code ? `${GST_STATES[code] ?? code} (${code})` : null;
const ddmmyyyy = (iso: string) => iso.slice(0, 10).split("-").reverse().join("-");
const metres = (m: number) => `${m.toLocaleString("en-IN")} m`;
/** "28-10-2026 11:30" in IST. */
const istStamp = (iso: string) => {
  const ist = new Date(Date.parse(iso) + 5.5 * 3_600_000).toISOString();
  return `${ddmmyyyy(ist)} ${ist.slice(11, 16)}`;
};

/** Per-rate tax summary of the lines. */
function taxRows(
  lines: readonly { gstRate: string; taxable: string; cgst: string; sgst: string; igst: string }[],
): DocTaxRow[] {
  const rates = [...new Set(lines.map((l) => trimDecimal(l.gstRate)!))];
  return rates.map((gstRate) => {
    const at = lines.filter((l) => trimDecimal(l.gstRate) === gstRate);
    const s = (k: "taxable" | "cgst" | "sgst" | "igst") => sum(at.map((l) => l[k])).toFixed(2);
    return { gstRate, taxable: s("taxable"), cgst: s("cgst"), sgst: s("sgst"), igst: s("igst") };
  });
}

/**
 * Printable invoices, credit / debit notes, challans and proformas (PRD §5.7, Q30). Builds the
 * document from the same detail the screens show — so customer scope and cost hiding apply —
 * plus the company profile and Settings → invoice.pdf. A posted B2B invoice without its IRN
 * prints "Provisional — IRN pending" (ADR-0011).
 */
@Injectable()
export class SalesDocumentsService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly settings: SettingsService,
    private readonly invoices: SalesInvoicesService,
    private readonly notes: NotesService,
    private readonly challans: ChallansService,
    private readonly proformas: ProformasService,
    private readonly pdf: PdfService,
  ) {}

  async render(kind: DocKind, id: string, format: "pdf" | "html"): Promise<RenderedDocument> {
    const doc = await this.build(kind, id);
    const html = renderSalesDocumentHtml(doc);
    const fileName = documentFileName(doc);
    if (format === "html") {
      return {
        body: Buffer.from(html),
        contentType: "text/html; charset=utf-8",
        fileName: fileName.replace(/\.pdf$/, ".html"),
      };
    }
    return { body: await this.pdf.render(html), contentType: "application/pdf", fileName };
  }

  async build(kind: DocKind, id: string): Promise<SalesDocument> {
    switch (kind) {
      case "SI":
        return this.invoice(id);
      case "NOTE":
        return this.note(id);
      case "DC":
        return this.challan(id);
      case "PF":
        return this.proforma(id);
    }
  }

  private async seller(): Promise<SalesDocument["seller"]> {
    const [c] = await this.uow.db
      .select()
      .from(companies)
      .where(eq(companies.id, actor().companyId));
    return {
      name: c!.legalName,
      tradeName: c!.tradeName,
      gstin: c!.gstin,
      pan: c!.pan,
      address: [
        c!.address.line1,
        c!.address.line2,
        `${c!.address.city} ${c!.address.pincode}`,
      ].filter((x): x is string => Boolean(x)),
      state: state(c!.stateCode),
      phone: c!.phone,
      email: c!.email,
      bank: c!.bank ?? null,
      signatoryName: c!.signatoryName,
    };
  }

  private async customer(id: string) {
    const [c] = await this.uow.db.select().from(customers).where(eq(customers.id, id));
    return c!;
  }

  private party(
    name: string,
    gstin: string | null,
    address: string,
    stateCode: string | null,
  ): DocParty {
    return { name, gstin, address: [address], state: state(stateCode) };
  }

  private async invoice(id: string): Promise<SalesDocument> {
    const si = await this.invoices.get(id); // scope-checked
    const [row] = await this.uow.db.select().from(salesInvoices).where(eq(salesInvoices.id, id));
    const cust = await this.customer(si.customerId);
    const pdf = await this.settings.value("invoice.pdf");
    const soNos = si.soIds.length
      ? (
          await this.uow.db
            .select({ soNo: salesOrders.soNo })
            .from(salesOrders)
            .where(inArray(salesOrders.id, si.soIds))
        ).map((s) => s.soNo)
      : [];
    const t = si.transport;
    const pendingIrn = si.status === "Posted" && ["Pending", "Failed"].includes(si.einvoice.status);
    return {
      kind: "TAX_INVOICE",
      number: si.siNo,
      date: si.date,
      watermark:
        si.status === "Draft"
          ? "DRAFT"
          : si.status === "Cancelled"
            ? "CANCELLED"
            : pendingIrn
              ? "PROVISIONAL"
              : null,
      seller: await this.seller(),
      billTo: this.party(si.customerName, si.customerGstin, si.billingAddress, cust.stateCode),
      shipTo:
        si.shippingAddress !== si.billingAddress
          ? this.party(si.customerName, si.customerGstin, si.shippingAddress, si.placeOfSupply)
          : null,
      placeOfSupply: state(si.placeOfSupply),
      meta: [
        ["Due date", ddmmyyyy(si.dueDate)] as [string, string],
        ...(soNos.length ? [["Order", soNos.join(", ")] as [string, string]] : []),
        ...(si.dcs.length
          ? [["Challan", si.dcs.map((d) => d.dcNo).join(", ")] as [string, string]]
          : []),
        ...(t.transporterName ? [["Transporter", t.transporterName] as [string, string]] : []),
        ...(t.vehicleNo ? [["Vehicle", t.vehicleNo] as [string, string]] : []),
        ...(t.lrNo
          ? [["LR", `${t.lrNo}${t.lrDate ? ` · ${ddmmyyyy(t.lrDate)}` : ""}`] as [string, string]]
          : []),
        ...(t.ewayBillNo
          ? [
              [
                "E-way bill",
                `${t.ewayBillNo}${t.ewayBillDate ? ` · ${ddmmyyyy(t.ewayBillDate)}` : ""}`,
              ] as [string, string],
            ]
          : []),
      ],
      einvoice:
        si.einvoice.status === "Generated" && si.einvoice.irn
          ? {
              irn: si.einvoice.irn,
              ackNo: si.einvoice.ackNo ?? "",
              ackDate: si.einvoice.ackDate ? istStamp(si.einvoice.ackDate) : "",
              qr: si.einvoice.signedQr,
            }
          : null,
      priced: true,
      lines: si.lines.map((l): DocLine => ({
        description: l.description,
        detail:
          pdf.showRolls && l.rolls.length
            ? l.rolls.map((r) => `${r.barcode} ${metres(r.lengthM)}`).join(" · ")
            : null,
        hsn: l.hsnCode,
        quantity: l.kind === "GOODS" ? metres(l.metres ?? 0) : "1",
        rate: l.ratePerM ? `${l.ratePerM}/m` : null,
        discount: D(l.discount).isZero() ? null : l.discount,
        taxable: l.taxable,
        gstRate: l.gstRate,
      })),
      taxes: taxRows(si.lines),
      regime: si.totals.regime,
      totals: si.totals,
      remarks: [
        "Tax payable on reverse charge: No.",
        ...(si.supplyType === "SEZWOP"
          ? ["Supply meant for SEZ under LUT without payment of integrated tax."]
          : []),
        ...(row!.notes ? [row!.notes] : []),
      ],
      terms: pdf.terms,
      copies: pdf.copies,
    };
  }

  private async note(id: string): Promise<SalesDocument> {
    const n = await this.notes.get(id); // scope-checked
    const [row] = await this.uow.db.select().from(customerNotes).where(eq(customerNotes.id, id));
    const cust = await this.customer(n.customerId);
    const pdf = await this.settings.value("invoice.pdf");
    const r = row!;
    const pendingIrn = n.status === "Posted" && ["Pending", "Failed"].includes(n.einvoice.status);
    return {
      kind: n.kind === "CREDIT" ? "CREDIT_NOTE" : "DEBIT_NOTE",
      number: n.noteNo,
      date: n.date,
      watermark:
        n.status === "Draft"
          ? "DRAFT"
          : n.status === "Cancelled"
            ? "CANCELLED"
            : pendingIrn
              ? "PROVISIONAL"
              : null,
      seller: await this.seller(),
      billTo: this.party(r.customerName, r.customerGstin, r.billingAddress, cust.stateCode),
      shipTo: null,
      placeOfSupply: state(r.placeOfSupply),
      meta: [
        ...(n.siNo ? [["Against invoice", n.siNo] as [string, string]] : []),
        ["Reason", n.reason],
      ],
      einvoice:
        n.einvoice.status === "Generated" && n.einvoice.irn
          ? {
              irn: n.einvoice.irn,
              ackNo: n.einvoice.ackNo ?? "",
              ackDate: n.einvoice.ackDate ? istStamp(n.einvoice.ackDate) : "",
              qr: n.einvoice.signedQr,
            }
          : null,
      priced: true,
      lines: n.lines.map((l) => ({
        description: l.description,
        hsn: l.hsnCode,
        quantity: "1",
        rate: null,
        discount: null,
        taxable: l.taxable,
        gstRate: l.gstRate,
      })),
      taxes: taxRows(n.lines),
      regime: n.totals.regime,
      totals: n.totals,
      remarks: [],
      terms: [],
      copies: pdf.copies.slice(0, 2),
    };
  }

  private async challan(id: string): Promise<SalesDocument> {
    const dc = await this.challans.get(id); // scope-checked
    const cust = await this.customer(dc.customerId);
    const [so] = await this.uow.db.select().from(salesOrders).where(eq(salesOrders.id, dc.soId));
    const pdf = await this.settings.value("invoice.pdf");
    const lines = dc.lines.map((l): DocLine => {
      const rolls = dc.rolls.filter((r) => r.soLineId === l.soLineId);
      return {
        description: l.description,
        detail: rolls.length
          ? rolls.map((r) => `${r.barcode} ${metres(r.lengthM)}`).join(" · ")
          : null,
        hsn: "",
        quantity: `${rolls.length} roll${rolls.length === 1 ? "" : "s"} · ${metres(l.pickedM)}`,
        rate: null,
        discount: null,
        taxable: null,
        gstRate: null,
      };
    });
    return {
      kind: "DELIVERY_CHALLAN",
      number: dc.dcNo,
      date: dc.date,
      watermark: dc.status === "Draft" ? "DRAFT" : dc.status === "Cancelled" ? "CANCELLED" : null,
      seller: await this.seller(),
      billTo: this.party(
        cust.legalName,
        cust.gstin,
        formatAddress(cust.billingAddress),
        cust.stateCode,
      ),
      shipTo: null,
      placeOfSupply: so ? state(so.placeOfSupply) : null,
      meta: [
        ["Order", dc.soNo],
        ["Goods value", `₹ ${D(dc.value).toFixed(2)}`],
        ...(dc.transporterName ? [["Transporter", dc.transporterName] as [string, string]] : []),
        ...(dc.vehicleNo ? [["Vehicle", dc.vehicleNo] as [string, string]] : []),
        ...(dc.lrNo ? [["LR", dc.lrNo] as [string, string]] : []),
        ...(dc.ewayBillNo ? [["E-way bill", dc.ewayBillNo] as [string, string]] : []),
      ],
      einvoice: null,
      priced: false,
      lines,
      taxes: [],
      regime: so?.regime ?? "CGST_SGST",
      totals: null,
      remarks: ["Goods sent for sale; the tax invoice follows.", ...(dc.notes ? [dc.notes] : [])],
      terms: [],
      copies: pdf.copies.slice(0, 2),
    };
  }

  private async proforma(id: string): Promise<SalesDocument> {
    const pf = await this.proformas.get(id); // scope-checked
    const cust = await this.customer(pf.customerId);
    const pdf = await this.settings.value("invoice.pdf");
    const lines: DocLine[] = [
      ...pf.lines.map((l) => ({
        description: l.description,
        hsn: l.hsnCode ?? "",
        quantity: metres(l.metres),
        rate: `${l.ratePerM}/m`,
        discount: D(l.discountPct).isZero() ? null : `${l.discountPct}%`,
        taxable: l.taxable,
        gstRate: l.gstRate,
      })),
      ...pf.charges.map((c) => ({
        description: c.label,
        hsn: "",
        quantity: "1",
        rate: null,
        discount: null,
        taxable: c.taxable,
        gstRate: null,
      })),
    ];
    return {
      kind: "PROFORMA",
      number: pf.proformaNo,
      date: pf.date,
      watermark: pf.status === "Cancelled" ? "CANCELLED" : null,
      seller: await this.seller(),
      billTo: this.party(
        cust.legalName,
        cust.gstin,
        formatAddress(cust.billingAddress),
        cust.stateCode,
      ),
      shipTo: null,
      placeOfSupply: null,
      meta: [["Valid until", ddmmyyyy(pf.validUntil)]],
      einvoice: null,
      priced: true,
      lines,
      // Proformas store totals only; the totals box shows the tax.
      taxes: [],
      regime: pf.totals.regime,
      totals: pf.totals,
      remarks: ["This is a proforma invoice, not a tax invoice."],
      terms: pdf.terms,
      copies: ["Original"],
    };
  }
}
