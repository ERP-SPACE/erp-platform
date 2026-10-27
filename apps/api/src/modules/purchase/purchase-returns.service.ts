import type { PurchaseReturnDetail, PurchaseReturnItem } from "@erp/contracts";
import {
  type Tx,
  purchaseInvoiceLines,
  purchaseInvoices,
  purchaseReturnRolls,
  purchaseReturns,
  rolls,
  suppliers,
} from "@erp/db";
import { D, invoiceTotals, purchaseReturnMachine, rollMachine, round, taxLine } from "@erp/domain";
import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { actor } from "../../common/context.js";
import { trimDecimal } from "../../common/decimal.js";
import { notFound, validationError } from "../../common/errors.js";
import { recordTransition, writePostingEvent } from "../../db/ledger.js";
import { UnitOfWork } from "../../db/unit-of-work.js";
import { updateVersioned } from "../../db/versioning.js";
import { EventBus } from "../realtime/event-bus.js";
import { SeriesService } from "../series/series.service.js";
import { sameItem, supplierWithRegime } from "./purchase-common.js";
import type { PurchaseReturnCreateDto, PurchaseReturnUpdateDto } from "./purchase.dto.js";

const RETURNABLE = new Set(["Unmapped", "Mapped"]);

/**
 * Purchase returns (PRD §6.2): whole rolls go back to the supplier at their invoiced rate. Posting
 * numbers the return (PR) and its GST debit note (DN), moves the rolls to ReturnedToSupplier and
 * writes PURCHASE_RETURN_POSTED for the accounting stage. A roll can be on one return only.
 */
