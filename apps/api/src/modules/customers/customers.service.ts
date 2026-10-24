import type {
  CustomerDefaults,
  CustomerDetail,
  CustomerGroupItem,
  CustomerListItem,
} from "@erp/contracts";
import {
  type Tx,
  creditPolicies,
  customerContacts,
  customerGroupMembers,
  customerGroups,
  customerShippingAddresses,
  customers,
  partyRates,
  rateHistory,
  salesmanDefaultRates,
  salesmen,
  user,
} from "@erp/db";
import { istToday } from "@erp/domain";
import { Injectable } from "@nestjs/common";
import { type SQL, and, asc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { actor, ctx } from "../../common/context.js";
import { trimDecimal } from "../../common/decimal.js";
import { notFound, reasonRequired, validationError } from "../../common/errors.js";
import { checkGstDetails } from "../../common/gst-checks.js";
import { nextMasterCode } from "../../db/master-codes.js";
import { UnitOfWork } from "../../db/unit-of-work.js";
import { updateVersioned } from "../../db/versioning.js";
import { loadProductNames } from "../catalogue/catalogue.service.js";
import { EventBus } from "../realtime/event-bus.js";
import { SettingsService } from "../settings/settings.service.js";
import { activeFilter, searchFilter } from "../suppliers/suppliers.service.js";
import { type CustomerScope, customerScopeFilter, loadCustomerScope } from "./customer-scope.js";
import type {
  BlockCustomerDto,
  CreateCustomerDto,
  CustomerListQueryDto,
  UpdateCreditPolicyDto,
  UpdateCustomerDto,
} from "./customers.dto.js";

type Db = UnitOfWork["db"] | Tx;

/** Exactly one flagged item (primary contact / default address) when the list is non-empty. */
export function normaliseOne<T>(items: T[], key: keyof T): T[] {
  if (items.length === 0) return items;
  const flagged = items.findIndex((i) => Boolean(i[key]));
  const keep = flagged === -1 ? 0 : flagged;
  return items.map((item, idx) => ({ ...item, [key]: idx === keep }));
}

const SEARCH_TEXT = sql`(${customers.legalName} || ' ' || coalesce(${customers.tradeName}, '') || ' ' || ${customers.code} || ' ' || coalesce(${customers.gstin}, '') || ' ' || coalesce(${customers.phone}, ''))`;

/**
 * Customer master (PRD §5.5): profile, GST, contacts, addresses, groups, credit policy.
 * Every read and write goes through the actor's customer scope (CLAUDE.md rule 10); an
 * out-of-scope customer is reported as not found.
 */
@Injectable()
export class CustomersService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly bus: EventBus,
    private readonly settings: SettingsService,
  ) {}

  async groups(): Promise<CustomerGroupItem[]> {
    return this.uow.db
      .select({ id: customerGroups.id, code: customerGroups.code, name: customerGroups.name })
      .from(customerGroups)
      .where(eq(customerGroups.companyId, actor().companyId))
      .orderBy(asc(customerGroups.name));
  }

  async list(query: CustomerListQueryDto): Promise<CustomerListItem[]> {
    const scope = await loadCustomerScope(this.uow.db);
    const filters: (SQL | undefined)[] = [
      customerScopeFilter(scope),
      activeFilter(customers.active, query.active),
      searchFilter(SEARCH_TEXT, query.q),
    ];
    if (query.salesmanId) filters.push(eq(customers.salesmanId, query.salesmanId));
    if (query.stateCode) filters.push(eq(customers.stateCode, query.stateCode));
    if (query.blocked) filters.push(eq(creditPolicies.manualBlock, query.blocked === "true"));
    if (query.groupId) {
      filters.push(
        sql`EXISTS (SELECT 1 FROM customer_group_members m WHERE m.customer_id = ${customers.id} AND m.group_id = ${query.groupId})`,
      );
    }
    const rows = await this.uow.db
      .select({ customer: customers, policy: creditPolicies, salesmanName: salesmen.name })
      .from(customers)
      .innerJoin(creditPolicies, eq(creditPolicies.customerId, customers.id))
      .leftJoin(salesmen, eq(salesmen.id, customers.salesmanId))
      .where(and(...filters))
      .orderBy(asc(customers.legalName));
    const groups = await this.groupsFor(
      this.uow.db,
      rows.map((r) => r.customer.id),
    );
    return rows.map((r) => toListItem(r.customer, r.policy, r.salesmanName, groups));
  }

  async get(id: string): Promise<CustomerDetail> {
    const scope = await loadCustomerScope(this.uow.db);
    return this.loadDetail(this.uow.db, id, scope);
  }

  /**
   * Credit terms and rates a new customer would get (Stage 1 gate: salesman defaults pre-fill).
   * Each credit value falls back to the `credit.defaults` setting when the salesman has none.
   */
  async defaults(salesmanId: string | undefined, db: Db = this.uow.db): Promise<CustomerDefaults> {
    const base = await this.settings.value("credit.defaults");
    if (!salesmanId) {
      return { creditPolicy: base, creditSource: "settings", rates: [] };
    }
    const [s] = await db
      .select()
      .from(salesmen)
      .where(and(eq(salesmen.id, salesmanId), eq(salesmen.companyId, actor().companyId)));
    if (!s) throw notFound("Salesman");
    const hasCredit =
      s.defaultCreditLimit !== null || s.defaultCreditDays !== null || s.defaultGraceDays !== null;
    const rates = await db
      .select()
      .from(salesmanDefaultRates)
      .where(eq(salesmanDefaultRates.salesmanId, s.id));
    const names = await loadProductNames(
      db,
      rates.map((r) => r.productId),
    );
    return {
      creditPolicy: {
        ...base,
        creditLimit: trimDecimal(s.defaultCreditLimit) ?? base.creditLimit,
        creditDays: s.defaultCreditDays ?? base.creditDays,
        graceDays: s.defaultGraceDays ?? base.graceDays,
      },
      creditSource: hasCredit ? "salesman" : "settings",
      rates: rates
        .map((r) => ({
          productId: r.productId,
          productName: names.get(r.productId)?.name ?? "",
          baseRate44: trimDecimal(r.baseRate44),
        }))
        .sort((a, b) => a.productName.localeCompare(b.productName)),
    };
  }

  async create(dto: CreateCustomerDto): Promise<CustomerDetail> {
    const gst = this.checkGst(dto);
    const companyId = actor().companyId;
    const scope = await loadCustomerScope(this.uow.db);
    const id = await this.uow.run(async (tx) => {
      await this.assertReferences(tx, dto);
      const defaults = await this.defaults(dto.salesmanId ?? undefined, tx);
      const consent = dto.whatsappConsent
        ? { whatsappConsentAt: new Date(), whatsappConsentBy: `${actor().name} (office)` }
        : {};
      const [c] = await tx
        .insert(customers)
        .values({
          companyId,
          code: await nextMasterCode(tx, companyId, "customer"),
          ...customerColumns(dto, gst),
          ...consent,
          // A user limited to their own customers becomes the account manager of what they add.
          accountManagerUserId:
            dto.accountManagerUserId ??
            (!scope.unrestricted && scope.ownCustomers ? actor().userId : null),
          createdBy: actor().userId,
          updatedBy: actor().userId,
        })
        .returning();
      const customerId = c!.id;
      const policy = dto.creditPolicy ?? defaults.creditPolicy;
      await tx.insert(creditPolicies).values({
        customerId,
        ...policy,
        createdBy: actor().userId,
        updatedBy: actor().userId,
      });
      await this.replaceChildren(tx, customerId, dto);

      if (dto.salesmanId && dto.applySalesmanRates && defaults.rates.length) {
        const today = istToday();
        await tx.insert(partyRates).values(
          defaults.rates.map((r) => ({
            customerId,
            productId: r.productId,
            baseRate44: r.baseRate44,
            validFrom: today,
            source: "salesman_default" as const,
            createdBy: actor().userId,
            updatedBy: actor().userId,
          })),
        );
        await tx.insert(rateHistory).values(
          defaults.rates.map((r) => ({
            customerId,
            productId: r.productId,
            newRate44: r.baseRate44,
            validFrom: today,
            source: "salesman_default" as const,
            reason: "Salesman default rate on onboarding",
            createdBy: actor().userId,
          })),
        );
      }
      this.bus.publishAfterCommit("customers.changed", { id: customerId });
      return customerId;
    });
    return this.get(id);
  }

  async update(id: string, dto: UpdateCustomerDto): Promise<CustomerDetail> {
    const gst = this.checkGst(dto);
    const scope = await loadCustomerScope(this.uow.db);
    await this.uow.run(async (tx) => {
      const current = await this.findInScope(tx, id, scope);
      await this.assertReferences(tx, dto);
      const consent =
        dto.whatsappConsent && !current.whatsappConsent
          ? { whatsappConsentAt: new Date(), whatsappConsentBy: `${actor().name} (office)` }
          : !dto.whatsappConsent
            ? { whatsappConsentAt: null, whatsappConsentBy: null }
            : {};
      const row = await updateVersioned(
        tx,
        customers,
        eq(customers.id, id),
        dto.version,
        {
          ...customerColumns(dto, gst),
          ...consent,
          accountManagerUserId: dto.accountManagerUserId ?? current.accountManagerUserId,
          active: dto.active,
        },
        "Customer",
      );
      await tx.delete(customerContacts).where(eq(customerContacts.customerId, id));
      await tx
        .delete(customerShippingAddresses)
        .where(eq(customerShippingAddresses.customerId, id));
      await tx.delete(customerGroupMembers).where(eq(customerGroupMembers.customerId, id));
      await this.replaceChildren(tx, id, dto);
      this.bus.publishAfterCommit("customers.changed", { id, version: row.version });
    });
    return this.get(id);
  }

  /** Credit limit/days/rule change — step-up + reason at the controller (ADR-0021). */
  async updateCredit(id: string, dto: UpdateCreditPolicyDto): Promise<CustomerDetail> {
    const scope = await loadCustomerScope(this.uow.db);
    const { version, ...patch } = dto;
    await this.uow.run(async (tx) => {
      await this.findInScope(tx, id, scope);
      await updateVersioned(
        tx,
        creditPolicies,
        eq(creditPolicies.customerId, id),
        version,
        patch,
        "Credit policy",
      );
      this.bus.publishAfterCommit("customers.changed", { id });
    });
    return this.get(id);
  }

  /** Manual block / unblock (PRD §5.5). The audit reason doubles as the block reason. */
  async setBlock(id: string, dto: BlockCustomerDto): Promise<CustomerDetail> {
    const reason = ctx().reason?.trim();
    if (!reason) throw reasonRequired();
    const scope = await loadCustomerScope(this.uow.db);
    await this.uow.run(async (tx) => {
      await this.findInScope(tx, id, scope);
      await updateVersioned(
        tx,
        creditPolicies,
        eq(creditPolicies.customerId, id),
        dto.version,
        dto.blocked
          ? {
              manualBlock: true,
              blockReason: reason,
              blockedAt: new Date(),
              blockedBy: actor().userId,
            }
          : { manualBlock: false, blockReason: null, blockedAt: null, blockedBy: null },
        "Credit policy",
      );
      this.bus.publishAfterCommit("customers.changed", { id });
    });
    return this.get(id);
  }

  /** Throws 404 when the customer is missing or outside the actor's scope. */
  async findInScope(db: Db, id: string, scope: CustomerScope) {
    const [row] = await db
      .select()
      .from(customers)
      .where(and(eq(customers.id, id), customerScopeFilter(scope)));
    if (!row) throw notFound("Customer");
    return row;
  }

  // ── helpers ────────────────────────────────────────────────────────────

  private checkGst(dto: CreateCustomerDto | UpdateCustomerDto) {
    const gstin = dto.gstType === "Unregistered" ? null : (dto.gstin ?? null);
    if (dto.gstType !== "Unregistered" && !gstin) {
      throw validationError("A GSTIN is required for registered customers.", [
        { path: "gstin", message: `Required for ${dto.gstType} customers` },
      ]);
    }
    const { pan } = checkGstDetails({ stateCode: dto.stateCode, gstin, pan: dto.pan ?? null });
    return { gstin, pan };
  }

  private async assertReferences(tx: Tx, dto: CreateCustomerDto | UpdateCustomerDto) {
    const companyId = actor().companyId;
    const issues: { path: string; message: string }[] = [];
    if (dto.salesmanId) {
      const [s] = await tx
        .select({ id: salesmen.id, active: salesmen.active })
        .from(salesmen)
        .where(and(eq(salesmen.id, dto.salesmanId), eq(salesmen.companyId, companyId)));
      if (!s) issues.push({ path: "salesmanId", message: "Unknown salesman" });
    }
    if (dto.accountManagerUserId) {
      const [u] = await tx
        .select({ id: user.id })
        .from(user)
        .where(and(eq(user.id, dto.accountManagerUserId), eq(user.companyId, companyId)));
      if (!u) issues.push({ path: "accountManagerUserId", message: "Unknown user" });
    }
    if (dto.groupIds.length) {
      const found = await tx
        .select({ id: customerGroups.id })
        .from(customerGroups)
        .where(
          and(eq(customerGroups.companyId, companyId), inArray(customerGroups.id, dto.groupIds)),
        );
      if (found.length !== new Set(dto.groupIds).size) {
        issues.push({ path: "groupIds", message: "Unknown customer group" });
      }
    }
    if (issues.length) throw validationError("Some references are invalid.", issues);
  }

  private async replaceChildren(
    tx: Tx,
    customerId: string,
    dto: CreateCustomerDto | UpdateCustomerDto,
  ) {
    const by = { createdBy: actor().userId, updatedBy: actor().userId };
    const contacts = normaliseOne(dto.contacts, "isPrimary");
    if (contacts.length) {
      await tx.insert(customerContacts).values(
        contacts.map((c) => ({
          customerId,
          name: c.name,
          phone: c.phone ?? null,
          email: c.email ?? null,
          role: c.role ?? null,
          isPrimary: c.isPrimary,
          ...by,
        })),
      );
    }
    const addresses = normaliseOne(dto.shippingAddresses, "isDefault");
    if (addresses.length) {
      await tx
        .insert(customerShippingAddresses)
        .values(addresses.map((a) => ({ customerId, ...a, ...by })));
    }
    const groupIds = [...new Set(dto.groupIds)];
    if (groupIds.length) {
      await tx
        .insert(customerGroupMembers)
        .values(groupIds.map((groupId) => ({ customerId, groupId })));
    }
  }

  private async groupsFor(db: Db, ids: string[]): Promise<Map<string, CustomerGroupItem[]>> {
    const map = new Map<string, CustomerGroupItem[]>();
    if (ids.length === 0) return map;
    const rows = await db
      .select({
        customerId: customerGroupMembers.customerId,
        id: customerGroups.id,
        code: customerGroups.code,
        name: customerGroups.name,
      })
      .from(customerGroupMembers)
      .innerJoin(customerGroups, eq(customerGroups.id, customerGroupMembers.groupId))
      .where(inArray(customerGroupMembers.customerId, ids))
      .orderBy(asc(customerGroups.name));
    for (const { customerId, ...group } of rows) {
      map.set(customerId, [...(map.get(customerId) ?? []), group]);
    }
    return map;
  }

  private async loadDetail(db: Db, id: string, scope: CustomerScope): Promise<CustomerDetail> {
    const manager = alias(user, "manager");
    const blocker = alias(user, "blocker");
    const [row] = await db
      .select({
        customer: customers,
        policy: creditPolicies,
        salesmanName: salesmen.name,
        managerName: manager.name,
        blockedByName: blocker.name,
      })
      .from(customers)
      .innerJoin(creditPolicies, eq(creditPolicies.customerId, customers.id))
      .leftJoin(salesmen, eq(salesmen.id, customers.salesmanId))
      .leftJoin(manager, eq(manager.id, customers.accountManagerUserId))
      .leftJoin(blocker, eq(blocker.id, creditPolicies.blockedBy))
      .where(and(eq(customers.id, id), customerScopeFilter(scope)));
    if (!row) throw notFound("Customer");
    const [contacts, addresses, groups] = await Promise.all([
      db
        .select()
        .from(customerContacts)
        .where(eq(customerContacts.customerId, id))
        .orderBy(sql`${customerContacts.isPrimary} DESC`, asc(customerContacts.name)),
      db
        .select()
        .from(customerShippingAddresses)
        .where(eq(customerShippingAddresses.customerId, id))
        .orderBy(
          sql`${customerShippingAddresses.isDefault} DESC`,
          asc(customerShippingAddresses.label),
        ),
      this.groupsFor(db, [id]),
    ]);
    const c = row.customer;
    const p = row.policy;
    return {
      ...toListItem(c, p, row.salesmanName, groups),
      pan: c.pan,
      billingAddress: c.billingAddress,
      phone: c.phone,
      email: c.email,
      businessType: c.businessType,
      monthlyCapacityM: c.monthlyCapacityM,
      targetSalesM: c.targetSalesM,
      referral: c.referral ?? null,
      tcsApplicable: c.tcsApplicable,
      whatsappNumber: c.whatsappNumber,
      whatsappLanguage: c.whatsappLanguage,
      whatsappConsent: c.whatsappConsent,
      whatsappConsentAt: c.whatsappConsentAt?.toISOString() ?? null,
      allowCut: c.allowCut,
      accountManagerUserId: c.accountManagerUserId,
      accountManagerName: row.managerName,
      contacts: contacts.map((x) => ({
        id: x.id,
        name: x.name,
        phone: x.phone,
        email: x.email,
        role: x.role,
        isPrimary: x.isPrimary,
      })),
      shippingAddresses: addresses.map((a) => ({
        id: a.id,
        label: a.label,
        address: a.address,
        stateCode: a.stateCode,
        isDefault: a.isDefault,
      })),
      creditPolicy: {
        creditLimit: trimDecimal(p.creditLimit),
        creditDays: p.creditDays,
        graceDays: p.graceDays,
        autoBlock: p.autoBlock,
        blockRule: p.blockRule,
        manualBlock: p.manualBlock,
        blockReason: p.blockReason,
        blockedAt: p.blockedAt?.toISOString() ?? null,
        blockedByName: row.blockedByName,
        version: p.version,
      },
      version: c.version,
      updatedAt: c.updatedAt.toISOString(),
    };
  }
}

