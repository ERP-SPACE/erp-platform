import type {
  ProformaDetail,
  ProformaListItem,
  proformaCreate,
  salesListQuery,
} from "@erp/contracts";
import { type Tx, customers, proformaLines, proformas, salesInvoices, salesOrders } from "@erp/db";
import { D, type ProformaStatus, proformaMachine, taxLine } from "@erp/domain";
import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, gte, ilike, lte, ne, or } from "drizzle-orm";
import type { z } from "zod";
import { actor } from "../../common/context.js";
import { addDays } from "../../common/dates.js";
import { trimDecimal } from "../../common/decimal.js";
import { notFound, validationError } from "../../common/errors.js";
import { recordTransition } from "../../db/ledger.js";
import { UnitOfWork } from "../../db/unit-of-work.js";
import { updateVersioned } from "../../db/versioning.js";
import { customerScopeFilter, loadCustomerScope } from "../customers/customer-scope.js";
import { EventBus } from "../realtime/event-bus.js";
import { SeriesService } from "../series/series.service.js";
import { SettingsService } from "../settings/settings.service.js";
import {
  assertActiveCustomer,
  customerContext,
  documentTotals,
  loadSkus,
  resolveCharges,
  totalsColumns,
  totalsOut,
} from "./sales-common.js";

type Input = z.infer<typeof proformaCreate>;

