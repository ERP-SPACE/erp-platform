import {
  type AccountDocument,
  accountFileName,
  inr,
  renderAccountDocumentHtml,
} from "@erp/documents";
import { type PostalAddress, companies, customers, suppliers } from "@erp/db";
import { istToday } from "@erp/domain";
import { Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { actor } from "../../common/context.js";
import { UnitOfWork } from "../../db/unit-of-work.js";
import { PdfService } from "../sales/pdf.service.js";
import type { RenderedDocument } from "../sales/sales-documents.service.js";
import { CommissionService } from "./commission.service.js";
import { type PartyType, ReceiptsService } from "./receipts.service.js";
import { StatementsService } from "./statements.service.js";

const lines = (a: PostalAddress | null | undefined) =>
  a
    ? [a.line1, a.line2, `${a.city} ${a.pincode}`, a.state].filter((x): x is string => Boolean(x))
    : [];
const rupees = (v: string) => `₹\u00a0${inr(v)}`;
const MODE: Record<string, string> = {
  CASH: "Cash",
  NEFT: "NEFT",
  RTGS: "RTGS",
  UPI: "UPI",
  CHEQUE: "Cheque",
};

/**
 * Printable account documents (Stage 4, ADR-0024 pipeline): statements of account, receipt /
 * payment advices and commission payout advices. Data comes from the same services the screens
 * use, so customer scope and permissions apply; the worker's Chromium makes the PDF.
 */
@Injectable()
export class AccountDocumentsService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly statements: StatementsService,
    private readonly receipts: ReceiptsService,
    private readonly commission: CommissionService,
    private readonly pdf: PdfService,
  ) {}

  private async seller(): Promise<AccountDocument["seller"]> {
    const [c] = await this.uow.db
      .select()
      .from(companies)
      .where(eq(companies.id, actor().companyId));
    return {
      name: c!.tradeName || c!.legalName,
      gstin: c!.gstin,
      address: lines(c!.address),
      phone: c!.phone,
      email: c!.email,
    };
  }

  private async address(type: PartyType, id: string) {
    if (type === "CUSTOMER") {
      const [c] = await this.uow.db
        .select({ a: customers.billingAddress })
        .from(customers)
        .where(eq(customers.id, id));
      return lines(c?.a);
    }
    const [s] = await this.uow.db
      .select({ a: suppliers.address })
      .from(suppliers)
      .where(eq(suppliers.id, id));
    return lines(s?.a);
  }

  private async out(
    doc: AccountDocument,
    fileName: string,
    format: "pdf" | "html",
  ): Promise<RenderedDocument> {
    const html = renderAccountDocumentHtml(doc);
    if (format === "html") {
      return {
        body: Buffer.from(html),
        contentType: "text/html; charset=utf-8",
        fileName: fileName.replace(/\.pdf$/, ".html"),
      };
    }
    return { body: await this.pdf.render(html), contentType: "application/pdf", fileName };
  }

  /** Statement of account for a period (customers: + they owe us; suppliers: + we owe them). */
  async statement(
    type: PartyType,
    partyId: string,
    from: string | undefined,
    to: string | undefined,
    format: "pdf" | "html",
  ) {
    const st = await this.statements.statement(type, partyId, from, to);
    const owe = type === "CUSTOMER" ? "Due from you" : "Due to you";
    const doc: AccountDocument = {
      title: "Statement of account",
      number: null,
      date: istToday(),
      seller: await this.seller(),
      party: {
        label: type === "CUSTOMER" ? "Customer" : "Supplier",
        name: st.partyName,
        gstin: st.gstin,
        address: await this.address(type, partyId),
      },
      meta: [
        [
          "Period",
          `${st.from.split("-").reverse().join("-")} to ${st.to.split("-").reverse().join("-")}`,
        ],
        ["Opening balance", rupees(st.opening)],
      ],
      columns: [
        { key: "date", label: "Date" },
        { key: "doc", label: "Document" },
        { key: "what", label: "Particulars" },
        { key: "debit", label: "Debit ₹", numeric: true },
        { key: "credit", label: "Credit ₹", numeric: true },
        { key: "balance", label: "Balance ₹", numeric: true },
      ],
      rows: st.entries.map((e) => ({
        date: e.date.split("-").reverse().join("-"),
        doc: e.docNo,
        what: e.description,
        debit: Number(e.debit) ? inr(e.debit) : "",
        credit: Number(e.credit) ? inr(e.credit) : "",
        balance: inr(e.balance),
      })),
      summary: [
        ["Opening balance", rupees(st.opening)],
        ...(Number(st.onAccount)
          ? ([["Unused credit / on account", rupees(st.onAccount)]] as [string, string][])
          : []),
        [`Closing balance (${owe.toLowerCase()})`, rupees(st.closing)],
      ],
      aging: st.aging.map((a) => ({ label: a.label, amount: rupees(a.amount) })),
      notes: ["Please tell us within 15 days if anything here does not match your books."],
    };
    return this.out(doc, accountFileName("statement", st.partyName, st.to), format);
  }

  /** Receipt (from a customer) or payment (to a supplier) advice, with what it settled. */
  async receipt(type: PartyType, id: string, format: "pdf" | "html") {
    const r = await this.receipts.get(type, id);
    const customer = type === "CUSTOMER";
    const doc: AccountDocument = {
      title: customer ? "Payment receipt" : "Payment advice",
      number: r.docNo,
      date: r.date,
      watermark:
        r.status === "Reversed"
          ? r.reversalKind === "BOUNCED"
            ? "Cheque bounced"
            : "Reversed"
          : r.status === "Draft"
            ? "Draft"
            : null,
      seller: await this.seller(),
      party: {
        label: customer ? "Received from" : "Paid to",
        name: r.partyName,
        address: await this.address(type, r.partyId),
      },
      meta: [
        ["Mode", MODE[r.mode] ?? r.mode],
        ...(r.reference
          ? ([[r.mode === "CHEQUE" ? "Cheque no." : "Reference", r.reference]] as [
              string,
              string,
            ][])
          : []),
        ...(r.bankName ? ([["Bank", r.bankName]] as [string, string][]) : []),
        ...(r.instrumentDate
          ? ([["Cheque date", r.instrumentDate.split("-").reverse().join("-")]] as [
              string,
              string,
            ][])
          : []),
      ],
      columns: [
        { key: "doc", label: "Against invoice" },
        { key: "date", label: "Invoice date" },
        { key: "amount", label: "Amount ₹", numeric: true },
        { key: "tds", label: "TDS / deduction ₹", numeric: true },
      ],
      rows: r.allocations.map((a) => ({
        doc: a.invoiceNo,
        date: a.invoiceDate ? a.invoiceDate.split("-").reverse().join("-") : "",
        amount: inr(a.amount),
        tds: Number(a.deduction) ? inr(a.deduction) : "",
      })),
      summary: [
        ["Applied to invoices", rupees(r.allocated)],
        ...(Number(r.unallocated)
          ? ([["On account", rupees(r.unallocated)]] as [string, string][])
          : []),
        [customer ? "Amount received" : "Amount paid", rupees(r.amount)],
      ],
      notes: [
        ...(r.status === "Reversed" ? [`Reversed: ${r.reversalReason ?? ""}`] : []),
        ...(r.mode === "CHEQUE" && r.status === "Posted"
          ? ["Subject to realisation of the cheque."]
          : []),
        ...(r.notes ? [r.notes] : []),
      ],
    };
    return this.out(
      doc,
      accountFileName(customer ? "receipt" : "payment", r.docNo ?? "draft"),
      format,
    );
  }

  /** Commission payout advice for the salesman: the entries it settles, gross, TDS and net. */
  async payout(id: string, format: "pdf" | "html") {
    const p = await this.commission.payout(id);
    const doc: AccountDocument = {
      title: "Commission payout",
      number: p.status === "Draft" ? null : p.payoutNo,
      date: p.paidOn ?? istToday(),
      watermark: p.status === "Draft" ? "Draft" : p.status === "Cancelled" ? "Cancelled" : null,
      seller: await this.seller(),
      party: { label: "Salesman", name: p.salesmanName },
      meta: [
        ["Commission up to", p.upTo.split("-").reverse().join("-")],
        ...(p.mode
          ? ([
              ["Paid by", `${MODE[p.mode] ?? p.mode}${p.reference ? ` · ${p.reference}` : ""}`],
            ] as [string, string][])
          : []),
      ],
      columns: [
        { key: "date", label: "Date" },
        { key: "customer", label: "Customer" },
        { key: "doc", label: "Invoice / document" },
        { key: "basis", label: "Basis" },
        { key: "amount", label: "Commission ₹", numeric: true },
      ],
      rows: p.entries.map((e) => ({
        date: e.date.split("-").reverse().join("-"),
        customer: e.customerName,
        doc: e.sourceNo === e.invoiceNo ? e.invoiceNo : `${e.invoiceNo} · ${e.sourceNo}`,
        basis:
          e.reversalReason ??
          (e.method === "PERCENT_SALES" ? `${e.rate} % of sales` : `₹${e.rate} per metre`),
        amount: inr(e.amount),
      })),
      summary: [
        ["Gross commission", rupees(p.gross)],
        ...(Number(p.tds) ? ([["TDS deducted", rupees(p.tds)]] as [string, string][]) : []),
        ["Net payable", rupees(p.net)],
      ],
    };
    return this.out(doc, accountFileName("commission", p.salesmanName, p.payoutNo), format);
  }
}