function customerColumns(
  dto: CreateCustomerDto | UpdateCustomerDto,
  gst: { gstin: string | null; pan: string | null },
) {
  return {
    legalName: dto.legalName,
    tradeName: dto.tradeName ?? null,
    gstType: dto.gstType,
    gstin: gst.gstin,
    stateCode: dto.stateCode,
    pan: gst.pan,
    billingAddress: dto.billingAddress,
    phone: dto.phone ?? null,
    email: dto.email ?? null,
    businessType: dto.businessType ?? null,
    monthlyCapacityM: dto.monthlyCapacityM ?? null,
    targetSalesM: dto.targetSalesM ?? null,
    referral: dto.referral ?? null,
    tcsApplicable: dto.tcsApplicable,
    whatsappNumber: dto.whatsappNumber ?? null,
    whatsappLanguage: dto.whatsappLanguage,
    whatsappConsent: dto.whatsappConsent,
    allowCut: dto.allowCut,
    salesmanId: dto.salesmanId ?? null,
  };
}

function toListItem(
  c: typeof customers.$inferSelect,
  p: typeof creditPolicies.$inferSelect,
  salesmanName: string | null,
  groups: Map<string, CustomerGroupItem[]>,
): CustomerListItem {
  return {
    id: c.id,
    code: c.code,
    legalName: c.legalName,
    tradeName: c.tradeName,
    gstin: c.gstin,
    gstType: c.gstType,
    stateCode: c.stateCode,
    city: c.billingAddress.city,
    groups: groups.get(c.id) ?? [],
    salesmanId: c.salesmanId,
    salesmanName,
    creditLimit: trimDecimal(p.creditLimit),
    creditDays: p.creditDays,
    // Stage 1 knows only manual blocks; exposure/overdue blocks arrive with invoices (Stage 3–4).
    blocked: p.manualBlock,
    active: c.active,
    createdAt: c.createdAt.toISOString(),
  };
}
