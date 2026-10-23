import {
  boolean,
  char,
  check,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { audited, id } from "./columns.js";
import { companies } from "./tenancy.js";

/** Typed key/value settings; each key's shape is defined in @erp/contracts `SETTINGS`. */
export const settings = pgTable(
  "settings",
  {
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    key: text("key").notNull(),
    value: jsonb("value").notNull(),
    ...audited,
  },
  (t) => [primaryKey({ columns: [t.companyId, t.key] })],
);

export const numberedOn = pgEnum("numbered_on", ["create", "post"]);

/** Series configuration per document type (ADR-0003). */
export const documentSeries = pgTable(
  "document_series",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    entityType: text("entity_type").notNull(),
    prefixTemplate: text("prefix_template").notNull(),
    padding: integer("padding").notNull(),
    resetOnFy: boolean("reset_on_fy").notNull().default(true),
    numberedOn: numberedOn("numbered_on").notNull(),
    ...audited,
  },
  (t) => [
    uniqueIndex("document_series_company_type_uq").on(t.companyId, t.entityType),
    check("document_series_padding_ck", sql`${t.padding} BETWEEN 3 AND 8`),
  ],
);

/**
 * Counters, one row per series per financial year. Allocated with SELECT … FOR UPDATE inside
 * the posting transaction, so numbers are gapless (ADR-0003). `fy` is '0000' when the series
 * does not reset.
 */
export const documentSequences = pgTable(
  "document_sequences",
  {
    seriesId: uuid("series_id")
      .notNull()
      .references(() => documentSeries.id, { onDelete: "cascade" }),
    fy: char("fy", { length: 4 }).notNull(),
    currentSeq: integer("current_seq").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.seriesId, t.fy] }),
    check("document_sequences_seq_ck", sql`${t.currentSeq} >= 0`),
  ],
);
