import type { PiDetail, PiListItem } from "@erp/contracts";
import {
  type Tx,
  goodsReceiptLines,
  goodsReceipts,
  purchaseInvoiceGrns,
  purchaseInvoiceLines,
  purchaseInvoices,
  purchaseOrderLines,
  purchaseOrders,
  rolls,
  suppliers,
} from "@erp/db";
import {
  D,
  type PiStatus,
  invoiceTotals,
  purchaseInvoiceMachine,
  round,
  taxLine,
} from "@erp/domain";
import { Injectable } from "@nestjs/common";
import { type SQL, and, asc, desc, eq, gte, inArray, isNotNull, lte, ne, sql } from "drizzle-orm";
import { actor, ctx } from "../../common/context.js";
import { trimDecimal } from "../../common/decimal.js";
import { notFound, reasonRequired, validationError } from "../../common/errors.js";
import { recordTransition, writePostingEvent } from "../../db/ledger.js";
import { UnitOfWork } from "../../db/unit-of-work.js";
import { updateVersioned } from "../../db/versioning.js";
import { EventBus } from "../realtime/event-bus.js";
import { SeriesService } from "../series/series.service.js";
import { searchFilter } from "../suppliers/suppliers.service.js";
import { assertActiveSupplier, sameItem, supplierWithRegime } from "./purchase-common.js";
import type { PiCreateDto, PiUpdateDto, PurchaseListQueryDto } from "./purchase.dto.js";

/**
 * Purchase invoices (PRD §6.2, ADR-0017). Drafts mirror the supplier's tax invoice line for
 * line; posting numbers it, fixes the totals (with the supplier's printed round-off), moves the
 * PO's invoiced metres, gives the linked GRN rolls their base cost from the invoice rates, and
 * writes PI_POSTED. A PI may be posted before its goods arrive (Q14): link the GRN afterwards.
 */
