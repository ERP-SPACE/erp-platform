import type { SupplierItem, TransporterItem } from "@erp/contracts";
import { type Tx, suppliers, transporters } from "@erp/db";
import { Injectable } from "@nestjs/common";
import { type SQL, and, asc, eq, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { actor } from "../../common/context.js";
import { notFound } from "../../common/errors.js";
import { checkGstDetails } from "../../common/gst-checks.js";
import { nextMasterCode } from "../../db/master-codes.js";
import { UnitOfWork } from "../../db/unit-of-work.js";
import { updateVersioned } from "../../db/versioning.js";
import { EventBus } from "../realtime/event-bus.js";
import type {
  CreateSupplierDto,
  CreateTransporterDto,
  MasterListQueryDto,
  UpdateSupplierDto,
  UpdateTransporterDto,
} from "./suppliers.dto.js";

/** Trigram/ILIKE filter over a concatenated search text (indexes in 0003_masters_constraints). */
export function searchFilter(text: SQL, q: string | undefined): SQL | undefined {
  if (!q) return undefined;
  return sql`${text} ILIKE ${"%" + q.replace(/[%_\\]/g, (c) => "\\" + c) + "%"}`;
}

export function activeFilter(column: PgColumn, active: "true" | "false" | "all"): SQL | undefined {
  if (active === "all") return undefined;
  return eq(column, active === "true");
}

/**
 * Candidate 3-character barcode codes from a supplier name (ADR-0007): initials first
 * ("Shree Ambika Paper" → SAP), then consonant-based variants, then a numeric suffix.
 */
export function shortCodeCandidates(name: string): string[] {
  const clean = name.toUpperCase().replace(/[^A-Z0-9 ]/g, " ");
  const words = clean.split(/\s+/).filter(Boolean);
  const letters = clean.replace(/[^A-Z0-9]/g, "");
  const out: string[] = [];
  const push = (c: string) => {
    if (/^[A-Z0-9]{3}$/.test(c) && !out.includes(c)) out.push(c);
  };
  push(words.map((w) => w[0]).join("").slice(0, 3));
  if (words.length >= 2) push(`${words[0]!.slice(0, 2)}${words[1]![0]}`);
  push(letters.slice(0, 3));
  const consonants = letters.replace(/[AEIOU]/g, "");
  push(consonants.slice(0, 3));
  const stem = (letters + "XX").slice(0, 2);
  for (let i = 1; i <= 9; i++) push(`${stem}${i}`);
  return out;
}

@Injectable()
export class SuppliersService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly bus: EventBus,
  ) {}

  // ── suppliers ──────────────────────────────────────────────────────────

  async listSuppliers(query: MasterListQueryDto): Promise<SupplierItem[]> {
    const rows = await this.uow.db
      .select()
      .from(suppliers)
      .where(
        and(
          eq(suppliers.companyId, actor().companyId),
          activeFilter(suppliers.active, query.active),
          searchFilter(
            sql`(${suppliers.name} || ' ' || ${suppliers.code} || ' ' || coalesce(${suppliers.gstin}, ''))`,
            query.q,
          ),
        ),
      )
      .orderBy(asc(suppliers.name));
    return rows.map(toSupplierItem);
  }

  async getSupplier(id: string): Promise<SupplierItem> {
    const [row] = await this.uow.db.select().from(suppliers).where(this.ownSupplier(id));
    if (!row) throw notFound("Supplier");
    return toSupplierItem(row);
  }

  async createSupplier(dto: CreateSupplierDto): Promise<SupplierItem> {
    const { pan } = checkGstDetails(dto);
    const companyId = actor().companyId;
    return this.uow.run(async (tx) => {
      const shortCode = dto.shortCode ?? (await this.freeShortCode(tx, companyId, dto.name));
      const [row] = await tx
        .insert(suppliers)
        .values({
          companyId,
          code: await nextMasterCode(tx, companyId, "supplier"),
          ...dto,
          shortCode,
          pan,
          createdBy: actor().userId,
          updatedBy: actor().userId,
        })
        .returning();
      this.bus.publishAfterCommit("suppliers.changed", { id: row!.id });
      return toSupplierItem(row!);
    });
  }

  async updateSupplier(id: string, dto: UpdateSupplierDto): Promise<SupplierItem> {
    const { pan } = checkGstDetails(dto);
    const { version, ...patch } = dto;
    return this.uow.run(async (tx) => {
      const row = await updateVersioned(
        tx,
        suppliers,
        this.ownSupplier(id),
        version,
        // An omitted shortCode is undefined and so left unchanged by Drizzle.
        { ...patch, pan },
        "Supplier",
      );
      this.bus.publishAfterCommit("suppliers.changed", { id, version: row.version });
      return toSupplierItem(row);
    });
  }

  private async freeShortCode(tx: Tx, companyId: string, name: string): Promise<string> {
    const taken = new Set(
      (
        await tx
          .select({ c: suppliers.shortCode })
          .from(suppliers)
          .where(eq(suppliers.companyId, companyId))
      ).map((r) => r.c),
    );
    const code = shortCodeCandidates(name).find((c) => !taken.has(c));
    if (!code) throw new Error("No free supplier short code — enter one manually");
    return code;
  }

  private ownSupplier(id: string) {
    return and(eq(suppliers.id, id), eq(suppliers.companyId, actor().companyId))!;
  }

  // ── transporters ───────────────────────────────────────────────────────

  async listTransporters(query: MasterListQueryDto): Promise<TransporterItem[]> {
    const rows = await this.uow.db
      .select()
      .from(transporters)
      .where(
        and(
          eq(transporters.companyId, actor().companyId),
          activeFilter(transporters.active, query.active),
          searchFilter(
            sql`(${transporters.name} || ' ' || ${transporters.code} || ' ' || coalesce(${transporters.gstin}, ''))`,
            query.q,
          ),
        ),
      )
      .orderBy(asc(transporters.name));
    return rows.map(toTransporterItem);
  }

  async createTransporter(dto: CreateTransporterDto): Promise<TransporterItem> {
    checkGstDetails(dto);
    const companyId = actor().companyId;
    return this.uow.run(async (tx) => {
      const [row] = await tx
        .insert(transporters)
        .values({
          companyId,
          code: await nextMasterCode(tx, companyId, "transporter"),
          ...dto,
          createdBy: actor().userId,
          updatedBy: actor().userId,
        })
        .returning();
      this.bus.publishAfterCommit("transporters.changed", { id: row!.id });
      return toTransporterItem(row!);
    });
  }

  async updateTransporter(id: string, dto: UpdateTransporterDto): Promise<TransporterItem> {
    checkGstDetails(dto);
    const { version, ...patch } = dto;
    return this.uow.run(async (tx) => {
      const row = await updateVersioned(
        tx,
        transporters,
        and(eq(transporters.id, id), eq(transporters.companyId, actor().companyId))!,
        version,
        patch,
        "Transporter",
      );
      this.bus.publishAfterCommit("transporters.changed", { id, version: row.version });
      return toTransporterItem(row);
    });
  }
}

function toSupplierItem(s: typeof suppliers.$inferSelect): SupplierItem {
  return {
    id: s.id,
    code: s.code,
    shortCode: s.shortCode,
    name: s.name,
    gstin: s.gstin,
    stateCode: s.stateCode,
    pan: s.pan,
    address: s.address,
    contactName: s.contactName,
    contactPhone: s.contactPhone,
    contactEmail: s.contactEmail,
    paymentDays: s.paymentDays,
    notes: s.notes,
    active: s.active,
    version: s.version,
    createdAt: s.createdAt.toISOString(),
  };
}

function toTransporterItem(t: typeof transporters.$inferSelect): TransporterItem {
  return {
    id: t.id,
    code: t.code,
    name: t.name,
    gstin: t.gstin,
    transporterId: t.transporterId,
    stateCode: t.stateCode,
    phone: t.phone,
    contactName: t.contactName,
    active: t.active,
    version: t.version,
  };
}
