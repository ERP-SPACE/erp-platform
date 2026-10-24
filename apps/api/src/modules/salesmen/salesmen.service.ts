import type {
  CommissionRuleItem,
  KycDocumentItem,
  SalesmanDetail,
  SalesmanItem,
} from "@erp/contracts";
import {
  type Tx,
  commissionRules,
  customers,
  products,
  salesmanBlockedCustomers,
  salesmanDefaultRates,
  salesmanKycDocuments,
  salesmen,
  user,
} from "@erp/db";
import { D, istToday } from "@erp/domain";
import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Readable } from "node:stream";
import { actor } from "../../common/context.js";
import { inRange } from "../../common/dates.js";
import { trimDecimal } from "../../common/decimal.js";
import { notFound, validationError } from "../../common/errors.js";
import { nextMasterCode } from "../../db/master-codes.js";
import { UnitOfWork } from "../../db/unit-of-work.js";
import { updateVersioned } from "../../db/versioning.js";
import { StorageService, sniffContentType } from "../../storage/storage.service.js";
import { loadProductNames } from "../catalogue/catalogue.service.js";
import { EventBus } from "../realtime/event-bus.js";
import { activeFilter, searchFilter } from "../suppliers/suppliers.service.js";
import type {
  CloseCommissionRuleDto,
  CreateCommissionRuleDto,
  CreateSalesmanDto,
  SalesmanBlockDto,
  SalesmanDefaultRatesDto,
  SalesmanListQueryDto,
  UpdateSalesmanDto,
} from "./salesmen.dto.js";

const EXTENSIONS = { "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg" } as const;

/**
 * Salesman / broker master (PRD §5.6): records only, no login (Q10). Holds the defaults a new
 * customer inherits, block settings, KYC documents and party-wise commission rules.
 */
