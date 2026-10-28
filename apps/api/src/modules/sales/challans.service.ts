import type {
  DcCutResult,
  DcDetail,
  DcListItem,
  dcCut,
  dcUpdate,
  salesListQuery,
} from "@erp/contracts";
import {
  type Tx,
  batches,
  customers,
  deliveryChallanRolls,
  deliveryChallans,
  rollCuts,
  rollLengthChanges,
  rolls,
  salesInvoiceDcs,
  salesInvoices,
  salesOrderLines,
  salesOrders,
  suppliers,
  transporters,
} from "@erp/db";
import {
  D,
  type DcStatus,
  cutRoll,
  deliveryChallanMachine,
  formatRollBarcode,
  parseRollBarcode,
  rollMachine,
  round,
  salesOrderMachine,
  taxLine,
} from "@erp/domain";
import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, gte, ilike, inArray, lte, ne, or, sql } from "drizzle-orm";
import type { z } from "zod";
import { actor } from "../../common/context.js";
import { AppError, notFound, validationError } from "../../common/errors.js";
import { recordTransition, writePostingEvent } from "../../db/ledger.js";
import { UnitOfWork } from "../../db/unit-of-work.js";
import { updateVersioned } from "../../db/versioning.js";
import { customerScopeFilter, loadCustomerScope } from "../customers/customer-scope.js";
import { EventBus } from "../realtime/event-bus.js";
import { SeriesService } from "../series/series.service.js";
import { SettingsService } from "../settings/settings.service.js";

const rollUnavailable = (what: string) => new AppError(409, "ROLL_UNAVAILABLE", what);
const touch = () => ({
  updatedAt: new Date(),
  updatedBy: actor().userId,
  version: sql`${rolls.version} + 1`,
});

/**
 * Delivery challans (PRD §6.5, ADR-0014/0018). Picking a roll onto a draft challan holds it
 * (Mapped → Allocated) with `FOR UPDATE SKIP LOCKED`, so two people can never take one roll; a
 * cut makes an Allocated child with a new barcode and leaves the parent Mapped and shorter.
 * Posting dispatches the rolls and moves the order on.
 */
