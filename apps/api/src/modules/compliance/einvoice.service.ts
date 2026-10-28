import { randomUUID } from "node:crypto";
import type {
  EInvoiceInfo,
  EInvoiceQueueItem,
  EInvoiceRequestItem,
  EwayBillResult,
  ewayBillGenerate,
  ewayBillInput,
  manualIrn,
} from "@erp/contracts";
import {
  type Tx,
  customerNotes,
  customers,
  deliveryChallans,
  einvoiceRequests,
  salesInvoiceDcs,
  salesInvoices,
  transporters,
} from "@erp/db";
import { D, istToday } from "@erp/domain";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { z } from "zod";
import { type Actor, actor, ctx, requestContext } from "../../common/context.js";
import { AppError, notFound, validationError } from "../../common/errors.js";
import { UnitOfWork } from "../../db/unit-of-work.js";
import { customerScopeFilter, loadCustomerScope } from "../customers/customer-scope.js";
import { EventBus } from "../realtime/event-bus.js";
import { daysBetween } from "../sales/sales-common.js";
import { SettingsService } from "../settings/settings.service.js";
import {
  type EDoc,
  type EDocType,
  buildPayload,
  lockDoc,
  setEinvoice,
} from "./einvoice-documents.js";
import {
  EINVOICE_PROVIDER,
  type EInvoiceProvider,
  EInvoiceProviderError,
  type IrnCancelReason,
} from "./einvoice-provider.js";

/** After this many failed tries an outage stops retrying by itself and waits for a person. */
export const MAX_AUTO_ATTEMPTS = 12;

export type GenerateOutcome =
  { outcome: "Generated" | "Skipped" } | { outcome: "Failed"; retryable: boolean; error: string };

type Action = "GENERATE" | "CANCEL" | "EWAY_BILL" | "MANUAL";

const einvoiceFailed = (message: string) => new AppError(422, "EINVOICE_FAILED", message);

/**
 * E-invoicing (ADR-0011): IRN generation and cancellation, e-way bills from the IRN, and the
 * manual fallback. Posting an SI / CN / DN only marks it Pending and queues it; this service
 * reports it to the IRP. Every provider call is logged to `einvoice_requests`.
 *
 * Status: Pending = queued or retrying after an outage; Failed = the IRP (or our own checks)
 * rejected the document and a person must fix and retry it; Generated; Cancelled.
 */
@Injectable()
export class EInvoiceService {
  private readonly logger = new Logger(EInvoiceService.name);

  constructor(
    private readonly uow: UnitOfWork,
    private readonly settings: SettingsService,
    private readonly bus: EventBus,
    @Inject(EINVOICE_PROVIDER) private readonly provider: EInvoiceProvider,
  ) {}

  /**
   * Reports one document to the IRP. Safe to call repeatedly: only Posted documents that are
   * Pending / Failed are sent, under a row lock, and a duplicate report returns the same IRN.
   */
  async generate(docType: EDocType, id: string): Promise<GenerateOutcome> {
    const { provider } = await this.settings.value("einvoice.config");
    return this.uow.run(async (tx) => {
      const doc = await lockDoc(tx, docType, id);
      if (doc.status !== "Posted" || !["Pending", "Failed"].includes(doc.einvoiceStatus)) {
        return { outcome: "Skipped" };
      }
      if (provider === "MANUAL") {
        await setEinvoice(tx, doc, {
          irnLastError:
            "E-invoicing is set to manual: generate the IRN on the portal and record it here.",
        });
        return { outcome: "Skipped" };
      }
      const { payload, problems } = await buildPayload(tx, doc);
      const attempts = doc.row.irnAttempts + 1;
      if (!payload || problems.length) {
        const error = problems.join("; ");
        await this.log(tx, doc, "GENERATE", { request: payload, ok: false, error });
        await setEinvoice(tx, doc, {
          einvoiceStatus: "Failed",
          irnAttempts: attempts,
          irnLastError: error,
        });
        this.changed(doc);
        return { outcome: "Failed", retryable: false, error };
      }
      const started = Date.now();
      try {
        if (provider === "GSP")
          throw new EInvoiceProviderError(
            "The live e-invoice provider isn't set up yet (Q27).",
            false,
          );
        const r = await this.provider.generateIrn(payload);
        await this.log(tx, doc, "GENERATE", {
          request: payload,
          response: {
            irn: r.irn,
            ackNo: r.ackNo,
            ackDate: r.ackDate,
            duplicate: r.duplicate ?? false,
          },
          ok: true,
          durationMs: Date.now() - started,
        });
        await setEinvoice(tx, doc, {
          einvoiceStatus: "Generated",
          irn: r.irn,
          ackNo: r.ackNo,
          ackDate: r.ackDate,
          signedInvoice: r.signedInvoice,
          signedQr: r.signedQr,
          irnAttempts: attempts,
          irnLastError: null,
        });
        this.changed(doc);
        return { outcome: "Generated" };
      } catch (error) {
        if (!(error instanceof EInvoiceProviderError)) throw error;
        await this.log(tx, doc, "GENERATE", {
          request: payload,
          response: error.response,
          ok: false,
          error: error.message,
          durationMs: Date.now() - started,
        });
        const retryable = error.retryable && attempts < MAX_AUTO_ATTEMPTS;
        await setEinvoice(tx, doc, {
          einvoiceStatus: retryable ? "Pending" : "Failed",
          irnAttempts: attempts,
          irnLastError: error.message,
        });
        this.changed(doc);
        return { outcome: "Failed", retryable, error: error.message };
      }
    });
  }

