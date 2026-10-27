import { sql } from "drizzle-orm";
import {
  boolean,
  char,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { audited, createdOnly, id } from "./columns.js";
import { products } from "./catalogue.js";
import { customers } from "./parties.js";
import { type PostalAddress, companies } from "./tenancy.js";

export const salesmanBlockMode = pgEnum("salesman_block_mode", ["None", "All", "Selective"]);
export const commissionMethod = pgEnum("commission_method", ["PER_METER", "PERCENT_SALES"]);
export const commissionTrigger = pgEnum("commission_trigger", [
  "ON_SI_POSTED",
  "ON_PAYMENT_RECEIVED",
]);

/** Salesman / broker master (PRD §5.6). Records only — salesmen do not log in (Q10). */
export const salesmen = pgTable(
  "salesmen",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    phone: text("phone"),
    whatsapp: text("whatsapp"),
    email: text("email"),
    address: jsonb("address").$type<PostalAddress | null>(),
    stateCode: char("state_code", { length: 2 }),
    targetSalesM: integer("target_sales_m"),
    /** Blocks new DC/SI for all or selected assigned customers (enforced in Stage 3). */
    blockMode: salesmanBlockMode("block_mode").notNull().default("None"),
    defaultCreditLimit: numeric("default_credit_limit", { precision: 14, scale: 2 }),
    defaultCreditDays: integer("default_credit_days"),
    defaultGraceDays: integer("default_grace_days"),
    active: boolean("active").notNull().default(true),
    ...audited,
  },
  (t) => [uniqueIndex("salesmen_company_code_uq").on(t.companyId, t.code)],
);

/** Rates applied to customers this salesman onboards (ported from legacy agent default rates). */
export const salesmanDefaultRates = pgTable(
  "salesman_default_rates",
  {
    salesmanId: uuid("salesman_id")
      .notNull()
      .references(() => salesmen.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    baseRate44: numeric("base_rate_44", { precision: 12, scale: 4 }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.salesmanId, t.productId] }),
    check("salesman_default_rates_ck", sql`${t.baseRate44} >= 0`),
  ],
);

export const salesmanBlockedCustomers = pgTable(
  "salesman_blocked_customers",
  {
    salesmanId: uuid("salesman_id")
      .notNull()
      .references(() => salesmen.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.salesmanId, t.customerId] })],
);

export const salesmanKycDocuments = pgTable(
  "salesman_kyc_documents",
  {
    id: id(),
    salesmanId: uuid("salesman_id")
      .notNull()
      .references(() => salesmen.id, { onDelete: "cascade" }),
    docType: text("doc_type").notNull(),
    fileName: text("file_name").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    storageKey: text("storage_key").notNull().unique(),
    notes: text("notes"),
    ...createdOnly,
  },
  (t) => [index("salesman_kyc_salesman_idx").on(t.salesmanId)],
);

/**
 * Party-wise commission rules (PRD §5.6). % commission is on taxable value (Q11).
 * No overlapping validity per (salesman, customer) — EXCLUDE constraint in the SQL migration.
 */
export const commissionRules = pgTable(
  "commission_rules",
  {
    id: id(),
    salesmanId: uuid("salesman_id")
      .notNull()
      .references(() => salesmen.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    method: commissionMethod("method").notNull(),
    rate: numeric("rate", { precision: 12, scale: 4 }).notNull(),
    triggerEvent: commissionTrigger("trigger_event").notNull(),
    validFrom: date("valid_from").notNull(),
    validTo: date("valid_to"),
    ...audited,
  },
  (t) => [
    index("commission_rules_salesman_idx").on(t.salesmanId, t.customerId),
    check("commission_rules_rate_ck", sql`${t.rate} >= 0`),
    check("commission_rules_range_ck", sql`${t.validTo} IS NULL OR ${t.validTo} >= ${t.validFrom}`),
  ],
);
