import type { SiDetail, SiListItem, salesListQuery, siCreate, siUpdate } from "@erp/contracts";
import {
  type Tx,
  customers,
  deliveryChallanRolls,
  deliveryChallans,
  proformaLines,
  proformas,
  rolls,
  salesInvoiceDcs,
  salesInvoiceLines,
  salesInvoiceRolls,
  salesInvoices,
  salesOrderLines,
  salesOrders,
  transporters,
} from "@erp/db";
import {
  D,
  type GstRegime,
  deliveryChallanMachine,
  istToday,
  lineTaxes,
  proformaMachine,
  rollCogs,
  rollMachine,
  salesInvoiceMachine,
  salesOrderMachine,
  sum,
} from "@erp/domain";
import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, gte, ilike, inArray, lte, ne, or, sql } from "drizzle-orm";
import type { z } from "zod";
import { actor, ctx } from "../../common/context.js";
import { addDays } from "../../common/dates.js";
import { trimDecimal } from "../../common/decimal.js";
import { AppError, notFound, reasonRequired, validationError } from "../../common/errors.js";
import { recordTransition, writePostingEvent } from "../../db/ledger.js";
import { UnitOfWork } from "../../db/unit-of-work.js";
import { updateVersioned } from "../../db/versioning.js";
import { customerScopeFilter, loadCustomerScope } from "../customers/customer-scope.js";
import { canSeeCost } from "../inventory/rolls.service.js";
import { EInvoiceQueue } from "../compliance/einvoice.queue.js";
import { EInvoiceService } from "../compliance/einvoice.service.js";
import { CommissionService } from "../collections/commission.service.js";
import { CreditRecheckQueue } from "./credit-recheck.queue.js";
import { EventBus } from "../realtime/event-bus.js";
import { SeriesService } from "../series/series.service.js";
import { SettingsService } from "../settings/settings.service.js";
import {
  type DocCharge,
  customerContext,
  daysBetween,
  documentTotals,
  loadSkus,
  resolveCharges,
  taxIssues,
  totalsColumns,
  totalsOut,
} from "./sales-common.js";

type CreateInput = z.infer<typeof siCreate>;
type UpdateInput = z.infer<typeof siUpdate>;

/** A goods line being drafted: one per SO line (or proforma line), with its rolls. */
interface GoodsDraft {
  soLineId: string | null;
  proformaLineId: string | null;
  skuId: string;
  description: string;
  hsnCode: string | null;
  gstRate: string | null;
  widthIn: string;
  ratePerM: string;
  discountPct: string;
  rolls: { rollId: string; lengthM: number }[];
}

const touchRolls = () => ({
  updatedAt: new Date(),
  updatedBy: actor().userId,
  version: sql`${rolls.version} + 1`,
});
const metresOf = (g: GoodsDraft) => g.rolls.reduce((s, r) => s + r.lengthM, 0);

/**
 * Sales invoices (PRD §6.5, §8.2, §8.4; ADR-0011; Q22/Q29). A draft comes from posted challans of
 * one customer, from a direct sale (rolls scanned on the invoice and held), or from a proforma.
 * Posting numbers it (SI/2627/00001), fixes each roll's COGS, moves challans / orders / proformas
 * on and writes SI_POSTED. B2B and SEZ invoices then wait for their IRN (step 5).
 */
