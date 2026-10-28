import type {
  AllocationPreview,
  CreditCheck,
  RateQuote,
  SoDetail,
  SoListItem,
  soCreate,
  salesListQuery,
} from "@erp/contracts";
import {
  type Tx,
  customers,
  deliveryChallanRolls,
  deliveryChallans,
  partyRates,
  rolls,
  salesInvoiceLines,
  salesInvoices,
  salesOrderLines,
  salesOrders,
  salesmanDefaultRates,
  salesmen,
} from "@erp/db";
import {
  D,
  type SoStatus,
  allocateRolls,
  checkOverride,
  istToday,
  resolveRate,
  salesOrderMachine,
  taxLine,
} from "@erp/domain";
import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, gte, ilike, inArray, lte, ne, or, sql } from "drizzle-orm";
import type { z } from "zod";
import { actor, ctx, runAsSystem } from "../../common/context.js";
import { trimDecimal } from "../../common/decimal.js";
import {
  approvalRequired,
  notFound,
  reasonRequired,
  validationError,
} from "../../common/errors.js";
import { recordTransition } from "../../db/ledger.js";
import { UnitOfWork } from "../../db/unit-of-work.js";
import { updateVersioned } from "../../db/versioning.js";
import { customerScopeFilter, loadCustomerScope } from "../customers/customer-scope.js";
import { EventBus } from "../realtime/event-bus.js";
import { SeriesService } from "../series/series.service.js";
import { SettingsService } from "../settings/settings.service.js";
import { CreditRecheckQueue } from "./credit-recheck.queue.js";
import { CreditService } from "./credit.service.js";
import {
  type Db,
  assertActiveCustomer,
  customerContext,
  documentTotals,
  loadSkus,
  resolveCharges,
  totalsColumns,
  totalsOut,
} from "./sales-common.js";

type SoInput = z.infer<typeof soCreate>;
type ListQuery = z.infer<typeof salesListQuery>;
const EDITABLE = new Set<SoStatus>(["Draft"]);

/**
 * Sales orders (PRD §6.5, ADR-0012/0013/0016). Rates start from the customer's 44″ rate and are
 * derived per width; a rate outside the tolerance waits for a manager's approval before Confirm.
 * Confirm runs the credit check: Confirmed, or OnHold with the reasons (OnHold never holds stock).
 */
