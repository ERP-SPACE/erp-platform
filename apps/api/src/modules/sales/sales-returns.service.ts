import type {
  SalesReturnDetail,
  SalesReturnItem,
  returnInspection,
  salesListQuery,
  salesReturnCreate,
} from "@erp/contracts";
import {
  type Tx,
  customerNotes,
  customers,
  rollLengthChanges,
  rolls,
  salesInvoiceLines,
  salesInvoiceRolls,
  salesInvoices,
  salesReturnRolls,
  salesReturns,
} from "@erp/db";
import {
  D,
  invoiceTotals,
  partialReturn,
  rollMachine,
  round,
  salesReturnMachine,
  sum,
  taxLine,
} from "@erp/domain";
import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { z } from "zod";
import { actor } from "../../common/context.js";
import { notFound, validationError } from "../../common/errors.js";
import { recordTransition, writePostingEvent } from "../../db/ledger.js";
import { UnitOfWork } from "../../db/unit-of-work.js";
import { updateVersioned } from "../../db/versioning.js";
import { customerScopeFilter, loadCustomerScope } from "../customers/customer-scope.js";
import { canSeeCost } from "../inventory/rolls.service.js";
import { EventBus } from "../realtime/event-bus.js";
import { SeriesService } from "../series/series.service.js";
import { SettingsService } from "../settings/settings.service.js";
import { NotesService } from "./notes.service.js";
import { loadSkus, totalsOut } from "./sales-common.js";

type Input = z.infer<typeof salesReturnCreate>;
const touch = () => ({
  updatedAt: new Date(),
  updatedBy: actor().userId,
  version: sql`${rolls.version} + 1`,
});

/**
 * Sales returns (PRD §6.6, §8.4; ADR-0015, Q19). The same roll (same barcode) comes back with its
 * measured length: the credit note is the returned share of what was billed, and the roll's cost
 * back in stock is the same share of its COGS (700 of 1000 m → 70 %). Posting issues the credit
 * note; each roll is then inspected — back to stock (new label) or scrap.
 */