@Injectable()
export class SalesInvoicesService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly bus: EventBus,
    private readonly series: SeriesService,
    private readonly settings: SettingsService,
    private readonly einvoice: EInvoiceService,
    private readonly irnQueue: EInvoiceQueue,
    private readonly creditRecheck: CreditRecheckQueue,
    private readonly commission: CommissionService,
  ) {}

  // ── read ───────────────────────────────────────────────────────────────────

  async list(query: z.infer<typeof salesListQuery>): Promise<SiListItem[]> {
    const scope = await loadCustomerScope(this.uow.db);
    const where = [customerScopeFilter(scope)];
    if (query.status) where.push(eq(salesInvoices.status, query.status as "Draft"));
    if (query.customerId) where.push(eq(salesInvoices.customerId, query.customerId));
    if (query.from) where.push(gte(salesInvoices.date, query.from));
    if (query.to) where.push(lte(salesInvoices.date, query.to));
    if (query.q) {
      const q = `%${query.q}%`;
      where.push(or(ilike(salesInvoices.siNo, q), ilike(customers.legalName, q))!);
    }
    const rows = await this.uow.db
      .select({ si: salesInvoices })
      .from(salesInvoices)
      .innerJoin(customers, eq(customers.id, salesInvoices.customerId))
      .where(and(...where))
      .orderBy(desc(salesInvoices.date), desc(salesInvoices.createdAt))
      .limit(500);
    return rows.map((r) => toListItem(r.si));
  }

  async get(id: string, db: UnitOfWork["db"] | Tx = this.uow.db): Promise<SiDetail> {
    const scope = await loadCustomerScope(db);
    const [row] = await db
      .select({ si: salesInvoices, transporterName: transporters.name })
      .from(salesInvoices)
      .innerJoin(customers, eq(customers.id, salesInvoices.customerId))
      .leftJoin(transporters, eq(transporters.id, salesInvoices.transporterId))
      .where(and(eq(salesInvoices.id, id), customerScopeFilter(scope)));
    if (!row) throw notFound("Sales invoice");
    const si = row.si;
    const lines = await db
      .select()
      .from(salesInvoiceLines)
      .where(eq(salesInvoiceLines.siId, id))
      .orderBy(asc(salesInvoiceLines.lineNo));
    const billed = await db
      .select({ r: salesInvoiceRolls, barcode: rolls.barcode })
      .from(salesInvoiceRolls)
      .innerJoin(rolls, eq(rolls.id, salesInvoiceRolls.rollId))
      .where(eq(salesInvoiceRolls.siId, id))
      .orderBy(asc(rolls.barcode));
    const dcs = await db
      .select({ id: deliveryChallans.id, dcNo: deliveryChallans.dcNo, soId: deliveryChallans.soId })
      .from(salesInvoiceDcs)
      .innerJoin(deliveryChallans, eq(deliveryChallans.id, salesInvoiceDcs.dcId))
      .where(eq(salesInvoiceDcs.siId, id));
    const soIds = await db
      .selectDistinct({ soId: salesOrderLines.soId })
      .from(salesInvoiceLines)
      .innerJoin(salesOrderLines, eq(salesOrderLines.id, salesInvoiceLines.soLineId))
      .where(eq(salesInvoiceLines.siId, id));
    const showCost = canSeeCost();
    const window = await this.settings.value("einvoice.config");
    return {
      ...toListItem(si),
      source: si.source,
      dcs: dcs.map(({ id: dcId, dcNo }) => ({ id: dcId, dcNo })),
      soIds: soIds.map((s) => s.soId),
      proformaId: si.proformaId,
      placeOfSupply: si.placeOfSupply,
      billingAddress: si.billingAddress,
      shippingAddress: si.shippingAddress,
      customerGstin: si.customerGstin,
      supplyType: si.supplyType,
      billDiscount: D(si.billDiscount).toFixed(2),
      notes: si.notes,
      lines: lines.map((l) => ({
        id: l.id,
        kind: l.kind,
        soLineId: l.soLineId,
        description: l.description,
        hsnCode: l.hsnCode,
        widthIn: trimDecimal(l.widthIn),
        metres: l.metres,
        ratePerM: trimDecimal(l.ratePerM),
        discountPct: trimDecimal(l.discountPct),
        gross: D(l.gross).toFixed(2),
        discount: D(l.discount).plus(D(l.billDiscount)).toFixed(2),
        taxable: D(l.taxable).toFixed(2),
        gstRate: trimDecimal(l.gstRate),
        cgst: D(l.cgst).toFixed(2),
        sgst: D(l.sgst).toFixed(2),
        igst: D(l.igst).toFixed(2),
        cogs: showCost && l.cogs !== null ? D(l.cogs).toFixed(2) : null,
        rolls: billed
          .filter((b) => b.r.siLineId === l.id)
          .map((b) => ({ rollId: b.r.rollId, barcode: b.barcode, lengthM: b.r.lengthM })),
      })),
      totals: totalsOut(si, si.regime),
      cogs: showCost && si.cogs !== null ? D(si.cogs).toFixed(2) : null,
      einvoice: {
        status: si.einvoiceStatus,
        irn: si.irn,
        ackNo: si.ackNo,
        ackDate: si.ackDate?.toISOString() ?? null,
        signedQr: si.signedQr,
        attempts: si.irnAttempts,
        lastError: si.irnLastError,
        cancellableUntil:
          si.status === "Posted" && si.postedAt
            ? new Date(si.postedAt.getTime() + window.cancelWindowHours * 3_600_000).toISOString()
            : null,
      },
      transport: {
        transporterId: si.transporterId,
        transporterName: row.transporterName,
        vehicleNo: si.vehicleNo,
        lrNo: si.lrNo,
        lrDate: si.lrDate,
        distanceKm: si.distanceKm,
        ewayBillNo: si.ewayBillNo,
        ewayBillDate: si.ewayBillDate,
      },
      blockers: si.status === "Draft" ? await this.blockers(si, lines) : [],
    };
  }

  /** What stops a draft from posting, in plain words. */
  private async blockers(
    si: typeof salesInvoices.$inferSelect,
    lines: (typeof salesInvoiceLines.$inferSelect)[],
  ): Promise<string[]> {
    const out: string[] = [];
    const goods = lines.filter((l) => l.kind === "GOODS");
    const skus = await loadSkus(
      this.uow.db,
      goods.map((l) => l.skuId!),
    );
    out.push(
      ...taxIssues(
        goods.map((l) => ({ description: l.description, ...pickTax(l, skus.get(l.skuId!)) })),
      ),
    );
    const today = istToday();
    const { reportingWindowDays } = await this.settings.value("einvoice.config");
    if (si.date > today) out.push("The invoice date is in the future.");
    if (si.supplyType !== "B2C" && daysBetween(si.date, today) > reportingWindowDays) {
      out.push(
        `The e-invoice portal only accepts invoices up to ${reportingWindowDays} days old. Change the date.`,
      );
    }
    if (!goods.length) out.push("The invoice has no goods.");
    return out;
  }

  // ── create ─────────────────────────────────────────────────────────────────

  async create(dto: CreateInput): Promise<SiDetail> {
    const id = await this.uow.run(async (tx) => {
      if (dto.source === "DC") return this.fromChallans(tx, dto.dcIds!, dto.date);
      if (dto.source === "DIRECT") return this.direct(tx, dto.soId!, dto.date, dto.rolls!);
      return this.fromProforma(tx, dto.proformaId!, dto.date, dto.rolls!);
    });
    return this.get(id);
  }

  /** Q29: several dispatched challans of one customer on one invoice. */
  private async fromChallans(tx: Tx, dcIds: string[], date: string) {
    const ids = [...new Set(dcIds)];
    const dcs = await tx
      .select()
      .from(deliveryChallans)
      .where(
        and(inArray(deliveryChallans.id, ids), eq(deliveryChallans.companyId, actor().companyId)),
      )
      .orderBy(asc(deliveryChallans.date))
      .for("update");
    if (dcs.length !== ids.length) throw notFound("Delivery challan");
    const notOpen = dcs.find((d) => d.status !== "Open");
    if (notOpen) {
      throw validationError(
        notOpen.status === "Draft"
          ? `${notOpen.dcNo} hasn't been dispatched yet.`
          : `${notOpen.dcNo} is ${notOpen.status === "Closed" ? "already invoiced" : notOpen.status.toLowerCase()}.`,
      );
    }
    if (new Set(dcs.map((d) => d.customerId)).size > 1) {
      throw validationError("All challans on one invoice must be for the same customer.");
    }
    const [taken] = await tx
      .select({ dcNo: deliveryChallans.dcNo, siNo: salesInvoices.siNo })
      .from(salesInvoiceDcs)
      .innerJoin(salesInvoices, eq(salesInvoices.id, salesInvoiceDcs.siId))
      .innerJoin(deliveryChallans, eq(deliveryChallans.id, salesInvoiceDcs.dcId))
      .where(and(inArray(salesInvoiceDcs.dcId, ids), ne(salesInvoices.status, "Cancelled")));
    if (taken)
      throw validationError(`${taken.dcNo} is already on invoice ${taken.siNo ?? "(draft)"}.`);

    const picks = await tx
      .select({ pick: deliveryChallanRolls, line: salesOrderLines })
      .from(deliveryChallanRolls)
      .innerJoin(salesOrderLines, eq(salesOrderLines.id, deliveryChallanRolls.soLineId))
      .where(inArray(deliveryChallanRolls.dcId, ids))
      .orderBy(asc(salesOrderLines.lineNo), asc(deliveryChallanRolls.createdAt));
    const goods = new Map<string, GoodsDraft>();
    for (const { pick, line } of picks) {
      const g = goods.get(line.id) ?? soGoods(line);
      g.rolls.push({ rollId: pick.rollId, lengthM: pick.lengthM });
      goods.set(line.id, g);
    }
    const first = dcs[0]!;
    const [so] = await tx.select().from(salesOrders).where(eq(salesOrders.id, first.soId));
    const { charges, billDiscount } = await this.orderExtras(tx, so!);
    const siId = await this.insertHeader(tx, {
      customerId: first.customerId,
      shippingAddressId: so!.shippingAddressId,
      date,
      source: "DC",
      proformaId: null,
      transport: first,
      billDiscount,
    });
    await tx.insert(salesInvoiceDcs).values(ids.map((dcId) => ({ siId, dcId })));
    await this.writeDraft(tx, siId, [...goods.values()], charges, billDiscount);
    return siId;
  }

  /** An order's extra charges and bill discount go on its first invoice only. */
  private async orderExtras(tx: Tx, so: typeof salesOrders.$inferSelect) {
    const [billed] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(salesInvoiceLines)
      .innerJoin(salesInvoices, eq(salesInvoices.id, salesInvoiceLines.siId))
      .innerJoin(salesOrderLines, eq(salesOrderLines.id, salesInvoiceLines.soLineId))
      .where(and(eq(salesOrderLines.soId, so.id), ne(salesInvoices.status, "Cancelled")));
    return billed!.n > 0
      ? { charges: [] as DocCharge[], billDiscount: "0" }
      : { charges: so.charges, billDiscount: so.billDiscount };
  }

  /** Q22 counter sale: rolls are scanned on the invoice and held (Allocated) until it posts. */
  private async direct(
    tx: Tx,
    soId: string,
    date: string,
    picks: { lineId: string; rollId: string }[],
  ) {
    const [so] = await tx
      .select()
      .from(salesOrders)
      .where(and(eq(salesOrders.id, soId), eq(salesOrders.companyId, actor().companyId)))
      .for("update");
    if (!so) throw notFound("Sales order");
    if (so.status !== "Confirmed" && so.status !== "PartiallyFulfilled") {
      throw validationError(
        so.status === "OnHold"
          ? "This order is on hold for credit."
          : `A ${so.status} order can't be invoiced.`,
      );
    }
    const lines = await tx.select().from(salesOrderLines).where(eq(salesOrderLines.soId, soId));
    const byLine = new Map(lines.map((l) => [l.id, l]));
    const held = await this.holdRolls(tx, picks, (lineId) => byLine.get(lineId)?.skuId ?? null);
    const goods = new Map<string, GoodsDraft>();
    for (const { lineId, roll } of held) {
      const line = byLine.get(lineId)!;
      const g = goods.get(lineId) ?? soGoods(line);
      g.rolls.push({ rollId: roll.id, lengthM: roll.currentLengthM });
      goods.set(lineId, g);
    }
    const { charges, billDiscount } = await this.orderExtras(tx, so);
    const siId = await this.insertHeader(tx, {
      customerId: so.customerId,
      shippingAddressId: so.shippingAddressId,
      date,
      source: "DIRECT",
      proformaId: null,
      transport: null,
      billDiscount,
    });
    await this.writeDraft(tx, siId, [...goods.values()], charges, billDiscount);
    return siId;
  }

  private async fromProforma(
    tx: Tx,
    proformaId: string,
    date: string,
    picks: { lineId: string; rollId: string }[],
  ) {
    const [pf] = await tx
      .select()
      .from(proformas)
      .where(and(eq(proformas.id, proformaId), eq(proformas.companyId, actor().companyId)))
      .for("update");
    if (!pf) throw notFound("Proforma");
    if (pf.status !== "Draft" && pf.status !== "Sent")
      throw validationError(`A ${pf.status} proforma can't be invoiced.`);
    const [open] = await tx
      .select({ id: salesInvoices.id })
      .from(salesInvoices)
      .where(and(eq(salesInvoices.proformaId, proformaId), ne(salesInvoices.status, "Cancelled")));
    if (open) throw validationError("This proforma already has an invoice.");
    const lines = await tx
      .select()
      .from(proformaLines)
      .where(eq(proformaLines.proformaId, proformaId));
    const byLine = new Map(lines.map((l) => [l.id, l]));
    const held = await this.holdRolls(tx, picks, (lineId) => byLine.get(lineId)?.skuId ?? null);
    const goods = new Map<string, GoodsDraft>();
    for (const { lineId, roll } of held) {
      const l = byLine.get(lineId)!;
      const g =
        goods.get(lineId) ??
        ({
          soLineId: null,
          proformaLineId: l.id,
          skuId: l.skuId,
          description: l.description,
          hsnCode: l.hsnCode,
          gstRate: l.gstRate,
          widthIn: l.widthIn,
          ratePerM: l.ratePerM,
          discountPct: l.discountPct,
          rolls: [],
        } satisfies GoodsDraft);
      g.rolls.push({ rollId: roll.id, lengthM: roll.currentLengthM });
      goods.set(lineId, g);
    }
    const siId = await this.insertHeader(tx, {
      customerId: pf.customerId,
      shippingAddressId: null,
      date,
      source: "PROFORMA",
      proformaId,
      transport: null,
      billDiscount: pf.billDiscount,
    });
    await this.writeDraft(tx, siId, [...goods.values()], pf.charges, pf.billDiscount);
    return siId;
  }

  /** Locks and holds Mapped rolls of each line's product (FOR UPDATE SKIP LOCKED). */
  private async holdRolls(
    tx: Tx,
    picks: { lineId: string; rollId: string }[],
    skuOf: (lineId: string) => string | null,
  ) {
    const ids = [...new Set(picks.map((p) => p.rollId))];
    if (ids.length !== picks.length) throw validationError("A roll is listed twice.");
    const found = await tx
      .select()
      .from(rolls)
      .where(and(inArray(rolls.id, ids), eq(rolls.companyId, actor().companyId)))
      .for("update", { skipLocked: true });
    if (found.length !== ids.length) {
      throw new AppError(
        409,
        "ROLL_UNAVAILABLE",
        "Some rolls are being used by someone else right now.",
      );
    }
    const byId = new Map(found.map((r) => [r.id, r]));
    const out = picks.map((p) => {
      const roll = byId.get(p.rollId)!;
      const skuId = skuOf(p.lineId);
      if (!skuId) throw notFound("Line");
      if (roll.status !== "Mapped") {
        throw new AppError(
          409,
          "ROLL_UNAVAILABLE",
          `${roll.barcode} is ${roll.status} and can't be sold.`,
        );
      }
      if (roll.skuId !== skuId)
        throw validationError(`${roll.barcode} is ${roll.description}, not this line's product.`);
      return { lineId: p.lineId, roll };
    });
    rollMachine.assert("Mapped", "Allocated");
    await tx
      .update(rolls)
      .set({ status: "Allocated", ...touchRolls() })
      .where(inArray(rolls.id, ids));
    await recordTransition(tx, "Roll", ids, "Mapped", "Allocated", "Held on a direct invoice");
    return out;
  }

  private async insertHeader(
    tx: Tx,
    h: {
      customerId: string;
      shippingAddressId: string | null;
      date: string;
      source: "DC" | "DIRECT" | "PROFORMA";
      proformaId: string | null;
      transport: typeof deliveryChallans.$inferSelect | null;
      billDiscount: string;
    },
  ) {
    const c = await customerContext(tx, h.customerId, h.shippingAddressId);
    const creditDays =
      c.policy?.creditDays ?? (await this.settings.value("credit.defaults")).creditDays;
    const t = h.transport;
    const [si] = await tx
      .insert(salesInvoices)
      .values({
        companyId: actor().companyId,
        branchId: actor().branchId,
        customerId: h.customerId,
        date: h.date,
        dueDate: addDays(h.date, creditDays),
        source: h.source,
        proformaId: h.proformaId,
        regime: c.regime,
        placeOfSupply: c.placeOfSupply,
        supplyType: c.supplyType,
        customerName: c.customerName,
        customerGstin: c.customer.gstin,
        billingAddress: c.billingAddress,
        shippingAddress: c.shippingAddress,
        billDiscount: D(h.billDiscount).toFixed(2),
        transporterId: t?.transporterId ?? null,
        vehicleNo: t?.vehicleNo ?? null,
        lrNo: t?.lrNo ?? null,
        lrDate: t?.lrDate ?? null,
        distanceKm: t?.distanceKm ?? null,
        ewayBillNo: t?.ewayBillNo ?? null,
        ewayBillDate: t?.ewayBillDate ?? null,
        createdBy: actor().userId,
        updatedBy: actor().userId,
      })
      .returning();
    await recordTransition(tx, "SalesInvoice", si!.id, null, "Draft");
    this.changed(si!.id);
    return si!.id;
  }

  /** (Re)writes a draft's lines, rolls and totals from goods + charges + bill discount. */
  private async writeDraft(
    tx: Tx,
    siId: string,
    goods: GoodsDraft[],
    charges: DocCharge[],
    billDiscount: string,
  ) {
    const [si] = await tx.select().from(salesInvoices).where(eq(salesInvoices.id, siId));
    const skus = await loadSkus(
      tx,
      goods.map((g) => g.skuId),
    );
    // HSN / GST come from the catalogue now if the order was taken before they were set.
    for (const g of goods) Object.assign(g, pickTax(g, skus.get(g.skuId)));
    const configured = await this.settings.value("invoice.extraCharges");
    const result = documentTotals(
      goods.map((g) => ({
        metres: metresOf(g),
        ratePerM: g.ratePerM,
        discountPct: g.discountPct,
        gstRate: g.gstRate,
      })),
      charges,
      {
        regime: si!.regime,
        billDiscount,
        zeroRated: si!.supplyType === "SEZWOP",
        roundOffTo: await this.settings.value("invoice.roundOffTo"),
      },
    );
    await tx.delete(salesInvoiceLines).where(eq(salesInvoiceLines.siId, siId));
    if (result) {
      const taxes = lineTaxes(result.lines, result.totals);
      // Charges are part of the same supply: the main goods' HSN unless Settings gives one (Q21).
      const mainHsn = goods[0]?.hsnCode ?? "";
      const rows = result.lines.map((l, i) => {
        const g = goods[i];
        const c = g ? null : charges[i - goods.length]!;
        return {
          siId,
          lineNo: i + 1,
          kind: l.kind,
          soLineId: g?.soLineId ?? null,
          proformaLineId: g?.proformaLineId ?? null,
          skuId: g?.skuId ?? null,
          chargeCode: c?.code ?? null,
          description: g?.description ?? c!.label,
          hsnCode: g?.hsnCode ?? configured.find((x) => x.code === c!.code)?.hsnCode ?? mainHsn,
          widthIn: g?.widthIn ?? null,
          metres: g ? metresOf(g) : null,
          ratePerM: g?.ratePerM ?? null,
          discountPct: g?.discountPct ?? "0",
          gross: l.gross.toFixed(2),
          discount: l.discount.toFixed(2),
          billDiscount: l.billDiscount.toFixed(2),
          taxable: l.taxable.toFixed(2),
          gstRate: l.gstRate.toString(),
          cgst: taxes[i]!.cgst.toFixed(2),
          sgst: taxes[i]!.sgst.toFixed(2),
          igst: taxes[i]!.igst.toFixed(2),
          createdBy: actor().userId,
        };
      });
      const inserted = await tx
        .insert(salesInvoiceLines)
        .values(rows)
        .returning({ id: salesInvoiceLines.id, lineNo: salesInvoiceLines.lineNo });
      const rollRows = goods.flatMap((g, i) =>
        g.rolls.map((r) => ({
          siId,
          siLineId: inserted.find((x) => x.lineNo === i + 1)!.id,
          rollId: r.rollId,
          lengthM: r.lengthM,
          createdBy: actor().userId,
        })),
      );
      if (rollRows.length) await tx.insert(salesInvoiceRolls).values(rollRows);
    }
    await tx
      .update(salesInvoices)
      .set({ billDiscount: D(billDiscount).toFixed(2), ...totalsColumns(result) })
      .where(eq(salesInvoices.id, siId));
  }

  // ── edit / post / cancel ───────────────────────────────────────────────────

  async update(id: string, dto: UpdateInput): Promise<SiDetail> {
    await this.uow.run(async (tx) => {
      const si = await this.lock(tx, id);
      if (si.status !== "Draft")
        throw validationError("A posted invoice can't be edited. Issue a credit or debit note.");
      const goods = await this.loadGoods(tx, id);
      for (const d of dto.lineDiscounts) {
        const line = goods.find((g) => g.lineId === d.lineId);
        if (!line) throw notFound("Invoice line");
        line.goods.discountPct = d.discountPct;
      }
      const creditDays =
        (await customerContext(tx, si.customerId)).policy?.creditDays ??
        (await this.settings.value("credit.defaults")).creditDays;
      await updateVersioned(
        tx,
        salesInvoices,
        eq(salesInvoices.id, id),
        dto.version,
        { date: dto.date, dueDate: addDays(dto.date, creditDays), notes: dto.notes ?? null },
        "Sales invoice",
      );
      const charges = resolveCharges(
        dto.charges,
        await this.settings.value("invoice.extraCharges"),
      );
      await this.writeDraft(
        tx,
        id,
        goods.map((g) => g.goods),
        charges,
        dto.billDiscount,
      );
      this.changed(id);
    });
    return this.get(id);
  }

  private async loadGoods(tx: Tx, siId: string) {
    const lines = await tx
      .select()
      .from(salesInvoiceLines)
      .where(and(eq(salesInvoiceLines.siId, siId), eq(salesInvoiceLines.kind, "GOODS")))
      .orderBy(asc(salesInvoiceLines.lineNo));
    const billed = await tx
      .select()
      .from(salesInvoiceRolls)
      .where(eq(salesInvoiceRolls.siId, siId));
    return lines.map((l) => ({
      lineId: l.id,
      goods: {
        soLineId: l.soLineId,
        proformaLineId: l.proformaLineId,
        skuId: l.skuId!,
        description: l.description,
        hsnCode: l.hsnCode,
        gstRate: l.gstRate,
        widthIn: l.widthIn!,
        ratePerM: l.ratePerM!,
        discountPct: l.discountPct,
        rolls: billed
          .filter((b) => b.siLineId === l.id)
          .map((b) => ({ rollId: b.rollId, lengthM: b.lengthM })),
      } satisfies GoodsDraft,
    }));
  }

  async post(id: string, version: number): Promise<SiDetail> {
    await this.uow.run(async (tx) => {
      const si = await this.lock(tx, id);
      salesInvoiceMachine.assert(si.status, "Posted");
      const lines = await tx
        .select()
        .from(salesInvoiceLines)
        .where(eq(salesInvoiceLines.siId, id))
        .orderBy(asc(salesInvoiceLines.lineNo));
      const blockers = await this.blockers(si, lines);
      if (blockers.length) {
        throw validationError(
          "This invoice can't be posted yet.",
          blockers.map((message) => ({ path: "invoice", message })),
        );
      }
      const billed = await tx
        .select({ b: salesInvoiceRolls, roll: rolls })
        .from(salesInvoiceRolls)
        .innerJoin(rolls, eq(rolls.id, salesInvoiceRolls.rollId))
        .where(eq(salesInvoiceRolls.siId, id))
        .for("update", { of: rolls });
      const expected = si.source === "DC" ? "Dispatched" : "Allocated";
      const off = billed.find((x) => x.roll.status !== expected);
      if (off)
        throw new AppError(
          409,
          "ROLL_UNAVAILABLE",
          `${off.roll.barcode} is ${off.roll.status}; the invoice needs recreating.`,
        );

      // COGS per roll at its landed cost (PRD §8.4; port matrix 2.11).
      const cogsByRoll = new Map<string, string>();
      for (const { b, roll } of billed) {
        const perM = roll.costPerM ?? roll.baseCostPerM ?? "0";
        const cogs = rollCogs(b.lengthM, perM).toFixed(2);
        cogsByRoll.set(b.id, cogs);
        await tx
          .update(salesInvoiceRolls)
          .set({ costPerM: perM, cogs })
          .where(eq(salesInvoiceRolls.id, b.id));
      }
      for (const l of lines.filter((x) => x.kind === "GOODS")) {
        const lineCogs = sum(
          billed.filter((x) => x.b.siLineId === l.id).map((x) => cogsByRoll.get(x.b.id)!),
        );
        await tx
          .update(salesInvoiceLines)
          .set({ cogs: lineCogs.toFixed(2) })
          .where(eq(salesInvoiceLines.id, l.id));
      }
      const totalCogs = sum([...cogsByRoll.values()]);

      // Direct / proforma sales dispatch their held rolls now.
      if (si.source !== "DC" && billed.length) {
        const ids = billed.map((x) => x.roll.id);
        await tx
          .update(rolls)
          .set({ status: "Dispatched", ...touchRolls() })
          .where(inArray(rolls.id, ids));
        await recordTransition(
          tx,
          "Roll",
          ids,
          "Allocated",
          "Dispatched",
          "Sold on a direct invoice",
        );
      }
      // Order lines: invoiced metres (and dispatched metres for direct sales).
      const metresByLine = new Map<string, number>();
      for (const l of lines)
        if (l.soLineId && l.metres)
          metresByLine.set(l.soLineId, (metresByLine.get(l.soLineId) ?? 0) + l.metres);
      for (const [lineId, m] of metresByLine) {
        await tx
          .update(salesOrderLines)
          .set({
            invoicedM: sql`${salesOrderLines.invoicedM} + ${m}`,
            ...(si.source === "DIRECT"
              ? { dispatchedM: sql`${salesOrderLines.dispatchedM} + ${m}` }
              : {}),
          })
          .where(eq(salesOrderLines.id, lineId));
      }
      if (si.source === "DIRECT") await this.advanceOrders(tx, [...metresByLine.keys()]);
      if (si.source === "DC") {
        const dcs = await tx.select().from(salesInvoiceDcs).where(eq(salesInvoiceDcs.siId, id));
        for (const { dcId } of dcs) {
          deliveryChallanMachine.assert("Open", "Closed");
          await tx
            .update(deliveryChallans)
            .set({
              status: "Closed",
              updatedAt: new Date(),
              updatedBy: actor().userId,
              version: sql`${deliveryChallans.version} + 1`,
            })
            .where(eq(deliveryChallans.id, dcId));
          await recordTransition(tx, "DeliveryChallan", dcId, "Open", "Closed", "Invoiced");
        }
      }
      if (si.proformaId) {
        const [pf] = await tx
          .select()
          .from(proformas)
          .where(eq(proformas.id, si.proformaId))
          .for("update");
        proformaMachine.assert(pf!.status, "Converted");
        await tx
          .update(proformas)
          .set({
            status: "Converted",
            updatedAt: new Date(),
            updatedBy: actor().userId,
            version: sql`${proformas.version} + 1`,
          })
          .where(eq(proformas.id, pf!.id));
        await recordTransition(tx, "Proforma", pf!.id, pf!.status, "Converted", "Invoiced");
      }

      const siNo = await this.series.allocate(tx, "SI", si.date);
      // Commission goes to the order's salesman, else the customer's (PRD §5.6), frozen now.
      const [owner] = (
        await tx.execute<{ salesman_id: string | null }>(sql`
          SELECT coalesce(
            (SELECT so.salesman_id FROM sales_invoice_lines l
               JOIN sales_order_lines sl ON sl.id = l.so_line_id
               JOIN sales_orders so ON so.id = sl.so_id
              WHERE l.si_id = ${id} AND so.salesman_id IS NOT NULL LIMIT 1),
            (SELECT c.salesman_id FROM customers c WHERE c.id = ${si.customerId})) AS salesman_id`)
      ).rows;
      const einvoiceStatus = si.supplyType === "B2C" ? "NotRequired" : "Pending";
      await updateVersioned(
        tx,
        salesInvoices,
        eq(salesInvoices.id, id),
        version,
        {
          status: "Posted",
          siNo,
          cogs: totalCogs.toFixed(2),
          einvoiceStatus,
          postedAt: new Date(),
          postedBy: actor().userId,
          salesmanId: owner?.salesman_id ?? null,
        },
        "Sales invoice",
      );
      await recordTransition(tx, "SalesInvoice", id, "Draft", "Posted");
      await this.commission.onInvoicePosted(tx, id);
      if (einvoiceStatus === "Pending") this.irnQueue.enqueueAfterCommit("SI", id);
      const fresh = await tx
        .select()
        .from(salesInvoiceLines)
        .where(eq(salesInvoiceLines.siId, id))
        .orderBy(asc(salesInvoiceLines.lineNo));
      await writePostingEvent(tx, {
        type: "SI_POSTED",
        docType: "SI",
        docId: id,
        docNo: siNo,
        docDate: si.date,
        partyType: "CUSTOMER",
        partyId: si.customerId,
        payload: {
          siNo,
          date: si.date,
          dueDate: si.dueDate,
          source: si.source,
          customer: { id: si.customerId, name: si.customerName, gstin: si.customerGstin },
          regime: si.regime,
          placeOfSupply: si.placeOfSupply,
          supplyType: si.supplyType,
          lines: fresh.map((l) => ({
            kind: l.kind,
            description: l.description,
            hsnCode: l.hsnCode,
            metres: l.metres,
            ratePerM: l.ratePerM,
            taxable: l.taxable,
            gstRate: l.gstRate,
            cgst: l.cgst,
            sgst: l.sgst,
            igst: l.igst,
            cogs: l.cogs,
            rolls: billed
              .filter((x) => x.b.siLineId === l.id)
              .map((x) => ({
                rollId: x.roll.id,
                barcode: x.roll.barcode,
                lengthM: x.b.lengthM,
                cogs: cogsByRoll.get(x.b.id),
              })),
          })),
          totals: totalsOut(si, si.regime as GstRegime),
          billDiscount: si.billDiscount,
          cogs: totalCogs.toFixed(2),
        },
      });
      this.changed(id);
      this.bus.publishAfterCommit("inventory.changed", { siId: id });
    });
    return this.get(id);
  }

  /** After a direct sale: Confirmed → PartiallyFulfilled / Closed by dispatched metres. */
  private async advanceOrders(tx: Tx, lineIds: string[]) {
    if (!lineIds.length) return;
    const soIds = (
      await tx
        .selectDistinct({ soId: salesOrderLines.soId })
        .from(salesOrderLines)
        .where(inArray(salesOrderLines.id, lineIds))
    ).map((r) => r.soId);
    const { toleranceM } = await this.settings.value("inventory.allocation");
    for (const soId of soIds) {
      const [so] = await tx
        .select()
        .from(salesOrders)
        .where(eq(salesOrders.id, soId))
        .for("update");
      const lines = await tx.select().from(salesOrderLines).where(eq(salesOrderLines.soId, soId));
      const to = lines.every((l) => l.dispatchedM >= l.totalM - toleranceM)
        ? "Closed"
        : "PartiallyFulfilled";
      if (to === so!.status) continue;
      salesOrderMachine.assert(so!.status, to);
      await tx
        .update(salesOrders)
        .set({
          status: to,
          updatedAt: new Date(),
          updatedBy: actor().userId,
          version: sql`${salesOrders.version} + 1`,
        })
        .where(eq(salesOrders.id, soId));
      await recordTransition(tx, "SalesOrder", soId, so!.status, to, "Direct invoice");
    }
  }

  /**
   * Cancel a draft (held rolls go back to stock), or a posted challan-based invoice within the IRN
   * window (ADR-0011): its challans reopen to be billed again; the number is never reused. Later
   * corrections — and any direct sale — are made with a credit note.
   */
  async cancel(id: string, version: number): Promise<SiDetail> {
    await this.uow.run(async (tx) => {
      const si = await this.lock(tx, id);
      salesInvoiceMachine.assert(si.status, "Cancelled");
      const billed = await tx
        .select()
        .from(salesInvoiceRolls)
        .where(eq(salesInvoiceRolls.siId, id));
      if (si.status === "Draft") {
        if (si.source !== "DC" && billed.length) {
          const ids = billed.map((b) => b.rollId);
          await tx
            .update(rolls)
            .set({ status: "Mapped", ...touchRolls() })
            .where(inArray(rolls.id, ids));
          await recordTransition(tx, "Roll", ids, "Allocated", "Mapped", "Draft invoice cancelled");
        }
      } else {
        const reason = ctx().reason?.trim();
        if (!reason) throw reasonRequired();
        if (si.source !== "DC") {
          throw validationError(
            "A direct sale can't be cancelled after posting. Take the goods back with a sales return.",
          );
        }
        const { cancelWindowHours } = await this.settings.value("einvoice.config");
        if (Date.now() - si.postedAt!.getTime() > cancelWindowHours * 3_600_000) {
          throw validationError(
            `Invoices can only be cancelled within ${cancelWindowHours} hours. Issue a credit note instead.`,
          );
        }
        const [later] = await tx
          .execute<{ n: number }>(
            sql`
          SELECT (SELECT count(*) FROM sales_returns WHERE si_id = ${id} AND status <> 'Cancelled')
               + (SELECT count(*) FROM customer_notes WHERE si_id = ${id} AND status <> 'Cancelled')
               + (SELECT count(*) FROM allocations WHERE sales_invoice_id = ${id} AND reversed_at IS NULL) AS n`,
          )
          .then((r) => r.rows);
        if (Number(later!.n) > 0)
          throw validationError(
            "This invoice has returns, notes or payments against it and can't be cancelled. Reverse the receipt first.",
          );
        const lines = await tx
          .select()
          .from(salesInvoiceLines)
          .where(eq(salesInvoiceLines.siId, id));
        for (const l of lines) {
          if (!l.soLineId || !l.metres) continue;
          await tx
            .update(salesOrderLines)
            .set({ invoicedM: sql`${salesOrderLines.invoicedM} - ${l.metres}` })
            .where(eq(salesOrderLines.id, l.soLineId));
        }
        const dcs = await tx.select().from(salesInvoiceDcs).where(eq(salesInvoiceDcs.siId, id));
        for (const { dcId } of dcs) {
          deliveryChallanMachine.assert("Closed", "Open");
          await tx
            .update(deliveryChallans)
            .set({
              status: "Open",
              updatedAt: new Date(),
              updatedBy: actor().userId,
              version: sql`${deliveryChallans.version} + 1`,
            })
            .where(eq(deliveryChallans.id, dcId));
          await recordTransition(
            tx,
            "DeliveryChallan",
            dcId,
            "Closed",
            "Open",
            `Invoice ${si.siNo} cancelled`,
          );
        }
        await writePostingEvent(tx, {
          type: "SI_CANCELLED",
          docType: "SI",
          docId: id,
          docNo: si.siNo,
          docDate: si.date,
          partyType: "CUSTOMER",
          partyId: si.customerId,
          payload: { siNo: si.siNo, reason, total: si.total, cogs: si.cogs },
        });
      }
      await updateVersioned(
        tx,
        salesInvoices,
        eq(salesInvoices.id, id),
        version,
        {
          status: "Cancelled",
          cancelledAt: new Date(),
          cancelledBy: actor().userId,
          cancelReason: ctx().reason ?? null,
        },
        "Sales invoice",
      );
      await recordTransition(tx, "SalesInvoice", id, si.status, "Cancelled");
      // Last, so an IRP refusal rolls the whole cancellation back (ADR-0011).
      if (si.status === "Posted") {
        await this.einvoice.cancelIrn(tx, "SI", id, ctx().reason!.trim());
        await this.commission.onInvoiceCancelled(tx, id, ctx().reason!.trim());
        this.creditRecheck.enqueueAfterCommit(si.customerId);
      }
      this.changed(id);
      this.bus.publishAfterCommit("inventory.changed", { siId: id });
    });
    return this.get(id);
  }

  async lock(tx: Tx, id: string) {
    const scope = await loadCustomerScope(tx);
    const [row] = await tx
      .select({ si: salesInvoices })
      .from(salesInvoices)
      .innerJoin(customers, eq(customers.id, salesInvoices.customerId))
      .where(and(eq(salesInvoices.id, id), customerScopeFilter(scope)))
      .for("update", { of: salesInvoices });
    if (!row) throw notFound("Sales invoice");
    return row.si;
  }

  private changed(id: string) {
    this.bus.publishAfterCommit("sales.changed", { doc: "SI", id });
  }
}

