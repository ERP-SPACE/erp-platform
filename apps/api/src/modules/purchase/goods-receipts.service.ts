import type { GrnDetail, GrnListItem } from "@erp/contracts";
import {
  type Tx,
  batches,
  goodsReceiptLines,
  goodsReceipts,
  purchaseOrderLines,
  purchaseOrders,
  rolls,
  skus,
  suppliers,
  user,
} from "@erp/db";
import {
  D,
  type GrnStatus,
  InvalidRollListError,
  formatRollBarcode,
  grnMachine,
  parseRollList,
  round,
} from "@erp/domain";
import { Injectable } from "@nestjs/common";
import { type SQL, and, asc, desc, eq, gte, inArray, lte, max, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { actor } from "../../common/context.js";
import { approvalRequired, notFound, validationError } from "../../common/errors.js";
import { recordTransition } from "../../db/ledger.js";
import { UnitOfWork } from "../../db/unit-of-work.js";
import { updateVersioned } from "../../db/versioning.js";
import { EventBus } from "../realtime/event-bus.js";
import { SeriesService } from "../series/series.service.js";
import { SettingsService } from "../settings/settings.service.js";
import { searchFilter } from "../suppliers/suppliers.service.js";
import { assertActiveSupplier, supplierWithRegime } from "./purchase-common.js";
import { PurchaseOrdersService } from "./purchase-orders.service.js";
import type { GrnCreateDto, GrnUpdateDto, PurchaseListQueryDto } from "./purchase.dto.js";

const MAX_ROLLS_PER_BATCH = 9999;

interface ParsedLine {
  input: GrnCreateDto["lines"][number];
  lengths: number[];
  rejected: number[];
}

/**
 * Goods receipts (PRD §6.2, ADR-0017). A GRN is drafted with the supplier's roll list; posting
 * creates the batch, one roll per physical roll (Mapped when the SKU is known, else Unmapped),
 * their barcodes, and updates the PO — all in one transaction. Receiving more than the PO
 * balance (beyond the tolerance setting) needs an approver, step-up and a reason.
 */
@Injectable()
export class GoodsReceiptsService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly bus: EventBus,
    private readonly series: SeriesService,
    private readonly settings: SettingsService,
    private readonly orders: PurchaseOrdersService,
  ) {}

  async list(query: PurchaseListQueryDto): Promise<GrnListItem[]> {
    const filters: (SQL | undefined)[] = [eq(goodsReceipts.companyId, actor().companyId)];
    if (query.supplierId) filters.push(eq(goodsReceipts.supplierId, query.supplierId));
    if (query.status) filters.push(eq(goodsReceipts.status, query.status as GrnStatus));
    if (query.from) filters.push(gte(goodsReceipts.date, query.from));
    if (query.to) filters.push(lte(goodsReceipts.date, query.to));
    filters.push(
      searchFilter(
        sql`(${goodsReceipts.grnNo} || ' ' || ${suppliers.name} || ' ' || coalesce(${goodsReceipts.supplierInvoiceNo}, '') || ' ' || coalesce(${goodsReceipts.supplierBatchRef}, ''))`,
        query.q,
      ),
    );
    const rows = await this.uow.db
      .select({
        grn: goodsReceipts,
        supplierName: suppliers.name,
        poNo: purchaseOrders.poNo,
        rollCount: sql<number>`coalesce((SELECT sum(l.roll_count) FROM goods_receipt_lines l WHERE l.grn_id = ${goodsReceipts.id}), 0)::int`,
        acceptedM: sql<number>`coalesce((SELECT sum(l.accepted_m) FROM goods_receipt_lines l WHERE l.grn_id = ${goodsReceipts.id}), 0)::int`,
        unmappedRolls: sql<number>`(SELECT count(*) FROM rolls r WHERE r.grn_id = ${goodsReceipts.id} AND r.status = 'Unmapped')::int`,
      })
      .from(goodsReceipts)
      .innerJoin(suppliers, eq(suppliers.id, goodsReceipts.supplierId))
      .leftJoin(purchaseOrders, eq(purchaseOrders.id, goodsReceipts.poId))
      .where(and(...filters))
      .orderBy(desc(goodsReceipts.date), desc(goodsReceipts.grnNo))
      .limit(500);
    return rows.map((r) => ({
      id: r.grn.id,
      grnNo: r.grn.grnNo,
      date: r.grn.date,
      supplierId: r.grn.supplierId,
      supplierName: r.supplierName,
      poId: r.grn.poId,
      poNo: r.poNo,
      status: r.grn.status,
      rollCount: r.rollCount,
      acceptedM: r.acceptedM,
      unmappedRolls: r.unmappedRolls,
      version: r.grn.version,
    }));
  }

  async get(id: string, db: UnitOfWork["db"] | Tx = this.uow.db): Promise<GrnDetail> {
    const approver = alias(user, "approver");
    const [row] = await db
      .select({
        grn: goodsReceipts,
        supplierName: suppliers.name,
        poNo: purchaseOrders.poNo,
        batchSeq: batches.batchSeq,
        approverName: approver.name,
      })
      .from(goodsReceipts)
      .innerJoin(suppliers, eq(suppliers.id, goodsReceipts.supplierId))
      .leftJoin(purchaseOrders, eq(purchaseOrders.id, goodsReceipts.poId))
      .leftJoin(batches, eq(batches.id, goodsReceipts.batchId))
      .leftJoin(approver, eq(approver.id, goodsReceipts.overReceiptApprovedBy))
      .where(and(eq(goodsReceipts.id, id), eq(goodsReceipts.companyId, actor().companyId)));
    if (!row) throw notFound("Goods receipt");
    const lines = await db
      .select({ line: goodsReceiptLines, skuCode: skus.code })
      .from(goodsReceiptLines)
      .leftJoin(skus, eq(skus.id, goodsReceiptLines.skuId))
      .where(eq(goodsReceiptLines.grnId, id))
      .orderBy(asc(goodsReceiptLines.lineNo));
    const [unmapped] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(rolls)
      .where(and(eq(rolls.grnId, id), eq(rolls.status, "Unmapped")));
    const g = row.grn;
    return {
      id: g.id,
      grnNo: g.grnNo,
      date: g.date,
      supplierId: g.supplierId,
      supplierName: row.supplierName,
      poId: g.poId,
      poNo: row.poNo,
      status: g.status,
      rollCount: lines.reduce((s, l) => s + l.line.rollCount, 0),
      acceptedM: lines.reduce((s, l) => s + l.line.acceptedM, 0),
      unmappedRolls: unmapped?.n ?? 0,
      version: g.version,
      supplierInvoiceNo: g.supplierInvoiceNo,
      supplierBatchRef: g.supplierBatchRef,
      batchCode: row.batchSeq ? String(row.batchSeq).padStart(4, "0") : null,
      vehicleNo: g.vehicleNo,
      notes: g.notes,
      postedAt: g.postedAt?.toISOString() ?? null,
      overReceiptApprovedByName: row.approverName,
      lines: lines.map(({ line, skuCode }) => ({
        id: line.id,
        poLineId: line.poLineId,
        skuId: line.skuId,
        skuCode,
        description: line.description,
        gsm: line.gsm,
        widthIn: Number(line.widthIn),
        qualityName: line.qualityName,
        rolls: line.rollList,
        rejectedRolls: line.rejectedRollList,
        rejectReason: line.rejectReason,
        rollCount: line.rollCount,
        acceptedM: line.acceptedM,
        rejectedCount: line.rejectedCount,
        rejectedM: line.rejectedM,
        overReceiptM: line.overReceiptM,
      })),
    };
  }

  async create(dto: GrnCreateDto): Promise<GrnDetail> {
    const parsed = parseLines(dto.lines);
    const id = await this.uow.run(async (tx) => {
      const { supplier } = await supplierWithRegime(tx, dto.supplierId);
      assertActiveSupplier(supplier);
      await this.assertPo(tx, dto);
      const [grn] = await tx
        .insert(goodsReceipts)
        .values({
          companyId: actor().companyId,
          branchId: actor().branchId,
          supplierId: supplier.id,
          grnNo: await this.series.allocate(tx, "GRN", dto.date),
          poId: dto.poId ?? null,
          date: dto.date,
          supplierInvoiceNo: dto.supplierInvoiceNo ?? null,
          supplierBatchRef: dto.supplierBatchRef ?? null,
          vehicleNo: dto.vehicleNo ?? null,
          notes: dto.notes ?? null,
          createdBy: actor().userId,
          updatedBy: actor().userId,
        })
        .returning();
      await this.insertLines(tx, grn!.id, parsed);
      await recordTransition(tx, "GoodsReceipt", grn!.id, null, "Created");
      this.changed(grn!.id);
      return grn!.id;
    });
    return this.get(id);
  }

  async update(id: string, dto: GrnUpdateDto): Promise<GrnDetail> {
    const parsed = parseLines(dto.lines);
    await this.uow.run(async (tx) => {
      const current = await this.lock(tx, id);
      if (current.status !== "Created")
        throw validationError("A posted goods receipt can't be edited.");
      const { supplier } = await supplierWithRegime(tx, dto.supplierId);
      assertActiveSupplier(supplier);
      await this.assertPo(tx, dto);
      await updateVersioned(
        tx,
        goodsReceipts,
        eq(goodsReceipts.id, id),
        dto.version,
        {
          supplierId: supplier.id,
          poId: dto.poId ?? null,
          date: dto.date,
          supplierInvoiceNo: dto.supplierInvoiceNo ?? null,
          supplierBatchRef: dto.supplierBatchRef ?? null,
          vehicleNo: dto.vehicleNo ?? null,
          notes: dto.notes ?? null,
        },
        "Goods receipt",
      );
      await tx.delete(goodsReceiptLines).where(eq(goodsReceiptLines.grnId, id));
      await this.insertLines(tx, id, parsed);
      this.changed(id);
    });
    return this.get(id);
  }

  async cancel(id: string, version: number): Promise<GrnDetail> {
    await this.uow.run(async (tx) => {
      const current = await this.lock(tx, id);
      grnMachine.assert(current.status, "Cancelled");
      await updateVersioned(
        tx,
        goodsReceipts,
        eq(goodsReceipts.id, id),
        version,
        { status: "Cancelled" },
        "Goods receipt",
      );
      await recordTransition(tx, "GoodsReceipt", id, current.status, "Cancelled");
      this.changed(id);
    });
    return this.get(id);
  }

  /**
   * Posts the receipt: checks the PO balance, allocates the batch and roll sequences under row
   * locks, creates the rolls with barcodes, and moves the PO along. `approveOverReceipt` is only
   * honoured on the approval route (permission + step-up + reason enforced by the controller).
   */
  async post(id: string, version: number, approveOverReceipt: boolean): Promise<GrnDetail> {
    await this.uow.run(async (tx) => {
      const grn = await this.lock(tx, id);
      grnMachine.assert(grn.status, "Posted");
      const lines = await tx
        .select()
        .from(goodsReceiptLines)
        .where(eq(goodsReceiptLines.grnId, id))
        .orderBy(asc(goodsReceiptLines.lineNo));
      if (lines.length === 0) throw validationError("Add at least one line before posting.");

      // 1. PO balance and over-receipt.
      const poLineIds = [...new Set(lines.flatMap((l) => (l.poLineId ? [l.poLineId] : [])))];
      const poLines = poLineIds.length
        ? await tx
            .select()
            .from(purchaseOrderLines)
            .where(inArray(purchaseOrderLines.id, poLineIds))
            .for("update")
        : [];
      const tolerance = D(await this.settings.value("purchase.overReceiptTolerancePct"));
      const incoming = new Map<string, number>();
      for (const l of lines)
        if (l.poLineId) incoming.set(l.poLineId, (incoming.get(l.poLineId) ?? 0) + l.acceptedM);
      const overByLine = new Map<string, number>();
      const issues: { path: string; message: string }[] = [];
      for (const pl of poLines) {
        const after = pl.receivedM + (incoming.get(pl.id) ?? 0);
        const allowed = D(pl.quantityM)
          .times(D(100).plus(tolerance))
          .dividedBy(100)
          .floor()
          .toNumber();
        const over = Math.max(0, after - pl.quantityM);
        if (over > 0) overByLine.set(pl.id, over);
        if (after > allowed) {
          issues.push({
            path: `lines.${lines.findIndex((l) => l.poLineId === pl.id)}.rolls`,
            message: `${pl.description}: ${after.toLocaleString("en-IN")} m against ${pl.quantityM.toLocaleString("en-IN")} m ordered`,
          });
        }
      }
      if (grn.poId) {
        lines.forEach((l, i) => {
          if (!l.poLineId)
            issues.push({
              path: `lines.${i}.poLineId`,
              message: `${l.description}: not on the purchase order`,
            });
        });
      }
      if (issues.length && !approveOverReceipt) {
        throw approvalRequired(
          "This receipt is more than the purchase order. Ask a purchase manager to approve it.",
          issues,
        );
      }

      // 2. Batch: per-supplier sequence under the supplier row lock (ADR-0007).
      const totalRolls = lines.reduce((s, l) => s + l.rollCount, 0);
      if (totalRolls > MAX_ROLLS_PER_BATCH) {
        throw validationError(
          `A receipt can create at most ${MAX_ROLLS_PER_BATCH} rolls; split it.`,
        );
      }
      const [supplier] = await tx
        .select()
        .from(suppliers)
        .where(eq(suppliers.id, grn.supplierId))
        .for("update");
      const [last] = await tx
        .select({ seq: max(batches.batchSeq) })
        .from(batches)
        .where(eq(batches.supplierId, grn.supplierId));
      const batchSeq = (last?.seq ?? 0) + 1;
      if (batchSeq > 9999) throw validationError("This supplier has used all 9999 batch numbers.");
      const postedAt = new Date();
      const [batch] = await tx
        .insert(batches)
        .values({
          companyId: grn.companyId,
          supplierId: grn.supplierId,
          batchSeq,
          supplierBatchRef: grn.supplierBatchRef,
          date: grn.date,
          nextRollSeq: totalRolls + 1,
          createdBy: actor().userId,
        })
        .returning();

      // 3. Rolls with barcodes; base cost is provisional from the PO rate until the PI (ADR-0017).
      const rateByPoLine = new Map(poLines.map((pl) => [pl.id, pl.ratePerM]));
      let seq = 0;
      const rows: (typeof rolls.$inferInsert)[] = [];
      for (const l of lines) {
        const rate = l.poLineId ? (rateByPoLine.get(l.poLineId) ?? null) : null;
        for (const length of parseRollList(l.rollList)) {
          seq += 1;
          rows.push({
            companyId: grn.companyId,
            branchId: grn.branchId,
            barcode: formatRollBarcode({
              postedAt,
              supplierCode: supplier!.shortCode,
              batchSeq,
              rollSeq: seq,
            }),
            batchId: batch!.id,
            rollSeq: seq,
            supplierId: grn.supplierId,
            grnId: grn.id,
            grnLineId: l.id,
            skuId: l.skuId,
            description: l.description,
            gsm: l.gsm,
            widthIn: l.widthIn,
            qualityName: l.qualityName,
            originalLengthM: length,
            currentLengthM: length,
            status: l.skuId ? "Mapped" : "Unmapped",
            baseCostPerM: rate,
            baseValue: rate ? round(D(rate).times(length), 2).toFixed(2) : "0",
            costPerM: rate,
            receivedAt: postedAt,
            mappedAt: l.skuId ? postedAt : null,
            createdBy: actor().userId,
            updatedBy: actor().userId,
          });
        }
      }
      const created: { id: string; status: string }[] = [];
      for (let i = 0; i < rows.length; i += 500) {
        created.push(
          ...(await tx
            .insert(rolls)
            .values(rows.slice(i, i + 500))
            .returning({ id: rolls.id, status: rolls.status })),
        );
      }
      for (const status of ["Mapped", "Unmapped"] as const) {
        await recordTransition(
          tx,
          "Roll",
          created.filter((r) => r.status === status).map((r) => r.id),
          null,
          status,
          `Received on ${grn.grnNo}`,
        );
      }

      // 4. PO progress and the GRN itself.
      for (const pl of poLines) {
        await tx
          .update(purchaseOrderLines)
          .set({ receivedM: sql`${purchaseOrderLines.receivedM} + ${incoming.get(pl.id) ?? 0}` })
          .where(eq(purchaseOrderLines.id, pl.id));
      }
      for (const l of lines) {
        const over = l.poLineId ? (overByLine.get(l.poLineId) ?? 0) : grn.poId ? l.acceptedM : 0;
        if (over)
          await tx
            .update(goodsReceiptLines)
            .set({ overReceiptM: over })
            .where(eq(goodsReceiptLines.id, l.id));
      }
      if (grn.poId) await this.orders.afterReceipt(tx, grn.poId);
      await updateVersioned(
        tx,
        goodsReceipts,
        eq(goodsReceipts.id, id),
        version,
        {
          status: "Posted",
          batchId: batch!.id,
          postedAt,
          postedBy: actor().userId,
          ...(issues.length && { overReceiptApprovedBy: actor().userId }),
        },
        "Goods receipt",
      );
      await recordTransition(tx, "GoodsReceipt", id, "Created", "Posted");
      this.changed(id);
      this.bus.publishAfterCommit("inventory.changed", {
        grnId: id,
        rolls: String(created.length),
      });
    });
    return this.get(id);
  }

  private async lock(tx: Tx, id: string) {
    const [grn] = await tx
      .select()
      .from(goodsReceipts)
      .where(and(eq(goodsReceipts.id, id), eq(goodsReceipts.companyId, actor().companyId)))
      .for("update");
    if (!grn) throw notFound("Goods receipt");
    return grn;
  }

  /** The PO must be this supplier's, approved, and own every referenced PO line. */
  private async assertPo(tx: Tx, dto: GrnCreateDto) {
    const lineIds = dto.lines.flatMap((l) => (l.poLineId ? [l.poLineId] : []));
    if (!dto.poId) {
      if (lineIds.length) throw validationError("PO lines need the purchase order selected.");
      return;
    }
    const [po] = await tx
      .select()
      .from(purchaseOrders)
      .where(and(eq(purchaseOrders.id, dto.poId), eq(purchaseOrders.companyId, actor().companyId)));
    if (!po) throw notFound("Purchase order");
    if (po.supplierId !== dto.supplierId) {
      throw validationError("The purchase order is for another supplier.", [
        { path: "poId", message: "Different supplier" },
      ]);
    }
    if (po.status !== "Approved" && po.status !== "PartiallyReceived") {
      throw validationError(
        `Purchase order ${po.poNo} is ${po.status}; only approved orders can be received.`,
        [{ path: "poId", message: `Order is ${po.status}` }],
      );
    }
    if (lineIds.length) {
      const owned = await tx
        .select({ id: purchaseOrderLines.id })
        .from(purchaseOrderLines)
        .where(and(eq(purchaseOrderLines.poId, po.id), inArray(purchaseOrderLines.id, lineIds)));
      if (owned.length !== new Set(lineIds).size) throw notFound("Purchase order line");
    }
  }

  private async insertLines(tx: Tx, grnId: string, parsed: ParsedLine[]) {
    await tx.insert(goodsReceiptLines).values(
      parsed.map(({ input, lengths, rejected }, i) => ({
        grnId,
        lineNo: i + 1,
        poLineId: input.poLineId ?? null,
        skuId: input.skuId ?? null,
        description: input.description,
        gsm: input.gsm,
        widthIn: String(input.widthIn),
        qualityName: input.qualityName ?? null,
        rollList: input.rolls,
        rejectedRollList: input.rejectedRolls ?? null,
        rejectReason: input.rejectReason ?? null,
        rollCount: lengths.length,
        acceptedM: lengths.reduce((s, x) => s + x, 0),
        rejectedCount: rejected.length,
        rejectedM: rejected.reduce((s, x) => s + x, 0),
        createdBy: actor().userId,
      })),
    );
  }

  private changed(id: string) {
    this.bus.publishAfterCommit("purchase.changed", { doc: "GRN", id });
  }
}

/** Parses every line's roll lists up front so a typo is reported against its line. */
function parseLines(lines: GrnCreateDto["lines"]): ParsedLine[] {
  const issues: { path: string; message: string }[] = [];
  const parsed = lines.map((input, i) => {
    let lengths: number[] = [];
    let rejected: number[] = [];
    try {
      lengths = parseRollList(input.rolls);
    } catch (e) {
      if (!(e instanceof InvalidRollListError)) throw e;
      issues.push({ path: `lines.${i}.rolls`, message: e.message });
    }
    if (input.rejectedRolls?.trim()) {
      try {
        rejected = parseRollList(input.rejectedRolls);
      } catch (e) {
        if (!(e instanceof InvalidRollListError)) throw e;
        issues.push({ path: `lines.${i}.rejectedRolls`, message: e.message });
      }
      if (!input.rejectReason?.trim()) {
        issues.push({
          path: `lines.${i}.rejectReason`,
          message: "Say why the rolls were rejected",
        });
      }
    }
    return { input, lengths, rejected };
  });
  if (issues.length) throw validationError("Some roll lists can't be read.", issues);
  return parsed;
}
