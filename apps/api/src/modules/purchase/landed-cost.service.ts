import type { LandedCostChargeItem, LandedCostPreview } from "@erp/contracts";
import {
  type Tx,
  landedCostAllocations,
  landedCostCharges,
  purchaseInvoices,
  rolls,
} from "@erp/db";
import {
  D,
  type Dec,
  IN_STOCK_ROLL_STATUSES,
  type LandedCostBasis,
  allocateCharge,
  round,
  sum,
} from "@erp/domain";
import { Injectable } from "@nestjs/common";
import { and, asc, eq, sql } from "drizzle-orm";
import { actor, ctx } from "../../common/context.js";
import { notFound, reasonRequired, validationError } from "../../common/errors.js";
import { writePostingEvent } from "../../db/ledger.js";
import { UnitOfWork } from "../../db/unit-of-work.js";
import { EventBus } from "../realtime/event-bus.js";
import { SettingsService } from "../settings/settings.service.js";
import type { LandedCostRequestDto } from "./purchase.dto.js";

type RollRow = typeof rolls.$inferSelect;
interface PlannedCharge {
  code: string;
  label: string;
  basis: LandedCostBasis;
  amount: Dec;
  vendorName: string | null;
  billRef: string | null;
  shares: Map<string, Dec>;
}

/**
 * Landed cost (PRD §8.3, ADR-0017): each charge on a posted purchase invoice is split across that
 * invoice's rolls once, by its basis (defaults from Settings → purchase.landedCostCharges), with
 * the largest-remainder method so shares sum to the charge to the paisa. Rolls already gone
 * (dispatched, returned, scrapped) keep their cost; their share is recorded as variance.
 */