function soGoods(line: typeof salesOrderLines.$inferSelect): GoodsDraft {
  return {
    soLineId: line.id,
    proformaLineId: null,
    skuId: line.skuId,
    description: line.description,
    hsnCode: line.hsnCode,
    gstRate: line.gstRate,
    widthIn: line.widthIn,
    ratePerM: line.ratePerM,
    discountPct: line.discountPct,
    rolls: [],
  };
}

/** The line's own HSN / GST, else the catalogue's current values. */
function pickTax(
  line: { hsnCode: string | null; gstRate: string | null },
  sku: { hsnCode: string | null; gstRate: string | null } | undefined,
) {
  return {
    hsnCode: line.hsnCode || sku?.hsnCode || null,
    gstRate: line.gstRate ?? sku?.gstRate ?? null,
  };
}

function toListItem(si: typeof salesInvoices.$inferSelect): SiListItem {
  return {
    id: si.id,
    siNo: si.siNo,
    date: si.date,
    customerId: si.customerId,
    customerName: si.customerName,
    status: si.status,
    total: D(si.total).toFixed(2),
    einvoiceStatus: si.einvoiceStatus,
    dueDate: si.dueDate,
    // Stage 4 subtracts receipts; until then a posted invoice is owed in full.
    outstanding: si.status === "Posted" ? D(si.total).toFixed(2) : "0.00",
    version: si.version,
  };
}