/** Proforma invoices (PRD §5.7, §6.5): own series, no accounting effect, converted to an SI. */
@Injectable()
export class ProformasService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly bus: EventBus,
    private readonly series: SeriesService,
    private readonly settings: SettingsService,
  ) {}

  async list(query: z.infer<typeof salesListQuery>): Promise<ProformaListItem[]> {
    const scope = await loadCustomerScope(this.uow.db);
    const where = [customerScopeFilter(scope)];
    if (query.status) where.push(eq(proformas.status, query.status as ProformaStatus));
    if (query.customerId) where.push(eq(proformas.customerId, query.customerId));
    if (query.from) where.push(gte(proformas.date, query.from));
    if (query.to) where.push(lte(proformas.date, query.to));
    if (query.q) {
      const q = `%${query.q}%`;
      where.push(or(ilike(proformas.proformaNo, q), ilike(customers.legalName, q))!);
    }
    const rows = await this.uow.db
      .select({ pf: proformas, customerName: customers.legalName })
      .from(proformas)
      .innerJoin(customers, eq(customers.id, proformas.customerId))
      .where(and(...where))
      .orderBy(desc(proformas.date), desc(proformas.createdAt))
      .limit(500);
    return Promise.all(rows.map((r) => this.toItem(this.uow.db, r.pf, r.customerName)));
  }

  private async toItem(
    db: UnitOfWork["db"] | Tx,
    pf: typeof proformas.$inferSelect,
    customerName: string,
  ): Promise<ProformaListItem> {
    const [si] = await db
      .select({ id: salesInvoices.id, siNo: salesInvoices.siNo })
      .from(salesInvoices)
      .where(and(eq(salesInvoices.proformaId, pf.id), ne(salesInvoices.status, "Cancelled")));
    return {
      id: pf.id,
      proformaNo: pf.proformaNo,
      date: pf.date,
      validUntil: pf.validUntil,
      customerId: pf.customerId,
      customerName,
      status: pf.status,
      total: D(pf.total).toFixed(2),
      convertedSiId: si?.id ?? null,
      convertedSiNo: si?.siNo ?? null,
      version: pf.version,
    };
  }

  async get(id: string): Promise<ProformaDetail> {
    const scope = await loadCustomerScope(this.uow.db);
    const [row] = await this.uow.db
      .select({ pf: proformas, customerName: customers.legalName })
      .from(proformas)
      .innerJoin(customers, eq(customers.id, proformas.customerId))
      .where(and(eq(proformas.id, id), customerScopeFilter(scope)));
    if (!row) throw notFound("Proforma");
    const lines = await this.uow.db
      .select()
      .from(proformaLines)
      .where(eq(proformaLines.proformaId, id))
      .orderBy(asc(proformaLines.lineNo));
    return {
      ...(await this.toItem(this.uow.db, row.pf, row.customerName)),
      soId: row.pf.soId,
      notes: row.pf.notes,
      lines: lines.map((l) => ({
        id: l.id,
        skuId: l.skuId,
        description: l.description,
        widthIn: trimDecimal(l.widthIn),
        hsnCode: l.hsnCode,
        gstRate: trimDecimal(l.gstRate),
        metres: l.metres,
        ratePerM: trimDecimal(l.ratePerM),
        discountPct: trimDecimal(l.discountPct),
        taxable: D(l.taxable).toFixed(2),
      })),
      charges: row.pf.charges.map((c) => ({ ...c, taxable: c.amount })),
      totals: totalsOut(row.pf, row.pf.regime),
    };
  }

  async create(dto: Input): Promise<ProformaDetail> {
    const id = await this.uow.run(async (tx) => {
      const c = await customerContext(tx, dto.customerId);
      assertActiveCustomer(c.customer);
      await this.checkOrder(tx, dto);
      const proformaNo = await this.series.allocate(tx, "PF", dto.date);
      const days = await this.settings.value("sales.proformaValidityDays");
      const [pf] = await tx
        .insert(proformas)
        .values({
          companyId: actor().companyId,
          branchId: actor().branchId,
          customerId: dto.customerId,
          proformaNo,
          soId: dto.soId ?? null,
          date: dto.date,
          validUntil: dto.validUntil ?? addDays(dto.date, days),
          regime: c.regime,
          placeOfSupply: c.placeOfSupply,
          notes: dto.notes ?? null,
          createdBy: actor().userId,
          updatedBy: actor().userId,
        })
        .returning();
      await this.writeLines(tx, pf!.id, dto, c);
      await recordTransition(tx, "Proforma", pf!.id, null, "Draft");
      this.changed(pf!.id);
      return pf!.id;
    });
    return this.get(id);
  }

  async update(id: string, dto: Input & { version: number }): Promise<ProformaDetail> {
    await this.uow.run(async (tx) => {
      const pf = await this.lock(tx, id);
      if (pf.status !== "Draft" && pf.status !== "Sent") {
        throw validationError(`A ${pf.status.toLowerCase()} proforma can't be edited.`);
      }
      const c = await customerContext(tx, dto.customerId);
      await this.checkOrder(tx, dto);
      const days = await this.settings.value("sales.proformaValidityDays");
      await updateVersioned(
        tx,
        proformas,
        eq(proformas.id, id),
        dto.version,
        {
          customerId: dto.customerId,
          soId: dto.soId ?? null,
          date: dto.date,
          validUntil: dto.validUntil ?? addDays(dto.date, days),
          regime: c.regime,
          placeOfSupply: c.placeOfSupply,
          notes: dto.notes ?? null,
        },
        "Proforma",
      );
      await tx.delete(proformaLines).where(eq(proformaLines.proformaId, id));
      await this.writeLines(tx, id, dto, c);
      this.changed(id);
    });
    return this.get(id);
  }

  private async checkOrder(tx: Tx, dto: Input) {
    if (!dto.soId) return;
    const [so] = await tx.select().from(salesOrders).where(eq(salesOrders.id, dto.soId));
    if (!so || so.customerId !== dto.customerId) {
      throw validationError("That order isn't this customer's.", [
        { path: "soId", message: "Choose one of the customer's orders" },
      ]);
    }
  }

  private async writeLines(
    tx: Tx,
    id: string,
    dto: Input,
    c: Awaited<ReturnType<typeof customerContext>>,
  ) {
    const skus = await loadSkus(
      tx,
      dto.lines.map((l) => l.skuId),
    );
    const rows = dto.lines.map((l, i) => {
      const sku = skus.get(l.skuId)!;
      const discountPct = l.discountPct ?? "0";
      return {
        proformaId: id,
        lineNo: i + 1,
        skuId: l.skuId,
        description: sku.description,
        widthIn: sku.widthIn,
        hsnCode: sku.hsnCode,
        gstRate: sku.gstRate,
        metres: l.metres,
        ratePerM: l.ratePerM,
        discountPct,
        taxable: taxLine({
          quantity: l.metres,
          rate: l.ratePerM,
          discountPct,
          gstRate: 0,
        }).taxable.toFixed(2),
        createdBy: actor().userId,
      };
    });
    await tx.insert(proformaLines).values(rows);
    const charges = resolveCharges(dto.charges, await this.settings.value("invoice.extraCharges"));
    const totals = documentTotals(
      rows.map((r) => ({
        metres: r.metres,
        ratePerM: r.ratePerM,
        discountPct: r.discountPct,
        gstRate: r.gstRate,
      })),
      charges,
      {
        regime: c.regime,
        billDiscount: dto.billDiscount ?? "0",
        zeroRated: c.supplyType === "SEZWOP",
        roundOffTo: await this.settings.value("invoice.roundOffTo"),
      },
    );
    await tx
      .update(proformas)
      .set({ charges, billDiscount: D(dto.billDiscount ?? 0).toFixed(2), ...totalsColumns(totals) })
      .where(eq(proformas.id, id));
  }

  async transition(id: string, to: "Sent" | "Cancelled", version: number): Promise<ProformaDetail> {
    await this.uow.run(async (tx) => {
      const pf = await this.lock(tx, id);
      proformaMachine.assert(pf.status, to);
      if (to === "Cancelled") {
        const [si] = await tx
          .select({ id: salesInvoices.id })
          .from(salesInvoices)
          .where(and(eq(salesInvoices.proformaId, id), ne(salesInvoices.status, "Cancelled")));
        if (si) throw validationError("Cancel the draft invoice made from this proforma first.");
      }
      await updateVersioned(
        tx,
        proformas,
        eq(proformas.id, id),
        version,
        { status: to, ...(to === "Sent" ? { sentAt: new Date() } : {}) },
        "Proforma",
      );
      await recordTransition(tx, "Proforma", id, pf.status, to);
      this.changed(id);
    });
    return this.get(id);
  }

  private async lock(tx: Tx, id: string) {
    const scope = await loadCustomerScope(tx);
    const [row] = await tx
      .select({ pf: proformas })
      .from(proformas)
      .innerJoin(customers, eq(customers.id, proformas.customerId))
      .where(and(eq(proformas.id, id), customerScopeFilter(scope)))
      .for("update", { of: proformas });
    if (!row) throw notFound("Proforma");
    return row.pf;
  }

  private changed(id: string) {
    this.bus.publishAfterCommit("sales.changed", { doc: "PF", id });
  }
}