  /** `generate` for the queue consumer: runs as the person who posted the document. */
  async generateAsSystem(job: {
    docType: EDocType;
    id: string;
    companyId: string;
    userId: string | null;
  }) {
    const system: Actor = {
      userId: job.userId ?? "",
      name: "E-invoice queue",
      email: "",
      companyId: job.companyId,
      branchId: null,
      roles: [],
      permissions: new Set(),
      sessionId: "",
      sessionCreatedAt: new Date(),
      twoFactorEnabled: false,
    };
    return requestContext.run({ requestId: `einvoice-${randomUUID()}`, actor: system }, () =>
      this.generate(job.docType, job.id),
    );
  }

  /** Retry now, from the screen. Reports the outcome as an error when it didn't work. */
  async retry(docType: EDocType, id: string): Promise<EInvoiceInfo> {
    await this.assertInScope(docType, id);
    const r = await this.generate(docType, id);
    if (r.outcome === "Failed") throw einvoiceFailed(`The IRN wasn't generated: ${r.error}`);
    return this.info(docType, id);
  }

  /**
   * Inside a document's cancel command (same transaction): cancels its IRN at the IRP within the
   * window, or drops a not-yet-reported document from the queue. Called last, so a provider
   * failure rolls the whole cancellation back.
   */
  async cancelIrn(
    tx: Tx,
    docType: EDocType,
    id: string,
    remark: string,
    reason: IrnCancelReason = "2",
  ) {
    const doc = await lockDoc(tx, docType, id);
    if (doc.einvoiceStatus === "Pending" || doc.einvoiceStatus === "Failed") {
      await setEinvoice(tx, doc, { einvoiceStatus: "NotRequired" });
      return;
    }
    if (doc.einvoiceStatus !== "Generated") return;
    const { cancelWindowHours, provider } = await this.settings.value("einvoice.config");
    const since = doc.ackDate ?? doc.postedAt!;
    if (Date.now() - since.getTime() > cancelWindowHours * 3_600_000) {
      throw validationError(
        `The IRN can only be cancelled within ${cancelWindowHours} hours of generation. Issue a credit note instead.`,
      );
    }
    if (provider === "MANUAL") {
      // Cancelled on the portal by hand; record it.
      await this.log(tx, doc, "CANCEL", {
        request: { irn: doc.irn, remark },
        ok: true,
        provider: "MANUAL",
      });
      await setEinvoice(tx, doc, { einvoiceStatus: "Cancelled", irnCancelledAt: new Date() });
      return;
    }
    const started = Date.now();
    try {
      const r = await this.provider.cancelIrn(doc.irn!, reason, remark);
      await this.log(tx, doc, "CANCEL", {
        request: { irn: doc.irn, reason, remark },
        response: r,
        ok: true,
        durationMs: Date.now() - started,
      });
      await setEinvoice(tx, doc, { einvoiceStatus: "Cancelled", irnCancelledAt: r.cancelledAt });
    } catch (error) {
      if (!(error instanceof EInvoiceProviderError)) throw error;
      // The cancellation rolls back, so the log is written outside it.
      await this.logDetached(doc, "CANCEL", {
        request: { irn: doc.irn, reason, remark },
        ok: false,
        error: error.message,
      });
      throw einvoiceFailed(`The IRN couldn't be cancelled: ${error.message}`);
    }
  }

