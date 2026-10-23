import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema/index.js";
import { auditLog } from "./schema/audit.js";

export const fullSchema = { ...schema, auditLog };
export type Db = NodePgDatabase<typeof fullSchema>;
/** A Drizzle transaction handle — what repositories receive inside a UnitOfWork. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

// Postgres `numeric` and `date` stay strings (no float or timezone conversion — ADR-0002).
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => v);
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));

export interface DbHandle {
  pool: pg.Pool;
  db: Db;
  close(): Promise<void>;
}

export function createDb(connectionString: string, options: { max?: number } = {}): DbHandle {
  const pool = new pg.Pool({
    connectionString,
    max: options.max ?? 10,
    idleTimeoutMillis: 30_000,
    application_name: "erp",
  });
  const db = drizzle(pool, { schema: fullSchema, casing: "snake_case" });
  return { pool, db, close: () => pool.end() };
}