@Injectable()
export class ChallansService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly bus: EventBus,
    private readonly series: SeriesService,
    private readonly settings: SettingsService,
  ) {}

  async list(query: z.infer<typeof salesListQuery>): Promise<DcListItem[]> {
    const scope = await loadCustomerScope(this.uow.db);
    const where = [customerScopeFilter(scope)];
    if (query.status) where.push(eq(deliveryChallans.status, query.status as DcStatus));
    if (query.customerId) where.push(eq(deliveryChallans.customerId, query.customerId));
    if (query.from) where.push(gte(deliveryChallans.date, query.from));
    if (query.to) where.push(lte(deliveryChallans.date, query.to));
    if (query.q) {
      const q = `%${query.q}%`;
      where.push(
        or(
          ilike(deliveryChallans.dcNo, q),
          ilike(customers.legalName, q),
          ilike(salesOrders.soNo, q),
        )!,
      );
    }
    const rows = await this.uow.db
      .select({ dc: deliveryChallans, customerName: customers.legalName, soNo: salesOrders.soNo })
      .from(deliveryChallans)
      .innerJoin(customers, eq(customers.id, deliveryChallans.customerId))
      .innerJoin(salesOrders, eq(salesOrders.id, deliveryChallans.soId))
      .where(and(...where))
      .orderBy(desc(deliveryChallans.date), desc(deliveryChallans.createdAt))
      .limit(500);
    const ids = rows.map((r) => r.dc.id);
    const counts = await this.counts(this.uow.db, ids);
    const billed = await this.billed(this.uow.db, ids);
    return rows.map((r) =>
      toListItem(r.dc, r.customerName, r.soNo, counts.get(r.dc.id), billed.has(r.dc.id)),
    );
  }

  private async counts(db: UnitOfWork["db"] | Tx, ids: string[]) {
    if (!ids.length) return new Map<string, { n: number; m: number }>();
    const rows = await db
      .select({
        dcId: deliveryChallanRolls.dcId,
        n: sql<number>`count(*)::int`,
        m: sql<number>`sum(${deliveryChallanRolls.lengthM})::int`,
      })
      .from(deliveryChallanRolls)
      .where(inArray(deliveryChallanRolls.dcId, ids))
      .groupBy(deliveryChallanRolls.dcId);
    return new Map(rows.map((r) => [r.dcId, r]));
  }

  /** Challans on a draft or posted invoice (cancelled invoices free them again). */
  private async billed(db: UnitOfWork["db"] | Tx, ids: string[]) {
    if (!ids.length) return new Set<string>();
    const rows = await db
      .select({ dcId: salesInvoiceDcs.dcId })
      .from(salesInvoiceDcs)
      .innerJoin(salesInvoices, eq(salesInvoices.id, salesInvoiceDcs.siId))
      .where(and(inArray(salesInvoiceDcs.dcId, ids), ne(salesInvoices.status, "Cancelled")));
    return new Set(rows.map((r) => r.dcId));
  }

  async get(id: string, db: UnitOfWork["db"] | Tx = this.uow.db): Promise<DcDetail> {
    const scope = await loadCustomerScope(db);
    const [row] = await db
      .select({
        dc: deliveryChallans,
        customerName: customers.legalName,
        soNo: salesOrders.soNo,
        transporterName: transporters.name,
      })
      .from(deliveryChallans)
      .innerJoin(customers, eq(customers.id, deliveryChallans.customerId))
      .innerJoin(salesOrders, eq(salesOrders.id, deliveryChallans.soId))
      .leftJoin(transporters, eq(transporters.id, deliveryChallans.transporterId))
      .where(and(eq(deliveryChallans.id, id), customerScopeFilter(scope)));
    if (!row) throw notFound("Delivery challan");
    const dc = row.dc;
    const lines = await db
      .select()
      .from(salesOrderLines)
      .where(eq(salesOrderLines.soId, dc.soId))
      .orderBy(asc(salesOrderLines.lineNo));
    const picked = await db
      .select({
        line: deliveryChallanRolls,
        barcode: rolls.barcode,
        description: rolls.description,
        parentBarcode: sql<
          string | null
        >`(SELECT p.barcode FROM rolls p WHERE p.id = ${rolls.parentRollId})`,
      })
      .from(deliveryChallanRolls)
      .innerJoin(rolls, eq(rolls.id, deliveryChallanRolls.rollId))
      .where(eq(deliveryChallanRolls.dcId, id))
      .orderBy(asc(deliveryChallanRolls.createdAt));
    const pickedBy = new Map<string, number>();
    for (const p of picked)
      pickedBy.set(p.line.soLineId, (pickedBy.get(p.line.soLineId) ?? 0) + p.line.lengthM);
    const threshold = await this.settings.value("ewaybill.thresholdInr");
    const billed = await this.billed(db, [id]);
    return {
      ...toListItem(
        dc,
        row.customerName,
        row.soNo,
        { n: picked.length, m: picked.reduce((s, p) => s + p.line.lengthM, 0) },
        billed.has(id),
      ),
      transporterId: dc.transporterId,
      vehicleNo: dc.vehicleNo,
      lrNo: dc.lrNo,
      lrDate: dc.lrDate,
      distanceKm: dc.distanceKm,
      ewayBillNo: dc.ewayBillNo,
      ewayBillDate: dc.ewayBillDate,
      transporterName: row.transporterName,
      notes: dc.notes,
      value: D(dc.value).toFixed(2),
      ewayBillRequired: D(dc.value).greaterThan(threshold),
      lines: lines.map((l) => {
        const pickedM = pickedBy.get(l.id) ?? 0;
        // Rolls already counted in dispatchedM once this challan is posted.
        const sent = dc.status === "Draft" ? l.dispatchedM : l.dispatchedM - pickedM;
        return {
          soLineId: l.id,
          description: l.description,
          orderedM: l.totalM,
          pickedM,
          balanceM: Math.max(0, l.totalM - sent - pickedM),
          allowCut: l.allowCut,
        };
      }),
      rolls: picked.map((p) => ({
        rollId: p.line.rollId,
        barcode: p.barcode,
        lengthM: p.line.lengthM,
        soLineId: p.line.soLineId,
        description: p.description,
        cutFromBarcode: p.parentBarcode,
      })),
    };
  }

  /** One draft challan per order at a time; the order must be confirmed. */
  async create(soId: string, date: string): Promise<DcDetail> {
    const id = await this.uow.run(async (tx) => {
      const so = await this.lockOrder(tx, soId);
      if (so.status !== "Confirmed" && so.status !== "PartiallyFulfilled") {
        throw validationError(
          so.status === "OnHold"
            ? "This order is on hold for credit. Release it before dispatching."
            : `A ${so.status} order can't be dispatched.`,
        );
      }
      const [open] = await tx
        .select({ dcNo: deliveryChallans.dcNo })
        .from(deliveryChallans)
        .where(and(eq(deliveryChallans.soId, soId), eq(deliveryChallans.status, "Draft")));
      if (open) throw validationError(`Challan ${open.dcNo} is still being picked for this order.`);
      const dcNo = await this.series.allocate(tx, "DC", date);
      const [dc] = await tx
        .insert(deliveryChallans)
        .values({
          companyId: actor().companyId,
          branchId: actor().branchId,
          customerId: so.customerId,
          dcNo,
          soId,
          date,
          createdBy: actor().userId,
          updatedBy: actor().userId,
        })
        .returning();
      await recordTransition(tx, "DeliveryChallan", dc!.id, null, "Draft");
      this.changed(dc!.id);
      return dc!.id;
    });
    return this.get(id);
  }

  /** Transport details stay editable after dispatch (the e-way bill often comes later). */
  async update(id: string, dto: z.infer<typeof dcUpdate>): Promise<DcDetail> {
    await this.uow.run(async (tx) => {
      const dc = await this.lock(tx, id);
      if (dc.status === "Cancelled" || dc.status === "Closed") {
        throw validationError(`A ${dc.status.toLowerCase()} challan can't be changed.`);
      }
      if (dc.status !== "Draft" && dto.date !== dc.date) {
        throw validationError("The date of a dispatched challan can't change.", [
          { path: "date", message: "Already dispatched" },
        ]);
      }
      if (dto.transporterId) {
        const [t] = await tx
          .select({ id: transporters.id })
          .from(transporters)
          .where(
            and(
              eq(transporters.id, dto.transporterId),
              eq(transporters.companyId, actor().companyId),
            ),
          );
        if (!t) throw notFound("Transporter");
      }
      await updateVersioned(
        tx,
        deliveryChallans,
        eq(deliveryChallans.id, id),
        dto.version,
        {
          date: dto.date,
          transporterId: dto.transporterId ?? null,
          vehicleNo: dto.vehicleNo ?? null,
          lrNo: dto.lrNo ?? null,
          lrDate: dto.lrDate ?? null,
          distanceKm: dto.distanceKm ?? null,
          ewayBillNo: dto.ewayBillNo ?? null,
          ewayBillDate: dto.ewayBillDate ?? null,
          notes: dto.notes ?? null,
        },
        "Delivery challan",
      );
      this.changed(id);
    });
    return this.get(id);
  }

  /** Scan or choose a roll for a line. It must be Mapped and of the line's product. */
  async pick(
    id: string,
    input: { soLineId: string; rollId?: string; barcode?: string },
  ): Promise<DcDetail> {
    await this.uow.run(async (tx) => {
      const dc = await this.lockDraft(tx, id);
      const line = await this.line(tx, dc.soId, input.soLineId);
      let rollId = input.rollId;
      if (input.barcode) {
        const parsed = parseRollBarcode(input.barcode);
        if (!parsed.valid) throw validationError(parsed.error);
        const [r] = await tx
          .select({ id: rolls.id })
          .from(rolls)
          .where(
            and(
              eq(rolls.barcode, input.barcode.trim().toUpperCase()),
              eq(rolls.companyId, actor().companyId),
            ),
          );
        if (!r) throw notFound(`Roll ${input.barcode.trim().toUpperCase()}`);
        rollId = r.id;
      }
      const [roll] = await tx
        .select()
        .from(rolls)
        .where(and(eq(rolls.id, rollId!), eq(rolls.companyId, actor().companyId)))
        .for("update", { skipLocked: true });
      if (!roll)
        throw rollUnavailable("Someone else is picking this roll right now. Try another one.");
      if (roll.status !== "Mapped") {
        const [where] = await tx
          .select({ dcNo: deliveryChallans.dcNo })
          .from(deliveryChallanRolls)
          .innerJoin(deliveryChallans, eq(deliveryChallans.id, deliveryChallanRolls.dcId))
          .where(
            and(eq(deliveryChallanRolls.rollId, roll.id), eq(deliveryChallans.status, "Draft")),
          );
        throw rollUnavailable(
          roll.status === "Allocated" && where
            ? `${roll.barcode} is already picked on ${where.dcNo}.`
            : `${roll.barcode} is ${roll.status} and can't be sent.`,
        );
      }
      if (roll.skuId !== line.skuId) {
        throw validationError(`${roll.barcode} is ${roll.description}, not ${line.description}.`);
      }
      await this.assertRoom(tx, dc, line, roll.currentLengthM);
      rollMachine.assert("Mapped", "Allocated");
      await tx
        .update(rolls)
        .set({ status: "Allocated", ...touch() })
        .where(eq(rolls.id, roll.id));
      await recordTransition(tx, "Roll", roll.id, "Mapped", "Allocated", `Picked on ${dc.dcNo}`);
      await tx.insert(deliveryChallanRolls).values({
        dcId: id,
        soLineId: line.id,
        rollId: roll.id,
        lengthM: roll.currentLengthM,
        createdBy: actor().userId,
      });
      await this.revalue(tx, id);
      this.changed(id);
    });
    return this.get(id);
  }

  /** A line may be over-filled by at most the allocation tolerance; beyond that, cut a roll. */
  private async assertRoom(
    tx: Tx,
    dc: typeof deliveryChallans.$inferSelect,
    line: typeof salesOrderLines.$inferSelect,
    lengthM: number,
  ) {
    const { toleranceM } = await this.settings.value("inventory.allocation");
    const [p] = await tx
      .select({ m: sql<number>`coalesce(sum(${deliveryChallanRolls.lengthM}), 0)::int` })
      .from(deliveryChallanRolls)
      .where(and(eq(deliveryChallanRolls.dcId, dc.id), eq(deliveryChallanRolls.soLineId, line.id)));
    const balance = line.totalM - line.dispatchedM - p!.m;
    if (lengthM > balance + toleranceM) {
      throw validationError(
        balance <= 0
          ? `${line.description} is already fully picked.`
          : `Only ${balance.toLocaleString("en-IN")} m is left on this line; this roll has ${lengthM.toLocaleString("en-IN")} m.${line.allowCut ? " Cut it instead." : ""}`,
      );
    }
  }

  async unpick(id: string, rollId: string): Promise<DcDetail> {
    await this.uow.run(async (tx) => {
      const dc = await this.lockDraft(tx, id);
      const [row] = await tx
        .delete(deliveryChallanRolls)
        .where(and(eq(deliveryChallanRolls.dcId, id), eq(deliveryChallanRolls.rollId, rollId)))
        .returning();
      if (!row) throw notFound("Roll on this challan");
      // A cut piece can't be un-cut: it goes back to stock as a remnant (ADR-0014).
      await tx
        .update(rolls)
        .set({ status: "Mapped", ...touch() })
        .where(eq(rolls.id, rollId));
      await recordTransition(tx, "Roll", rollId, "Allocated", "Mapped", `Removed from ${dc.dcNo}`);
      await this.revalue(tx, id);
      this.changed(id);
    });
    return this.get(id);
  }

  /** Cut at picking (ADR-0018): the piece is picked for the line; the parent stays in stock. */
  async cut(id: string, input: z.infer<typeof dcCut>): Promise<DcCutResult> {
    const result = await this.uow.run(async (tx) => {
      const dc = await this.lockDraft(tx, id);
      const line = await this.line(tx, dc.soId, input.soLineId);
      if (!line.allowCut) {
        throw validationError("This customer doesn't accept cut rolls on this line.");
      }
      const [parent] = await tx
        .select()
        .from(rolls)
        .where(and(eq(rolls.id, input.rollId), eq(rolls.companyId, actor().companyId)))
        .for("update", { skipLocked: true });
      if (!parent) throw rollUnavailable("Someone else is using this roll right now.");
      if (parent.status !== "Mapped")
        throw rollUnavailable(`${parent.barcode} is ${parent.status} and can't be cut.`);
      if (parent.skuId !== line.skuId) {
        throw validationError(
          `${parent.barcode} is ${parent.description}, not ${line.description}.`,
        );
      }
      await this.assertRoom(tx, dc, line, input.cutM);
      const perM = D(parent.costPerM ?? parent.baseCostPerM ?? 0);
      const costs = cutRoll(
        {
          lengthM: parent.currentLengthM,
          landedCostTotal: round(perM.times(parent.currentLengthM), 2),
        },
        input.cutM,
        input.wasteM,
      );

      // The child's barcode continues the parent's batch sequence (ADR-0007/0018).
      const [batch] = await tx
        .select()
        .from(batches)
        .where(eq(batches.id, parent.batchId))
        .for("update");
      const [supplier] = await tx
        .select()
        .from(suppliers)
        .where(eq(suppliers.id, parent.supplierId));
      const rollSeq = batch!.nextRollSeq;
      if (rollSeq > 9999) throw validationError("This batch has used all 9999 roll numbers.");
      await tx
        .update(batches)
        .set({ nextRollSeq: rollSeq + 1 })
        .where(eq(batches.id, batch!.id));
      const baseValue = parent.baseCostPerM
        ? round(D(parent.baseCostPerM).times(input.cutM), 2)
        : D(0);
      const [child] = await tx
        .insert(rolls)
        .values({
          companyId: parent.companyId,
          branchId: parent.branchId,
          barcode: formatRollBarcode({
            postedAt: parent.receivedAt,
            supplierCode: supplier!.shortCode,
            batchSeq: batch!.batchSeq,
            rollSeq,
          }),
          batchId: parent.batchId,
          rollSeq,
          supplierId: parent.supplierId,
          grnId: parent.grnId,
          grnLineId: parent.grnLineId,
          skuId: parent.skuId,
          description: parent.description,
          gsm: parent.gsm,
          widthIn: parent.widthIn,
          qualityName: parent.qualityName,
          originalLengthM: input.cutM,
          currentLengthM: input.cutM,
          status: "Allocated",
          baseCostPerM: parent.baseCostPerM,
          baseValue: baseValue.toFixed(2),
          landedCost: (costs.childCost.greaterThan(baseValue)
            ? costs.childCost.minus(baseValue)
            : D(0)
          ).toFixed(2),
          costPerM: parent.costPerM,
          piId: parent.piId,
          parentRollId: parent.id,
          // Same age as its parent: FIFO and ageing follow the paper, not the cut.
          receivedAt: parent.receivedAt,
          mappedAt: parent.mappedAt,
          createdBy: actor().userId,
          updatedBy: actor().userId,
        })
        .returning();
      await recordTransition(
        tx,
        "Roll",
        child!.id,
        null,
        "Allocated",
        `Cut from ${parent.barcode} for ${dc.dcNo}`,
      );
      await tx
        .update(rolls)
        .set({ currentLengthM: costs.parentLengthAfter, labelReprintDue: true, ...touch() })
        .where(eq(rolls.id, parent.id));
      const [cutRow] = await tx
        .insert(rollCuts)
        .values({
          parentRollId: parent.id,
          childRollId: child!.id,
          cutM: input.cutM,
          wasteM: input.wasteM,
          parentLengthBefore: parent.currentLengthM,
          parentLengthAfter: costs.parentLengthAfter,
          childCost: costs.childCost.toFixed(2),
          wasteCost: costs.wasteCost.toFixed(2),
          dcId: dc.id,
          soLineId: line.id,
          createdBy: actor().userId,
        })
        .returning();
      await tx.insert(rollLengthChanges).values({
        rollId: parent.id,
        kind: "CUT",
        fromM: parent.currentLengthM,
        toM: costs.parentLengthAfter,
        reason: `Cut ${input.cutM} m${input.wasteM ? ` + ${input.wasteM} m waste` : ""} for ${dc.dcNo}`,
        refType: "roll_cut",
        refId: cutRow!.id,
        createdBy: actor().userId,
      });
      if (input.wasteM > 0) {
        await writePostingEvent(tx, {
          type: "ROLL_SCRAPPED",
          docType: "ROLL",
          docId: parent.id,
          docNo: parent.barcode,
          docDate: dc.date,
          payload: {
            reason: "cut waste",
            rolls: [
              {
                rollId: parent.id,
                barcode: parent.barcode,
                skuId: parent.skuId,
                lengthM: input.wasteM,
                costPerM: perM.toFixed(4),
                value: costs.wasteCost.toFixed(2),
              },
            ],
            total: costs.wasteCost.toFixed(2),
          },
        });
      }
      await tx.insert(deliveryChallanRolls).values({
        dcId: id,
        soLineId: line.id,
        rollId: child!.id,
        lengthM: input.cutM,
        createdBy: actor().userId,
      });
      await this.revalue(tx, id);
      this.changed(id);
      this.bus.publishAfterCommit("inventory.changed", { rollId: parent.id });
      return {
        child: { rollId: child!.id, barcode: child!.barcode, lengthM: input.cutM },
        parent: { rollId: parent.id, barcode: parent.barcode, lengthM: costs.parentLengthAfter },
        labelRollIds: [child!.id, parent.id],
      };
    });
    return result;
  }

  /** Dispatch: rolls → Dispatched, order quantities and status move on, DC_POSTED is written. */
  async post(id: string, version: number): Promise<DcDetail> {
    await this.uow.run(async (tx) => {
      const dc = await this.lockDraft(tx, id);
      deliveryChallanMachine.assert(dc.status, "Open");
      const picked = await tx
        .select({ pick: deliveryChallanRolls, roll: rolls })
        .from(deliveryChallanRolls)
        .innerJoin(rolls, eq(rolls.id, deliveryChallanRolls.rollId))
        .where(eq(deliveryChallanRolls.dcId, id))
        .for("update", { of: rolls });
      if (!picked.length) throw validationError("Pick at least one roll before dispatching.");
      const wrong = picked.find((p) => p.roll.status !== "Allocated");
      if (wrong)
        throw rollUnavailable(
          `${wrong.roll.barcode} is ${wrong.roll.status}; remove it and pick again.`,
        );
      const so = await this.lockOrder(tx, dc.soId);
      if (so.status !== "Confirmed" && so.status !== "PartiallyFulfilled") {
        throw validationError(`The order is ${so.status}; it can't be dispatched now.`);
      }
      const ids = picked.map((p) => p.roll.id);
      await tx
        .update(rolls)
        .set({ status: "Dispatched", ...touch() })
        .where(inArray(rolls.id, ids));
      await recordTransition(
        tx,
        "Roll",
        ids,
        "Allocated",
        "Dispatched",
        `Dispatched on ${dc.dcNo}`,
      );

      const byLine = new Map<string, number>();
      for (const p of picked)
        byLine.set(p.pick.soLineId, (byLine.get(p.pick.soLineId) ?? 0) + p.pick.lengthM);
      for (const [lineId, m] of byLine) {
        await tx
          .update(salesOrderLines)
          .set({ dispatchedM: sql`${salesOrderLines.dispatchedM} + ${m}` })
          .where(eq(salesOrderLines.id, lineId));
      }
      const lines = await tx.select().from(salesOrderLines).where(eq(salesOrderLines.soId, so.id));
      const { toleranceM } = await this.settings.value("inventory.allocation");
      const done = lines.every((l) => l.dispatchedM >= l.totalM - toleranceM);
      const soTo = done ? "Closed" : "PartiallyFulfilled";
      if (soTo !== so.status) {
        salesOrderMachine.assert(so.status, soTo);
        await tx
          .update(salesOrders)
          .set({
            status: soTo,
            updatedAt: new Date(),
            updatedBy: actor().userId,
            version: sql`${salesOrders.version} + 1`,
          })
          .where(eq(salesOrders.id, so.id));
        await recordTransition(
          tx,
          "SalesOrder",
          so.id,
          so.status,
          soTo,
          `Dispatched on ${dc.dcNo}`,
        );
      }
      await updateVersioned(
        tx,
        deliveryChallans,
        eq(deliveryChallans.id, id),
        version,
        { status: "Open", postedAt: new Date(), postedBy: actor().userId },
        "Delivery challan",
      );
      await recordTransition(tx, "DeliveryChallan", id, "Draft", "Open");
      const [customer] = await tx.select().from(customers).where(eq(customers.id, dc.customerId));
      await writePostingEvent(tx, {
        type: "DC_POSTED",
        docType: "DC",
        docId: id,
        docNo: dc.dcNo,
        docDate: dc.date,
        partyType: "CUSTOMER",
        partyId: dc.customerId,
        payload: {
          dcNo: dc.dcNo,
          soId: so.id,
          soNo: so.soNo,
          customer: { id: customer!.id, name: customer!.legalName, gstin: customer!.gstin },
          transport: {
            transporterId: dc.transporterId,
            vehicleNo: dc.vehicleNo,
            lrNo: dc.lrNo,
            ewayBillNo: dc.ewayBillNo,
          },
          // Goods leave stock at carrying cost; COGS is recognised when invoiced (PRD §8.4).
          rolls: picked.map((p) => ({
            rollId: p.roll.id,
            barcode: p.roll.barcode,
            soLineId: p.pick.soLineId,
            skuId: p.roll.skuId,
            lengthM: p.pick.lengthM,
            costPerM: p.roll.costPerM ?? p.roll.baseCostPerM,
            cost: round(
              D(p.roll.costPerM ?? p.roll.baseCostPerM ?? 0).times(p.pick.lengthM),
              2,
            ).toFixed(2),
          })),
          value: D(dc.value).toFixed(2),
        },
      });
      this.changed(id);
      this.bus.publishAfterCommit("inventory.changed", { dcId: id });
    });
    return this.get(id);
  }

  /** Cancel a draft: picked rolls go back to stock (cut pieces stay as remnants). */
  async cancel(id: string, version: number): Promise<DcDetail> {
    await this.uow.run(async (tx) => {
      const dc = await this.lock(tx, id);
      deliveryChallanMachine.assert(dc.status, "Cancelled");
      const picked = await tx
        .select()
        .from(deliveryChallanRolls)
        .where(eq(deliveryChallanRolls.dcId, id));
      const ids = picked.map((p) => p.rollId);
      if (ids.length) {
        await tx
          .update(rolls)
          .set({ status: "Mapped", ...touch() })
          .where(inArray(rolls.id, ids));
        await recordTransition(
          tx,
          "Roll",
          ids,
          "Allocated",
          "Mapped",
          `Challan ${dc.dcNo} cancelled`,
        );
        await tx.delete(deliveryChallanRolls).where(eq(deliveryChallanRolls.dcId, id));
      }
      await updateVersioned(
        tx,
        deliveryChallans,
        eq(deliveryChallans.id, id),
        version,
        { status: "Cancelled", value: "0" },
        "Delivery challan",
      );
      await recordTransition(tx, "DeliveryChallan", id, "Draft", "Cancelled");
      this.changed(id);
    });
    return this.get(id);
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  /** Taxable value of the picked metres at the order's line rates (e-way bill threshold). */
  private async revalue(tx: Tx, id: string) {
    const rows = await tx
      .select({
        m: deliveryChallanRolls.lengthM,
        rate: salesOrderLines.ratePerM,
        disc: salesOrderLines.discountPct,
      })
      .from(deliveryChallanRolls)
      .innerJoin(salesOrderLines, eq(salesOrderLines.id, deliveryChallanRolls.soLineId))
      .where(eq(deliveryChallanRolls.dcId, id));
    const value = rows.reduce(
      (s, r) =>
        s.plus(taxLine({ quantity: r.m, rate: r.rate, discountPct: r.disc, gstRate: 0 }).taxable),
      D(0),
    );
    await tx
      .update(deliveryChallans)
      .set({ value: value.toFixed(2) })
      .where(eq(deliveryChallans.id, id));
  }

  private async line(tx: Tx, soId: string, lineId: string) {
    const [line] = await tx
      .select()
      .from(salesOrderLines)
      .where(and(eq(salesOrderLines.id, lineId), eq(salesOrderLines.soId, soId)));
    if (!line) throw notFound("Order line on this challan's order");
    return line;
  }

  private async lockOrder(tx: Tx, soId: string) {
    const scope = await loadCustomerScope(tx);
    const [row] = await tx
      .select({ so: salesOrders })
      .from(salesOrders)
      .innerJoin(customers, eq(customers.id, salesOrders.customerId))
      .where(and(eq(salesOrders.id, soId), customerScopeFilter(scope)))
      .for("update", { of: salesOrders });
    if (!row) throw notFound("Sales order");
    return row.so;
  }

  async lock(tx: Tx, id: string) {
    const scope = await loadCustomerScope(tx);
    const [row] = await tx
      .select({ dc: deliveryChallans })
      .from(deliveryChallans)
      .innerJoin(customers, eq(customers.id, deliveryChallans.customerId))
      .where(and(eq(deliveryChallans.id, id), customerScopeFilter(scope)))
      .for("update", { of: deliveryChallans });
    if (!row) throw notFound("Delivery challan");
    return row.dc;
  }

  private async lockDraft(tx: Tx, id: string) {
    const dc = await this.lock(tx, id);
    if (dc.status !== "Draft")
      throw validationError(
        `Challan ${dc.dcNo} is already ${dc.status === "Open" ? "dispatched" : dc.status.toLowerCase()}.`,
      );
    return dc;
  }

  private changed(id: string) {
    this.bus.publishAfterCommit("sales.changed", { doc: "DC", id });
  }
}

function toListItem(
  dc: typeof deliveryChallans.$inferSelect,
  customerName: string,
  soNo: string,
  count: { n: number; m: number } | undefined,
  invoiced: boolean,
): DcListItem {
  return {
    id: dc.id,
    dcNo: dc.dcNo,
    date: dc.date,
    soId: dc.soId,
    soNo,
    customerId: dc.customerId,
    customerName,
    status: dc.status,
    rollCount: count?.n ?? 0,
    metres: count?.m ?? 0,
    vehicleNo: dc.vehicleNo,
    invoiced,
    version: dc.version,
  };
}