  /** An IRN generated on the portal by hand (ADR-0011 fallback). */
  async recordManual(
    docType: EDocType,
    id: string,
    dto: z.infer<typeof manualIrn>,
  ): Promise<EInvoiceInfo> {
    await this.assertInScope(docType, id);
    await this.uow.run(async (tx) => {
      const doc = await lockDoc(tx, docType, id);
      if (doc.status !== "Posted") throw validationError("Only a posted document gets an IRN.");
      if (doc.supplyType === "B2C") throw validationError("B2C documents don't need an IRN.");
      if (!["Pending", "Failed"].includes(doc.einvoiceStatus)) {
        throw validationError(
          `This document's IRN is already ${doc.einvoiceStatus.toLowerCase()}.`,
        );
      }
      await this.log(tx, doc, "MANUAL", {
        request: { ...dto, reason: ctx().reason ?? null },
        ok: true,
        provider: "MANUAL",
      });
      await setEinvoice(tx, doc, {
        einvoiceStatus: "Generated",
        irn: dto.irn,
        ackNo: dto.ackNo,
        ackDate: new Date(dto.ackDate),
        signedQr: dto.signedQr ?? null,
        signedInvoice: null,
        irnLastError: null,
      });
      this.changed(doc);
    });
    return this.info(docType, id);
  }

  /** E-way bill from the invoice's IRN (Part A from the IRN, Part B from the transport details). */
  async ewayBill(siId: string, dto: z.infer<typeof ewayBillGenerate>): Promise<EwayBillResult> {
    await this.assertInScope("SI", siId);
    const { provider } = await this.settings.value("einvoice.config");
    return this.uow.run(async (tx) => {
      const doc = await lockDoc(tx, "SI", siId);
      const si = doc.row as typeof salesInvoices.$inferSelect;
      await this.assertEwayAllowed(si);
      if (si.einvoiceStatus !== "Generated" || !si.irn) {
        throw new AppError(
          409,
          "IRN_PENDING",
          "Generate the IRN first, or enter the e-way bill by hand.",
        );
      }
      if (provider === "MANUAL")
        throw validationError("E-invoicing is set to manual: enter the e-way bill by hand.");
      const [t] = si.transporterId
        ? await tx.select().from(transporters).where(eq(transporters.id, si.transporterId))
        : [];
      const input = {
        irn: si.irn,
        distanceKm: dto.distanceKm,
        vehicleNo: dto.vehicleNo ?? si.vehicleNo,
        transporterGstin: dto.transporterGstin ?? t?.gstin ?? null,
        transporterName: t?.name ?? null,
        transDocNo: dto.transDocNo ?? si.lrNo,
        transDocDate: dto.transDocDate ?? si.lrDate,
      };
      const started = Date.now();
      try {
        const r = await this.provider.generateEwayBill(input);
        await this.log(tx, doc, "EWAY_BILL", {
          request: input,
          response: r,
          ok: true,
          durationMs: Date.now() - started,
        });
        return this.saveEway(tx, si, {
          ewayBillNo: r.ewbNo,
          ewayBillDate: istDate(r.ewbDate),
          validUntil: r.validUntil ? istDate(r.validUntil) : null,
          distanceKm: dto.distanceKm,
          vehicleNo: input.vehicleNo,
        });
      } catch (error) {
        if (!(error instanceof EInvoiceProviderError)) throw error;
        await this.logDetached(doc, "EWAY_BILL", {
          request: input,
          response: error.response,
          ok: false,
          error: error.message,
        });
        throw einvoiceFailed(`The e-way bill wasn't generated: ${error.message}`);
      }
    });
  }

  /** An e-way bill made on the e-way bill portal by hand. */
  async recordEwayBill(siId: string, dto: z.infer<typeof ewayBillInput>): Promise<EwayBillResult> {
    await this.assertInScope("SI", siId);
    return this.uow.run(async (tx) => {
      const doc = await lockDoc(tx, "SI", siId);
      const si = doc.row as typeof salesInvoices.$inferSelect;
      await this.assertEwayAllowed(si);
      await this.log(tx, doc, "EWAY_BILL", { request: dto, ok: true, provider: "MANUAL" });
      return this.saveEway(tx, si, {
        ewayBillNo: dto.ewayBillNo,
        ewayBillDate: dto.ewayBillDate,
        validUntil: dto.validUntil ?? null,
      });
    });
  }