@Injectable()
export class SalesOrdersService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly bus: EventBus,
    private readonly series: SeriesService,
    private readonly settings: SettingsService,
    private readonly credit: CreditService,
    private readonly creditRecheck: CreditRecheckQueue,
  ) {}

  // ── rates & stock ──────────────────────────────────────────────────────────

  async quote(customerId: string, skuId: string, date = istToday()): Promise<RateQuote> {
    const c = await customerContext(this.uow.db, customerId);
    const sku = (await loadSkus(this.uow.db, [skuId])).get(skuId)!;
    const resolved = await this.resolve(this.uow.db, c.customer, sku, date);
    const [stock] = await this.uow.db
      .select({ m: sql<number>`coalesce(sum(${rolls.currentLengthM}), 0)::int` })
      .from(rolls)
      .where(and(eq(rolls.skuId, skuId), eq(rolls.status, "Mapped")));
    return {
      source: resolved.source,
      base44: resolved.base44 === null ? null : trimDecimal(resolved.base44.toString()),
      ratePerM: resolved.ratePerM === null ? null : resolved.ratePerM.toFixed(2),
      widthIn: sku.widthIn,
      gstRate: sku.gstRate,
      availableM: stock?.m ?? 0,
    };
  }

  private async resolve(
    db: Db,
    customer: { id: string; salesmanId: string | null },
    sku: { productId: string; widthIn: string },
    date: string,
  ) {
    const decimals = await this.settings.value("pricing.rateDecimals");
    const rates = await db
      .select({
        baseRate44: partyRates.baseRate44,
        validFrom: partyRates.validFrom,
        validTo: partyRates.validTo,
      })
      .from(partyRates)
      .where(and(eq(partyRates.customerId, customer.id), eq(partyRates.productId, sku.productId)));
    let salesmanDefault44: string | null = null;
    if (customer.salesmanId) {
      const [d] = await db
        .select({ rate: salesmanDefaultRates.baseRate44 })
        .from(salesmanDefaultRates)
        .where(
          and(
            eq(salesmanDefaultRates.salesmanId, customer.salesmanId),
            eq(salesmanDefaultRates.productId, sku.productId),
          ),
        );
      salesmanDefault44 = d?.rate ?? null;
    }
    return resolveRate({ partyRates: rates, salesmanDefault44 }, date, sku.widthIn, decimals);
  }

  // ── read ───────────────────────────────────────────────────────────────────

  async list(query: ListQuery): Promise<SoListItem[]> {
    const scope = await loadCustomerScope(this.uow.db);
    const where = [customerScopeFilter(scope)];
    if (query.status) where.push(eq(salesOrders.status, query.status as SoStatus));
    if (query.customerId) where.push(eq(salesOrders.customerId, query.customerId));
    if (query.from) where.push(gte(salesOrders.date, query.from));
    if (query.to) where.push(lte(salesOrders.date, query.to));
    if (query.q) {
      const q = `%${query.q}%`;
      where.push(or(ilike(salesOrders.soNo, q), ilike(customers.legalName, q))!);
    }
    const rows = await this.uow.db
      .select({ so: salesOrders, customerName: customers.legalName, salesmanName: salesmen.name })
      .from(salesOrders)
      .innerJoin(customers, eq(customers.id, salesOrders.customerId))
      .leftJoin(salesmen, eq(salesmen.id, salesOrders.salesmanId))
      .where(and(...where))
      .orderBy(desc(salesOrders.date), desc(salesOrders.createdAt))
      .limit(500);
    const sums = await this.lineSums(rows.map((r) => r.so.id));
    return rows.map((r) => toListItem(r.so, r.customerName, r.salesmanName, sums.get(r.so.id)));
  }

  private async lineSums(ids: string[]) {
    if (!ids.length)
      return new Map<string, { ordered: number; dispatched: number; pending: boolean }>();
    const rows = await this.uow.db
      .select({
        soId: salesOrderLines.soId,
        ordered: sql<number>`sum(${salesOrderLines.totalM})::int`,
        dispatched: sql<number>`sum(${salesOrderLines.dispatchedM})::int`,
        pending: sql<boolean>`bool_or(${salesOrderLines.needsApproval} AND ${salesOrderLines.approvedAt} IS NULL)`,
      })
      .from(salesOrderLines)
      .where(inArray(salesOrderLines.soId, ids))
      .groupBy(salesOrderLines.soId);
    return new Map(rows.map((r) => [r.soId, r]));
  }

  async get(id: string, db: Db = this.uow.db): Promise<SoDetail> {
    const scope = await loadCustomerScope(db);
    const [row] = await db
      .select({ so: salesOrders, customerName: customers.legalName, salesmanName: salesmen.name })
      .from(salesOrders)
      .innerJoin(customers, eq(customers.id, salesOrders.customerId))
      .leftJoin(salesmen, eq(salesmen.id, salesOrders.salesmanId))
      .where(and(eq(salesOrders.id, id), customerScopeFilter(scope)));
    if (!row) throw notFound("Sales order");
    const so = row.so;
    const lines = await db
      .select({
        line: salesOrderLines,
        approver: sql<
          string | null
        >`(SELECT name FROM "user" u WHERE u.id = ${salesOrderLines.approvedBy})`,
      })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.soId, id))
      .orderBy(asc(salesOrderLines.lineNo));
    const skuCodes = await loadSkus(
      db,
      lines.map((l) => l.line.skuId),
    );
    const dcs = await db
      .select({
        id: deliveryChallans.id,
        dcNo: deliveryChallans.dcNo,
        status: deliveryChallans.status,
      })
      .from(deliveryChallans)
      .where(eq(deliveryChallans.soId, id))
      .orderBy(asc(deliveryChallans.createdAt));
    const invoices = await db
      .selectDistinct({
        id: salesInvoices.id,
        siNo: salesInvoices.siNo,
        status: salesInvoices.status,
      })
      .from(salesInvoices)
      .innerJoin(salesInvoiceLines, eq(salesInvoiceLines.siId, salesInvoices.id))
      .innerJoin(salesOrderLines, eq(salesOrderLines.id, salesInvoiceLines.soLineId))
      .where(eq(salesOrderLines.soId, id));
    const [released] = so.releasedBy
      ? (
          await db.execute<{ name: string }>(
            sql`SELECT name FROM "user" WHERE id = ${so.releasedBy}`,
          )
        ).rows
      : [];
    const sums = {
      ordered: lines.reduce((s, l) => s + l.line.totalM, 0),
      dispatched: lines.reduce((s, l) => s + l.line.dispatchedM, 0),
      pending: lines.some((l) => l.line.needsApproval && !l.line.approvedAt),
    };
    return {
      ...toListItem(so, row.customerName, row.salesmanName, sums),
      customerRef: so.customerRef,
      shippingAddressId: so.shippingAddressId,
      placeOfSupply: so.placeOfSupply,
      notes: so.notes,
      lines: lines.map(({ line: l, approver }) => ({
        id: l.id,
        skuId: l.skuId,
        skuCode: skuCodes.get(l.skuId)?.skuCode ?? "",
        description: l.description,
        widthIn: trimDecimal(l.widthIn),
        gsm: l.gsm,
        hsnCode: l.hsnCode,
        gstRate: l.gstRate === null ? null : trimDecimal(l.gstRate),
        totalM: l.totalM,
        lengthMix: l.lengthMix ?? null,
        qtyRolls: l.qtyRolls,
        allowCut: l.allowCut,
        rateSource: l.rateSource,
        base44: trimDecimal(l.base44),
        derivedRatePerM: l.derivedRatePerM === null ? null : D(l.derivedRatePerM).toFixed(2),
        ratePerM: trimDecimal(l.ratePerM),
        deviationPct: trimDecimal(l.deviationPct),
        needsApproval: l.needsApproval,
        approvedByName: approver,
        discountPct: trimDecimal(l.discountPct),
        amount: D(l.amount).toFixed(2),
        dispatchedM: l.dispatchedM,
        invoicedM: l.invoicedM,
        balanceM: Math.max(0, l.totalM - l.dispatchedM),
        notes: l.notes,
      })),
      charges: so.charges.map((c) => ({ ...c, taxable: c.amount })),
      totals: totalsOut(so, so.regime),
      credit: (so.creditCheck as CreditCheck | null) ?? null,
      releasedByName: released?.name ?? null,
      dcs,
      invoices,
    };
  }

  // ── write ──────────────────────────────────────────────────────────────────

  async create(dto: SoInput): Promise<SoDetail> {
    const id = await this.uow.run(async (tx) => {
      const c = await customerContext(tx, dto.customerId, dto.shippingAddressId);
      assertActiveCustomer(c.customer);
      const soNo = await this.series.allocate(tx, "SO", dto.date);
      const [so] = await tx
        .insert(salesOrders)
        .values({
          companyId: actor().companyId,
          branchId: actor().branchId,
          customerId: dto.customerId,
          soNo,
          date: dto.date,
          regime: c.regime,
          placeOfSupply: c.placeOfSupply,
          shippingAddressId: c.shippingAddressId,
          salesmanId: c.customer.salesmanId,
          customerRef: dto.customerRef ?? null,
          notes: dto.notes ?? null,
          createdBy: actor().userId,
          updatedBy: actor().userId,
        })
        .returning();
      await this.writeLines(tx, so!.id, dto, c);
      await recordTransition(tx, "SalesOrder", so!.id, null, "Draft");
      this.changed(so!.id);
      return so!.id;
    });
    return this.get(id);
  }

  async update(id: string, dto: SoInput & { version: number }): Promise<SoDetail> {
    await this.uow.run(async (tx) => {
      const so = await this.lock(tx, id);
      if (!EDITABLE.has(so.status)) throw validationError(`A ${so.status} order can't be edited.`);
      const c = await customerContext(tx, dto.customerId, dto.shippingAddressId);
      assertActiveCustomer(c.customer);
      await updateVersioned(
        tx,
        salesOrders,
        eq(salesOrders.id, id),
        dto.version,
        {
          customerId: dto.customerId,
          date: dto.date,
          regime: c.regime,
          placeOfSupply: c.placeOfSupply,
          shippingAddressId: c.shippingAddressId,
          salesmanId: c.customer.salesmanId,
          customerRef: dto.customerRef ?? null,
          notes: dto.notes ?? null,
          creditCheck: null,
          heldReasons: [],
        },
        "Sales order",
      );
      await tx.delete(salesOrderLines).where(eq(salesOrderLines.soId, id));
      await this.writeLines(tx, id, dto, c);
      this.changed(id);
    });
    return this.get(id);
  }

  /** Lines with their rate source, derived rate and override check; then the order's totals. */
  private async writeLines(
    tx: Tx,
    soId: string,
    dto: SoInput,
    c: Awaited<ReturnType<typeof customerContext>>,
  ) {
    const skuMap = await loadSkus(
      tx,
      dto.lines.map((l) => l.skuId),
    );
    const tolerance = await this.settings.value("pricing.overrideTolerancePct");
    const charges = resolveCharges(dto.charges, await this.settings.value("invoice.extraCharges"));
    const values = [];
    for (const [i, l] of dto.lines.entries()) {
      const sku = skuMap.get(l.skuId)!;
      const resolved = await this.resolve(tx, c.customer, sku, dto.date);
      const check = checkOverride(resolved.ratePerM, l.ratePerM, tolerance);
      const qtyRolls = l.lengthMix?.length
        ? l.lengthMix.reduce((s, m) => s + m.rolls, 0)
        : Math.max(1, Math.ceil(l.totalM / sku.defaultLengthM));
      const discountPct = l.discountPct ?? "0";
      values.push({
        soId,
        lineNo: i + 1,
        skuId: l.skuId,
        description: sku.description,
        gsm: sku.gsm,
        widthIn: sku.widthIn,
        hsnCode: sku.hsnCode,
        gstRate: sku.gstRate,
        totalM: l.totalM,
        lengthMix: l.lengthMix?.length ? l.lengthMix : null,
        qtyRolls,
        allowCut: l.allowCut ?? c.customer.allowCut,
        rateSource: resolved.source,
        base44: resolved.base44?.toString() ?? null,
        derivedRatePerM: resolved.ratePerM?.toFixed(4) ?? null,
        ratePerM: l.ratePerM,
        deviationPct: resolved.ratePerM ? check.deviationPct.toFixed(2) : null,
        needsApproval: check.needsApproval,
        discountPct,
        amount: taxLine({
          quantity: l.totalM,
          rate: l.ratePerM,
          discountPct,
          gstRate: 0,
        }).taxable.toFixed(2),
        notes: l.notes ?? null,
        createdBy: actor().userId,
      });
    }
    await tx.insert(salesOrderLines).values(values);
    const totals = documentTotals(
      values.map((v) => ({
        metres: v.totalM,
        ratePerM: v.ratePerM,
        discountPct: v.discountPct,
        gstRate: v.gstRate,
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
      .update(salesOrders)
      .set({ charges, billDiscount: D(dto.billDiscount ?? 0).toFixed(2), ...totalsColumns(totals) })
      .where(eq(salesOrders.id, soId));
  }

  /** Confirm (PRD §6.5 click 1): approvals first, then the credit check decides Confirmed / OnHold. */
  async confirm(id: string, version: number): Promise<SoDetail> {
    await this.uow.run(async (tx) => {
      const so = await this.lock(tx, id);
      if (so.status !== "Draft") salesOrderMachine.assert(so.status, "Confirmed");
      const lines = await tx.select().from(salesOrderLines).where(eq(salesOrderLines.soId, id));
      const waiting = lines.filter((l) => l.needsApproval && !l.approvedAt);
      if (waiting.length) {
        throw approvalRequired(
          "Some rates are outside the allowed range and need a manager's approval.",
          waiting.map((l) => ({
            path: `lines.${l.lineNo - 1}.ratePerM`,
            message: `${l.description}: ₹${trimDecimal(l.ratePerM)}/m is ${trimDecimal(l.deviationPct) ?? "—"} % from ₹${l.derivedRatePerM ? D(l.derivedRatePerM).toFixed(2) : "—"}/m`,
          })),
        );
      }
      const c = await customerContext(tx, so.customerId);
      assertActiveCustomer(c.customer);
      const check = await this.credit.check(tx, so.customerId, so.total, so.id, c.policy);
      const to: SoStatus = check.blocked ? "OnHold" : "Confirmed";
      salesOrderMachine.assert(so.status, to);
      await updateVersioned(
        tx,
        salesOrders,
        eq(salesOrders.id, id),
        version,
        {
          status: to,
          creditCheck: check,
          heldReasons: check.blocked ? check.reasons : [],
          confirmedAt: new Date(),
          confirmedBy: actor().userId,
        },
        "Sales order",
      );
      await recordTransition(
        tx,
        "SalesOrder",
        id,
        so.status,
        to,
        check.blocked ? `Credit: ${check.reasons.join(", ")}` : null,
      );
      this.changed(id);
    });
    return this.get(id);
  }

  /** A manager approves out-of-range rates (step-up; PRD §6.4). */
  async approveRates(id: string, version: number): Promise<SoDetail> {
    await this.uow.run(async (tx) => {
      const so = await this.lock(tx, id);
      if (!EDITABLE.has(so.status))
        throw validationError("Only a draft order's rates can be approved.");
      const updated = await tx
        .update(salesOrderLines)
        .set({ approvedAt: new Date(), approvedBy: actor().userId })
        .where(
          and(
            eq(salesOrderLines.soId, id),
            eq(salesOrderLines.needsApproval, true),
            sql`${salesOrderLines.approvedAt} IS NULL`,
          ),
        )
        .returning({ id: salesOrderLines.id });
      if (!updated.length)
        throw validationError("No rates on this order are waiting for approval.");
      await updateVersioned(tx, salesOrders, eq(salesOrders.id, id), version, {}, "Sales order");
      this.changed(id);
    });
    return this.get(id);
  }

  /** Re-run the credit check on a held order: it confirms if the customer is now within terms. */
  async recheck(id: string, version: number): Promise<SoDetail> {
    await this.uow.run(async (tx) => {
      const so = await this.lock(tx, id);
      if (so.status !== "OnHold") throw validationError("Only an order on hold can be re-checked.");
      const c = await customerContext(tx, so.customerId);
      const check = await this.credit.check(tx, so.customerId, so.total, so.id, c.policy);
      const to: SoStatus = check.blocked ? "OnHold" : "Confirmed";
      await updateVersioned(
        tx,
        salesOrders,
        eq(salesOrders.id, id),
        version,
        { status: to, creditCheck: check, heldReasons: check.blocked ? check.reasons : [] },
        "Sales order",
      );
      if (to !== so.status)
        await recordTransition(tx, "SalesOrder", id, so.status, to, "Credit re-check");
      this.changed(id);
    });
    return this.get(id);
  }

  /**
   * Automatic credit re-check (Stage 3 step 6): after a credit note, a cancelled invoice or order,
   * or a credit-policy change, orders the credit check put on hold are checked again, oldest
   * first, and confirmed once the customer is within terms. Manual holds (no credit reasons) are
   * left for a person. Runs per order as whoever confirmed it, so its company and scope apply.
   */
  async recheckHeld(
    filter: { companyId: string; customerId: string | null } | null,
  ): Promise<{ checked: number; released: number }> {
    const held = await this.uow.db
      .select({
        id: salesOrders.id,
        companyId: salesOrders.companyId,
        userId: sql<string | null>`coalesce(${salesOrders.confirmedBy}, ${salesOrders.createdBy})`,
      })
      .from(salesOrders)
      .where(
        and(
          eq(salesOrders.status, "OnHold"),
          sql`cardinality(${salesOrders.heldReasons}) > 0`,
          filter ? eq(salesOrders.companyId, filter.companyId) : undefined,
          filter?.customerId ? eq(salesOrders.customerId, filter.customerId) : undefined,
        ),
      )
      .orderBy(asc(salesOrders.confirmedAt), asc(salesOrders.createdAt));
    let released = 0;
    for (const h of held) {
      const confirmed = await runAsSystem({ ...h, name: "Credit re-check" }, () =>
        this.uow.run(async (tx) => {
          const [so] = await tx
            .select()
            .from(salesOrders)
            .where(eq(salesOrders.id, h.id))
            .for("update");
          if (!so || so.status !== "OnHold" || !so.heldReasons.length) return false;
          const c = await customerContext(tx, so.customerId);
          const check = await this.credit.check(tx, so.customerId, so.total, so.id, c.policy);
          const to: SoStatus = check.blocked ? "OnHold" : "Confirmed";
          await updateVersioned(
            tx,
            salesOrders,
            eq(salesOrders.id, so.id),
            so.version,
            { status: to, creditCheck: check, heldReasons: check.blocked ? check.reasons : [] },
            "Sales order",
          );
          if (to === "Confirmed") {
            salesOrderMachine.assert("OnHold", "Confirmed");
            await recordTransition(
              tx,
              "SalesOrder",
              so.id,
              "OnHold",
              "Confirmed",
              "Credit re-check: customer is within terms again",
            );
          }
          this.changed(so.id);
          return to === "Confirmed";
        }),
      );
      if (confirmed) released++;
    }
    return { checked: held.length, released };
  }

  /** Release a credit hold (PRD §8.5 step 4): reason mandatory, step-up, audited. */
  async release(id: string, version: number): Promise<SoDetail> {
    const reason = ctx().reason?.trim();
    if (!reason) throw reasonRequired();
    await this.uow.run(async (tx) => {
      const so = await this.lock(tx, id);
      if (so.status !== "OnHold") throw validationError("Only an order on hold can be released.");
      salesOrderMachine.assert(so.status, "Confirmed");
      await updateVersioned(
        tx,
        salesOrders,
        eq(salesOrders.id, id),
        version,
        { status: "Confirmed", releasedAt: new Date(), releasedBy: actor().userId },
        "Sales order",
      );
      await recordTransition(tx, "SalesOrder", id, "OnHold", "Confirmed", reason);
      this.changed(id);
    });
    return this.get(id);
  }

  /** Hold / close (short-close) / cancel. Cancel only while nothing has been picked or sent. */
  async transition(
    id: string,
    to: "OnHold" | "Closed" | "Cancelled",
    version: number,
  ): Promise<SoDetail> {
    await this.uow.run(async (tx) => {
      const so = await this.lock(tx, id);
      salesOrderMachine.assert(so.status, to);
      if (to === "Cancelled") {
        const [busy] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(deliveryChallans)
          .where(and(eq(deliveryChallans.soId, id), ne(deliveryChallans.status, "Cancelled")));
        if (busy!.n > 0)
          throw validationError("This order has challans. Cancel them first, or close the order.");
      }
      if (to === "Closed") {
        const [draft] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(deliveryChallans)
          .where(and(eq(deliveryChallans.soId, id), eq(deliveryChallans.status, "Draft")));
        if (draft!.n > 0)
          throw validationError("Post or cancel the draft challan before closing the order.");
      }
      await updateVersioned(
        tx,
        salesOrders,
        eq(salesOrders.id, id),
        version,
        { status: to },
        "Sales order",
      );
      await recordTransition(tx, "SalesOrder", id, so.status, to);
      // Its value leaves the customer's exposure; other held orders may now fit.
      if (to !== "OnHold") this.creditRecheck.enqueueAfterCommit(so.customerId);
      this.changed(id);
    });
    return this.get(id);
  }

  // ── allocation suggestion (ADR-0014: suggestion only, nothing is held) ──────

  async allocation(id: string): Promise<AllocationPreview> {
    const so = await this.get(id);
    const opts = await this.settings.value("inventory.allocation");
    const picked = await this.uow.db
      .select({
        soLineId: deliveryChallanRolls.soLineId,
        m: sql<number>`sum(${deliveryChallanRolls.lengthM})::int`,
      })
      .from(deliveryChallanRolls)
      .innerJoin(deliveryChallans, eq(deliveryChallans.id, deliveryChallanRolls.dcId))
      .where(and(eq(deliveryChallans.soId, id), eq(deliveryChallans.status, "Draft")))
      .groupBy(deliveryChallanRolls.soLineId);
    const pickedBy = new Map(picked.map((p) => [p.soLineId, p.m]));
    const lines = [];
    // Two lines of one SKU must not be offered the same rolls.
    const taken = new Set<string>();
    for (const line of so.lines) {
      const requiredM = Math.max(0, line.totalM - line.dispatchedM - (pickedBy.get(line.id) ?? 0));
      const stock = await this.uow.db
        .select({
          id: rolls.id,
          barcode: rolls.barcode,
          lengthM: rolls.currentLengthM,
          receivedAt: rolls.receivedAt,
        })
        .from(rolls)
        .where(
          and(
            eq(rolls.companyId, actor().companyId),
            eq(rolls.skuId, line.skuId),
            eq(rolls.status, "Mapped"),
          ),
        );
      const available = stock.filter((r) => !taken.has(r.id));
      const result = requiredM
        ? allocateRolls(
            available.map((r) => ({
              id: r.id,
              lengthM: r.lengthM,
              inwardAt: r.receivedAt.getTime(),
            })),
            requiredM,
            {
              standardLengthM: opts.standardLengthM,
              toleranceM: opts.toleranceM,
              minRemnantM: opts.minUsableLengthM,
              allowCut: line.allowCut,
            },
          )
        : null;
      const byId = new Map(stock.map((r) => [r.id, r]));
      result?.rolls.forEach((r) => taken.add(r.id));
      if (result?.cut) taken.add(result.cut.rollId);
      lines.push({
        soLineId: line.id,
        status: result?.status ?? ("FULFILLED" as const),
        rolls: (result?.rolls ?? []).map((r) => {
          const s = byId.get(r.id)!;
          return {
            rollId: r.id,
            barcode: s.barcode,
            lengthM: s.lengthM,
            ageDays: Math.floor((Date.now() - s.receivedAt.getTime()) / 86_400_000),
          };
        }),
        cut: result?.cut ? { ...result.cut, barcode: byId.get(result.cut.rollId)!.barcode } : null,
        groups: result?.groups ?? [],
        requiredM,
        allocatedM: result?.allocatedM ?? 0,
        remainingM: result?.remainingM ?? 0,
      });
    }
    return { lines };
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  async lock(tx: Tx, id: string) {
    const scope = await loadCustomerScope(tx);
    const [row] = await tx
      .select({ so: salesOrders })
      .from(salesOrders)
      .innerJoin(customers, eq(customers.id, salesOrders.customerId))
      .where(and(eq(salesOrders.id, id), customerScopeFilter(scope)))
      .for("update", { of: salesOrders });
    if (!row) throw notFound("Sales order");
    return row.so;
  }

  private changed(id: string) {
    this.bus.publishAfterCommit("sales.changed", { doc: "SO", id });
  }
}

function toListItem(
  so: typeof salesOrders.$inferSelect,
  customerName: string,
  salesmanName: string | null,
  sums: { ordered: number; dispatched: number; pending: boolean } | undefined,
): SoListItem {
  return {
    id: so.id,
    soNo: so.soNo,
    date: so.date,
    customerId: so.customerId,
    customerName,
    salesmanName,
    status: so.status,
    orderedM: sums?.ordered ?? 0,
    dispatchedM: sums?.dispatched ?? 0,
    total: D(so.total).toFixed(2),
    pendingApproval: sums?.pending ?? false,
    heldReasons: so.heldReasons as SoListItem["heldReasons"],
    version: so.version,
  };
}
