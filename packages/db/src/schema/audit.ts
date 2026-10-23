import { bigint, jsonb, pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Read model for the audit log. The table itself (monthly partitions, trigger function, grants)
 * is created by the hand-written migration `0001_audit_and_grants.sql`, because drizzle-kit
 * cannot express partitioning. This declaration is excluded from drizzle-kit (see drizzle.config.ts).
 */
export const auditSchema = pgSchema("audit");

export const auditLog = auditSchema.table("audit_log", {
  id: bigint("id", { mode: "number" }).notNull(),
  at: timestamp("at", { withTimezone: true }).notNull(),
  tableName: text("table_name").notNull(),
  rowId: text("row_id"),
  action: text("action").$type<"INSERT" | "UPDATE" | "DELETE">().notNull(),
  before: jsonb("before").$type<Record<string, unknown> | null>(),
  after: jsonb("after").$type<Record<string, unknown> | null>(),
  changedKeys: text("changed_keys").array(),
  userId: text("user_id"),
  requestId: text("request_id"),
  reason: text("reason"),
  companyId: uuid("company_id"),
});
