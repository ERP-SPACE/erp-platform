import type { RollEvent, RollInspector, RollItem, RollPage } from "@erp/contracts";
import {
  type Tx,
  batches,
  categories,
  goodsReceipts,
  labelPrints,
  landedCostAllocations,
  landedCostCharges,
  products,
  purchaseInvoices,
  purchaseReturnRolls,
  purchaseReturns,
  qualities,
  rolls,
  skus,
  statusTransitions,
  suppliers,
  user,
} from "@erp/db";
import {
  D,
  type RollStatus,
  parseRollBarcode,
  rollMachine,
  rollWeightKg,
  round,
  sum,
} from "@erp/domain";
import { Injectable } from "@nestjs/common";
import { type SQL, and, asc, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { actor, ctx } from "../../common/context.js";
import { trimDecimal } from "../../common/decimal.js";
import { notFound, reasonRequired, validationError } from "../../common/errors.js";
import { recordTransition, writePostingEvent } from "../../db/ledger.js";
import { UnitOfWork } from "../../db/unit-of-work.js";
import { updateVersioned } from "../../db/versioning.js";
import { CatalogueService } from "../catalogue/catalogue.service.js";
import { EventBus } from "../realtime/event-bus.js";
import { searchFilter } from "../suppliers/suppliers.service.js";
import type { MapRollsDto, RollListQueryDto } from "./inventory.dto.js";

const IN_STOCK: RollStatus[] = ["Unmapped", "Mapped", "Allocated"];
const SCRAPPABLE = new Set<RollStatus>(["Unmapped", "Mapped", "Returned"]);

const rollSelect = {
  roll: rolls,
  supplierName: suppliers.name,
  batchSeq: batches.batchSeq,
  supplierBatchRef: batches.supplierBatchRef,
  grnNo: goodsReceipts.grnNo,
  skuCode: skus.code,
};

/**
 * Rolls (PRD §6.3): lists, the Roll Inspector, mapping Unmapped rolls, scrap and length
 * correction. Every status change goes through the roll state machine and is logged; cost is
 * only shown to users with `inventory.view_cost` (labels never carry it — ADR-0006).
 */
@Injectable()
export class RollsService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly bus: EventBus,
    private readonly catalogue: CatalogueService,
  ) {}

  async list(query: RollListQueryDto): Promise<RollPage> {
    const filters: (SQL | undefined)[] = [eq(rolls.companyId, actor().companyId)];
    if (query.status) filters.push(eq(rolls.status, query.status));
    if (query.skuId) filters.push(eq(rolls.skuId, query.skuId));
    if (query.supplierId) filters.push(eq(rolls.supplierId, query.supplierId));
    if (query.grnId) filters.push(eq(rolls.grnId, query.grnId));
    if (query.inStock === "true") filters.push(inArray(rolls.status, IN_STOCK));
    if (query.inStock === "false") filters.push(sql`${rolls.status} NOT IN ('Unmapped','Mapped','Allocated')`);
    if (query.cursor) filters.push(lt(rolls.id, query.cursor));
    filters.push(searchFilter(sql`(${rolls.barcode} || ' ' || ${rolls.description})`, query.q));
    const rows = await this.uow.db
      .select(rollSelect)
      .from(rolls)
      .innerJoin(suppliers, eq(suppliers.id, rolls.supplierId))
      .innerJoin(batches, eq(batches.id, rolls.batchId))
      .innerJoin(goodsReceipts, eq(goodsReceipts.id, rolls.grnId))
      .leftJoin(skus, eq(skus.id, rolls.skuId))
      .where(and(...filters))
      .orderBy(desc(rolls.id))
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    return {
      items: page.map(toItem),
      nextCursor: rows.length > query.limit ? page.at(-1)!.roll.id : null,
    };
  }

  /** Roll Inspector by id or by a scanned barcode (PRD UAT §11.2). */
  async inspect(idOrBarcode: string): Promise<RollInspector> {
    const db = this.uow.db;
    const scanned = parseRollBarcode(idOrBarcode);
    const where = scanned.valid
      ? eq(rolls.barcode, idOrBarcode.trim().toUpperCase())
      : /^[0-9a-f-]{36}$/i.test(idOrBarcode)
        ? eq(rolls.id, idOrBarcode)
        : undefined;
    if (!where) throw validationError(scanned.valid ? "Roll not found." : scanned.error);
    const [row] = await db
      .select({ ...rollSelect, piNo: purchaseInvoices.piNo, supplierInvoiceNo: purchaseInvoices.supplierInvoiceNo, grnDate: goodsReceipts.date })
      .from(rolls)
      .innerJoin(suppliers, eq(suppliers.id, rolls.supplierId))
      .innerJoin(batches, eq(batches.id, rolls.batchId))
      .innerJoin(goodsReceipts, eq(goodsReceipts.id, rolls.grnId))
      .leftJoin(skus, eq(skus.id, rolls.skuId))
      .leftJoin(purchaseInvoices, eq(purchaseInvoices.id, rolls.piId))
      .where(and(where, eq(rolls.companyId, actor().companyId)));
    if (!row) throw notFound("Roll");
    const r = row.roll;
    const [transitions, prints, costs, returns, children] = await Promise.all([
      db
        .select({ t: statusTransitions, byName: user.name })
        .from(statusTransitions)
        .leftJoin(user, eq(user.id, statusTransitions.by))
        .where(and(eq(statusTransitions.entityType, "Roll"), eq(statusTransitions.entityId, r.id))),
      db
        .select({ p: labelPrints, byName: user.name })
        .from(labelPrints)
        .leftJoin(user, eq(user.id, labelPrints.createdBy))
        .where(eq(labelPrints.rollId, r.id)),
      db
        .select({ a: landedCostAllocations, label: landedCostCharges.label, byName: user.name })
        .from(landedCostAllocations)
        .innerJoin(landedCostCharges, eq(landedCostCharges.id, landedCostAllocations.chargeId))
        .leftJoin(user, eq(user.id, landedCostAllocations.createdBy))
        .where(eq(landedCostAllocations.rollId, r.id)),
      db
        .select({ pr: purchaseReturns })
        .from(purchaseReturnRolls)
        .innerJoin(purchaseReturns, eq(purchaseReturns.id, purchaseReturnRolls.returnId))
        .where(eq(purchaseReturnRolls.rollId, r.id)),
      db.select({ id: rolls.id }).from(rolls).where(eq(rolls.parentRollId, r.id)),
    ]);
    const showCost = canSeeCost();
    const events: RollEvent[] = [
      {
        at: r.receivedAt.toISOString(),
        kind: "DOCUMENT" as const,
        title: `Received on ${row.grnNo}`,
        detail: `${row.supplierName} · lot ${String(row.batchSeq).padStart(4, "0")}${row.supplierBatchRef ? ` (${row.supplierBatchRef})` : ""} · ${r.originalLengthM} m`,
        byName: null,
        docType: "GRN",
        docId: r.grnId,
        docNo: row.grnNo,
      },
      ...transitions.map(({ t, byName }) => ({
        at: t.at.toISOString(),
        kind: "STATUS" as const,
        title: t.fromStatus ? `${t.fromStatus} → ${t.toStatus}` : `Created as ${t.toStatus}`,
        detail: t.reason,
        byName,
        docType: null,
        docId: null,
        docNo: null,
      })),
      ...prints.map(({ p, byName }) => ({
        at: p.createdAt.toISOString(),
        kind: "LABEL" as const,
        title: p.reprint ? "Label reprinted" : "Label printed",
        detail: p.reason,
        byName,
        docType: null,
        docId: null,
        docNo: null,
      })),
      ...(showCost
        ? costs.map(({ a, label, byName }) => ({
            at: a.createdAt.toISOString(),
            kind: "COST" as const,
            title: `${label}: ${a.kind === "ALLOCATE" ? "+" : a.kind === "REVERSE" ? "reversed " : "variance "}₹${D(a.amount).toFixed(2)}`,
            detail: null,
            byName,
            docType: "PI",
            docId: r.piId,
            docNo: row.piNo,
          }))
        : []),
      ...returns.map(({ pr }) => ({
        at: (pr.postedAt ?? pr.createdAt).toISOString(),
        kind: "DOCUMENT" as const,
        title: `Purchase return ${pr.prNo ?? "(draft)"}`,
        detail: pr.reason,
        byName: null,
        docType: "PR",
        docId: pr.id,
        docNo: pr.prNo,
      })),
    ].sort((a, b) => a.at.localeCompare(b.at));
    return {
      ...toItem(row),
      piId: r.piId,
      piNo: row.piNo,
      supplierInvoiceNo: row.supplierInvoiceNo,
      baseValue: showCost ? D(r.baseValue).toFixed(2) : null,
      landedCost: showCost ? D(r.landedCost).toFixed(2) : null,
      weightKg: rollWeightKg(r.gsm, r.widthIn, r.currentLengthM).toFixed(3),
      parentRollId: r.parentRollId,
      childRollIds: children.map((c) => c.id),
      labelPrints: prints.length,
      events,
    };
  }

  /** Maps Unmapped rolls to a SKU, creating the product/SKU first when asked (PRD §6.2). */
  async map(dto: MapRollsDto): Promise<{ mapped: number; skuId: string }> {
    const skuId = dto.skuId ?? (await this.ensureSku(dto.createSku!));
    const [sku] = await this.uow.db
      .select({ sku: skus, gsm: products.gsm, category: categories.name, quality: qualities.name })
      .from(skus)
      .innerJoin(products, eq(products.id, skus.productId))
      .innerJoin(categories, eq(categories.id, products.categoryId))
      .innerJoin(qualities, eq(qualities.id, products.qualityId))
      .where(and(eq(skus.id, skuId), eq(skus.companyId, actor().companyId)));
    if (!sku) throw notFound("SKU");
    const mapped = await this.uow.run(async (tx) => {
      const found = await this.lockRolls(tx, dto.rollIds);
      const issues: { path: string; message: string }[] = [];
      for (const r of found) {
        if (r.status !== "Unmapped") issues.push({ path: "rollIds", message: `${r.barcode} is already ${r.status}` });
        else if (r.gsm !== sku.gsm || D(r.widthIn).comparedTo(D(sku.sku.widthIn)) !== 0) {
          issues.push({
            path: "skuId",
            message: `${r.barcode} is ${r.gsm} GSM × ${trimDecimal(r.widthIn)}″, the SKU is ${sku.gsm} GSM × ${trimDecimal(sku.sku.widthIn)}″`,
          });
        }
      }
      if (issues.length) throw validationError("Some rolls can't be mapped to this SKU.", issues);
      for (const r of found) rollMachine.assert(r.status, "Mapped");
      const now = new Date();
      await tx
        .update(rolls)
        .set({
          status: "Mapped",
          skuId,
          description: `${sku.category} ${sku.quality} ${sku.gsm} GSM ${trimDecimal(sku.sku.widthIn)}″`,
          qualityName: sku.quality,
          mappedAt: now,
          updatedAt: now,
          updatedBy: actor().userId,
          version: sql`${rolls.version} + 1`,
        })
        .where(inArray(rolls.id, found.map((r) => r.id)));
      await recordTransition(tx, "Roll", found.map((r) => r.id), "Unmapped", "Mapped", `Mapped to ${sku.sku.code}`);
      this.changed();
      return found.length;
    });
    return { mapped, skuId };
  }

  /** Scrap (UAT §11.2): reason + step-up at the controller; writes ROLL_SCRAPPED at carrying cost. */
  async scrap(rollIds: string[]): Promise<{ scrapped: number; value: string | null }> {
    const reason = ctx().reason?.trim();
    if (!reason) throw reasonRequired();
    const value = await this.uow.run(async (tx) => {
      const found = await this.lockRolls(tx, rollIds);
      const bad = found.find((r) => !SCRAPPABLE.has(r.status));
      if (bad) throw validationError(`${bad.barcode} is ${bad.status} and can't be scrapped.`);
      const lines = found.map((r) => ({
        rollId: r.id,
        barcode: r.barcode,
        skuId: r.skuId,
        lengthM: r.currentLengthM,
        costPerM: r.costPerM ?? r.baseCostPerM ?? "0",
        value: round(D(r.costPerM ?? r.baseCostPerM ?? 0).times(r.currentLengthM), 2).toFixed(2),
      }));
      for (const status of SCRAPPABLE) {
        const ids = found.filter((r) => r.status === status).map((r) => r.id);
        if (!ids.length) continue;
        rollMachine.assert(status, "Scrap");
        await tx
          .update(rolls)
          .set({ status: "Scrap", updatedAt: new Date(), updatedBy: actor().userId, version: sql`${rolls.version} + 1` })
          .where(inArray(rolls.id, ids));
        await recordTransition(tx, "Roll", ids, status, "Scrap", reason);
      }
      const total = sum(lines.map((l) => l.value)).toFixed(2);
      await writePostingEvent(tx, {
        type: "ROLL_SCRAPPED",
        docType: "ROLL",
        docId: found[0]!.id,
        docNo: found.length === 1 ? found[0]!.barcode : `${found.length} rolls`,
        docDate: new Date().toISOString().slice(0, 10),
        payload: { reason, rolls: lines, total },
      });
      this.changed();
      return total;
    });
    return { scrapped: rollIds.length, value: canSeeCost() ? value : null };
  }

  /** Fixes a mis-keyed supplier length on an untouched roll; base value follows the new length. */
  async correctLength(id: string, lengthM: number, version: number): Promise<RollItem> {
    if (!ctx().reason?.trim()) throw reasonRequired();
    await this.uow.run(async (tx) => {
      const [r] = await this.lockRolls(tx, [id]);
      if (!IN_STOCK.includes(r!.status) || r!.status === "Allocated") {
        throw validationError(`A ${r!.status} roll's length can't be corrected.`);
      }
      if (r!.currentLengthM !== r!.originalLengthM || r!.parentRollId) {
        throw validationError("This roll has been cut; correct the cut instead.");
      }
      const children = await tx.select({ id: rolls.id }).from(rolls).where(eq(rolls.parentRollId, id));
      if (children.length) throw validationError("This roll has been cut; correct the cut instead.");
      const baseValue = r!.baseCostPerM ? round(D(r!.baseCostPerM).times(lengthM), 2) : D(r!.baseValue);
      await updateVersioned(
        tx,
        rolls,
        eq(rolls.id, id),
        version,
        {
          originalLengthM: lengthM,
          currentLengthM: lengthM,
          baseValue: baseValue.toFixed(2),
          costPerM: round(baseValue.plus(r!.landedCost).dividedBy(lengthM), 4).toFixed(4),
        },
        "Roll",
      );
      this.changed();
    });
    return toItem((await this.rowById(id))!);
  }

  private async rowById(id: string) {
    const [row] = await this.uow.db
      .select(rollSelect)
      .from(rolls)
      .innerJoin(suppliers, eq(suppliers.id, rolls.supplierId))
      .innerJoin(batches, eq(batches.id, rolls.batchId))
      .innerJoin(goodsReceipts, eq(goodsReceipts.id, rolls.grnId))
      .leftJoin(skus, eq(skus.id, rolls.skuId))
      .where(eq(rolls.id, id));
    return row;
  }

  private async lockRolls(tx: Tx, ids: string[]) {
    const unique = [...new Set(ids)];
    const found = await tx
      .select()
      .from(rolls)
      .where(and(eq(rolls.companyId, actor().companyId), inArray(rolls.id, unique)))
      .orderBy(asc(rolls.id))
      .for("update");
    if (found.length !== unique.length) throw notFound("Roll");
    return found;
  }

  /** Finds or creates the product (category × quality × GSM) and its SKU at this width. */
  private async ensureSku(spec: NonNullable<MapRollsDto["createSku"]>): Promise<string> {
    const [existing] = await this.uow.db
      .select({ productId: products.id })
      .from(products)
      .where(
        and(
          eq(products.companyId, actor().companyId),
          eq(products.categoryId, spec.categoryId),
          eq(products.qualityId, spec.qualityId),
          eq(products.gsm, spec.gsm),
        ),
      );
    const product = existing
      ? await this.catalogue.getProduct(existing.productId)
      : await this.catalogue.createProduct({
          categoryId: spec.categoryId,
          qualityId: spec.qualityId,
          gsm: spec.gsm,
          defaultLengthM: spec.defaultLengthM,
          widthsIn: [spec.widthIn],
        });
    const at = (p: typeof product) => p.skus.find((s) => Number(s.widthIn) === spec.widthIn);
    const sku = at(product) ?? at(await this.catalogue.addSkus(product.id, { widthsIn: [spec.widthIn] }));
    return sku!.id;
  }

  private changed() {
    this.bus.publishAfterCommit("inventory.changed", { at: new Date().toISOString() });
  }
}

