import type { BulkRevisionRow, PartyRateItem, RateHistoryItem } from "@erp/contracts";
import {
  type Tx,
  customerGroupMembers,
  customers,
  partyRates,
  products,
  rateHistory,
  user,
} from "@erp/db";
import { istToday, reviseRate } from "@erp/domain";
import { Injectable } from "@nestjs/common";
import { type SQL, and, asc, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { actor, ctx } from "../../common/context.js";
import { trimDecimal } from "../../common/decimal.js";
import { addDays, inRange } from "../../common/dates.js";
import { notFound, reasonRequired, validationError } from "../../common/errors.js";
import { UnitOfWork } from "../../db/unit-of-work.js";
import { loadProductNames } from "../catalogue/catalogue.service.js";
import { customerScopeFilter, loadCustomerScope } from "../customers/customer-scope.js";
import { CustomersService } from "../customers/customers.service.js";
import { EventBus } from "../realtime/event-bus.js";
import { SettingsService } from "../settings/settings.service.js";
import type { BulkRevisionDto, SetPartyRateDto } from "./pricing.dto.js";

type RateRow = typeof partyRates.$inferSelect;

/** Rate rows in effect on `date`: started on or before it and not closed before it. */
const effectiveOn = (date: string) =>
  and(
    lte(partyRates.validFrom, date),
    or(isNull(partyRates.validTo), gte(partyRates.validTo, date)),
  )!;

/**
 * Customer rates per metre at 44″ (ADR-0013) with validity ranges. Ranges never overlap —
 * the database enforces it (EXCLUDE on party_rates, the Stage 1 gate); revising closes the
 * running rate the day before the new one starts. Every change appends to rate_history.
 */
@Injectable()
export class PricingService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly bus: EventBus,
    private readonly customers: CustomersService,
    private readonly settings: SettingsService,
  ) {}

  async listRates(customerId: string): Promise<PartyRateItem[]> {
    const scope = await loadCustomerScope(this.uow.db);
    await this.customers.findInScope(this.uow.db, customerId, scope);
    const rows = await this.uow.db
      .select()
      .from(partyRates)
      .where(eq(partyRates.customerId, customerId))
      .orderBy(asc(partyRates.productId), desc(partyRates.validFrom));
    const names = await loadProductNames(
      this.uow.db,
      rows.map((r) => r.productId),
    );
    const today = istToday();
    return rows
      .map((r) => ({
        id: r.id,
        productId: r.productId,
        productName: names.get(r.productId)?.name ?? "",
        categoryName: names.get(r.productId)?.categoryName ?? "",
        baseRate44: trimDecimal(r.baseRate44),
        validFrom: r.validFrom,
        validTo: r.validTo,
        source: r.source,
        current: inRange(today, r.validFrom, r.validTo),
      }))
      .sort(
        (a, b) =>
          a.productName.localeCompare(b.productName) || b.validFrom.localeCompare(a.validFrom),
      );
  }

  async setRate(customerId: string, dto: SetPartyRateDto): Promise<PartyRateItem[]> {
    const scope = await loadCustomerScope(this.uow.db);
    await this.uow.run(async (tx) => {
      await this.customers.findInScope(tx, customerId, scope);
      const [product] = await tx
        .select({ id: products.id })
        .from(products)
        .where(and(eq(products.id, dto.productId), eq(products.companyId, actor().companyId)));
      if (!product) throw notFound("Product");
      if (dto.validTo && dto.validTo < dto.validFrom) {
        throw validationError("The end date is before the start date.", [
          { path: "validTo", message: "Must be on or after the start date" },
        ]);
      }

      let previous: RateRow | undefined;
      let validTo = dto.validTo ?? null;
      if (dto.mode === "revise") {
        [previous] = await tx
          .select()
          .from(partyRates)
          .where(
            and(
              eq(partyRates.customerId, customerId),
              eq(partyRates.productId, dto.productId),
              effectiveOn(dto.validFrom),
            ),
          )
          .for("update");
        if (previous && previous.validFrom === dto.validFrom) {
          // Same start date: correct the rate in place rather than creating a zero-length range.
          await tx
            .update(partyRates)
            .set({
              baseRate44: dto.baseRate44,
              source: "manual",
              updatedAt: new Date(),
              updatedBy: actor().userId,
              version: sql`${partyRates.version} + 1`,
            })
            .where(eq(partyRates.id, previous.id));
          await this.writeHistory(
            tx,
            customerId,
            dto.productId,
            previous.baseRate44,
            dto.baseRate44,
            dto.validFrom,
            "manual",
          );
          this.bus.publishAfterCommit("customers.changed", { id: customerId });
          return;
        }
        if (previous) {
          validTo ??= previous.validTo;
          await tx
            .update(partyRates)
            .set({
              validTo: addDays(dto.validFrom, -1),
              updatedAt: new Date(),
              updatedBy: actor().userId,
              version: sql`${partyRates.version} + 1`,
            })
            .where(eq(partyRates.id, previous.id));
        }
      }
      await tx.insert(partyRates).values({
        customerId,
        productId: dto.productId,
        baseRate44: dto.baseRate44,
        validFrom: dto.validFrom,
        validTo,
        source: "manual",
        createdBy: actor().userId,
        updatedBy: actor().userId,
      });
      await this.writeHistory(
        tx,
        customerId,
        dto.productId,
        previous?.baseRate44 ?? null,
        dto.baseRate44,
        dto.validFrom,
        "manual",
      );
      this.bus.publishAfterCommit("customers.changed", { id: customerId });
    });
    return this.listRates(customerId);
  }

  async history(customerId: string): Promise<RateHistoryItem[]> {
    const scope = await loadCustomerScope(this.uow.db);
    await this.customers.findInScope(this.uow.db, customerId, scope);
    const rows = await this.uow.db
      .select({ h: rateHistory, byName: user.name })
      .from(rateHistory)
      .leftJoin(user, eq(user.id, rateHistory.createdBy))
      .where(eq(rateHistory.customerId, customerId))
      .orderBy(desc(rateHistory.createdAt))
      .limit(500);
    const names = await loadProductNames(
      this.uow.db,
      rows.map((r) => r.h.productId),
    );
    return rows.map(({ h, byName }) => ({
      id: h.id,
      productName: names.get(h.productId)?.name ?? "",
      previousRate44: trimDecimal(h.previousRate44),
      newRate44: trimDecimal(h.newRate44),
      validFrom: h.validFrom,
      source: h.source,
      reason: h.reason,
      byName,
      at: h.createdAt.toISOString(),
    }));
  }

  // ── bulk revision (PRD §6.4) ────────────────────────────────────────────

  async previewBulk(dto: BulkRevisionDto) {
    const rows = await this.bulkRows(this.uow.db, dto, false);
    return {
      rows: rows.map((r) => r.row),
      customers: new Set(rows.map((r) => r.row.customerId)).size,
    };
  }

  /** One transaction: close running ranges, insert revised ones, write history; all or nothing. */
  async applyBulk(dto: BulkRevisionDto) {
    const reason = ctx().reason?.trim();
    if (!reason) throw reasonRequired();
    return this.uow.run(async (tx) => {
      const rows = await this.bulkRows(tx, dto, true);
      for (const { rate, row } of rows) {
        if (rate.validFrom === dto.effectiveFrom) {
          await tx
            .update(partyRates)
            .set({
              baseRate44: row.newRate44,
              source: "bulk_revision",
              updatedAt: new Date(),
              updatedBy: actor().userId,
              version: sql`${partyRates.version} + 1`,
            })
            .where(eq(partyRates.id, rate.id));
        } else {
          await tx
            .update(partyRates)
            .set({
              validTo: addDays(dto.effectiveFrom, -1),
              updatedAt: new Date(),
              updatedBy: actor().userId,
              version: sql`${partyRates.version} + 1`,
            })
            .where(eq(partyRates.id, rate.id));
          await tx.insert(partyRates).values({
            customerId: rate.customerId,
            productId: rate.productId,
            baseRate44: row.newRate44,
            validFrom: dto.effectiveFrom,
            validTo: rate.validTo,
            source: "bulk_revision",
            createdBy: actor().userId,
            updatedBy: actor().userId,
          });
        }
        await this.writeHistory(
          tx,
          rate.customerId,
          rate.productId,
          rate.baseRate44,
          row.newRate44,
          dto.effectiveFrom,
          "bulk_revision",
          reason,
        );
      }
      const customerIds = [...new Set(rows.map((r) => r.row.customerId))];
      if (customerIds.length) {
        this.bus.publishAfterCommit("customers.changed", { ids: customerIds.join(",") });
      }
      return { revised: rows.length, customers: customerIds.length };
    });
  }

  /** Rates in scope that are in effect on the effective date, with their revised values. */
  private async bulkRows(
    db: UnitOfWork["db"] | Tx,
    dto: BulkRevisionDto,
    lock: boolean,
  ): Promise<{ rate: RateRow; row: BulkRevisionRow }[]> {
    const scope = await loadCustomerScope(db);
    const decimals = await this.settings.value("pricing.rateDecimals");
    const filters: (SQL | undefined)[] = [
      customerScopeFilter(scope),
      eq(customers.active, true),
      effectiveOn(dto.effectiveFrom),
    ];
    if (dto.customerIds.length || dto.groupIds.length) {
      const target: SQL[] = [];
      if (dto.customerIds.length) target.push(inArray(customers.id, dto.customerIds));
      if (dto.groupIds.length) {
        target.push(
          sql`EXISTS (SELECT 1 FROM ${customerGroupMembers} m WHERE m.customer_id = ${customers.id} AND ${inArray(sql`m.group_id`, dto.groupIds)})`,
        );
      }
      filters.push(or(...target));
    }
    if (dto.categoryIds.length) filters.push(inArray(products.categoryId, dto.categoryIds));
    if (dto.qualityIds.length) filters.push(inArray(products.qualityId, dto.qualityIds));
    if (dto.gsms.length) filters.push(inArray(products.gsm, dto.gsms));

    const query = db
      .select({ rate: partyRates, customerName: customers.legalName })
      .from(partyRates)
      .innerJoin(customers, eq(customers.id, partyRates.customerId))
      .innerJoin(products, eq(products.id, partyRates.productId))
      .where(and(...filters))
      .orderBy(asc(customers.legalName));
    const rows = lock ? await query.for("update", { of: partyRates }) : await query;
    const names = await loadProductNames(
      db,
      rows.map((r) => r.rate.productId),
    );
    return (
      rows
        .map(({ rate, customerName }) => {
          const next = reviseRate(rate.baseRate44, { mode: dto.mode, value: dto.value }, decimals);
          return {
            rate,
            row: {
              customerId: rate.customerId,
              customerName,
              productId: rate.productId,
              productName: names.get(rate.productId)?.name ?? "",
              oldRate44: trimDecimal(rate.baseRate44),
              newRate44: next.toFixed(decimals),
            },
          };
        })
        // A change that rounds to the same rate is not a revision.
        .filter((r) => trimDecimal(r.row.newRate44) !== r.row.oldRate44)
    );
  }

  private async writeHistory(
    tx: Tx,
    customerId: string,
    productId: string,
    previous: string | null,
    next: string,
    validFrom: string,
    source: "manual" | "bulk_revision",
    reason = ctx().reason ?? null,
  ) {
    await tx.insert(rateHistory).values({
      customerId,
      productId,
      previousRate44: previous,
      newRate44: next,
      validFrom,
      source,
      reason,
      createdBy: actor().userId,
    });
  }
}