@Injectable()
export class SalesReturnsService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly bus: EventBus,
    private readonly series: SeriesService,
    private readonly settings: SettingsService,
    private readonly notes: NotesService,
  ) {}

  async list(query: z.infer<typeof salesListQuery>): Promise<SalesReturnItem[]> {
    const scope = await loadCustomerScope(this.uow.db);
    const where = [customerScopeFilter(scope)];
    if (query.status) where.push(eq(salesReturns.status, query.status as "Draft"));
    if (query.customerId) where.push(eq(salesReturns.customerId, query.customerId));
    if (query.from) where.push(gte(salesReturns.date, query.from));
    if (query.to) where.push(lte(salesReturns.date, query.to));
    if (query.q) {
      const q = `%${query.q}%`;
      where.push(
        or(
          ilike(salesReturns.srNo, q),
          ilike(customers.legalName, q),
          ilike(salesInvoices.siNo, q),
        )!,
      );
    }
    const rows = await this.uow.db
      .select({ sr: salesReturns, customerName: customers.legalName, siNo: salesInvoices.siNo })
      .from(salesReturns)
      .innerJoin(customers, eq(customers.id, salesReturns.customerId))
      .innerJoin(salesInvoices, eq(salesInvoices.id, salesReturns.siId))
      .where(and(...where))
      .orderBy(desc(salesReturns.date), desc(salesReturns.createdAt))
      .limit(500);
    const out: SalesReturnItem[] = [];
    for (const r of rows)
      out.push(await this.toItem(this.uow.db, r.sr, r.customerName, r.siNo ?? ""));
    return out;
  }

  private async toItem(
    db: UnitOfWork["db"] | Tx,
    sr: typeof salesReturns.$inferSelect,
    customerName: string,
    siNo: string,
  ): Promise<SalesReturnItem> {
    const [c] = await db
      .select({
        n: sql<number>`count(*)::int`,
        m: sql<number>`coalesce(sum(${salesReturnRolls.returnedM}), 0)::int`,
        waiting: sql<number>`count(*) FILTER (WHERE ${salesReturnRolls.inspectedAt} IS NULL)::int`,
      })
      .from(salesReturnRolls)
      .where(eq(salesReturnRolls.returnId, sr.id));
    const [cn] = await db
      .select({ id: customerNotes.id, noteNo: customerNotes.noteNo })
      .from(customerNotes)
      .where(eq(customerNotes.salesReturnId, sr.id));
    return {
      id: sr.id,
      srNo: sr.srNo,
      cnId: cn?.id ?? null,
      cnNo: cn?.noteNo ?? null,
      date: sr.date,
      siId: sr.siId,
      siNo,
      customerId: sr.customerId,
      customerName,
      status: sr.status,
      reason: sr.reason,
      rollCount: c?.n ?? 0,
      returnedM: c?.m ?? 0,
      awaitingInspection: sr.status === "Posted" ? (c?.waiting ?? 0) : 0,
      total: D(sr.total).toFixed(2),
      version: sr.version,
    };
  }

  async get(id: string): Promise<SalesReturnDetail> {
    const scope = await loadCustomerScope(this.uow.db);
    const [row] = await this.uow.db
      .select({
        sr: salesReturns,
        customerName: customers.legalName,
        siNo: salesInvoices.siNo,
        regime: salesInvoices.regime,
      })
      .from(salesReturns)
      .innerJoin(customers, eq(customers.id, salesReturns.customerId))
      .innerJoin(salesInvoices, eq(salesInvoices.id, salesReturns.siId))
      .where(and(eq(salesReturns.id, id), customerScopeFilter(scope)));
    if (!row) throw notFound("Sales return");
    const lines = await this.uow.db
      .select({ line: salesReturnRolls, roll: rolls })
      .from(salesReturnRolls)
      .innerJoin(rolls, eq(rolls.id, salesReturnRolls.rollId))
      .where(eq(salesReturnRolls.returnId, id))
      .orderBy(asc(rolls.barcode));
    const { minUsableLengthM } = await this.settings.value("inventory.allocation");
    const showCost = canSeeCost();
    return {
      ...(await this.toItem(this.uow.db, row.sr, row.customerName, row.siNo ?? "")),
      notes: row.sr.notes,
      rolls: lines.map(({ line, roll }) => ({
        rollId: roll.id,
        barcode: roll.barcode,
        lengthM: roll.currentLengthM,
        description: roll.description,
        dispatchedM: line.dispatchedM,
        returnedM: line.returnedM,
        taxable: D(line.taxable).toFixed(2),
        cost: showCost && line.cost !== null ? D(line.cost).toFixed(2) : null,
        rollStatus: roll.status,
        suggestScrap: line.returnedM < minUsableLengthM,
      })),
      totals: totalsOut(row.sr, row.regime),
    };
  }

  async create(dto: Input): Promise<SalesReturnDetail> {
    const id = await this.uow.run(async (tx) => {
      const si = await this.invoice(tx, dto.siId);
      const [sr] = await tx
        .insert(salesReturns)
        .values({
          companyId: actor().companyId,
          branchId: actor().branchId,
          customerId: si.customerId,
          siId: si.id,
          date: dto.date,
          reason: dto.reason,
          notes: dto.notes ?? null,
          createdBy: actor().userId,
          updatedBy: actor().userId,
        })
        .returning();
      await this.writeRolls(tx, sr!.id, si, dto.rolls);
      await recordTransition(tx, "SalesReturn", sr!.id, null, "Draft");
      this.changed(sr!.id);
      return sr!.id;
    });
    return this.get(id);
  }

  async update(id: string, dto: Input & { version: number }): Promise<SalesReturnDetail> {
    await this.uow.run(async (tx) => {
      const sr = await this.lock(tx, id);
      if (sr.status !== "Draft") throw validationError("A posted return can't be edited.");
      if (dto.siId !== sr.siId)
        throw validationError("A return stays on its invoice. Start a new return instead.");
      const si = await this.invoice(tx, sr.siId);
      await updateVersioned(
        tx,
        salesReturns,
        eq(salesReturns.id, id),
        dto.version,
        { date: dto.date, reason: dto.reason, notes: dto.notes ?? null },
        "Sales return",
      );
      await tx.delete(salesReturnRolls).where(eq(salesReturnRolls.returnId, id));
      await this.writeRolls(tx, id, si, dto.rolls);
      this.changed(id);
    });
    return this.get(id);
  }

  private async invoice(tx: Tx, siId: string) {
    const scope = await loadCustomerScope(tx);
    const [row] = await tx
      .select({ si: salesInvoices })
      .from(salesInvoices)
      .innerJoin(customers, eq(customers.id, salesInvoices.customerId))
      .where(and(eq(salesInvoices.id, siId), customerScopeFilter(scope)));
    if (!row) throw notFound("Sales invoice");
    if (row.si.status !== "Posted")
      throw validationError("Goods can only come back against a posted invoice.");
    return row.si;
  }

  /** Each roll's returned share of its billed value and of its COGS (PRD §8.4). */
  private async writeRolls(
    tx: Tx,
    returnId: string,
    si: typeof salesInvoices.$inferSelect,
    input: { rollId: string; returnedM: number }[],
  ) {
    const ids = input.map((r) => r.rollId);
    if (new Set(ids).size !== ids.length) throw validationError("A roll is listed twice.");
    const billed = await tx
      .select({ b: salesInvoiceRolls, line: salesInvoiceLines, roll: rolls })
      .from(salesInvoiceRolls)
      .innerJoin(salesInvoiceLines, eq(salesInvoiceLines.id, salesInvoiceRolls.siLineId))
      .innerJoin(rolls, eq(rolls.id, salesInvoiceRolls.rollId))
      .where(and(eq(salesInvoiceRolls.siId, si.id), inArray(salesInvoiceRolls.rollId, ids)));
    const issues: { path: string; message: string }[] = [];
    const rows = input.map((r, i) => {
      const hit = billed.find((x) => x.b.rollId === r.rollId);
      if (!hit) {
        issues.push({ path: `rolls.${i}.rollId`, message: "This roll isn't on the invoice" });
        return null;
      }
      if (hit.roll.status !== "Dispatched") {
        issues.push({
          path: `rolls.${i}.rollId`,
          message: `${hit.roll.barcode} is ${hit.roll.status}`,
        });
        return null;
      }
      if (r.returnedM > hit.b.lengthM) {
        issues.push({
          path: `rolls.${i}.returnedM`,
          message: `Only ${hit.b.lengthM} m was sent on this roll`,
        });
        return null;
      }
      // The roll's share of its line's taxable value, then the returned share of that.
      const rollTaxable = round(
        D(hit.line.taxable).times(hit.b.lengthM).dividedBy(hit.line.metres!),
        2,
      );
      const share = partialReturn(r.returnedM, hit.b.lengthM, {
        taxable: rollTaxable,
        cogs: hit.b.cogs ?? 0,
      });
      return {
        returnId,
        siRollId: hit.b.id,
        rollId: r.rollId,
        dispatchedM: hit.b.lengthM,
        returnedM: r.returnedM,
        taxable: share.taxable.toFixed(2),
        gstRate: hit.line.gstRate,
        cost: share.cost.toFixed(2),
        createdBy: actor().userId,
      };
    });
    if (issues.length) throw validationError("Some rolls can't be returned.", issues);
    // One open return per roll is enforced by sales_return_rolls_open_uq (port matrix 2.10).
    await tx.insert(salesReturnRolls).values(rows.map((r) => r!));
    const totals = invoiceTotals(
      rows.map((r) =>
        taxLine({
          quantity: 1,
          rate: r!.taxable,
          gstRate: si.supplyType === "SEZWOP" ? 0 : r!.gstRate,
        }),
      ),
      si.regime,
      await this.settings.value("invoice.roundOffTo"),
    );
    await tx
      .update(salesReturns)
      .set({
        gross: totals.taxable.toFixed(2),
        discount: "0.00",
        taxable: totals.taxable.toFixed(2),
        cgst: totals.cgst.toFixed(2),
        sgst: totals.sgst.toFixed(2),
        igst: totals.igst.toFixed(2),
        roundOff: totals.roundOff.toFixed(2),
        total: totals.total.toFixed(2),
        cost: sum(rows.map((r) => r!.cost)).toFixed(2),
      })
      .where(eq(salesReturns.id, returnId));
  }

  /** Post: rolls come back Returned at their measured length, and the credit note is issued. */
  async post(id: string, version: number): Promise<SalesReturnDetail> {
    await this.uow.run(async (tx) => {
      const sr = await this.lock(tx, id);
      salesReturnMachine.assert(sr.status, "Posted");
      const lines = await tx
        .select({ line: salesReturnRolls, roll: rolls, siLine: salesInvoiceLines })
        .from(salesReturnRolls)
        .innerJoin(rolls, eq(rolls.id, salesReturnRolls.rollId))
        .innerJoin(salesInvoiceRolls, eq(salesInvoiceRolls.id, salesReturnRolls.siRollId))
        .innerJoin(salesInvoiceLines, eq(salesInvoiceLines.id, salesInvoiceRolls.siLineId))
        .where(eq(salesReturnRolls.returnId, id))
        .for("update", { of: rolls });
      if (!lines.length) throw validationError("Add at least one roll before posting.");
      const srNo = await this.series.allocate(tx, "SR", sr.date);
      for (const { line, roll } of lines) {
        rollMachine.assert(roll.status, "Returned");
        await tx
          .update(rolls)
          .set({
            status: "Returned",
            currentLengthM: line.returnedM,
            labelReprintDue: line.returnedM !== roll.currentLengthM,
            ...touch(),
          })
          .where(eq(rolls.id, roll.id));
        if (line.returnedM !== roll.currentLengthM) {
          await tx.insert(rollLengthChanges).values({
            rollId: roll.id,
            kind: "RETURN",
            fromM: roll.currentLengthM,
            toM: line.returnedM,
            reason: `Returned on ${srNo}`,
            refType: "sales_return",
            refId: id,
            createdBy: actor().userId,
          });
        }
      }
      await recordTransition(
        tx,
        "Roll",
        lines.map((l) => l.roll.id),
        "Dispatched",
        "Returned",
        `${srNo}: ${sr.reason}`,
      );
      await updateVersioned(
        tx,
        salesReturns,
        eq(salesReturns.id, id),
        version,
        { status: "Posted", srNo, postedAt: new Date(), postedBy: actor().userId },
        "Sales return",
      );
      await recordTransition(tx, "SalesReturn", id, "Draft", "Posted");

      // One credit-note line per invoice line returned against.
      const bySiLine = new Map<
        string,
        { description: string; hsnCode: string; gstRate: string; taxable: ReturnType<typeof D> }
      >();
      for (const { line, siLine } of lines) {
        const prev = bySiLine.get(siLine.id);
        bySiLine.set(siLine.id, {
          description: siLine.description,
          hsnCode: siLine.hsnCode,
          gstRate: siLine.gstRate,
          taxable: (prev?.taxable ?? D(0)).plus(D(line.taxable)),
        });
      }
      const cn = await this.notes.issue(
        tx,
        {
          customerId: sr.customerId,
          siId: sr.siId,
          salesReturnId: id,
          date: sr.date,
          reason: `Return ${srNo}: ${sr.reason}`,
        },
        [...bySiLine.values()].map((v) => ({
          description: `${v.description} (returned)`,
          hsnCode: v.hsnCode,
          gstRate: v.gstRate,
          taxable: v.taxable.toFixed(2),
        })),
      );
      await writePostingEvent(tx, {
        type: "SALES_RETURN_POSTED",
        docType: "SR",
        docId: id,
        docNo: srNo,
        docDate: sr.date,
        partyType: "CUSTOMER",
        partyId: sr.customerId,
        payload: {
          srNo,
          cnId: cn.id,
          cnNo: cn.noteNo,
          siId: sr.siId,
          reason: sr.reason,
          // Inventory back at the returned share of COGS (PRD §8.4); revenue reversal is on the CN.
          rolls: lines.map(({ line, roll }) => ({
            rollId: roll.id,
            barcode: roll.barcode,
            dispatchedM: line.dispatchedM,
            returnedM: line.returnedM,
            taxable: line.taxable,
            cost: line.cost,
          })),
          cost: sr.cost,
        },
      });
      this.changed(id);
      this.bus.publishAfterCommit("inventory.changed", { returnId: id });
    });
    return this.get(id);
  }

  /** Inspection (ADR-0015): back to stock — optionally as another product — or scrap. */
  async inspect(id: string, input: z.infer<typeof returnInspection>): Promise<SalesReturnDetail> {
    await this.uow.run(async (tx) => {
      const sr = await this.lock(tx, id);
      if (sr.status !== "Posted")
        throw validationError("Post the return before inspecting its rolls.");
      const [row] = await tx
        .select({ line: salesReturnRolls, roll: rolls })
        .from(salesReturnRolls)
        .innerJoin(rolls, eq(rolls.id, salesReturnRolls.rollId))
        .where(
          and(
            eq(salesReturnRolls.returnId, id),
            eq(salesReturnRolls.rollId, input.rollId),
            isNull(salesReturnRolls.inspectedAt),
          ),
        )
        .for("update", { of: rolls });
      if (!row) throw notFound("Roll waiting for inspection on this return");
      const { roll, line } = row;
      const to = input.outcome === "RESTOCK" ? "Mapped" : "Scrap";
      rollMachine.assert(roll.status, to);
      let skuId = roll.skuId;
      if (input.outcome === "RESTOCK" && input.skuId && input.skuId !== roll.skuId) {
        const sku = (await loadSkus(tx, [input.skuId])).get(input.skuId)!;
        if (sku.gsm !== roll.gsm || Number(sku.widthIn) !== Number(roll.widthIn)) {
          throw validationError(
            `${sku.description} doesn't match this roll (${roll.gsm} GSM · ${Number(roll.widthIn)}″).`,
          );
        }
        skuId = sku.skuId;
      }
      await tx
        .update(rolls)
        .set({
          status: to,
          skuId,
          ...(to === "Mapped" ? { mappedAt: new Date() } : {}),
          ...touch(),
        })
        .where(eq(rolls.id, roll.id));
      await recordTransition(tx, "Roll", roll.id, roll.status, to, `Inspected on ${sr.srNo}`);
      if (to === "Scrap") {
        await writePostingEvent(tx, {
          type: "ROLL_SCRAPPED",
          docType: "ROLL",
          docId: roll.id,
          docNo: roll.barcode,
          docDate: new Date().toISOString().slice(0, 10),
          payload: {
            reason: `Returned on ${sr.srNo}, failed inspection`,
            // At the partial cost it came back at (UAT §11.4).
            rolls: [
              {
                rollId: roll.id,
                barcode: roll.barcode,
                skuId: roll.skuId,
                lengthM: line.returnedM,
                value: line.cost,
              },
            ],
            total: line.cost,
          },
        });
      }
      await tx
        .update(salesReturnRolls)
        .set({
          outcome: input.outcome,
          inspectedAt: new Date(),
          inspectedBy: actor().userId,
          closedAt: new Date(),
        })
        .where(eq(salesReturnRolls.id, line.id));
      this.changed(id);
      this.bus.publishAfterCommit("inventory.changed", { rollId: roll.id });
    });
    return this.get(id);
  }

  async cancel(id: string, version: number): Promise<SalesReturnDetail> {
    await this.uow.run(async (tx) => {
      const sr = await this.lock(tx, id);
      salesReturnMachine.assert(sr.status, "Cancelled");
      await tx
        .update(salesReturnRolls)
        .set({ closedAt: new Date() })
        .where(eq(salesReturnRolls.returnId, id));
      await updateVersioned(
        tx,
        salesReturns,
        eq(salesReturns.id, id),
        version,
        { status: "Cancelled" },
        "Sales return",
      );
      await recordTransition(tx, "SalesReturn", id, sr.status, "Cancelled");
      this.changed(id);
    });
    return this.get(id);
  }

  private async lock(tx: Tx, id: string) {
    const scope = await loadCustomerScope(tx);
    const [row] = await tx
      .select({ sr: salesReturns })
      .from(salesReturns)
      .innerJoin(customers, eq(customers.id, salesReturns.customerId))
      .where(and(eq(salesReturns.id, id), customerScopeFilter(scope)))
      .for("update", { of: salesReturns });
    if (!row) throw notFound("Sales return");
    return row.sr;
  }

  private changed(id: string) {
    this.bus.publishAfterCommit("sales.changed", { doc: "SR", id });
  }
}
