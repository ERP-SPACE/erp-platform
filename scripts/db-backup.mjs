#!/usr/bin/env node
/**
 * Database backup (Stage 6): a custom-format pg_dump of the application database into
 * BACKUP_DIR (default `.backups/`), with a manifest beside it (size, SHA-256, row counts at
 * the time of the dump, migration level) that the restore drill checks against. Backups older
 * than the retention (`backup.retentionDays`, passed as BACKUP_RETENTION_DAYS; default 30) are
 * deleted. The worker runs this nightly; `pnpm db:backup` runs it by hand.
 * Prints one JSON line with the result. Production (Stage 7) adds RDS point-in-time recovery.
 */
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { COUNTED_TABLES, databaseName, pgTool, psql, root } from "./lib/pg-tools.mjs";

const dir = resolve(root, process.env.BACKUP_DIR ?? ".backups");
const retentionDays = Number(process.env.BACKUP_RETENTION_DAYS ?? 30);
const db = databaseName();

const stamp = new Date(Date.now() + 5.5 * 3600_000).toISOString().replace(/[-:]/g, "").slice(0, 13); // IST yyyymmddThhmm
const base = `${db}-${stamp.replace("T", "-")}`;
const file = resolve(dir, `${base}.dump`);
await mkdir(dir, { recursive: true });

// Row counts first, then the dump: the drill expects at least these counts (writes during the
// dump can only add rows).
const counts = {};
for (const t of COUNTED_TABLES) {
  const [[n]] = await psql(db, `SELECT count(*) FROM ${t}`);
  counts[t] = Number(n);
}
const [[migration]] = await psql(db, "SELECT max(created_at)::text FROM drizzle.__drizzle_migrations");

const started = Date.now();
await pgTool("pg_dump", ["-d", db, "-Fc", "--no-password"], { stdout: createWriteStream(file) });
const { size } = await stat(file);
if (size < 1024) throw new Error(`Backup ${file} is only ${size} bytes`);
const hash = createHash("sha256");
await pipeline(createReadStream(file), hash);
const manifest = {
  file: `${base}.dump`,
  database: db,
  createdAt: new Date().toISOString(),
  seconds: Math.round((Date.now() - started) / 100) / 10,
  sizeBytes: size,
  sha256: hash.digest("hex"),
  migration,
  counts,
};
await writeFile(resolve(dir, `${base}.json`), JSON.stringify(manifest, null, 2));

// Retention: delete dumps (and their manifests) older than the setting, never the newest.
const cutoff = Date.now() - retentionDays * 86_400_000;
const dumps = (await readdir(dir)).filter((f) => f.startsWith(`${db}-`) && f.endsWith(".dump")).sort();
let pruned = 0;
for (const f of dumps.slice(0, -1)) {
  const p = resolve(dir, f);
  if ((await stat(p)).mtimeMs < cutoff) {
    await rm(p, { force: true });
    await rm(p.replace(/\.dump$/, ".json"), { force: true });
    pruned += 1;
  }
}
console.log(JSON.stringify({ ok: true, file: manifest.file, sizeBytes: size, seconds: manifest.seconds, pruned }));
