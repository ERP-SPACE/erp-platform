import pg from "pg";

/**
 * Creates the erp_owner / erp_app roles and hands the database to erp_owner — the same as
 * infra/docker/postgres/init/01-roles.sql, for databases not created by Docker Compose
 * (Testcontainers, CI service containers). Idempotent.
 */
export async function bootstrapRoles(
  superuserUrl: string,
  passwords: { owner: string; app: string } = { owner: "erp_owner_dev", app: "erp_app_dev" },
): Promise<void> {
  const client = new pg.Client({ connectionString: superuserUrl });
  await client.connect();
  try {
    const database = (await client.query<{ db: string }>("SELECT current_database() AS db"))
      .rows[0]!.db;
    for (const [role, password] of [
      ["erp_owner", passwords.owner],
      ["erp_app", passwords.app],
    ] as const) {
      const exists = await client.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [role]);
      if (exists.rowCount === 0) {
        await client.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password.replace(/'/g, "''")}'`);
      }
    }
    await client.query(`ALTER DATABASE "${database}" OWNER TO erp_owner`);
    await client.query(`GRANT CONNECT ON DATABASE "${database}" TO erp_app`);
    await client.query("ALTER SCHEMA public OWNER TO erp_owner");
    await client.query("GRANT USAGE ON SCHEMA public TO erp_app");
  } finally {
    await client.end();
  }
}
