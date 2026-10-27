import type { PoDetail, PoListItem } from "@erp/contracts";
import { type Tx, purchaseOrderLines, purchaseOrders, skus, suppliers, user } from "@erp/db";
import { D, type PoStatus, invoiceTotals, purchaseOrderMachine, taxLine } from "@erp/domain";
import { Injectable } from "@nestjs/common";
import { type SQL, and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { actor } from "../../common/context.js";
import { trimDecimal } from "../../common/decimal.js";
import { notFound, validationError } from "../../common/errors.js";
import { recordTransition } from "../../db/ledger.js";
import { UnitOfWork } from "../../db/unit-of-work.js";
import { updateVersioned } from "../../db/versioning.js";
import { EventBus } from "../realtime/event-bus.js";
import { SeriesService } from "../series/series.service.js";
import { searchFilter } from "../suppliers/suppliers.service.js";
import { assertActiveSupplier, supplierWithRegime } from "./purchase-common.js";
import type { PoCreateDto, PoUpdateDto, PurchaseListQueryDto } from "./purchase.dto.js";

/**
 * Purchase orders (PRD §5.4): Draft → Approved → PartiallyReceived → Closed / Cancelled.
 * Lines carry the supplier's per-metre rate; received/invoiced metres are maintained by GRN and
 * PI posting. Only drafts can be edited.
 */
@Injectable()
export class PurchaseOrdersService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly bus: EventBus,
    private readonly series: SeriesService,
  ) {}

  async list(query: PurchaseListQueryDto): Promise<PoListItem[]> {
    const filters: (SQL | undefined)[] = [eq(purchaseOrders.companyId, actor().companyId)];
    if (query.supplierId) filters.push(eq(purchaseOrders.supplierId, query.supplierId));
    if (query.status) filters.push(eq(purchaseOrders.status, query.status as PoStatus));
    if (query.from) filters.push(gte(purchaseOrders.date, query.from));
    if (query.to) filters.push(lte(purchaseOrders.date, query.to));
    filters.push(searchFilter(sql`(${purchaseOrders.poNo} || ' ' || ${suppliers.name})`, query.q));
    const rows = await this.uow.db
      .select({
        po: purchaseOrders,
        supplierName: suppliers.name,
        orderedM: sql<number>`coalesce(sum(${purchaseOrderLines.quantityM}), 0)::int`,
        receivedM: sql<number>`coalesce(sum(${purchaseOrderLines.receivedM}), 0)::int`,
        taxable: sql<string>`coalesce(sum(round(${purchaseOrderLines.quantityM} * ${purchaseOrderLines.ratePerM}, 2)), 0)::text`,
      })
      .from(purchaseOrders)
      .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
      .leftJoin(purchaseOrderLines, eq(purchaseOrderLines.poId, purchaseOrders.id))
      .where(and(...filters))
      .groupBy(purchaseOrders.id, suppliers.name)
      .orderBy(desc(purchaseOrders.date), desc(purchaseOrders.poNo))
      .limit(500);
    return rows.map((r) => ({
      id: r.po.id,
      poNo: r.po.poNo,
      date: r.po.date,
      supplierId: r.po.supplierId,
      supplierName: r.supplierName,
      status: r.po.status,
      orderedM: r.orderedM,
      receivedM: r.receivedM,
      taxable: D(r.taxable).toFixed(2),
      version: r.po.version,
    }));
  }

  async get(id: string, db: UnitOfWork["db"] | Tx = this.uow.db): Promise<PoDetail> {
    const [row] = await db
      .select({ po: purchaseOrders, supplierName: suppliers.name, approvedByName: user.name })
      .from(purchaseOrders)
      .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
      .leftJoin(user, eq(user.id, purchaseOrders.approvedBy))
      .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.companyId, actor().companyId)));
    if (!row) throw notFound("Purchase order");
    const lines = await db
      .select({ line: purchaseOrderLines, skuCode: skus.code })
      .from(purchaseOrderLines)
      .leftJoin(skus, eq(skus.id, purchaseOrderLines.skuId))
      .where(eq(purchaseOrderLines.poId, id))
      .orderBy(asc(purchaseOrderLines.lineNo));
    const taxLines = lines.map(({ line }) =>
      taxLine({ quantity: line.quantityM, rate: line.ratePerM, gstRate: line.gstRate }),
    );
    const totals = invoiceTotals(taxLines, row.po.regime, 0);
    const po = row.po;
    return {
      id: po.id,
      poNo: po.poNo,
      date: po.date,
      supplierId: po.supplierId,
      supplierName: row.supplierName,
      status: po.status,
      orderedM: lines.reduce((s, l) => s + l.line.quantityM, 0),
      receivedM: lines.reduce((s, l) => s + l.line.receivedM, 0),
      taxable: totals.taxable.toFixed(2),
      version: po.version,
      expectedDate: po.expectedDate,
      notes: po.notes,
      regime: po.regime,
      approvedAt: po.approvedAt?.toISOString() ?? null,
      approvedByName: row.approvedByName,
      totals: {
        taxable: totals.taxable.toFixed(2),
        tax: totals.cgst.plus(totals.sgst).plus(totals.igst).toFixed(2),
        total: totals.beforeRoundOff.toFixed(2),
      },
      lines: lines.map(({ line, skuCode }, i) => ({
        id: line.id,
        skuId: line.skuId,
        skuCode,
        description: line.description,
        gsm: line.gsm,
        widthIn: Number(line.widthIn),
        qualityName: line.qualityName,
        quantityM: line.quantityM,
        ratePerM: trimDecimal(line.ratePerM),
        gstRate: trimDecimal(line.gstRate) as "18",
        notes: line.notes,
        amount: taxLines[i]!.taxable.toFixed(2),
        receivedM: line.receivedM,
        invoicedM: line.invoicedM,
        balanceM: Math.max(0, line.quantityM - line.receivedM),
      })),
    };
  }

  async create(dto: PoCreateDto): Promise<PoDetail> {
    const id = await this.uow.run(async (tx) => {
      const { supplier, regime } = await supplierWithRegime(tx, dto.supplierId);
      assertActiveSupplier(supplier);
      await this.assertSkus(tx, dto.lines);
      const [po] = await tx
        .insert(purchaseOrders)
        .values({
          companyId: actor().companyId,
          branchId: actor().branchId,
          supplierId: supplier.id,
          poNo: await this.series.allocate(tx, "PO", dto.date),
          date: dto.date,
          expectedDate: dto.expectedDate ?? null,
          regime,
          notes: dto.notes ?? null,
          createdBy: actor().userId,
          updatedBy: actor().userId,
        })
        .returning();
      await this.insertLines(tx, po!.id, dto.lines);
      await recordTransition(tx, "PurchaseOrder", po!.id, null, "Draft");
      this.changed(po!.id);
      return po!.id;
    });
    return this.get(id);
  }

  async update(id: string, dto: PoUpdateDto): Promise<PoDetail> {
    await this.uow.run(async (tx) => {
      const current = await this.lock(tx, id);
      if (current.status !== "Draft") {
        throw validationError("Only a draft purchase order can be edited.");
      }
      const { supplier, regime } = await supplierWithRegime(tx, dto.supplierId);
      assertActiveSupplier(supplier);
      await this.assertSkus(tx, dto.lines);
      await updateVersioned(
        tx,
        purchaseOrders,
        eq(purchaseOrders.id, id),
        dto.version,
        {
          supplierId: supplier.id,
          date: dto.date,
          expectedDate: dto.expectedDate ?? null,
          regime,
          notes: dto.notes ?? null,
        },
        "Purchase order",
      );
      await tx.delete(purchaseOrderLines).where(eq(purchaseOrderLines.poId, id));
      await this.insertLines(tx, id, dto.lines);
      this.changed(id);
    });
    return this.get(id);
  }

  /** Approve / close / cancel through the state machine. */
  async transition(id: string, to: "Approved" | "Closed" | "Cancelled", version: number) {
    await this.uow.run(async (tx) => {
      const current = await this.lock(tx, id);
      purchaseOrderMachine.assert(current.status, to);
      if (to === "Cancelled") {
        const [received] = await tx
          .select({ m: sql<number>`coalesce(sum(${purchaseOrderLines.receivedM}), 0)::int` })
          .from(purchaseOrderLines)
          .where(eq(purchaseOrderLines.poId, id));
        if ((received?.m ?? 0) > 0) {
          throw validationError("Goods were already received; close the order instead.");
        }
      }
      await updateVersioned(
        tx,
        purchaseOrders,
        eq(purchaseOrders.id, id),
        version,
        {
          status: to,
          ...(to === "Approved" && { approvedAt: new Date(), approvedBy: actor().userId }),
        },
        "Purchase order",
      );
      await recordTransition(tx, "PurchaseOrder", id, current.status, to);
      this.changed(id);
    });
    return this.get(id);
  }

  /** Called by GRN posting: PartiallyReceived on the first receipt, Closed when fully received. */
  async afterReceipt(tx: Tx, poId: string) {
    const [po] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, poId)).for("update");
    if (!po) return;
    const lines = await tx.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.poId, poId));
    const complete = lines.every((l) => l.receivedM >= l.quantityM);
    const next: PoStatus | null =
      complete && po.status !== "Closed"
        ? "Closed"
        : po.status === "Approved"
          ? "PartiallyReceived"
          : null;
    if (!next || next === po.status) return;
    if (po.status === "Approved" && next === "Closed") {
      // Approved → PartiallyReceived → Closed keeps the log faithful to the machine.
      purchaseOrderMachine.assert("Approved", "PartiallyReceived");
      await recordTransition(tx, "PurchaseOrder", poId, "Approved", "PartiallyReceived");
      await recordTransition(tx, "PurchaseOrder", poId, "PartiallyReceived", "Closed", "Fully received");
    } else {
      purchaseOrderMachine.assert(po.status, next);
      await recordTransition(tx, "PurchaseOrder", poId, po.status, next);
    }
    await tx
      .update(purchaseOrders)
      .set({ status: next, updatedAt: new Date(), version: sql`${purchaseOrders.version} + 1` })
      .where(eq(purchaseOrders.id, poId));
    this.changed(poId);
  }

  private async lock(tx: Tx, id: string) {
    const [po] = await tx
      .select()
      .from(purchaseOrders)
      .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.companyId, actor().companyId)))
      .for("update");
    if (!po) throw notFound("Purchase order");
    return po;
  }

  private async assertSkus(tx: Tx, lines: { skuId?: string | null }[]) {
    const ids = [...new Set(lines.flatMap((l) => (l.skuId ? [l.skuId] : [])))];
    if (!ids.length) return;
    const found = await tx
      .select({ id: skus.id })
      .from(skus)
      .where(and(eq(skus.companyId, actor().companyId), inArray(skus.id, ids)));
    if (found.length !== ids.length) throw notFound("SKU");
  }

  private async insertLines(tx: Tx, poId: string, lines: PoCreateDto["lines"]) {
    await tx.insert(purchaseOrderLines).values(
      lines.map((l, i) => ({
        poId,
        lineNo: i + 1,
        skuId: l.skuId ?? null,
        description: l.description,
        gsm: l.gsm,
        widthIn: String(l.widthIn),
        qualityName: l.qualityName ?? null,
        quantityM: l.quantityM,
        ratePerM: l.ratePerM,
        gstRate: l.gstRate,
        notes: l.notes ?? null,
        createdBy: actor().userId,
      })),
    );
  }

  private changed(id: string) {
    this.bus.publishAfterCommit("purchase.changed", { doc: "PO", id });
  }
}