@Injectable()
export class SalesmenService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly bus: EventBus,
    private readonly storage: StorageService,
  ) {}

  async list(query: SalesmanListQueryDto): Promise<SalesmanItem[]> {
    const rows = await this.uow.db
      .select({
        s: salesmen,
        customerCount: sql<number>`(SELECT count(*)::int FROM customers c WHERE c.salesman_id = salesmen.id AND c.active)`,
      })
      .from(salesmen)
      .where(
        and(
          eq(salesmen.companyId, actor().companyId),
          activeFilter(salesmen.active, query.active),
          searchFilter(
            sql`(${salesmen.name} || ' ' || ${salesmen.code} || ' ' || coalesce(${salesmen.phone}, ''))`,
            query.q,
          ),
        ),
      )
      .orderBy(asc(salesmen.name));
    return rows.map((r) => toItem(r.s, r.customerCount));
  }

  async get(id: string): Promise<SalesmanDetail> {
    const db = this.uow.db;
    const [row] = await db
      .select({
        s: salesmen,
        customerCount: sql<number>`(SELECT count(*)::int FROM customers c WHERE c.salesman_id = salesmen.id AND c.active)`,
      })
      .from(salesmen)
      .where(this.own(id));
    if (!row) throw notFound("Salesman");
    const [rates, blocked, docs] = await Promise.all([
      db.select().from(salesmanDefaultRates).where(eq(salesmanDefaultRates.salesmanId, id)),
      db
        .select({ customerId: salesmanBlockedCustomers.customerId })
        .from(salesmanBlockedCustomers)
        .where(eq(salesmanBlockedCustomers.salesmanId, id)),
      db
        .select({ d: salesmanKycDocuments, byName: user.name })
        .from(salesmanKycDocuments)
        .leftJoin(user, eq(user.id, salesmanKycDocuments.createdBy))
        .where(eq(salesmanKycDocuments.salesmanId, id))
        .orderBy(desc(salesmanKycDocuments.createdAt)),
    ]);
    const names = await loadProductNames(
      db,
      rates.map((r) => r.productId),
    );
    const s = row.s;
    return {
      ...toItem(s, row.customerCount),
      address: s.address ?? null,
      defaultCreditLimit: trimDecimal(s.defaultCreditLimit),
      defaultCreditDays: s.defaultCreditDays,
      defaultGraceDays: s.defaultGraceDays,
      defaultRates: rates
        .map((r) => ({
          productId: r.productId,
          productName: names.get(r.productId)?.name ?? "",
          baseRate44: trimDecimal(r.baseRate44),
        }))
        .sort((a, b) => a.productName.localeCompare(b.productName)),
      blockedCustomerIds: blocked.map((b) => b.customerId),
      kycDocuments: docs.map(({ d, byName }) => toKycItem(d, byName)),
    };
  }

  async create(dto: CreateSalesmanDto): Promise<SalesmanDetail> {
    const companyId = actor().companyId;
    const id = await this.uow.run(async (tx) => {
      const [row] = await tx
        .insert(salesmen)
        .values({
          companyId,
          code: await nextMasterCode(tx, companyId, "salesman"),
          ...dto,
          createdBy: actor().userId,
          updatedBy: actor().userId,
        })
        .returning();
      this.changed(row!.id);
      return row!.id;
    });
    return this.get(id);
  }

  async update(id: string, dto: UpdateSalesmanDto): Promise<SalesmanDetail> {
    const { version, ...patch } = dto;
    await this.uow.run(async (tx) => {
      await updateVersioned(tx, salesmen, this.own(id), version, patch, "Salesman");
      this.changed(id);
    });
    return this.get(id);
  }

  /** Replaces the salesman's default product rates (applied to customers they onboard). */
  async setDefaultRates(id: string, dto: SalesmanDefaultRatesDto): Promise<SalesmanDetail> {
    await this.uow.run(async (tx) => {
      await this.lock(tx, id);
      const ids = [...new Set(dto.rates.map((r) => r.productId))];
      if (ids.length !== dto.rates.length) {
        throw validationError("Each product can appear only once.", [
          { path: "rates", message: "Duplicate product" },
        ]);
      }
      if (ids.length) {
        const found = await tx
          .select({ id: products.id })
          .from(products)
          .where(and(eq(products.companyId, actor().companyId), inArray(products.id, ids)));
        if (found.length !== ids.length) throw notFound("Product");
      }
      await tx.delete(salesmanDefaultRates).where(eq(salesmanDefaultRates.salesmanId, id));
      if (dto.rates.length) {
        await tx
          .insert(salesmanDefaultRates)
          .values(dto.rates.map((r) => ({ salesmanId: id, ...r })));
      }
      this.changed(id);
    });
    return this.get(id);
  }

  /** Block mode None / All / Selective (enforced on new DC/SI in Stage 3). */
  async setBlock(id: string, dto: SalesmanBlockDto): Promise<SalesmanDetail> {
    await this.uow.run(async (tx) => {
      await updateVersioned(
        tx,
        salesmen,
        this.own(id),
        dto.version,
        { blockMode: dto.blockMode },
        "Salesman",
      );
      await tx.delete(salesmanBlockedCustomers).where(eq(salesmanBlockedCustomers.salesmanId, id));
      const customerIds = dto.blockMode === "Selective" ? [...new Set(dto.customerIds)] : [];
      if (dto.blockMode === "Selective" && customerIds.length === 0) {
        throw validationError("Choose at least one customer to block.", [
          { path: "customerIds", message: "Required for selective blocking" },
        ]);
      }
      if (customerIds.length) {
        const found = await tx
          .select({ id: customers.id })
          .from(customers)
          .where(
            and(eq(customers.companyId, actor().companyId), inArray(customers.id, customerIds)),
          );
        if (found.length !== customerIds.length) throw notFound("Customer");
        await tx
          .insert(salesmanBlockedCustomers)
          .values(customerIds.map((customerId) => ({ salesmanId: id, customerId })));
      }
      this.changed(id);
    });
    return this.get(id);
  }

  // ── commission rules (Q11: % on taxable value) ───────────────────────────

  async commissionRules(id: string): Promise<CommissionRuleItem[]> {
    await this.lock(this.uow.db, id, false);
    const rows = await this.uow.db
      .select({ r: commissionRules, customerName: customers.legalName })
      .from(commissionRules)
      .innerJoin(customers, eq(customers.id, commissionRules.customerId))
      .where(eq(commissionRules.salesmanId, id))
      .orderBy(asc(customers.legalName), desc(commissionRules.validFrom));
    const today = istToday();
    return rows.map(({ r, customerName }) => ({
      id: r.id,
      salesmanId: r.salesmanId,
      customerId: r.customerId,
      customerName,
      method: r.method,
      rate: trimDecimal(r.rate),
      triggerEvent: r.triggerEvent,
      validFrom: r.validFrom,
      validTo: r.validTo,
      current: inRange(today, r.validFrom, r.validTo),
    }));
  }

  async addCommissionRule(id: string, dto: CreateCommissionRuleDto) {
    await this.uow.run(async (tx) => {
      await this.lock(tx, id);
      const [c] = await tx
        .select({ id: customers.id })
        .from(customers)
        .where(and(eq(customers.id, dto.customerId), eq(customers.companyId, actor().companyId)));
      if (!c) throw notFound("Customer");
      if (dto.method === "PERCENT_SALES" && D(dto.rate).greaterThan(100)) {
        throw validationError("A percentage can't exceed 100.", [
          { path: "rate", message: "At most 100 %" },
        ]);
      }
      await tx.insert(commissionRules).values({
        salesmanId: id,
        ...dto,
        validTo: dto.validTo ?? null,
        createdBy: actor().userId,
        updatedBy: actor().userId,
      });
      this.changed(id);
    });
    return this.commissionRules(id);
  }

  /** Rules are closed, never deleted — accruals in Stage 4 reference them. */
  async closeCommissionRule(ruleId: string, dto: CloseCommissionRuleDto) {
    const salesmanId = await this.uow.run(async (tx) => {
      const [rule] = await tx
        .select({ r: commissionRules })
        .from(commissionRules)
        .innerJoin(salesmen, eq(salesmen.id, commissionRules.salesmanId))
        .where(and(eq(commissionRules.id, ruleId), eq(salesmen.companyId, actor().companyId)));
      if (!rule) throw notFound("Commission rule");
      if (dto.validTo < rule.r.validFrom) {
        throw validationError("The end date is before the start date.", [
          { path: "validTo", message: `Must be on or after ${rule.r.validFrom}` },
        ]);
      }
      await tx
        .update(commissionRules)
        .set({
          validTo: dto.validTo,
          updatedAt: new Date(),
          updatedBy: actor().userId,
          version: sql`${commissionRules.version} + 1`,
        })
        .where(eq(commissionRules.id, ruleId));
      this.changed(rule.r.salesmanId);
      return rule.r.salesmanId;
    });
    return this.commissionRules(salesmanId);
  }

  // ── KYC documents (ADR-0023) ────────────────────────────────────────────

  async addKyc(
    id: string,
    file: { fileName: string; bytes: Buffer },
    fields: { docType: KycDocumentItem["docType"]; notes?: string },
  ): Promise<KycDocumentItem> {
    const contentType = sniffContentType(file.bytes);
    if (!contentType) {
      throw validationError("Upload a PDF, PNG or JPEG file.", [
        { path: "file", message: "Unsupported file type" },
      ]);
    }
    await this.lock(this.uow.db, id, false);
    const key = await this.storage.put(`kyc/${id}`, file.bytes, EXTENSIONS[contentType]);
    try {
      return await this.uow.run(async (tx) => {
        const [doc] = await tx
          .insert(salesmanKycDocuments)
          .values({
            salesmanId: id,
            docType: fields.docType,
            fileName: file.fileName.slice(0, 200),
            contentType,
            sizeBytes: file.bytes.length,
            storageKey: key,
            notes: fields.notes ?? null,
            createdBy: actor().userId,
          })
          .returning();
        this.changed(id);
        return toKycItem(doc!, actor().name);
      });
    } catch (error) {
      await this.storage.remove(key); // no orphan files when the insert fails
      throw error;
    }
  }

  async openKyc(
    docId: string,
  ): Promise<{ stream: Readable; size: number; fileName: string; contentType: string }> {
    const doc = await this.findKyc(this.uow.db, docId);
    const file = await this.storage.open(doc.storageKey);
    return { ...file, fileName: doc.fileName, contentType: doc.contentType };
  }

  async removeKyc(docId: string): Promise<void> {
    await this.uow.run(async (tx) => {
      const doc = await this.findKyc(tx, docId);
      await tx.delete(salesmanKycDocuments).where(eq(salesmanKycDocuments.id, docId));
      this.uow.afterCommit(() => this.storage.remove(doc.storageKey));
      this.changed(doc.salesmanId);
    });
  }

  // ── helpers ────────────────────────────────────────────────────────────

  private async findKyc(db: UnitOfWork["db"] | Tx, docId: string) {
    const [row] = await db
      .select({ d: salesmanKycDocuments })
      .from(salesmanKycDocuments)
      .innerJoin(salesmen, eq(salesmen.id, salesmanKycDocuments.salesmanId))
      .where(and(eq(salesmanKycDocuments.id, docId), eq(salesmen.companyId, actor().companyId)));
    if (!row) throw notFound("Document");
    return row.d;
  }

  /** Confirms the salesman exists in this company; inside a write, locks the row. */
  private async lock(db: UnitOfWork["db"] | Tx, id: string, forUpdate = true) {
    const query = db.select({ id: salesmen.id }).from(salesmen).where(this.own(id));
    const [row] = forUpdate ? await query.for("update") : await query;
    if (!row) throw notFound("Salesman");
  }

  private own(id: string) {
    return and(eq(salesmen.id, id), eq(salesmen.companyId, actor().companyId))!;
  }

  private changed(id: string) {
    this.bus.publishAfterCommit("salesmen.changed", { id });
  }
}

function toItem(s: typeof salesmen.$inferSelect, customerCount: number): SalesmanItem {
  return {
    id: s.id,
    code: s.code,
    name: s.name,
    phone: s.phone,
    whatsapp: s.whatsapp,
    email: s.email,
    stateCode: s.stateCode,
    targetSalesM: s.targetSalesM,
    blockMode: s.blockMode,
    customerCount,
    active: s.active,
    version: s.version,
  };
}

function toKycItem(
  d: typeof salesmanKycDocuments.$inferSelect,
  byName: string | null,
): KycDocumentItem {
  return {
    id: d.id,
    docType: d.docType as KycDocumentItem["docType"],
    fileName: d.fileName,
    contentType: d.contentType,
    sizeBytes: d.sizeBytes,
    notes: d.notes,
    uploadedAt: d.createdAt.toISOString(),
    uploadedByName: byName,
  };
}
