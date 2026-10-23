import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  numeric,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { audited, id } from "./columns.js";
import { companies } from "./tenancy.js";

/**
 * Catalogue (PRD §5.1, §6.1): Category → Quality → GSM → Width.
 * A product is (category, quality, GSM); a SKU is a product at one width.
 * HSN and GST rate live on the category and may be blank until entered (Q9) — the category
 * is then "not tax-ready" and cannot be invoiced (enforced in Stage 3).
 */
export const categories = pgTable(
  "categories",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    hsnCode: text("hsn_code"),
    gstRate: numeric("gst_rate", { precision: 5, scale: 2 }),
    active: boolean("active").notNull().default(true),
    ...audited,
  },
  (t) => [
    uniqueIndex("categories_company_code_uq").on(t.companyId, t.code),
    check("categories_hsn_ck", sql`${t.hsnCode} IS NULL OR ${t.hsnCode} ~ '^[0-9]{4}([0-9]{2}){0,2}$'`),
  ],
);

export const qualities = pgTable(
  "qualities",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    name: text("name").notNull(),
    aliases: text("aliases").array().notNull().default(sql`'{}'::text[]`),
    active: boolean("active").notNull().default(true),
    ...audited,
  },
  (t) => [uniqueIndex("qualities_company_name_uq").on(t.companyId, sql`lower(${t.name})`)],
);

export const products = pgTable(
  "products",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id),
    qualityId: uuid("quality_id")
      .notNull()
      .references(() => qualities.id),
    gsm: integer("gsm").notNull(),
    defaultLengthM: integer("default_length_m").notNull().default(1000),
    active: boolean("active").notNull().default(true),
    ...audited,
  },
  (t) => [
    uniqueIndex("products_unique_triple_uq").on(t.categoryId, t.qualityId, t.gsm),
    check("products_gsm_ck", sql`${t.gsm} > 0`),
    check("products_length_ck", sql`${t.defaultLengthM} > 0`),
  ],
);

export const skus = pgTable(
  "skus",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    widthIn: numeric("width_in", { precision: 5, scale: 2 }).notNull(),
    taxRateOverride: numeric("tax_rate_override", { precision: 5, scale: 2 }),
    active: boolean("active").notNull().default(true),
    ...audited,
  },
  (t) => [
    uniqueIndex("skus_product_width_uq").on(t.productId, t.widthIn),
    uniqueIndex("skus_company_code_uq").on(t.companyId, t.code),
    index("skus_product_idx").on(t.productId),
    check("skus_width_ck", sql`${t.widthIn} > 0`),
  ],
);
