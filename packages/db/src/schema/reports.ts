import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { audited, createdOnly, id } from "./columns.js";
import { user } from "./identity.js";
import { companies } from "./tenancy.js";

/**
 * Stage 5: saved pivots and report exports. The report data itself comes from materialized
 * views and live queries (migration 0012); nothing here duplicates a business number.
 */

export const exportFormat = pgEnum("export_format", ["csv", "xlsx", "pdf"]);
export const exportStatus = pgEnum("export_status", [
  "Queued",
  "Running",
  "Ready",
  "Failed",
  "Expired",
]);

/** A named pivot (spec as in `@erp/contracts` pivotSpec). Private unless shared with roles (Q39). */
export const savedPivots = pgTable(
  "saved_pivots",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id),
    name: text("name").notNull(),
    spec: jsonb("spec").notNull(),
    /** custom | thisMonth | lastMonth | thisQuarter | thisFy | last30 | last90 */
    range: text("range").notNull().default("custom"),
    /** Role codes that can open it; empty = only the owner. */
    sharedWithRoles: text("shared_with_roles")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    ...audited,
  },
  (t) => [
    uniqueIndex("saved_pivots_owner_name_uq").on(t.ownerId, t.name),
    index("saved_pivots_shared_idx").using("gin", t.sharedWithRoles),
  ],
);

/** One export request: built by the worker, stored through the file-storage adapter (ADR-0023). */
export const reportExports = pgTable(
  "report_exports",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    title: text("title").notNull(),
    format: exportFormat("format").notNull(),
    /** The validated export request (report id + query, or pivot spec). */
    request: jsonb("request").notNull(),
    /** Whether cost columns were allowed when it was requested (Q36). */
    includesCost: boolean("includes_cost").notNull().default(false),
    status: exportStatus("status").notNull().default("Queued"),
    storageKey: text("storage_key"),
    rowCount: integer("row_count"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    readyAt: timestamp("ready_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    ...createdOnly,
  },
  (t) => [
    index("report_exports_user_idx").on(t.userId, t.createdAt),
    index("report_exports_expiry_idx")
      .on(t.expiresAt)
      .where(sql`${t.status} = 'Ready'`),
    check(
      "report_exports_ready_ck",
      sql`${t.status} <> 'Ready' OR (${t.storageKey} IS NOT NULL AND ${t.expiresAt} IS NOT NULL)`,
    ),
  ],
);