  private async assertEwayAllowed(si: typeof salesInvoices.$inferSelect) {
    if (si.status !== "Posted") throw validationError("Only a posted invoice gets an e-way bill.");
    if (si.ewayBillNo)
      throw validationError(`This invoice already has e-way bill ${si.ewayBillNo}.`);
  }

  private async saveEway(
    tx: Tx,
    si: typeof salesInvoices.$inferSelect,
    v: {
      ewayBillNo: string;
      ewayBillDate: string;
      validUntil: string | null;
      distanceKm?: number;
      vehicleNo?: string | null;
    },
  ): Promise<EwayBillResult> {
    await tx
      .update(salesInvoices)
      .set({
        ewayBillNo: v.ewayBillNo,
        ewayBillDate: v.ewayBillDate,
        ...(v.distanceKm !== undefined ? { distanceKm: v.distanceKm } : {}),
        ...(v.vehicleNo ? { vehicleNo: v.vehicleNo } : {}),
        updatedAt: new Date(),
        updatedBy: actor().userId,
      })
      .where(eq(salesInvoices.id, si.id));
    // The goods move on the challans; they carry the same e-way bill.
    const dcIds = (
      await tx.select().from(salesInvoiceDcs).where(eq(salesInvoiceDcs.siId, si.id))
    ).map((d) => d.dcId);
    if (dcIds.length) {
      await tx
        .update(deliveryChallans)
        .set({
          ewayBillNo: v.ewayBillNo,
          ewayBillDate: v.ewayBillDate,
          ewayBillValidUntil: v.validUntil,
          updatedAt: new Date(),
          updatedBy: actor().userId,
        })
        .where(inArray(deliveryChallans.id, dcIds));
    }
    this.bus.publishAfterCommit("sales.changed", { doc: "SI", id: si.id });
    return {
      siId: si.id,
      ewayBillNo: v.ewayBillNo,
      ewayBillDate: v.ewayBillDate,
      validUntil: v.validUntil,
    };
  }

  /** Posted documents still waiting for an IRN, oldest first, with the reporting deadline. */
  async queue(): Promise<EInvoiceQueueItem[]> {
    const scope = await loadCustomerScope(this.uow.db);
    const { reportingWindowDays } = await this.settings.value("einvoice.config");
    const today = istToday();
    const waiting = ["Pending", "Failed"] as const;
    const sis = await this.uow.db
      .select({ r: salesInvoices })
      .from(salesInvoices)
      .innerJoin(customers, eq(customers.id, salesInvoices.customerId))
      .where(
        and(
          eq(salesInvoices.companyId, actor().companyId),
          eq(salesInvoices.status, "Posted"),
          inArray(salesInvoices.einvoiceStatus, [...waiting]),
          customerScopeFilter(scope),
        ),
      );
    const notes = await this.uow.db
      .select({ r: customerNotes })
      .from(customerNotes)
      .innerJoin(customers, eq(customers.id, customerNotes.customerId))
      .where(
        and(
          eq(customerNotes.companyId, actor().companyId),
          eq(customerNotes.status, "Posted"),
          inArray(customerNotes.einvoiceStatus, [...waiting]),
          customerScopeFilter(scope),
        ),
      );
    const item = (
      docType: EDocType,
      r: typeof salesInvoices.$inferSelect | typeof customerNotes.$inferSelect,
      docNo: string | null,
    ): EInvoiceQueueItem => ({
      docType,
      id: r.id,
      docNo,
      date: r.date,
      customerName: r.customerName,
      total: D(r.total).toFixed(2),
      status: r.einvoiceStatus,
      attempts: r.irnAttempts,
      lastError: r.irnLastError,
      daysLeft: reportingWindowDays - daysBetween(r.date, today),
    });
    return [
      ...sis.map(({ r }) => item("SI", r, r.siNo)),
      ...notes.map(({ r }) => item(r.kind === "CREDIT" ? "CN" : "DN", r, r.noteNo)),
    ].sort((a, b) => a.date.localeCompare(b.date) || (a.docNo ?? "").localeCompare(b.docNo ?? ""));
  }

