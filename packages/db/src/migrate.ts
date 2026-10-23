import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { createDb } from "./client.js";

export const MIGRATIONS_FOLDER = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

/** Apply all pending migrations. Must run as erp_owner (DATABASE_OWNER_URL). */
export async function runMigrations(ownerUrl: string): Promise<void> {
  const handle = createDb(ownerUrl, { max: 1 });
  try {
    await migrate(handle.db, { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await handle.close();
  }
}

/** Drop everything owned by the app (local/dev only) so migrations can run from scratch. */
export async function dropAll(ownerUrl: string): Promise<void> {
  const client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    await client.query(`
      DROP SCHEMA IF EXISTS audit CASCADE;
      DROP SCHEMA IF EXISTS drizzle CASCADE;
      DROP SCHEMA public CASCADE;
      CREATE SCHEMA public;
      GRANT USAGE ON SCHEMA public TO erp_app;
      DROP TYPE IF EXISTS scope_type, numbered_on, notification_channel, notification_status CASCADE;
    `);
  } finally {
    await client.end();
  }
}
