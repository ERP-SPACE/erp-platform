import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, rename } from "node:fs/promises";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { SETTINGS, type SettingKey, type SettingValue, parseSetting } from "@erp/contracts";
import { type DbHandle, idempotencyKeys, settings } from "@erp/db";
import { eq, lt, sql } from "drizzle-orm";
import type { Redis } from "ioredis";
import type { Logger } from "pino";
import type { JobName } from "../schedule.js";

export interface JobDeps {
  db: DbHandle;
  redis: Redis;
  log: Logger;
  /** Repository root (for scripts) and the file-storage root (ADR-0023). */
  paths?: { root: string; storage: string };
}

/** A setting's value (single company), its default until someone saves it. */
async function setting<K extends SettingKey>(db: DbHandle, key: K): Promise<SettingValue<K>> {
  const [row] = await db.db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, key))
    .limit(1);
  return parseSetting(key, row?.value ?? SETTINGS[key].default);
}

/** CSV cell: quoted when needed; JSON for objects. */
const csvCell = (v: unknown) => {
  if (v === null || v === undefined) return "";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const AUDIT_COLUMNS = [
  "id",
  "at",
  "table_name",
  "row_id",
  "action",
  "before",
  "after",
  "changed_keys",
  "user_id",
  "request_id",
  "reason",
  "company_id",
] as const;

type Handler = (deps: JobDeps) => Promise<Record<string, unknown>>;

export const handlers: Record<JobName, Handler> = {
  /** Lets /readyz and ops see the worker is alive. */
  async "system.heartbeat"({ redis }) {
    await redis.set("erp:worker:heartbeat", new Date().toISOString(), "EX", 180);
    return {};
  },

  /** Keeps monthly audit partitions two months ahead (migration 0001). */
  async "audit.ensure-partitions"({ db }) {
    const result = await db.db.execute<{ created: number }>(
      sql`SELECT audit.ensure_partitions(2) AS created`,
    );
    return { created: result.rows[0]?.created ?? 0 };
  },

  async "idempotency.purge-expired"({ db }) {
    const deleted = await db.db
      .delete(idempotencyKeys)
      .where(lt(idempotencyKeys.expiresAt, new Date()))
      .returning({ key: idempotencyKeys.key });
    return { deleted: deleted.length };
  },

  /**
   * Refreshes the analytics materialized views (ADR-0005). The worker connects as erp_app, which
   * can't refresh views itself; each refresh function is SECURITY DEFINER (migration 0005).
   */
  async "analytics.refresh"({ db, redis }) {
    for (const fn of ANALYTICS_REFRESH_FUNCTIONS) {
      await db.db.execute(sql.raw(`SELECT ${fn}()`));
    }
    await redis.set("erp:analytics:refreshed-at", new Date().toISOString());
    return { refreshed: ANALYTICS_REFRESH_FUNCTIONS.length };
  },

  /**
   * Nightly database backup (Stage 6): runs `scripts/db-backup.mjs` (pg_dump, manifest,
   * retention from `backup.retentionDays`). `pnpm db:restore-drill` proves a dump restores.
   */
  async "db.backup"({ db, redis, paths }) {
    if (!paths) throw new Error("db.backup needs the repository root");
    const days = await setting(db, "backup.retentionDays");
    const out = await new Promise<string>((done, fail) =>
      execFile(
        process.execPath,
        [resolve(paths.root, "scripts/db-backup.mjs")],
        {
          cwd: paths.root,
          env: { ...process.env, BACKUP_RETENTION_DAYS: String(days) },
          maxBuffer: 1 << 20,
        },
        (error, stdout, stderr) =>
          error ? fail(new Error(stderr || error.message)) : done(stdout),
      ),
    );
    const result = JSON.parse(out.trim().split("\n").at(-1)!) as Record<string, unknown>;
    await redis.set("erp:backup:last", JSON.stringify({ ...result, at: new Date().toISOString() }));
    return result;
  },

  /**
   * Audit archival (Q45): each monthly partition older than `audit.archiveAfterMonths` is
   * written to storage as gzipped CSV, then detached into the `audit_archive` schema — still
   * queryable, never deleted before the 7-year retention (CLAUDE.md rule 7).
   */
  async "audit.archive"({ db, log, paths }) {
    if (!paths) throw new Error("audit.archive needs the storage root");
    const months = await setting(db, "audit.archiveAfterMonths");
    const due = (
      await db.db.execute<{ name: string }>(
        sql`SELECT audit.partitions_to_archive(${months}) AS name`,
      )
    ).rows.map((r) => r.name);
    const dir = resolve(paths.storage, "audit-archive");
    await mkdir(dir, { recursive: true });
    const archived: { partition: string; rows: number }[] = [];
    for (const name of due) {
      if (!/^audit_log_\d{6}$/.test(name)) continue;
      // Read through the parent table (the app role's privilege), page by id.
      let rows = 0;
      const pages = async function* () {
        yield `${AUDIT_COLUMNS.join(",")}\n`;
        let after = 0n;
        for (;;) {
          const page = (
            await db.db.execute<Record<string, unknown>>(sql`
              SELECT ${sql.raw(AUDIT_COLUMNS.join(", "))} FROM audit.audit_log
              WHERE tableoid = ${`audit.${name}`}::regclass AND id > ${after.toString()}
              ORDER BY id LIMIT 5000`)
          ).rows;
          if (!page.length) return;
          rows += page.length;
          after = BigInt(String(page.at(-1)!.id));
          yield page.map((r) => AUDIT_COLUMNS.map((c) => csvCell(r[c])).join(",")).join("\n") +
            "\n";
        }
      };
      const file = resolve(dir, `${name}.csv.gz`);
      await pipeline(Readable.from(pages()), createGzip(), createWriteStream(`${file}.part`));
      await rename(`${file}.part`, file);
      await db.db.execute(sql`SELECT audit.archive_partition(${name})`);
      log.info({ partition: name, rows }, "audit partition archived");
      archived.push({ partition: name, rows });
    }
    return { archived };
  },
};

/** Stage 2: stock by SKU / batch / supplier. Stage 5 adds its own. */
export const ANALYTICS_REFRESH_FUNCTIONS: readonly string[] = [
  "public.refresh_stock_views",
  "public.refresh_report_views",
];