  /** Posted documents the queue should (re)try: Pending ones, across companies. */
  async pendingJobs(): Promise<
    { docType: EDocType; id: string; companyId: string; userId: string | null }[]
  > {
    const sis = await this.uow.db
      .select({
        id: salesInvoices.id,
        companyId: salesInvoices.companyId,
        userId: salesInvoices.postedBy,
      })
      .from(salesInvoices)
      .where(and(eq(salesInvoices.status, "Posted"), eq(salesInvoices.einvoiceStatus, "Pending")));
    const notes = await this.uow.db
      .select({
        id: customerNotes.id,
        kind: customerNotes.kind,
        companyId: customerNotes.companyId,
        userId: customerNotes.postedBy,
      })
      .from(customerNotes)
      .where(and(eq(customerNotes.status, "Posted"), eq(customerNotes.einvoiceStatus, "Pending")));
    return [
      ...sis.map((s) => ({ docType: "SI" as const, ...s })),
      ...notes.map(({ kind, ...n }) => ({
        docType: kind === "CREDIT" ? ("CN" as const) : ("DN" as const),
        ...n,
      })),
    ];
  }

  async requests(docType: EDocType, id: string): Promise<EInvoiceRequestItem[]> {
    await this.assertInScope(docType, id);
    const rows = await this.uow.db
      .select()
      .from(einvoiceRequests)
      .where(and(eq(einvoiceRequests.docType, docType), eq(einvoiceRequests.docId, id)))
      .orderBy(desc(einvoiceRequests.createdAt));
    return rows.map((r) => ({
      id: r.id,
      action: r.action as Action,
      provider: r.provider,
      ok: r.ok,
      error: r.error,
      durationMs: r.durationMs,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async info(docType: EDocType, id: string): Promise<EInvoiceInfo> {
    const doc = await lockDoc(this.uow.db, docType, id, { lock: false });
    const { cancelWindowHours } = await this.settings.value("einvoice.config");
    const r = doc.row;
    const since = r.ackDate ?? r.postedAt;
    return {
      status: r.einvoiceStatus,
      irn: r.irn,
      ackNo: r.ackNo,
      ackDate: r.ackDate?.toISOString() ?? null,
      signedQr: r.signedQr,
      attempts: r.irnAttempts,
      lastError: r.irnLastError,
      cancellableUntil:
        r.status === "Posted" && since
          ? new Date(since.getTime() + cancelWindowHours * 3_600_000).toISOString()
          : null,
    };
  }

  /** Customer scope (CLAUDE.md rule 10) for the per-document endpoints. */
  private async assertInScope(docType: EDocType, id: string) {
    const scope = await loadCustomerScope(this.uow.db);
    const t = docType === "SI" ? salesInvoices : customerNotes;
    const [row] = await this.uow.db
      .select({ id: t.id })
      .from(t)
      .innerJoin(customers, eq(customers.id, t.customerId))
      .where(and(eq(t.id, id), customerScopeFilter(scope)));
    if (!row) throw notFound(docType === "SI" ? "Sales invoice" : "Note");
  }

  private async log(
    tx: Tx,
    doc: EDoc,
    action: Action,
    v: {
      request?: unknown;
      response?: unknown;
      ok: boolean;
      error?: string;
      durationMs?: number;
      provider?: string;
    },
  ) {
    await tx.insert(einvoiceRequests).values({
      companyId: doc.companyId,
      docType: doc.docType,
      docId: doc.id,
      action,
      provider: v.provider ?? this.provider.name,
      request: v.request ?? null,
      response: v.response ?? null,
      ok: v.ok,
      error: v.error ?? null,
      durationMs: v.durationMs ?? null,
      createdBy: requestContext.getStore()?.actor?.userId || null,
    });
  }

  /** Logs a failed call in its own transaction, for commands that roll back on failure. */
  private async logDetached(doc: EDoc, action: Action, v: Parameters<EInvoiceService["log"]>[3]) {
    try {
      await this.uow.db.transaction((tx) => this.log(tx, doc, action, v));
    } catch (error) {
      this.logger.error(error, "could not log e-invoice request");
    }
  }

  private changed(doc: EDoc) {
    this.bus.publishAfterCommit("sales.changed", {
      doc: doc.docType === "SI" ? "SI" : "NOTE",
      id: doc.id,
    });
  }
}

/** The IST calendar date of an instant. */
const istDate = (d: Date) => new Date(d.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);