export function canSeeCost(): boolean {
  return actor().permissions.has("inventory.view_cost");
}

function toItem(row: {
  roll: typeof rolls.$inferSelect;
  supplierName: string;
  batchSeq: number;
  supplierBatchRef: string | null;
  grnNo: string;
  skuCode: string | null;
}): RollItem {
  const r = row.roll;
  const showCost = canSeeCost();
  return {
    id: r.id,
    barcode: r.barcode,
    status: r.status,
    skuId: r.skuId,
    skuCode: row.skuCode,
    description: r.description,
    gsm: r.gsm,
    widthIn: trimDecimal(r.widthIn),
    qualityName: r.qualityName,
    originalLengthM: r.originalLengthM,
    currentLengthM: r.currentLengthM,
    supplierId: r.supplierId,
    supplierName: row.supplierName,
    batchCode: String(row.batchSeq).padStart(4, "0"),
    supplierBatchRef: row.supplierBatchRef,
    grnId: r.grnId,
    grnNo: row.grnNo,
    receivedAt: r.receivedAt.toISOString(),
    ageDays: Math.floor((Date.now() - r.receivedAt.getTime()) / 86_400_000),
    baseCostPerM: showCost && r.baseCostPerM ? trimDecimal(r.baseCostPerM) : null,
    landedCostPerM: showCost && r.costPerM ? trimDecimal(r.costPerM) : null,
    version: r.version,
  };
}