@Injectable()
export class LandedCostService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly bus: EventBus,
    private readonly settings: SettingsService,
  ) {}

  async list(piId: string): Promise<LandedCostChargeItem[]> {
    await this.pi(this.uow.db, piId);
    const rows = await this.uow.db
      .select()
      .from(landedCostCharges)
      .where(eq(landedCostCharges.piId, piId))
      .orderBy(asc(landedCostCharges.createdAt));
    return rows.map((c) => ({
      id: c.id,
      code: c.code,
      label: c.label,
      basis: c.basis,
      amount: D(c.amount).toFixed(2),
      vendorName: c.vendorName,
      billRef: c.billRef,
      allocated: Boolean(c.allocatedAt) && !c.reversedAt,
      allocatedAt: c.allocatedAt?.toISOString() ?? null,
      reversedAt: c.reversedAt?.toISOString() ?? null,
    }));
  }

  async preview(piId: string, dto: LandedCostRequestDto): Promise<LandedCostPreview> {
    const { plan, piRolls } = await this.plan(this.uow.db, piId, dto);
    return this.toPreview(plan, piRolls);
  }

  async apply(piId: string, dto: LandedCostRequestDto): Promise<LandedCostPreview> {
    return this.uow.run(async (tx) => {
      const { pi, plan, piRolls } = await this.plan(tx, piId, dto, true);
      const preview = this.toPreview(plan, piRolls);
      const now = new Date();
      const perRoll = new Map<string, Dec>();
      for (const charge of plan) {
        const [row] = await tx
          .insert(landedCostCharges)
          .values({
            piId,
            code: charge.code,
            label: charge.label,
            basis: charge.basis,
            amount: charge.amount.toFixed(2),
            vendorName: charge.vendorName,
            billRef: charge.billRef,
            allocatedAt: now,
            allocatedBy: actor().userId,
            createdBy: actor().userId,
            updatedBy: actor().userId,
          })
          .returning();
        await tx.insert(landedCostAllocations).values(
          piRolls.map((r) => ({
            chargeId: row!.id,
            rollId: r.id,
            kind: inStock(r) ? ("ALLOCATE" as const) : ("VARIANCE" as const),
            amount: charge.shares.get(r.id)!.toFixed(2),
            createdBy: actor().userId,
          })),
        );
        for (const r of piRolls) {
          if (inStock(r))
            perRoll.set(r.id, (perRoll.get(r.id) ?? D(0)).plus(charge.shares.get(r.id)!));
        }
      }
      await this.addToRolls(tx, piRolls, perRoll);
      await writePostingEvent(tx, {
        type: "LANDED_COST_ALLOCATED",
        docType: "PI",
        docId: piId,
        docNo: pi.piNo,
        docDate: pi.supplierInvoiceDate,
        partyType: "SUPPLIER",
        partyId: pi.supplierId,
        payload: {
          charges: preview.charges,
          capitalised: sum([...perRoll.values()]).toFixed(2),
          variance: preview.varianceAmount,
        },
      });
      this.changed(piId);
      return preview;
    });
  }

  /** Reverses one allocated charge (reason required); in-stock rolls give their share back. */
  async reverse(chargeId: string): Promise<LandedCostChargeItem[]> {
    const reason = ctx().reason?.trim();
    if (!reason) throw reasonRequired();
    const piId = await this.uow.run(async (tx) => {
      const [charge] = await tx
        .select({ c: landedCostCharges, companyId: purchaseInvoices.companyId })
        .from(landedCostCharges)
        .innerJoin(purchaseInvoices, eq(purchaseInvoices.id, landedCostCharges.piId))
        .where(eq(landedCostCharges.id, chargeId))
        .for("update", { of: landedCostCharges });
      if (!charge || charge.companyId !== actor().companyId) throw notFound("Landed-cost charge");
      if (!charge.c.allocatedAt || charge.c.reversedAt)
        throw validationError("This charge is not currently allocated.");
      const pi = await this.pi(tx, charge.c.piId);
      const shares = await tx
        .select({ a: landedCostAllocations, roll: rolls })
        .from(landedCostAllocations)
        .innerJoin(rolls, eq(rolls.id, landedCostAllocations.rollId))
        .where(eq(landedCostAllocations.chargeId, chargeId))
        .for("update", { of: rolls });
      const perRoll = new Map<string, Dec>();
      await tx.insert(landedCostAllocations).values(
        shares.map(({ a, roll }) => {
          const back = D(a.amount).negated();
          // Only rolls that took the share (ALLOCATE) and are still in stock give it back.
          const capitalised = a.kind === "ALLOCATE" && inStock(roll);
          if (capitalised) perRoll.set(roll.id, back);
          return {
            chargeId,
            rollId: roll.id,
            kind: capitalised ? ("REVERSE" as const) : ("VARIANCE" as const),
            amount: back.toFixed(2),
            createdBy: actor().userId,
          };
        }),
      );
      await this.addToRolls(
        tx,
        shares.map((s) => s.roll),
        perRoll,
      );
      await tx
        .update(landedCostCharges)
        .set({
          reversedAt: new Date(),
          reversedBy: actor().userId,
          updatedAt: new Date(),
          updatedBy: actor().userId,
          version: sql`${landedCostCharges.version} + 1`,
        })
        .where(eq(landedCostCharges.id, chargeId));
      await writePostingEvent(tx, {
        type: "LANDED_COST_REVERSED",
        docType: "PI",
        docId: pi.id,
        docNo: pi.piNo,
        docDate: pi.supplierInvoiceDate,
        partyType: "SUPPLIER",
        partyId: pi.supplierId,
        payload: { chargeId, code: charge.c.code, amount: D(charge.c.amount).toFixed(2), reason },
      });
      this.changed(pi.id);
      return pi.id;
    });
    return this.list(piId);
  }

  // ── helpers ────────────────────────────────────────────────────────────

  private async plan(
    db: UnitOfWork["db"] | Tx,
    piId: string,
    dto: LandedCostRequestDto,
    lock = false,
  ) {
    const pi = await this.pi(db, piId);
    if (pi.status !== "Posted")
      throw validationError("Post the purchase invoice before adding landed cost.");
    // The read-only db and a transaction share the query API; only a transaction locks.
    const query = (db as Tx)
      .select()
      .from(rolls)
      .where(eq(rolls.piId, piId))
      .orderBy(asc(rolls.barcode));
    const piRolls: RollRow[] = lock ? await query.for("update") : await query;
    if (piRolls.length === 0) {
      throw validationError("This invoice has no rolls yet — link its goods receipt first.");
    }
    const configured = await this.settings.value("purchase.landedCostCharges");
    const issues: { path: string; message: string }[] = [];
    const plan: PlannedCharge[] = dto.charges.map((c, i) => {
      const setting = configured.find((s) => s.code === c.code && s.active);
      if (!setting)
        issues.push({
          path: `charges.${i}.code`,
          message: `Unknown or inactive charge "${c.code}"`,
        });
      const basis = c.basis ?? setting?.basis ?? "VALUE";
      const amount = D(c.amount);
      return {
        code: c.code,
        label: setting?.label ?? c.code,
        basis,
        amount,
        vendorName: c.vendorName ?? null,
        billRef: c.billRef ?? null,
        shares: issues.length
          ? new Map()
          : allocateCharge(
              amount,
              basis,
              piRolls.map((r) => ({
                id: r.id,
                lengthM: r.originalLengthM,
                baseValue: r.baseValue,
                gsm: r.gsm,
                widthIn: r.widthIn,
              })),
            ),
      };
    });
    if (issues.length) throw validationError("Some charges are not configured.", issues);
    return { pi, plan, piRolls };
  }

  private toPreview(plan: PlannedCharge[], piRolls: RollRow[]): LandedCostPreview {
    let variance = D(0);
    const rows = piRolls.map((r) => {
      const shares = Object.fromEntries(plan.map((c) => [c.code, c.shares.get(r.id)!.toFixed(2)]));
      const added = sum(plan.map((c) => c.shares.get(r.id)!));
      if (!inStock(r)) variance = variance.plus(added);
      const landed = inStock(r) ? D(r.landedCost).plus(added) : D(r.landedCost);
      return {
        rollId: r.id,
        barcode: r.barcode,
        description: r.description,
        lengthM: r.originalLengthM,
        baseValue: D(r.baseValue).toFixed(2),
        shares,
        landedCost: landed.toFixed(2),
        costPerMetre: round(D(r.baseValue).plus(landed).dividedBy(r.originalLengthM), 4).toFixed(4),
        dispatched: !inStock(r),
      };
    });
    return {
      rows,
      charges: plan.map((c) => ({
        code: c.code,
        basis: c.basis,
        amount: c.amount.toFixed(2),
        allocated: sum([...c.shares.values()]).toFixed(2),
      })),
      varianceAmount: variance.toFixed(2),
    };
  }

  private async addToRolls(tx: Tx, all: RollRow[], delta: Map<string, Dec>) {
    for (const r of all) {
      const d = delta.get(r.id);
      if (!d || d.isZero()) continue;
      const landed = D(r.landedCost).plus(d);
      await tx
        .update(rolls)
        .set({
          landedCost: landed.toFixed(2),
          costPerM: round(D(r.baseValue).plus(landed).dividedBy(r.originalLengthM), 4).toFixed(4),
          updatedAt: new Date(),
          updatedBy: actor().userId,
          version: sql`${rolls.version} + 1`,
        })
        .where(eq(rolls.id, r.id));
    }
  }

  private async pi(db: UnitOfWork["db"] | Tx, piId: string) {
    const [pi] = await db
      .select()
      .from(purchaseInvoices)
      .where(and(eq(purchaseInvoices.id, piId), eq(purchaseInvoices.companyId, actor().companyId)));
    if (!pi) throw notFound("Purchase invoice");
    return pi;
  }

  private changed(piId: string) {
    this.bus.publishAfterCommit("purchase.changed", { doc: "PI", id: piId });
    this.bus.publishAfterCommit("inventory.changed", { piId });
  }
}

const inStock = (r: Pick<RollRow, "status">) => IN_STOCK_ROLL_STATUSES.includes(r.status);
