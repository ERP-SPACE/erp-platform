import { sql } from "drizzle-orm";
import {
  boolean,
  char,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { audited, id } from "./columns.js";
import { user } from "./identity.js";
import { type PostalAddress, companies } from "./tenancy.js";

/* ── suppliers & transporters (PRD §5.4) ───────────────────────────────────── */

export const suppliers = pgTable(
  "suppliers",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    code: text("code").notNull(),
    /** 3-character code printed in roll barcodes (ADR-0007). */
    shortCode: char("short_code", { length: 3 }).notNull(),
    name: text("name").notNull(),
    gstin: char("gstin", { length: 15 }),
    stateCode: char("state_code", { length: 2 }).notNull(),
    pan: char("pan", { length: 10 }),
    address: jsonb("address").$type<PostalAddress>().notNull(),
    contactName: text("contact_name"),
    contactPhone: text("contact_phone"),
    contactEmail: text("contact_email"),
    paymentDays: integer("payment_days").notNull().default(30),
    notes: text("notes"),
    active: boolean("active").notNull().default(true),
    ...audited,
  },
  (t) => [
    uniqueIndex("suppliers_company_code_uq").on(t.companyId, t.code),
    uniqueIndex("suppliers_company_short_code_uq").on(t.companyId, t.shortCode),
    uniqueIndex("suppliers_company_gstin_uq")
      .on(t.companyId, t.gstin)
      .where(sql`${t.gstin} IS NOT NULL`),
  ],
);

export const transporters = pgTable(
  "transporters",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    gstin: char("gstin", { length: 15 }),
    /** Transporter ID for e-way bills when the transporter has no GSTIN (ADR-0011). */
    transporterId: text("transporter_id"),
    stateCode: char("state_code", { length: 2 }).notNull(),
    phone: text("phone"),
    contactName: text("contact_name"),
    active: boolean("active").notNull().default(true),
    ...audited,
  },
  (t) => [uniqueIndex("transporters_company_code_uq").on(t.companyId, t.code)],
);

/* ── customers (PRD §5.5, §6.7) ────────────────────────────────────────────── */

export const gstType = pgEnum("gst_type", ["Regular", "Composition", "Unregistered", "SEZ"]);
export const whatsappLanguage = pgEnum("whatsapp_language", ["English", "Hindi", "Gujarati"]);
export const blockRule = pgEnum("block_rule", ["OVER_LIMIT", "OVER_DUE", "BOTH"]);

export interface Referral {
  source?: string | null;
  name?: string | null;
  contact?: string | null;
  company?: string | null;
  remarks?: string | null;
}

export const customers = pgTable(
  "customers",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    code: text("code").notNull(),
    legalName: text("legal_name").notNull(),
    tradeName: text("trade_name"),
    gstType: gstType("gst_type").notNull().default("Regular"),
    gstin: char("gstin", { length: 15 }),
    stateCode: char("state_code", { length: 2 }).notNull(),
    pan: char("pan", { length: 10 }),
    billingAddress: jsonb("billing_address").$type<PostalAddress>().notNull(),
    phone: text("phone"),
    email: text("email"),
    businessType: text("business_type"),
    monthlyCapacityM: integer("monthly_capacity_m"),
    targetSalesM: integer("target_sales_m"),
    referral: jsonb("referral").$type<Referral | null>(),
    /** Reserved: TCS on sale of goods withdrawn from 1 Apr 2025 (ADR-0010). */
    tcsApplicable: boolean("tcs_applicable").notNull().default(false),
    whatsappNumber: text("whatsapp_number"),
    whatsappLanguage: whatsappLanguage("whatsapp_language").notNull().default("English"),
    whatsappConsent: boolean("whatsapp_consent").notNull().default(false),
    whatsappConsentAt: timestamp("whatsapp_consent_at", { withTimezone: true }),
    whatsappConsentBy: text("whatsapp_consent_by"),
    /** Customer accepts cut (part) rolls (ADR-0018). */
    allowCut: boolean("allow_cut").notNull().default(true),
    // FK to salesmen is added in the SQL migration (table defined in salesmen.ts).
    salesmanId: uuid("salesman_id"),
    accountManagerUserId: text("account_manager_user_id").references(() => user.id),
    active: boolean("active").notNull().default(true),
    ...audited,
  },
  (t) => [
    uniqueIndex("customers_company_code_uq").on(t.companyId, t.code),
    uniqueIndex("customers_company_gstin_uq")
      .on(t.companyId, t.gstin)
      .where(sql`${t.gstin} IS NOT NULL`),
    index("customers_salesman_idx").on(t.salesmanId),
    check(
      "customers_gstin_required_ck",
      sql`${t.gstType} IN ('Unregistered') OR ${t.gstin} IS NOT NULL`,
    ),
  ],
);

export const customerContacts = pgTable(
  "customer_contacts",
  {
    id: id(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    phone: text("phone"),
    email: text("email"),
    role: text("role"),
    isPrimary: boolean("is_primary").notNull().default(false),
    ...audited,
  },
  (t) => [
    index("customer_contacts_customer_idx").on(t.customerId),
    // Exactly one primary per customer (ported from legacy sanitizeContactPersons).
    uniqueIndex("customer_contacts_one_primary_uq")
      .on(t.customerId)
      .where(sql`${t.isPrimary}`),
  ],
);

export const customerShippingAddresses = pgTable(
  "customer_shipping_addresses",
  {
    id: id(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    address: jsonb("address").$type<PostalAddress>().notNull(),
    stateCode: char("state_code", { length: 2 }).notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    ...audited,
  },
  (t) => [
    index("customer_shipping_customer_idx").on(t.customerId),
    uniqueIndex("customer_shipping_one_default_uq")
      .on(t.customerId)
      .where(sql`${t.isDefault}`),
  ],
);

export const customerGroups = pgTable(
  "customer_groups",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    ...audited,
  },
  (t) => [uniqueIndex("customer_groups_company_code_uq").on(t.companyId, t.code)],
);

export const customerGroupMembers = pgTable(
  "customer_group_members",
  {
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    groupId: uuid("group_id")
      .notNull()
      .references(() => customerGroups.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.customerId, t.groupId] })],
);

/** Credit policy, 1:1 with customer (PRD §5.5, §8.5). Grace days are internal only. */
export const creditPolicies = pgTable(
  "credit_policies",
  {
    customerId: uuid("customer_id")
      .primaryKey()
      .references(() => customers.id, { onDelete: "cascade" }),
    creditLimit: numeric("credit_limit", { precision: 14, scale: 2 }).notNull(),
    creditDays: integer("credit_days").notNull(),
    graceDays: integer("grace_days").notNull(),
    autoBlock: boolean("auto_block").notNull().default(true),
    blockRule: blockRule("block_rule").notNull().default("BOTH"),
    manualBlock: boolean("manual_block").notNull().default(false),
    blockReason: text("block_reason"),
    blockedAt: timestamp("blocked_at", { withTimezone: true }),
    blockedBy: text("blocked_by"),
    ...audited,
  },
  (t) => [
    check("credit_policies_limit_ck", sql`${t.creditLimit} >= 0`),
    check("credit_policies_days_ck", sql`${t.creditDays} >= 0 AND ${t.graceDays} >= 0`),
  ],
);
