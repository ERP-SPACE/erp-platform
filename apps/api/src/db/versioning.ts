import type { Tx } from "@erp/db";
import { and, eq, type SQL, sql } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { ctx } from "../common/context.js";
import { notFound, versionConflict } from "../common/errors.js";

type VersionedTable = PgTable & {
  version: PgColumn;
  updatedAt: PgColumn;
  updatedBy: PgColumn;
};

/**
 * Optimistic-concurrency update (CLAUDE.md rule 6): applies `patch` only if the row still has
 * `expectedVersion`, bumping the version. Otherwise throws 404 or 409 VERSION_CONFLICT with
 * who changed it and when.
 */
export async function updateVersioned<T extends VersionedTable>(
  tx: Tx,
  table: T,
  where: SQL,
  expectedVersion: number,
  patch: Record<string, unknown>,
  what: string,
): Promise<T["$inferSelect"]> {
  const rows = (await tx
    .update(table)
    .set({
      ...patch,
      version: sql`${table.version} + 1`,
      updatedAt: new Date(),
      updatedBy: ctx().actor?.userId ?? null,
    } as never)
    .where(and(where, eq(table.version, expectedVersion)))
    .returning()) as unknown as T["$inferSelect"][];
  if (rows.length > 0) return rows[0]!;

  const current = await tx
    .select({ version: table.version, updatedBy: table.updatedBy, updatedAt: table.updatedAt })
    .from(table as PgTable)
    .where(where);
  const row = current[0] as { version: number; updatedBy: string | null; updatedAt: Date } | undefined;
  if (!row) throw notFound(what);
  throw versionConflict({
    version: row.version,
    updatedBy: row.updatedBy,
    updatedAt: row.updatedAt.toISOString(),
  });
}