@Injectable()
export class PurchaseInvoicesService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly bus: EventBus,
    private readonly series: SeriesService,
  ) {}

  async list(query: PurchaseListQueryDto): Promise<PiListItem[]> {
    const filters: (SQL | undefined)[] = [eq(purchaseInvoices.companyId, actor().companyId)];
    if (query.supplierId) filters.push(eq(purchaseInvoices.supplierId, query.supplierId));
    if (query.status) filters.push(eq(purchaseInvoices.status, query.status as PiStatus));
    if (query.from) filters.push(gte(purchaseInvoices.supplierInvoiceDate, query.from));
    if (query.to) filters.push(lte(purchaseInvoices.supplierInvoiceDate, query.to));
    filters.push(
      searchFilter(
        sql`(coalesce(${purchaseInvoices.piNo}, '') || ' ' || ${purchaseInvoices.supplierInvoiceNo} || ' ' || ${suppliers.name})`,
        query.q,
      ),
    );
    const rows = await this.uow.db
      .select({
        pi: purchaseInvoices,
        supplierName: suppliers.name,
        rollCount: sql<number>`(SELECT count(*) FROM rolls r WHERE r.pi_id = ${purchaseInvoices.id})::int`,
        allocated: sql<boolean>`EXISTS (SELECT 1 FROM landed_cost_charges c WHERE c.pi_id = ${purchaseInvoices.id} AND c.allocated_at IS NOT NULL AND c.reversed_at IS NULL)`,
        draftTaxable: sql<string>`(SELECT coalesce(sum(l.taxable), 0) FROM purchase_invoice_lines l WHERE l.pi_id = ${purchaseInvoices.id})::text`,
      })
      .from(purchaseInvoices)
      .innerJoin(suppliers, eq(suppliers.id, purchaseInvoices.supplierId))
      .where(and(...filters))
      .orderBy(desc(purchaseInvoices.supplierInvoiceDate), desc(purchaseInvoices.createdAt))
      .limit(500);
    return rows.map((r) => ({
      id: r.pi.id,
      piNo: r.pi.piNo,
      supplierInvoiceNo: r.pi.supplierInvoiceNo,
      supplierInvoiceDate: r.pi.supplierInvoiceDate,
      supplierId: r.pi.supplierId,
      supplierName: r.supplierName,
      status: r.pi.status,
      total: r.pi.status === "Posted" ? D(r.pi.total).toFixed(2) : D(r.draftTaxable).toFixed(2),
      rollCount: r.rollCount,
      landedCostAllocated: r.allocated,
      version: r.pi.version,
    }));
  }

  async get(id: string, db: UnitOfWork["db"] | Tx = this.uow.db): Promise<PiDetail> {
    const [row] = await db
      .select({ pi: purchaseInvoices, supplierName: suppliers.name, poNo: purchaseOrders.poNo })
      .from(purchaseInvoices)
      .innerJoin(suppliers, eq(suppliers.id, purchaseInvoices.supplierId))
      .leftJoin(purchaseOrders, eq(purchaseOrders.id, purchaseInvoices.poId))
      .where(and(eq(purchaseInvoices.id, id), eq(purchaseInvoices.companyId, actor().companyId)));
    if (!row) throw notFound("Purchase invoice");
    const pi = row.pi;
    const [lines, grns, counts] = await Promise.all([
      db
        .select()
        .from(purchaseInvoiceLines)
        .where(eq(purchaseInvoiceLines.piId, id))
        .orderBy(asc(purchaseInvoiceLines.lineNo)),
      db.select({ grnId: purchaseInvoiceGrns.grnId }).from(purchaseInvoiceGrns).where(eq(purchaseInvoiceGrns.piId, id)),
      db
        .select({
          rolls: sql<number>`(SELECT count(*) FROM rolls r WHERE r.pi_id = ${id})::int`,
          allocated: sql<boolean>`EXISTS (SELECT 1 FROM landed_cost_charges c WHERE c.pi_id = ${id} AND c.allocated_at IS NOT NULL AND c.reversed_at IS NULL)`,
        })
        .from(purchaseInvoices)
        .where(eq(purchaseInvoices.id, id)),
    ]);
    const totals =
      pi.status === "Posted"
        ? {
            taxable: D(pi.taxable),
            cgst: D(pi.cgst),
            sgst: D(pi.sgst),
            igst: D(pi.igst),
            roundOff: D(pi.roundOff),
            total: D(pi.total),
          }
        : this.totals(lines, pi.regime, pi.roundOff);
    return {
      id: pi.id,
      piNo: pi.piNo,
      supplierInvoiceNo: pi.supplierInvoiceNo,
      supplierInvoiceDate: pi.supplierInvoiceDate,
      supplierId: pi.supplierId,
      supplierName: row.supplierName,
      status: pi.status,
      total: totals.total.toFixed(2),
      rollCount: counts[0]?.rolls ?? 0,
      landedCostAllocated: counts[0]?.allocated ?? false,
      version: pi.version,
      poId: pi.poId,
      poNo: row.poNo,
      grnIds: grns.map((g) => g.grnId),
      irn: pi.irn,
      ewayBillNo: pi.ewayBillNo,
      regime: pi.regime,
      notes: pi.notes,
      postedAt: pi.postedAt?.toISOString() ?? null,
      linesWithoutPo: lines.filter((l) => !l.poLineId).length,
      totals: {
        taxable: totals.taxable.toFixed(2),
        cgst: totals.cgst.toFixed(2),
        sgst: totals.sgst.toFixed(2),
        igst: totals.igst.toFixed(2),
        roundOff: totals.roundOff.toFixed(2),
        total: totals.total.toFixed(2),
      },
      lines: lines.map((l) => ({
        id: l.id,
        poLineId: l.poLineId,
        skuId: l.skuId,
        description: l.description,
        gsm: l.gsm,
        widthIn: Number(l.widthIn),
        qualityName: l.qualityName,
        hsnCode: l.hsnCode,
        quantityM: l.quantityM,
        ratePerM: trimDecimal(l.ratePerM),
        discountPct: trimDecimal(l.discountPct),
        gstRate: trimDecimal(l.gstRate) as "18",
        taxable: D(l.taxable).toFixed(2),
        withoutPo: !l.poLineId,
      })),
    };
  }

  async create(dto: PiCreateDto): Promise<PiDetail> {
    const id = await this.uow.run(async (tx) => {
      const { supplier, regime } = await supplierWithRegime(tx, dto.supplierId);
      assertActiveSupplier(supplier);
      await this.assertRefs(tx, dto, null);
      const [pi] = await tx
        .insert(purchaseInvoices)
        .values({
          companyId: actor().companyId,
          branchId: actor().branchId,
          supplierId: supplier.id,
          supplierInvoiceNo: dto.supplierInvoiceNo,
          supplierInvoiceDate: dto.supplierInvoiceDate,
          poId: dto.poId ?? null,
          regime,
          irn: dto.irn ?? null,
          ewayBillNo: dto.ewayBillNo ?? null,
          roundOff: dto.roundOff,
          notes: dto.notes ?? null,
          createdBy: actor().userId,
          updatedBy: actor().userId,
        })
        .returning();
      await this.writeChildren(tx, pi!.id, dto);
      await recordTransition(tx, "PurchaseInvoice", pi!.id, null, "Draft");
      this.changed(pi!.id);
      return pi!.id;
    });
    return this.get(id);
  }

  async update(id: string, dto: PiUpdateDto): Promise<PiDetail> {
    await this.uow.run(async (tx) => {
      const current = await this.lock(tx, id);
      if (current.status !== "Draft") throw validationError("A posted purchase invoice can't be edited.");
      const { supplier, regime } = await supplierWithRegime(tx, dto.supplierId);
      assertActiveSupplier(supplier);
      await this.assertRefs(tx, dto, id);
      await updateVersioned(
        tx,
        purchaseInvoices,
        eq(purchaseInvoices.id, id),
        dto.version,
        {
          supplierId: supplier.id,
          supplierInvoiceNo: dto.supplierInvoiceNo,
          supplierInvoiceDate: dto.supplierInvoiceDate,
          poId: dto.poId ?? null,
          regime,
          irn: dto.irn ?? null,
          ewayBillNo: dto.ewayBillNo ?? null,
          roundOff: dto.roundOff,
          notes: dto.notes ?? null,
        },
        "Purchase invoice",
      );
      await tx.delete(purchaseInvoiceLines).where(eq(purchaseInvoiceLines.piId, id));
      await tx.delete(purchaseInvoiceGrns).where(eq(purchaseInvoiceGrns.piId, id));
      await this.writeChildren(tx, id, dto);
      this.changed(id);
    });
    return this.get(id);
  }

  async cancel(id: string, version: number): Promise<PiDetail> {
    await this.uow.run(async (tx) => {
      const current = await this.lock(tx, id);
      purchaseInvoiceMachine.assert(current.status, "Cancelled");
      await updateVersioned(tx, purchaseInvoices, eq(purchaseInvoices.id, id), version, { status: "Cancelled" }, "Purchase invoice");
      await recordTransition(tx, "PurchaseInvoice", id, current.status, "Cancelled");
      this.changed(id);
    });
    return this.get(id);
  }

  async post(id: string, version: number): Promise<PiDetail> {
    await this.uow.run(async (tx) => {
      const pi = await this.lock(tx, id);
      purchaseInvoiceMachine.assert(pi.status, "Posted");
      const lines = await tx.select().from(purchaseInvoiceLines).where(eq(purchaseInvoiceLines.piId, id));
      if (lines.length === 0) throw validationError("Add at least one line before posting.");
      // PRD §6.2: lines without a PO line are allowed, but only with a reason.
      if (lines.some((l) => !l.poLineId) && !ctx().reason?.trim()) throw reasonRequired();

      const totals = this.totals(lines, pi.regime, pi.roundOff);
      const piNo = await this.series.allocate(tx, "PI", pi.supplierInvoiceDate);
      for (const l of lines) {
        if (!l.poLineId) continue;
        await tx
          .update(purchaseOrderLines)
          .set({ invoicedM: sql`${purchaseOrderLines.invoicedM} + ${l.quantityM}` })
          .where(eq(purchaseOrderLines.id, l.poLineId));
      }
      const grnIds = (
        await tx.select({ grnId: purchaseInvoiceGrns.grnId }).from(purchaseInvoiceGrns).where(eq(purchaseInvoiceGrns.piId, id))
      ).map((g) => g.grnId);
      const rollCount = await this.applyBaseCost(tx, id, lines, grnIds);

      await updateVersioned(
        tx,
        purchaseInvoices,
        eq(purchaseInvoices.id, id),
        version,
        {
          status: "Posted",
          piNo,
          taxable: totals.taxable.toFixed(2),
          cgst: totals.cgst.toFixed(2),
          sgst: totals.sgst.toFixed(2),
          igst: totals.igst.toFixed(2),
          total: totals.total.toFixed(2),
          postedAt: new Date(),
          postedBy: actor().userId,
        },
        "Purchase invoice",
      );
      await recordTransition(tx, "PurchaseInvoice", id, "Draft", "Posted");
      const [supplier] = await tx.select().from(suppliers).where(eq(suppliers.id, pi.supplierId));
      await writePostingEvent(tx, {
        type: "PI_POSTED",
        docType: "PI",
        docId: id,
        docNo: piNo,
        docDate: pi.supplierInvoiceDate,
        partyType: "SUPPLIER",
        partyId: pi.supplierId,
        payload: {
          supplier: { id: supplier!.id, name: supplier!.name, gstin: supplier!.gstin, stateCode: supplier!.stateCode },
          supplierInvoiceNo: pi.supplierInvoiceNo,
          supplierInvoiceDate: pi.supplierInvoiceDate,
          irn: pi.irn,
          regime: pi.regime,
          lines: lines.map((l) => ({
            description: l.description,
            hsnCode: l.hsnCode,
            quantityM: l.quantityM,
            ratePerM: l.ratePerM,
            discountPct: l.discountPct,
            gstRate: l.gstRate,
            taxable: l.taxable,
            skuId: l.skuId,
          })),
          totals: {
            taxable: totals.taxable.toFixed(2),
            cgst: totals.cgst.toFixed(2),
            sgst: totals.sgst.toFixed(2),
            igst: totals.igst.toFixed(2),
            roundOff: totals.roundOff.toFixed(2),
            total: totals.total.toFixed(2),
          },
          rollCount,
        },
      });
      this.changed(id);
    });
    return this.get(id);
  }

  /** Links goods that arrived after the invoice was posted (Q14); their rolls take its rates. */
  async linkGrns(id: string, grnIds: string[]): Promise<PiDetail> {
    await this.uow.run(async (tx) => {
      const pi = await this.lock(tx, id);
      if (pi.status !== "Posted") throw validationError("Link goods receipts to a posted invoice, or edit the draft.");
      await this.assertGrns(tx, pi.supplierId, grnIds, id);
      await tx.insert(purchaseInvoiceGrns).values(grnIds.map((grnId) => ({ piId: id, grnId }))).onConflictDoNothing();
      const lines = await tx.select().from(purchaseInvoiceLines).where(eq(purchaseInvoiceLines.piId, id));
      await this.applyBaseCost(tx, id, lines, grnIds);
      this.changed(id);
    });
    return this.get(id);
  }

  /**
   * Sets each GRN roll's base cost from the matching invoice line: by PO line first, else by
   * SKU / GSM + width. Every roll must match, and none may already belong to another invoice.
   */
  private async applyBaseCost(
    tx: Tx,
    piId: string,
    lines: (typeof purchaseInvoiceLines.$inferSelect)[],
    grnIds: string[],
  ): Promise<number> {
    if (grnIds.length === 0) return 0;
    const grnRolls = await tx
      .select({ roll: rolls, poLineId: goodsReceiptLines.poLineId, grnNo: goodsReceipts.grnNo })
      .from(rolls)
      .innerJoin(goodsReceiptLines, eq(goodsReceiptLines.id, rolls.grnLineId))
      .innerJoin(goodsReceipts, eq(goodsReceipts.id, rolls.grnId))
      .where(inArray(rolls.grnId, grnIds))
      .for("update", { of: rolls });
    const taken = grnRolls.filter((r) => r.roll.piId && r.roll.piId !== piId);
    if (taken.length) {
      throw validationError(`${taken.length} rolls are already on another purchase invoice.`, [
        { path: "grnIds", message: `Already invoiced: ${taken[0]!.grnNo}` },
      ]);
    }
    const unmatched: string[] = [];
    for (const { roll, poLineId } of grnRolls) {
      const line =
        (poLineId && lines.find((l) => l.poLineId === poLineId)) ||
        lines.find((l) => sameItem({ skuId: l.skuId, gsm: l.gsm, widthIn: l.widthIn }, roll));
      if (!line) {
        unmatched.push(roll.barcode);
        continue;
      }
      const rate = D(line.ratePerM).times(D(100).minus(line.discountPct)).dividedBy(100);
      const baseValue = round(rate.times(roll.originalLengthM), 2);
      await tx
        .update(rolls)
        .set({
          piId,
          baseCostPerM: rate.toFixed(4),
          baseValue: baseValue.toFixed(2),
          costPerM: round(baseValue.plus(roll.landedCost).dividedBy(roll.originalLengthM), 4).toFixed(4),
          updatedAt: new Date(),
          updatedBy: actor().userId,
          version: sql`${rolls.version} + 1`,
        })
        .where(eq(rolls.id, roll.id));
    }
    if (unmatched.length) {
      throw validationError(`${unmatched.length} received rolls have no matching invoice line.`, [
        { path: "lines", message: `No line for ${unmatched.slice(0, 3).join(", ")}${unmatched.length > 3 ? "…" : ""}` },
      ]);
    }
    return grnRolls.length;
  }

  private totals(lines: (typeof purchaseInvoiceLines.$inferSelect)[], regime: "CGST_SGST" | "IGST", roundOff: string) {
    const t = invoiceTotals(
      lines.map((l) => taxLine({ quantity: l.quantityM, rate: l.ratePerM, discountPct: l.discountPct, gstRate: l.gstRate })),
      regime,
      0,
    );
    // The supplier's printed round-off is kept so our total equals their invoice exactly.
    const ro = D(roundOff);
    return { ...t, roundOff: ro, total: t.beforeRoundOff.plus(ro) };
  }

  private async lock(tx: Tx, id: string) {
    const [pi] = await tx
      .select()
      .from(purchaseInvoices)
      .where(and(eq(purchaseInvoices.id, id), eq(purchaseInvoices.companyId, actor().companyId)))
      .for("update");
    if (!pi) throw notFound("Purchase invoice");
    return pi;
  }

  private async assertRefs(tx: Tx, dto: PiCreateDto, selfId: string | null) {
    if (D(dto.roundOff).abs().greaterThan(1)) {
      throw validationError("Round-off can't be more than ₹1.", [{ path: "roundOff", message: "At most ±1.00" }]);
    }
    const lineIds = dto.lines.flatMap((l) => (l.poLineId ? [l.poLineId] : []));
    if (dto.poId) {
      const [po] = await tx
        .select()
        .from(purchaseOrders)
        .where(and(eq(purchaseOrders.id, dto.poId), eq(purchaseOrders.companyId, actor().companyId)));
      if (!po) throw notFound("Purchase order");
      if (po.supplierId !== dto.supplierId) {
        throw validationError("The purchase order is for another supplier.", [{ path: "poId", message: "Different supplier" }]);
      }
      if (lineIds.length) {
        const owned = await tx
          .select({ id: purchaseOrderLines.id })
          .from(purchaseOrderLines)
          .where(and(eq(purchaseOrderLines.poId, po.id), inArray(purchaseOrderLines.id, lineIds)));
        if (owned.length !== new Set(lineIds).size) throw notFound("Purchase order line");
      }
    } else if (lineIds.length) {
      throw validationError("PO lines need the purchase order selected.");
    }
    await this.assertGrns(tx, dto.supplierId, dto.grnIds, selfId);
  }

  /** GRNs must be this supplier's, posted, and not on another live invoice. */
  private async assertGrns(tx: Tx, supplierId: string, grnIds: string[], selfId: string | null) {
    if (!grnIds.length) return;
    const found = await tx
      .select()
      .from(goodsReceipts)
      .where(and(eq(goodsReceipts.companyId, actor().companyId), inArray(goodsReceipts.id, grnIds)));
    if (found.length !== new Set(grnIds).size) throw notFound("Goods receipt");
    const bad = found.find((g) => g.supplierId !== supplierId || g.status !== "Posted");
    if (bad) {
      throw validationError(`${bad.grnNo} is not a posted receipt from this supplier.`, [
        { path: "grnIds", message: `${bad.grnNo} can't be linked` },
      ]);
    }
    const elsewhere = await tx
      .select({ grnId: purchaseInvoiceGrns.grnId, piId: purchaseInvoices.id })
      .from(purchaseInvoiceGrns)
      .innerJoin(purchaseInvoices, eq(purchaseInvoices.id, purchaseInvoiceGrns.piId))
      .where(
        and(
          inArray(purchaseInvoiceGrns.grnId, grnIds),
          ne(purchaseInvoices.status, "Cancelled"),
          selfId ? ne(purchaseInvoices.id, selfId) : isNotNull(purchaseInvoices.id),
        ),
      );
    if (elsewhere.length) {
      throw validationError("A goods receipt is already on another purchase invoice.", [
        { path: "grnIds", message: "Already linked to another invoice" },
      ]);
    }
  }

  private async writeChildren(tx: Tx, piId: string, dto: PiCreateDto) {
    await tx.insert(purchaseInvoiceLines).values(
      dto.lines.map((l, i) => ({
        piId,
        lineNo: i + 1,
        poLineId: l.poLineId ?? null,
        skuId: l.skuId ?? null,
        description: l.description,
        gsm: l.gsm,
        widthIn: String(l.widthIn),
        qualityName: l.qualityName ?? null,
        hsnCode: l.hsnCode,
        quantityM: l.quantityM,
        ratePerM: l.ratePerM,
        discountPct: l.discountPct,
        gstRate: l.gstRate,
        taxable: taxLine({ quantity: l.quantityM, rate: l.ratePerM, discountPct: l.discountPct, gstRate: l.gstRate }).taxable.toFixed(2),
        createdBy: actor().userId,
      })),
    );
    if (dto.grnIds.length) {
      await tx.insert(purchaseInvoiceGrns).values([...new Set(dto.grnIds)].map((grnId) => ({ piId, grnId })));
    }
  }

  private changed(id: string) {
    this.bus.publishAfterCommit("purchase.changed", { doc: "PI", id });
    this.bus.publishAfterCommit("inventory.changed", { piId: id });
  }
}
