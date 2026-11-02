import {
  BATCH_CHAPTER,
  type CashAccount,
  OPENING_CHAPTERS,
  type OpeningBatch,
  type OpeningBatchKind,
  type OpeningChapterCode,
  type OpeningCheckReport,
  type OpeningStatus,
  type OpeningUpload,
  type cashAccountInput,
  type cashAccountUpdate,
} from "@erp/contracts";
import {
  type Tx,
  batches,
  categories,
  companies,
  customers,
  goLive,
  goodsReceiptLines,
  goodsReceipts,
  openingBatches,
  openingCashBalances,
  openingChapters,
  products,
  purchaseInvoices,
  qualities,
  rolls,
  salesInvoices,
  skus,
  suppliers,
  user,
} from "@erp/db";
import {
  CsvError,
  D,
  type KnownParty,
  type KnownSku,
  checkAgainstBooks,
  checkOpeningInvoices,
  checkOpeningRolls,
  checkOpeningSkuTotals,
  dayBefore,
  formatRollBarcode,
  goLiveBlockers,
  gstRegime,
  parseCsv,
  splitOpeningRolls,
  sum,
} from "@erp/domain";
import { Injectable } from "@nestjs/common";
import { and, asc, eq, inArray, max, ne, sql } from "drizzle-orm";
import type { z } from "zod";
import { addDays } from "../../common/dates.js";
import { actor } from "../../common/context.js";
import { AppError, notFound, validationError } from "../../common/errors.js";
import { recordTransition, writePostingEvent } from "../../db/ledger.js";
import { UnitOfWork } from "../../db/unit-of-work.js";
import { updateVersioned } from "../../db/versioning.js";
import { formatAddress } from "../sales/sales-common.js";
import { SeriesService } from "../series/series.service.js";
import { SettingsService } from "../settings/settings.service.js";

/** One roll to create, whichever stock route it came from. */
interface RollToMake {
  supplierId: string;
  skuId: string;
  barcode: string | null;
  lengthM: number;
  costPerM: string;
  value: string;
  receivedDate: string;
  batchRef: string | null;
}

const PREVIEW = 50;
const lockedError = () =>
  new AppError(
    409,
    "OPENING_LOCKED",
    "Opening balances are locked since go-live. Correct them with an adjustment and a reason.",
  );

/**
 * Opening Balance Wizard (PRD §5.10). Uploads are checked by the pure domain rules first
 * (`dryRun`); an import with no errors is saved as one batch:
 *  - stock → one opening GRN per supplier (series OB) whose rolls are Mapped with landed cost;
 *  - receivables / payables → opening invoices (no lines, no GST, IRN or commission);
 * and can be discarded until anything touches it or the company goes live. The database
 * enforces the lock (migration 0014); this service gives friendly answers before it does.
 */
