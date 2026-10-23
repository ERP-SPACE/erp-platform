import { defineConfig } from "drizzle-kit";

// The audit schema (src/schema/audit.ts) is deliberately not listed: it is managed by the
// hand-written migration 0001_audit_and_grants.sql (partitioned table + triggers).
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dbCredentials: {
    url: process.env.DATABASE_OWNER_URL ?? "postgres://erp_owner:erp_owner_dev@localhost:5433/erp",
  },
  strict: true,
  verbose: true,
});