@Injectable()
export class PurchaseReturnsService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly bus: EventBus,
    private readonly series: SeriesService,
  ) {}

  async list(): Promise<PurchaseReturnItem[]> {
    const rows = await this.uow.db
      .select({ pr: purchaseReturns, supplierName: suppliers.name })
      .from(purchaseReturns)
      .innerJoin(suppliers, eq(suppliers.id, purchaseReturns.supplierId))
      .where(eq(purchaseReturns.companyId, actor().companyId))
      .orderBy(desc(purchaseReturns.date), desc(purchaseReturns.createdAt))
      .limit(500);
    const ids = rows.map((r) => r.pr.id);
    const counts = ids.length
      ? await this.uow.db
          .select({
            returnId: purchaseReturnRolls.returnId,
            n: sql<number>`count(*)::int`,
            m: sql<number>`sum(${purchaseReturnRolls.lengthM})::int`,
          })
          .from(purchaseReturnRolls)
          .where(inArray(purchaseReturnRolls.returnId, ids))
          .groupBy(purchaseReturnRolls.returnId)
      : [];
    const byId = new Map(counts.map((c) => [c.returnId, c]));
    return rows.map((r) => toItem(r.pr, r.supplierName, byId.get(r.pr.id)));
  }

  async get(id: string, db: UnitOfWork["db"] | Tx = this.uow.db): Promise<PurchaseReturnDetail> {
    const [row] = await db
      .select({ pr: purchaseReturns, supplierName: suppliers.name })
      .from(purchaseReturns)
      .innerJoin(suppliers, eq(suppliers.id, purchaseReturns.supplierId))
      .where(and(eq(purchaseReturns.id, id), eq(purchaseReturns.companyId, actor().companyId)));
    if (!row) throw notFound("Purchase return");
    const lines = await db
      .select({ line: purchaseReturnRolls, barcode: rolls.barcode, description: rolls.description })
      .from(purchaseReturnRolls)
      .innerJoin(rolls, eq(rolls.id, purchaseReturnRolls.rollId))
      .where(eq(purchaseReturnRolls.returnId, id))
      .orderBy(asc(rolls.barcode));
    const totals = this.totals(
      lines.map((l) => l.line),
      row.pr.regime,
    );
    const count = {
      n: lines.length,
      m: lines.reduce((s, l) => s + l.line.lengthM, 0),
    };
    const item = toItem(row.pr, row.supplierName, count);
    return {
      ...item,
      totals:
        row.pr.status === "Posted"
          ? item.totals
          : {
              taxable: totals.taxable.toFixed(2),
              cgst: totals.cgst.toFixed(2),
              sgst: totals.sgst.toFixed(2),
              igst: totals.igst.toFixed(2),
              roundOff: totals.roundOff.toFixed(2),
              total: totals.total.toFixed(2),
            },
      notes: row.pr.notes,
      rolls: lines.map(({ line, barcode, description }) => ({
        rollId: line.rollId,
        barcode,
        description,
        lengthM: line.lengthM,
        ratePerM: trimDecimal(line.ratePerM),
        amount: D(line.amount).toFixed(2),
      })),
    };
  }

  async create(dto: PurchaseReturnCreateDto): Promise<PurchaseReturnDetail> {
    const id = await this.uow.run(async (tx) => {
      const { regime } = await supplierWithRegime(tx, dto.supplierId);
      const [pr] = await tx
        .insert(purchaseReturns)
        .values({
          companyId: actor().companyId,
          branchId: actor().branchId,
          supplierId: dto.supplierId,
          piId: dto.piId ?? null,
          date: dto.date,
          regime,
          reason: dto.reason,
          notes: dto.notes ?? null,
          createdBy: actor().userId,
          updatedBy: actor().userId,
        })
        .returning();
      await this.writeRolls(tx, pr!.id, dto);
      await recordTransition(tx, "PurchaseReturn", pr!.id, null, "Draft");
      this.changed(pr!.id);
      return pr!.id;
    });
    return this.get(id);
  }

  async update(id: string, dto: PurchaseReturnUpdateDto): Promise<PurchaseReturnDetail> {
    await this.uow.run(async (tx) => {
      const pr = await this.lock(tx, id);
      if (pr.status !== "Draft") throw validationError("A posted purchase return can't be edited.");
      const { regime } = await supplierWithRegime(tx, dto.supplierId);
      await updateVersioned(
        tx,
        purchaseReturns,
        eq(purchaseReturns.id, id),
        dto.version,
        {
          supplierId: dto.supplierId,
          piId: dto.piId ?? null,
          date: dto.date,
          regime,
          reason: dto.reason,
          notes: dto.notes ?? null,
        },
        "Purchase return",
      );
      await tx.delete(purchaseReturnRolls).where(eq(purchaseReturnRolls.returnId, id));
      await this.writeRolls(tx, id, dto);
      this.changed(id);
    });
    return this.get(id);
  }

  async cancel(id: string, version: number): Promise<PurchaseReturnDetail> {
    await this.uow.run(async (tx) => {
      const pr = await this.lock(tx, id);
      purchaseReturnMachine.assert(pr.status, "Cancelled");
      // Free the rolls for another return (port matrix 2.10: one open return per roll).
      await tx.delete(purchaseReturnRolls).where(eq(purchaseReturnRolls.returnId, id));
      await updateVersioned(
        tx,
        purchaseReturns,
        eq(purchaseReturns.id, id),
        version,
        { status: "Cancelled" },
        "Purchase return",
      );
      await recordTransition(tx, "PurchaseReturn", id, pr.status, "Cancelled");
      this.changed(id);
    });
    return this.get(id);
  }

  async post(id: string, version: number): Promise<PurchaseReturnDetail> {
    await this.uow.run(async (tx) => {
      const pr = await this.lock(tx, id);
      purchaseReturnMachine.assert(pr.status, "Posted");
      const lines = await tx
        .select({ line: purchaseReturnRolls, roll: rolls })
        .from(purchaseReturnRolls)
        .innerJoin(rolls, eq(rolls.id, purchaseReturnRolls.rollId))
        .where(eq(purchaseReturnRolls.returnId, id))
        .for("update", { of: rolls });
      if (lines.length === 0) throw validationError("Add at least one roll before posting.");
      const moved = lines.filter((l) => !RETURNABLE.has(l.roll.status));
      if (moved.length) {
        throw validationError(
          `${moved[0]!.roll.barcode} is ${moved[0]!.roll.status} and can't be returned now.`,
        );
      }
      for (const { roll } of lines) rollMachine.assert(roll.status, "ReturnedToSupplier");
      const totals = this.totals(
        lines.map((l) => l.line),
        pr.regime,
      );
      const prNo = await this.series.allocate(tx, "PR", pr.date);
      const dnNo = await this.series.allocate(tx, "DN", pr.date);
      for (const status of ["Unmapped", "Mapped"] as const) {
        const ids = lines.filter((l) => l.roll.status === status).map((l) => l.roll.id);
        if (!ids.length) continue;
        await tx
          .update(rolls)
          .set({
            status: "ReturnedToSupplier",
            updatedAt: new Date(),
            updatedBy: actor().userId,
            version: sql`${rolls.version} + 1`,
          })
          .where(inArray(rolls.id, ids));
        await recordTransition(
          tx,
          "Roll",
          ids,
          status,
          "ReturnedToSupplier",
          `Purchase return ${prNo}: ${pr.reason}`,
        );
      }
      await updateVersioned(
        tx,
        purchaseReturns,
        eq(purchaseReturns.id, id),
        version,
        {
          status: "Posted",
          prNo,
          dnNo,
          taxable: totals.taxable.toFixed(2),
          cgst: totals.cgst.toFixed(2),
          sgst: totals.sgst.toFixed(2),
          igst: totals.igst.toFixed(2),
          roundOff: totals.roundOff.toFixed(2),
          total: totals.total.toFixed(2),
          postedAt: new Date(),
          postedBy: actor().userId,
        },
        "Purchase return",
      );
      await recordTransition(tx, "PurchaseReturn", id, "Draft", "Posted");
      const [supplier] = await tx.select().from(suppliers).where(eq(suppliers.id, pr.supplierId));
      await writePostingEvent(tx, {
        type: "PURCHASE_RETURN_POSTED",
        docType: "DN",
        docId: id,
        docNo: dnNo,
        docDate: pr.date,
        partyType: "SUPPLIER",
        partyId: pr.supplierId,
        payload: {
          prNo,
          dnNo,
          supplier: {
            id: supplier!.id,
            name: supplier!.name,
            gstin: supplier!.gstin,
            stateCode: supplier!.stateCode,
          },
          regime: pr.regime,
          reason: pr.reason,
          piId: pr.piId,
          rolls: lines.map(({ line, roll }) => ({
            rollId: roll.id,
            barcode: roll.barcode,
            lengthM: line.lengthM,
            ratePerM: line.ratePerM,
            gstRate: line.gstRate,
            amount: line.amount,
            // Inventory leaves at its carrying cost; any gap to the debit value is a variance.
            carryingValue: round(
              D(roll.costPerM ?? roll.baseCostPerM ?? 0).times(line.lengthM),
              2,
            ).toFixed(2),
          })),
          totals: {
            taxable: totals.taxable.toFixed(2),
            cgst: totals.cgst.toFixed(2),
            sgst: totals.sgst.toFixed(2),
            igst: totals.igst.toFixed(2),
            roundOff: totals.roundOff.toFixed(2),
            total: totals.total.toFixed(2),
          },
        },
      });
      this.changed(id);
      this.bus.publishAfterCommit("inventory.changed", { returnId: id });
    });
    return this.get(id);
  }

  /** Each roll returns at its invoiced rate (after discount) and its invoice line's GST rate. */
  private async writeRolls(tx: Tx, returnId: string, dto: PurchaseReturnCreateDto) {
    const ids = [...new Set(dto.rollIds)];
    const found = await tx
      .select()
      .from(rolls)
      .where(and(eq(rolls.companyId, actor().companyId), inArray(rolls.id, ids)))
      .for("update");
    if (found.length !== ids.length) throw notFound("Roll");
    const issues: { path: string; message: string }[] = [];
    for (const r of found) {
      if (r.supplierId !== dto.supplierId)
        issues.push({ path: "rollIds", message: `${r.barcode} is from another supplier` });
      else if (!RETURNABLE.has(r.status))
        issues.push({ path: "rollIds", message: `${r.barcode} is ${r.status}` });
      else if (!r.piId || !r.baseCostPerM)
        issues.push({
          path: "rollIds",
          message: `${r.barcode} has no posted purchase invoice yet`,
        });
      else if (dto.piId && r.piId !== dto.piId)
        issues.push({ path: "rollIds", message: `${r.barcode} is on another invoice` });
    }
    if (issues.length) throw validationError("Some rolls can't be returned.", issues);
    const piIds = [...new Set(found.map((r) => r.piId!))];
    const piLines = await tx
      .select({ line: purchaseInvoiceLines })
      .from(purchaseInvoiceLines)
      .innerJoin(purchaseInvoices, eq(purchaseInvoices.id, purchaseInvoiceLines.piId))
      .where(inArray(purchaseInvoiceLines.piId, piIds));
    const lineFor = (r: (typeof found)[number]) =>
      piLines.find(
        (p) =>
          p.line.piId === r.piId &&
          sameItem({ skuId: p.line.skuId, gsm: p.line.gsm, widthIn: p.line.widthIn }, r),
      )?.line;
    const unpriced = found.filter((r) => !lineFor(r));
    if (unpriced.length) {
      throw validationError(
        `${unpriced[0]!.barcode} has no matching line on its purchase invoice.`,
        [{ path: "rollIds", message: "Can't find its GST rate" }],
      );
    }
    await tx.insert(purchaseReturnRolls).values(
      found.map((r) => {
        const line = lineFor(r)!;
        return {
          returnId,
          rollId: r.id,
          lengthM: r.currentLengthM,
          ratePerM: r.baseCostPerM!,
          gstRate: line.gstRate,
          amount: round(D(r.baseCostPerM!).times(r.currentLengthM), 2).toFixed(2),
          createdBy: actor().userId,
        };
      }),
    );
  }

  private totals(
    lines: { lengthM: number; ratePerM: string; gstRate: string }[],
    regime: "CGST_SGST" | "IGST",
  ) {
    return invoiceTotals(
      lines.map((l) => taxLine({ quantity: l.lengthM, rate: l.ratePerM, gstRate: l.gstRate })),
      regime,
      1,
    );
  }

  private async lock(tx: Tx, id: string) {
    const [pr] = await tx
      .select()
      .from(purchaseReturns)
      .where(and(eq(purchaseReturns.id, id), eq(purchaseReturns.companyId, actor().companyId)))
      .for("update");
    if (!pr) throw notFound("Purchase return");
    return pr;
  }

  private changed(id: string) {
    this.bus.publishAfterCommit("purchase.changed", { doc: "PR", id });
  }
}

function toItem(
  pr: typeof purchaseReturns.$inferSelect,
  supplierName: string,
  count: { n: number; m: number } | undefined,
): PurchaseReturnItem {
  return {
    id: pr.id,
    prNo: pr.prNo,
    dnNo: pr.dnNo,
    date: pr.date,
    supplierId: pr.supplierId,
    supplierName,
    piId: pr.piId,
    status: pr.status,
    reason: pr.reason,
    rollCount: count?.n ?? 0,
    metres: count?.m ?? 0,
    totals: {
      taxable: D(pr.taxable).toFixed(2),
      cgst: D(pr.cgst).toFixed(2),
      sgst: D(pr.sgst).toFixed(2),
      igst: D(pr.igst).toFixed(2),
      roundOff: D(pr.roundOff).toFixed(2),
      total: D(pr.total).toFixed(2),
    },
    version: pr.version,
  };
}