@Injectable()
export class OpeningService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly settings: SettingsService,
    private readonly series: SeriesService,
  ) {}

  // ── dates and the lock ─────────────────────────────────────────────────────

  private async dates() {
    const goLiveDate = (await this.settings.value("golive.date")) || null;
    return { goLiveDate, openingDate: goLiveDate ? dayBefore(goLiveDate) : null };
  }

  private async requireGoLiveDate() {
    const d = await this.dates();
    if (!d.goLiveDate) {
      throw validationError("Set the go-live date first (Settings → Go-live).", [
        { path: "golive.date", message: "Needed to date the opening balances" },
      ]);
    }
    return d as { goLiveDate: string; openingDate: string };
  }

  private async lock() {
    const [row] = await this.uow.db
      .select({
        lockedAt: goLive.lockedAt,
        lockedBy: goLive.lockedBy,
        doc: goLive.lockedByDoc,
        name: user.name,
      })
      .from(goLive)
      .leftJoin(user, eq(user.id, goLive.lockedBy))
      .where(eq(goLive.companyId, actor().companyId));
    return row ?? null;
  }

  private async assertOpen() {
    if (await this.lock()) throw lockedError();
  }

  // ── lookups the domain checks need ─────────────────────────────────────────

  private async knownSkus(): Promise<(KnownSku & { description: string; gsmN: number })[]> {
    const rows = await this.uow.db
      .select({
        id: skus.id,
        code: skus.code,
        widthIn: skus.widthIn,
        gsm: products.gsm,
        quality: qualities.name,
        category: categories.name,
      })
      .from(skus)
      .innerJoin(products, eq(products.id, skus.productId))
      .innerJoin(qualities, eq(qualities.id, products.qualityId))
      .innerJoin(categories, eq(categories.id, products.categoryId))
      .where(and(eq(skus.companyId, actor().companyId), eq(skus.active, true)));
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      gsm: r.gsm,
      gsmN: r.gsm,
      quality: r.quality,
      widthIn: r.widthIn,
      description: `${r.category} ${r.gsm} GSM ${r.quality} ${D(r.widthIn).toString()}″`,
    }));
  }

  private async knownSuppliers(): Promise<KnownParty[]> {
    return this.uow.db
      .select({
        id: suppliers.id,
        code: suppliers.code,
        name: suppliers.name,
        gstin: suppliers.gstin,
      })
      .from(suppliers)
      .where(eq(suppliers.companyId, actor().companyId));
  }

  private async knownCustomers(): Promise<KnownParty[]> {
    return this.uow.db
      .select({
        id: customers.id,
        code: customers.code,
        name: customers.legalName,
        gstin: customers.gstin,
      })
      .from(customers)
      .where(eq(customers.companyId, actor().companyId));
  }

  // ── upload: check, then import ─────────────────────────────────────────────

  async upload(input: OpeningUpload): Promise<OpeningCheckReport> {
    await this.assertOpen();
    const { goLiveDate, openingDate } = await this.requireGoLiveDate();
    let table;
    try {
      table = parseCsv(input.csv);
    } catch (e) {
      if (e instanceof CsvError) {
        return this.report(
          input.kind,
          0,
          { rows: [], errors: [{ line: e.line, message: e.message }], warnings: [] },
          "0",
          null,
          null,
          [],
          null,
        );
      }
      throw e;
    }
    const company = actor().companyId;

    if (input.kind === "AR" || input.kind === "AP") {
      const customer = input.kind === "AR";
      const parties = customer ? await this.knownCustomers() : await this.knownSuppliers();
      const existing = new Set<string>();
      if (customer) {
        // Your own old invoice numbers are unique across customers, so check them company-wide.
        for (const r of await this.uow.db
          .select({ customerId: salesInvoices.customerId, no: salesInvoices.siNo })
          .from(salesInvoices)
          .where(and(eq(salesInvoices.companyId, company), sql`${salesInvoices.siNo} IS NOT NULL`)))
          for (const p of parties) existing.add(`${p.id}|${r.no!.toUpperCase()}`);
      } else {
        for (const r of await this.uow.db
          .select({
            supplierId: purchaseInvoices.supplierId,
            no: purchaseInvoices.supplierInvoiceNo,
          })
          .from(purchaseInvoices)
          .where(
            and(eq(purchaseInvoices.companyId, company), ne(purchaseInvoices.status, "Cancelled")),
          ))
          existing.add(`${r.supplierId}|${r.no.toUpperCase()}`);
      }
      const checked = checkOpeningInvoices(table, {
        parties,
        goLiveDate,
        existing,
        partyLabel: customer ? "customer" : "supplier",
      });
      if (customer) {
        // The same old number for two different customers is a mistake in the file.
        const seen = new Map<string, number>();
        for (const r of checked.rows) {
          const k = r.invoiceNo.toUpperCase();
          if (seen.has(k)) {
            checked.errors.push({
              line: r.line,
              column: "invoice_no",
              message: `Invoice ${r.invoiceNo} is also on line ${seen.get(k)}`,
            });
          } else seen.set(k, r.line);
        }
      }
      const total = sum(checked.rows.map((r) => r.amount)).toFixed(2);
      const preview = checked.rows.slice(0, PREVIEW).map((r) => ({
        line: r.line,
        party: r.partyName,
        invoiceNo: r.invoiceNo,
        date: r.date,
        dueDate: r.dueDate,
        amount: r.amount,
      }));
      let batchId: string | null = null;
      if (!input.dryRun && !checked.errors.length && checked.rows.length) {
        batchId = await this.uow.run(
          async (tx) => {
            const id = await this.newBatch(
              tx,
              input,
              checked.rows.length,
              total,
              null,
              checked.rows,
            );
            if (customer) await this.importReceivables(tx, id, checked.rows);
            else await this.importPayables(tx, id, checked.rows, openingDate);
            await writePostingEvent(tx, {
              type: customer ? "OPENING_AR" : "OPENING_AP",
              docType: "OPENING",
              docId: id,
              docNo: null,
              docDate: openingDate,
              payload: {
                total,
                invoices: checked.rows.map((r) => ({
                  partyId: r.partyId,
                  invoiceNo: r.invoiceNo,
                  date: r.date,
                  amount: r.amount,
                })),
              },
            });
            return id;
          },
          { reason: `Opening ${customer ? "receivables" : "payables"}: ${input.fileName}` },
        );
      }
      return this.report(
        input.kind,
        table.rows.length,
        checked,
        total,
        null,
        null,
        preview,
        batchId,
      );
    }

    // Stock.
    const skuList = await this.knownSkus();
    const supplierList = await this.knownSuppliers();
    let toMake: RollToMake[];
    let checked;
    if (input.kind === "STOCK_ROLLS") {
      const barcodes = table.rows
        .map((r) => (r.values.barcode ?? "").toUpperCase())
        .filter(Boolean);
      const used = barcodes.length
        ? new Set(
            (
              await this.uow.db
                .select({ b: rolls.barcode })
                .from(rolls)
                .where(and(eq(rolls.companyId, company), inArray(rolls.barcode, barcodes)))
            ).map((r) => r.b),
          )
        : new Set<string>();
      checked = checkOpeningRolls(table, {
        skus: skuList,
        suppliers: supplierList,
        goLiveDate,
        existingBarcodes: used,
      });
      toMake = checked.rows.map((r) => ({
        supplierId: r.supplierId,
        skuId: r.skuId,
        barcode: r.barcode,
        lengthM: r.metres,
        costPerM: r.costPerM,
        value: r.value,
        receivedDate: r.receivedDate,
        batchRef: r.batchRef,
      }));
    } else {
      const std = (await this.settings.value("inventory.allocation")).standardLengthM;
      checked = checkOpeningSkuTotals(table, {
        skus: skuList,
        suppliers: supplierList,
        goLiveDate,
        standardLengthM: std,
      });
      toMake = checked.rows.flatMap((r) =>
        splitOpeningRolls(r.metres, r.rolls, r.value, std).map((p) => ({
          supplierId: r.supplierId,
          skuId: r.skuId,
          barcode: null,
          lengthM: p.lengthM,
          costPerM: p.costPerM,
          value: p.value,
          receivedDate: r.receivedDate,
          batchRef: null,
        })),
      );
    }
    const total = sum(toMake.map((r) => r.value)).toFixed(2);
    const metres = toMake.reduce((s, r) => s + r.lengthM, 0);
    const skuById = new Map(skuList.map((s) => [s.id, s]));
    const supName = new Map(supplierList.map((s) => [s.id, s.name]));
    const preview = toMake.slice(0, PREVIEW).map((r) => ({
      supplier: supName.get(r.supplierId) ?? "",
      sku: skuById.get(r.skuId)?.code ?? "",
      barcode: r.barcode ?? "(new)",
      metres: r.lengthM,
      costPerM: r.costPerM,
      value: r.value,
      received: r.receivedDate,
    }));
    let batchId: string | null = null;
    if (!input.dryRun && !checked.errors.length && toMake.length) {
      batchId = await this.uow.run(
        async (tx) => {
          const id = await this.newBatch(tx, input, toMake.length, total, metres, checked.rows);
          const grns = await this.importStock(tx, id, toMake, skuById, openingDate);
          await writePostingEvent(tx, {
            type: "OPENING_STOCK",
            docType: "OPENING",
            docId: id,
            docNo: null,
            docDate: openingDate,
            payload: { total, metres, rolls: toMake.length, grns },
          });
          return id;
        },
        { reason: `Opening stock: ${input.fileName}` },
      );
    }
    return this.report(
      input.kind,
      table.rows.length,
      checked,
      total,
      metres,
      toMake.length,
      preview,
      batchId,
    );
  }

  private report(
    kind: OpeningBatchKind,
    rowCount: number,
    checked: {
      rows: unknown[];
      errors: OpeningCheckReport["errors"];
      warnings: OpeningCheckReport["warnings"];
    },
    total: string,
    metres: number | null,
    rollCount: number | null,
    preview: OpeningCheckReport["preview"],
    batchId: string | null,
  ): OpeningCheckReport {
    return {
      kind,
      rowCount,
      okCount: checked.rows.length,
      errors: checked.errors,
      warnings: checked.warnings,
      total,
      metres,
      rolls: rollCount,
      preview,
      batchId,
    };
  }

  private async newBatch(
    tx: Tx,
    input: OpeningUpload,
    rowCount: number,
    total: string,
    metres: number | null,
    rows: unknown[],
  ) {
    const [b] = await tx
      .insert(openingBatches)
      .values({
        companyId: actor().companyId,
        kind: input.kind,
        fileName: input.fileName || "upload.csv",
        rowCount,
        total,
        metres,
        rows,
        createdBy: actor().userId,
      })
      .returning({ id: openingBatches.id });
    // A new import reopens its chapter for confirmation against the books.
    await tx
      .insert(openingChapters)
      .values({
        companyId: actor().companyId,
        chapter: BATCH_CHAPTER[input.kind],
        createdBy: actor().userId,
        updatedBy: actor().userId,
      })
      .onConflictDoUpdate({
        target: [openingChapters.companyId, openingChapters.chapter],
        set: {
          status: "Draft",
          confirmedAt: null,
          confirmedBy: null,
          notNeededReason: null,
          updatedBy: actor().userId,
          updatedAt: new Date(),
        },
      });
    return b!.id;
  }

  /** One opening GRN (series OB) per supplier; rolls Mapped with their landed cost (UAT §11.7). */
  private async importStock(
    tx: Tx,
    batchId: string,
    toMake: RollToMake[],
    skuById: Map<string, KnownSku & { description: string; gsmN: number }>,
    openingDate: string,
  ) {
    const bySupplier = new Map<string, RollToMake[]>();
    for (const r of toMake)
      bySupplier.set(r.supplierId, [...(bySupplier.get(r.supplierId) ?? []), r]);
    const grns: { id: string; grnNo: string; rolls: number }[] = [];
    const postedAt = new Date();
    for (const [supplierId, list] of bySupplier) {
      const [supplier] = await tx
        .select()
        .from(suppliers)
        .where(eq(suppliers.id, supplierId))
        .for("update");
      const [last] = await tx
        .select({ seq: max(batches.batchSeq) })
        .from(batches)
        .where(eq(batches.supplierId, supplierId));
      const batchSeq = (last?.seq ?? 0) + 1;
      if (batchSeq > 9999)
        throw validationError(`${supplier!.name} has used all 9999 batch numbers.`);
      if (list.length > 9999)
        throw validationError(
          `Split ${supplier!.name}'s rolls: one opening GRN holds at most 9999.`,
        );
      const [batch] = await tx
        .insert(batches)
        .values({
          companyId: actor().companyId,
          supplierId,
          batchSeq,
          supplierBatchRef: "Opening stock",
          date: openingDate,
          nextRollSeq: list.length + 1,
          createdBy: actor().userId,
        })
        .returning();
      const grnNo = await this.series.allocate(tx, "OB", openingDate);
      const [grn] = await tx
        .insert(goodsReceipts)
        .values({
          companyId: actor().companyId,
          branchId: actor().branchId,
          supplierId,
          grnNo,
          date: openingDate,
          status: "Posted",
          notes: "Opening stock (Opening Balance Wizard)",
          batchId: batch!.id,
          openingBatchId: batchId,
          postedAt,
          postedBy: actor().userId,
          createdBy: actor().userId,
          updatedBy: actor().userId,
        })
        .returning();
      // One line per SKU, rolls in file order.
      const bySku = new Map<string, RollToMake[]>();
      for (const r of list) bySku.set(r.skuId, [...(bySku.get(r.skuId) ?? []), r]);
      const lineIds = new Map<string, string>();
      let lineNo = 0;
      for (const [skuId, rs] of bySku) {
        const s = skuById.get(skuId)!;
        const [line] = await tx
          .insert(goodsReceiptLines)
          .values({
            grnId: grn!.id,
            lineNo: ++lineNo,
            skuId,
            description: s.description,
            gsm: s.gsmN,
            widthIn: s.widthIn,
            qualityName: s.quality,
            rollList: rs.map((r) => r.lengthM).join(", "),
            rollCount: rs.length,
            acceptedM: rs.reduce((t, r) => t + r.lengthM, 0),
            createdBy: actor().userId,
          })
          .returning({ id: goodsReceiptLines.id });
        lineIds.set(skuId, line!.id);
      }
      const rows: (typeof rolls.$inferInsert)[] = list.map((r, i) => {
        const s = skuById.get(r.skuId)!;
        return {
          companyId: actor().companyId,
          branchId: actor().branchId,
          barcode:
            r.barcode ??
            formatRollBarcode({
              postedAt,
              supplierCode: supplier!.shortCode,
              batchSeq,
              rollSeq: i + 1,
            }),
          batchId: batch!.id,
          rollSeq: i + 1,
          supplierId,
          grnId: grn!.id,
          grnLineId: lineIds.get(r.skuId)!,
          skuId: r.skuId,
          description: s.description,
          gsm: s.gsmN,
          widthIn: s.widthIn,
          qualityName: s.quality,
          originalLengthM: r.lengthM,
          currentLengthM: r.lengthM,
          status: "Mapped" as const,
          baseCostPerM: r.costPerM,
          baseValue: r.value,
          costPerM: r.costPerM,
          receivedAt: new Date(`${r.receivedDate}T00:00:00+05:30`),
          mappedAt: postedAt,
          createdBy: actor().userId,
          updatedBy: actor().userId,
        };
      });
      const created: string[] = [];
      for (let i = 0; i < rows.length; i += 500) {
        created.push(
          ...(
            await tx
              .insert(rolls)
              .values(rows.slice(i, i + 500))
              .returning({ id: rolls.id })
          ).map((r) => r.id),
        );
      }
      await recordTransition(tx, "Roll", created, null, "Mapped", `Opening stock on ${grnNo}`);
      await recordTransition(tx, "GoodsReceipt", grn!.id, null, "Posted", "Opening stock");
      grns.push({ id: grn!.id, grnNo, rolls: created.length });
    }
    return grns;
  }

  /** Opening receivables: invoices with the old number, no lines, GST, IRN or commission (Q42). */
  private async importReceivables(
    tx: Tx,
    batchId: string,
    rows: {
      partyId: string;
      invoiceNo: string;
      date: string;
      dueDate: string | null;
      amount: string;
    }[],
  ) {
    const ids = [...new Set(rows.map((r) => r.partyId))];
    const parties = await tx
      .select({ c: customers, state: companies.stateCode })
      .from(customers)
      .innerJoin(companies, eq(companies.id, customers.companyId))
      .where(inArray(customers.id, ids));
    const policies = await tx.execute<{ customer_id: string; credit_days: number }>(
      sql`SELECT customer_id, credit_days FROM credit_policies WHERE customer_id IN (${sql.join(
        ids.map((i) => sql`${i}`),
        sql`, `,
      )})`,
    );
    const days = new Map(policies.rows.map((p) => [p.customer_id, p.credit_days]));
    const defaultDays = (await this.settings.value("credit.defaults")).creditDays;
    const byId = new Map(parties.map((p) => [p.c.id, p]));
    const postedAt = new Date();
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const inserted = await tx
        .insert(salesInvoices)
        .values(
          chunk.map((r) => {
            const { c, state } = byId.get(r.partyId)!;
            return {
              companyId: actor().companyId,
              branchId: actor().branchId,
              customerId: c.id,
              siNo: r.invoiceNo,
              legacyNo: r.invoiceNo,
              openingBatchId: batchId,
              date: r.date,
              dueDate: r.dueDate ?? addDays(r.date, days.get(c.id) ?? defaultDays),
              status: "Posted" as const,
              source: "OPENING" as const,
              regime: gstRegime(state, c.stateCode),
              placeOfSupply: c.stateCode,
              supplyType: c.gstin ? ("B2B" as const) : ("B2C" as const),
              customerName: c.legalName,
              customerGstin: c.gstin,
              billingAddress: formatAddress(c.billingAddress),
              shippingAddress: formatAddress(c.billingAddress),
              total: r.amount,
              postedAt,
              postedBy: actor().userId,
              notes: "Opening balance (Opening Balance Wizard)",
              createdBy: actor().userId,
              updatedBy: actor().userId,
            };
          }),
        )
        .returning({ id: salesInvoices.id });
      await recordTransition(
        tx,
        "SalesInvoice",
        inserted.map((r) => r.id),
        null,
        "Posted",
        "Opening balance",
      );
    }
  }

  /** Opening payables: purchase invoices under the supplier's number, with an internal PI ref. */
  private async importPayables(
    tx: Tx,
    batchId: string,
    rows: { partyId: string; invoiceNo: string; date: string; amount: string }[],
    openingDate: string,
  ) {
    const ids = [...new Set(rows.map((r) => r.partyId))];
    const parties = await tx
      .select({ s: suppliers, state: companies.stateCode })
      .from(suppliers)
      .innerJoin(companies, eq(companies.id, suppliers.companyId))
      .where(inArray(suppliers.id, ids));
    const byId = new Map(parties.map((p) => [p.s.id, p]));
    const postedAt = new Date();
    const created: string[] = [];
    for (const r of rows) {
      const { s, state } = byId.get(r.partyId)!;
      const [pi] = await tx
        .insert(purchaseInvoices)
        .values({
          companyId: actor().companyId,
          branchId: actor().branchId,
          supplierId: s.id,
          piNo: await this.series.allocate(tx, "PI", openingDate),
          openingBatchId: batchId,
          supplierInvoiceNo: r.invoiceNo,
          supplierInvoiceDate: r.date,
          status: "Posted",
          regime: gstRegime(state, s.stateCode),
          total: r.amount,
          notes: "Opening balance (Opening Balance Wizard)",
          postedAt,
          postedBy: actor().userId,
          createdBy: actor().userId,
          updatedBy: actor().userId,
        })
        .returning({ id: purchaseInvoices.id });
      created.push(pi!.id);
    }
    await recordTransition(tx, "PurchaseInvoice", created, null, "Posted", "Opening balance");
  }

  // ── discard ────────────────────────────────────────────────────────────────

  /** Removes everything a batch created — only while nothing has used it (PRD §12 rollback). */
  async discard(id: string, reason: string): Promise<OpeningBatch> {
    await this.assertOpen();
    await this.uow.run(
      async (tx) => {
        const [b] = await tx
          .select()
          .from(openingBatches)
          .where(and(eq(openingBatches.id, id), eq(openingBatches.companyId, actor().companyId)))
          .for("update");
        if (!b) throw notFound("Opening batch");
        if (b.status === "Discarded") throw validationError("This import is already discarded.");
        const why = await this.untouched(tx, b.id, b.kind);
        if (why) throw validationError(`This import can't be discarded: ${why}.`);
        if (b.kind === "AR") {
          await tx.delete(salesInvoices).where(eq(salesInvoices.openingBatchId, b.id));
        } else if (b.kind === "AP") {
          await tx.delete(purchaseInvoices).where(eq(purchaseInvoices.openingBatchId, b.id));
        } else {
          const grnIds = await tx
            .select({ id: goodsReceipts.id, batchId: goodsReceipts.batchId })
            .from(goodsReceipts)
            .where(eq(goodsReceipts.openingBatchId, b.id));
          if (grnIds.length) {
            const g = grnIds.map((x) => x.id);
            await tx.delete(rolls).where(inArray(rolls.grnId, g));
            await tx.delete(goodsReceiptLines).where(inArray(goodsReceiptLines.grnId, g));
            await tx.delete(goodsReceipts).where(inArray(goodsReceipts.id, g));
            await tx.delete(batches).where(
              inArray(
                batches.id,
                grnIds.map((x) => x.batchId!),
              ),
            );
          }
        }
        await tx
          .update(openingBatches)
          .set({
            status: "Discarded",
            discardedAt: new Date(),
            discardedBy: actor().userId,
            discardReason: reason,
          })
          .where(eq(openingBatches.id, b.id));
        await tx
          .update(openingChapters)
          .set({
            status: "Draft",
            confirmedAt: null,
            confirmedBy: null,
            updatedBy: actor().userId,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(openingChapters.companyId, actor().companyId),
              eq(openingChapters.chapter, BATCH_CHAPTER[b.kind]),
            ),
          );
        await writePostingEvent(tx, {
          type: "OPENING_DISCARDED",
          docType: "OPENING",
          docId: b.id,
          docNo: null,
          docDate: (await this.dates()).openingDate ?? new Date().toISOString().slice(0, 10),
          payload: { kind: b.kind, total: b.total, reason },
        });
      },
      { reason },
    );
    return (await this.batchList()).find((x) => x.id === id)!;
  }

  /** Why a batch can no longer be discarded, or null when it can. */
  private async untouched(
    db: Pick<Tx, "execute">,
    batchId: string,
    kind: OpeningBatchKind,
  ): Promise<string | null> {
    if (kind === "AR") {
      const { rows } = await db.execute<{ n: number }>(sql`
        SELECT count(*)::int AS n FROM allocations a JOIN sales_invoices si ON si.id = a.sales_invoice_id
        WHERE si.opening_batch_id = ${batchId}`);
      const notes = await db.execute<{ n: number }>(sql`
        SELECT count(*)::int AS n FROM customer_notes n JOIN sales_invoices si ON si.id = n.si_id
        WHERE si.opening_batch_id = ${batchId}`);
      if (rows[0]!.n || notes.rows[0]!.n) return "money or a note has been applied to its invoices";
      return null;
    }
    if (kind === "AP") {
      const { rows } = await db.execute<{ n: number }>(sql`
        SELECT count(*)::int AS n FROM allocations a JOIN purchase_invoices pi ON pi.id = a.purchase_invoice_id
        WHERE pi.opening_batch_id = ${batchId}`);
      return rows[0]!.n ? "a payment has been applied to its invoices" : null;
    }
    const { rows } = await db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM rolls r JOIN goods_receipts g ON g.id = r.grn_id
      WHERE g.opening_batch_id = ${batchId}
        AND (r.status <> 'Mapped' OR r.current_length_m <> r.original_length_m)`);
    if (rows[0]!.n) return "some of its rolls have been picked, cut or changed";
    // Label prints are an append-only log: once a label is printed the rolls stay.
    const printed = await db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM label_prints lp JOIN rolls r ON r.id = lp.roll_id
      JOIN goods_receipts g ON g.id = r.grn_id WHERE g.opening_batch_id = ${batchId}`);
    return printed.rows[0]!.n ? "labels have been printed for its rolls" : null;
  }

  // ── chapters ───────────────────────────────────────────────────────────────

  private async chapterTotal(chapter: OpeningChapterCode): Promise<string> {
    if (chapter === "CASH") {
      const [r] = await this.uow.db
        .select({ t: sql<string>`coalesce(sum(${openingCashBalances.balance}), 0)::text` })
        .from(openingCashBalances)
        .where(eq(openingCashBalances.companyId, actor().companyId));
      return D(r!.t).toFixed(2);
    }
    const kinds: OpeningBatchKind[] =
      chapter === "STOCK" ? ["STOCK_ROLLS", "STOCK_SKU"] : [chapter];
    const [r] = await this.uow.db
      .select({ t: sql<string>`coalesce(sum(${openingBatches.total}), 0)::text` })
      .from(openingBatches)
      .where(
        and(
          eq(openingBatches.companyId, actor().companyId),
          eq(openingBatches.status, "Imported"),
          inArray(openingBatches.kind, kinds),
        ),
      );
    return D(r!.t).toFixed(2);
  }

  /** Confirms a chapter: the imported total must equal the books to the paisa (Q43). */
  async confirm(chapter: OpeningChapterCode, booksTotal: string): Promise<OpeningStatus> {
    await this.assertOpen();
    const total = await this.chapterTotal(chapter);
    if (chapter === "CASH") {
      const [open] = await this.uow.db
        .select({
          n: sql<number>`count(*) FILTER (WHERE ${openingCashBalances.confirmedAt} IS NULL)::int`,
          all: sql<number>`count(*)::int`,
        })
        .from(openingCashBalances)
        .where(eq(openingCashBalances.companyId, actor().companyId));
      if (!open!.all)
        throw validationError(
          "Add the bank and cash accounts first, or mark the chapter as not needed.",
        );
      if (open!.n)
        throw validationError(
          "Each bank and cash balance must be confirmed by the accountant first.",
        );
    } else if (total === "0.00") {
      throw validationError(
        "Nothing is imported in this chapter yet. Import it or mark it as not needed.",
      );
    }
    const check = checkAgainstBooks([total], booksTotal);
    if (!check.matches) {
      throw validationError(
        `The import totals ₹${check.imported}; your books say ₹${check.books} (difference ₹${check.difference}). They must match to the paisa.`,
        [{ path: "booksTotal", message: `Difference ₹${check.difference}` }],
      );
    }
    await this.uow.run((tx) =>
      tx
        .insert(openingChapters)
        .values({
          companyId: actor().companyId,
          chapter,
          status: "Confirmed",
          booksTotal,
          confirmedAt: new Date(),
          confirmedBy: actor().userId,
          createdBy: actor().userId,
          updatedBy: actor().userId,
        })
        .onConflictDoUpdate({
          target: [openingChapters.companyId, openingChapters.chapter],
          set: {
            status: "Confirmed",
            booksTotal,
            notNeededReason: null,
            confirmedAt: new Date(),
            confirmedBy: actor().userId,
            updatedBy: actor().userId,
            updatedAt: new Date(),
          },
        }),
    );
    return this.status();
  }

  async notNeeded(chapter: OpeningChapterCode, reason: string): Promise<OpeningStatus> {
    await this.assertOpen();
    if ((await this.chapterTotal(chapter)) !== "0.00") {
      throw validationError(
        "This chapter has imports. Discard them first, or confirm them against the books.",
      );
    }
    await this.uow.run(
      (tx) =>
        tx
          .insert(openingChapters)
          .values({
            companyId: actor().companyId,
            chapter,
            status: "NotNeeded",
            notNeededReason: reason,
            createdBy: actor().userId,
            updatedBy: actor().userId,
          })
          .onConflictDoUpdate({
            target: [openingChapters.companyId, openingChapters.chapter],
            set: {
              status: "NotNeeded",
              notNeededReason: reason,
              booksTotal: null,
              confirmedAt: null,
              confirmedBy: null,
              updatedBy: actor().userId,
              updatedAt: new Date(),
            },
          }),
      { reason },
    );
    return this.status();
  }

  // ── bank and cash ──────────────────────────────────────────────────────────

  async listCash(): Promise<CashAccount[]> {
    const rows = await this.uow.db
      .select({ a: openingCashBalances, name: user.name })
      .from(openingCashBalances)
      .leftJoin(user, eq(user.id, openingCashBalances.confirmedBy))
      .where(eq(openingCashBalances.companyId, actor().companyId))
      .orderBy(asc(openingCashBalances.kind), asc(openingCashBalances.name));
    return rows.map(({ a, name }) => ({
      id: a.id,
      name: a.name,
      kind: a.kind,
      bankName: a.bankName,
      accountLast4: a.accountLast4,
      balance: D(a.balance).toFixed(2),
      asOf: a.asOf,
      confirmedAt: a.confirmedAt?.toISOString() ?? null,
      confirmedByName: name,
      version: a.version,
    }));
  }

  private async cashChanged(tx: Tx) {
    await tx
      .update(openingChapters)
      .set({ status: "Draft", confirmedAt: null, confirmedBy: null, updatedAt: new Date() })
      .where(
        and(eq(openingChapters.companyId, actor().companyId), eq(openingChapters.chapter, "CASH")),
      );
  }

  async addCash(dto: z.infer<typeof cashAccountInput>): Promise<CashAccount[]> {
    await this.assertOpen();
    await this.uow.run(async (tx) => {
      const clash = await tx
        .select({ id: openingCashBalances.id })
        .from(openingCashBalances)
        .where(
          and(
            eq(openingCashBalances.companyId, actor().companyId),
            eq(openingCashBalances.name, dto.name),
          ),
        );
      if (clash.length)
        throw validationError("There is already an account with this name.", [
          { path: "name", message: "Use another name" },
        ]);
      await tx.insert(openingCashBalances).values({
        companyId: actor().companyId,
        name: dto.name,
        kind: dto.kind,
        bankName: dto.kind === "BANK" ? (dto.bankName ?? null) : null,
        accountLast4: dto.accountLast4 ?? null,
        balance: dto.balance,
        asOf: dto.asOf,
        createdBy: actor().userId,
        updatedBy: actor().userId,
      });
      await this.cashChanged(tx);
    });
    return this.listCash();
  }

  async updateCash(id: string, dto: z.infer<typeof cashAccountUpdate>): Promise<CashAccount[]> {
    await this.assertOpen();
    await this.uow.run(async (tx) => {
      await updateVersioned(
        tx,
        openingCashBalances,
        and(eq(openingCashBalances.id, id), eq(openingCashBalances.companyId, actor().companyId))!,
        dto.version,
        {
          name: dto.name,
          kind: dto.kind,
          bankName: dto.kind === "BANK" ? (dto.bankName ?? null) : null,
          accountLast4: dto.accountLast4 ?? null,
          balance: dto.balance,
          asOf: dto.asOf,
          // A changed balance needs confirming again.
          confirmedAt: null,
          confirmedBy: null,
          updatedBy: actor().userId,
          updatedAt: new Date(),
        },
        "Bank or cash account",
      );
      await this.cashChanged(tx);
    });
    return this.listCash();
  }

  async removeCash(id: string): Promise<CashAccount[]> {
    await this.assertOpen();
    await this.uow.run(async (tx) => {
      const gone = await tx
        .delete(openingCashBalances)
        .where(
          and(eq(openingCashBalances.id, id), eq(openingCashBalances.companyId, actor().companyId)),
        )
        .returning({ id: openingCashBalances.id });
      if (!gone.length) throw notFound("Bank or cash account");
      await this.cashChanged(tx);
    });
    return this.listCash();
  }

  /** The accountant confirms each balance with their password (PRD §5.10). */
  async confirmCash(id: string, version: number): Promise<CashAccount[]> {
    await this.assertOpen();
    await this.uow.run((tx) =>
      updateVersioned(
        tx,
        openingCashBalances,
        and(eq(openingCashBalances.id, id), eq(openingCashBalances.companyId, actor().companyId))!,
        version,
        {
          confirmedAt: new Date(),
          confirmedBy: actor().userId,
          updatedBy: actor().userId,
          updatedAt: new Date(),
        },
        "Bank or cash account",
      ),
    );
    return this.listCash();
  }

  // ── status and go live ─────────────────────────────────────────────────────

  private async batchList(): Promise<OpeningBatch[]> {
    const rows = await this.uow.db
      .select({ b: openingBatches, name: user.name })
      .from(openingBatches)
      .leftJoin(user, eq(user.id, openingBatches.createdBy))
      .where(eq(openingBatches.companyId, actor().companyId))
      .orderBy(asc(openingBatches.createdAt));
    const docs = await this.uow.db
      .select({
        id: goodsReceipts.id,
        no: goodsReceipts.grnNo,
        batch: goodsReceipts.openingBatchId,
      })
      .from(goodsReceipts)
      .where(
        and(
          eq(goodsReceipts.companyId, actor().companyId),
          sql`${goodsReceipts.openingBatchId} IS NOT NULL`,
        ),
      );
    const locked = Boolean(await this.lock());
    const out: OpeningBatch[] = [];
    for (const { b, name } of rows) {
      out.push({
        id: b.id,
        kind: b.kind,
        status: b.status,
        fileName: b.fileName,
        rowCount: b.rowCount,
        total: D(b.total).toFixed(2),
        metres: b.metres,
        documents: docs.filter((d) => d.batch === b.id).map((d) => ({ id: d.id, docNo: d.no })),
        createdAt: b.createdAt.toISOString(),
        createdByName: name,
        discardedAt: b.discardedAt?.toISOString() ?? null,
        discardReason: b.discardReason,
        discardable:
          !locked && b.status === "Imported" && !(await this.untouched(this.uow.db, b.id, b.kind)),
      });
    }
    return out;
  }

  async status(): Promise<OpeningStatus> {
    const { goLiveDate, openingDate } = await this.dates();
    const lock = await this.lock();
    const stored = await this.uow.db
      .select({ c: openingChapters, name: user.name })
      .from(openingChapters)
      .leftJoin(user, eq(user.id, openingChapters.confirmedBy))
      .where(eq(openingChapters.companyId, actor().companyId));
    const batchesAll = await this.batchList();
    const chapters = await Promise.all(
      OPENING_CHAPTERS.map(async (chapter) => {
        const s = stored.find((x) => x.c.chapter === chapter);
        const total = await this.chapterTotal(chapter);
        const own = batchesAll.filter((b) => BATCH_CHAPTER[b.kind] === chapter);
        const status: OpeningStatus["chapters"][number]["status"] =
          s?.c.status ??
          (own.some((b) => b.status === "Imported") || (chapter === "CASH" && total !== "0.00")
            ? "Draft"
            : "Empty");
        const books = s?.c.booksTotal ? D(s.c.booksTotal).toFixed(2) : null;
        return {
          chapter,
          status:
            status === "Draft" && !own.some((b) => b.status === "Imported") && chapter !== "CASH"
              ? ("Empty" as const)
              : status,
          total,
          booksTotal: books,
          difference: books ? D(total).minus(books).toFixed(2) : null,
          notNeededReason: s?.c.notNeededReason ?? null,
          confirmedAt: s?.c.confirmedAt?.toISOString() ?? null,
          confirmedByName: s?.name ?? null,
          batches: own,
        };
      }),
    );
    return {
      goLiveDate,
      openingDate,
      lockedAt: lock?.lockedAt.toISOString() ?? null,
      lockedByName: lock?.name ?? null,
      lockedBy: lock ? (lock.doc === "manual" ? "manual" : lock.doc) : null,
      chapters,
      cash: await this.listCash(),
      blockers: [
        ...(goLiveDate ? [] : ["Set the go-live date (Settings → Go-live)"]),
        ...goLiveBlockers(
          chapters.map((c) => ({ chapter: c.chapter, status: c.status })),
          lock?.lockedAt.toISOString() ?? null,
        ),
      ],
    };
  }

  /** The Owner goes live by hand (Q44); the first live posting would do the same. */
  async goLive(): Promise<OpeningStatus> {
    const s = await this.status();
    if (s.blockers.length) throw validationError(`Not ready to go live: ${s.blockers.join("; ")}.`);
    await this.uow.run(
      async (tx) => {
        const inserted = await tx
          .insert(goLive)
          .values({ companyId: actor().companyId, lockedBy: actor().userId, lockedByDoc: "manual" })
          .onConflictDoNothing()
          .returning({ at: goLive.lockedAt });
        if (!inserted.length) throw lockedError();
        await writePostingEvent(tx, {
          type: "GO_LIVE",
          docType: "OPENING",
          docId: actor().companyId,
          docNo: null,
          docDate: s.openingDate!,
          payload: {
            goLiveDate: s.goLiveDate,
            chapters: s.chapters.map((c) => ({
              chapter: c.chapter,
              status: c.status,
              total: c.total,
              booksTotal: c.booksTotal,
            })),
            cash: s.cash.map((a) => ({
              name: a.name,
              kind: a.kind,
              balance: a.balance,
              asOf: a.asOf,
            })),
          },
        });
      },
      { reason: "Go live" },
    );
    return this.status();
  }
}
