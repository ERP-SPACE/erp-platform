#!/usr/bin/env node
/**
 * Restore drill (Stage 6 gate): proves the latest backup can be restored and used.
 *
 *  1. picks the newest dump in BACKUP_DIR (or `--file <name>`) and checks its SHA-256;
 *  2. restores it into a scratch database `<db>_restore_drill` (dropped first);
 *  3. checks the restored copy:
 *     - every counted table has at least the rows the manifest recorded;
 *     - the migration level matches;
 *     - the customer and supplier ledgers balance against invoice and receipt totals;
 *     - the audit log is still append-only;
 *     - the reporting views refresh and stock value agrees across views;
 *  4. prints PASS / FAIL per check, writes `<dump>.drill.json`, and drops the scratch database
 *     (`--keep` leaves it for a look).
 * Exit code 0 only when every check passes. Run: `pnpm db:restore-drill`.
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { COUNTED_TABLES, databaseName, pgTool, psql, root } from "./lib/pg-tools.mjs";

const args = process.argv.slice(2);
const keep = args.includes("--keep");
const dir = resolve(root, process.env.BACKUP_DIR ?? ".backups");
const source = databaseName();
const scratch = `${source}_restore_drill`;

const dumps = (await readdir(dir)).filter((f) => f.startsWith(`${source}-`) && f.endsWith(".dump")).sort();
const pickedName = args.includes("--file") ? args[args.indexOf("--file") + 1] : dumps.at(-1);
if (!pickedName) {
  console.error(`No backups in ${dir}. Run pnpm db:backup first.`);
  process.exit(1);
}
const dumpPath = resolve(dir, pickedName);
const manifest = JSON.parse(await readFile(dumpPath.replace(/\.dump$/, ".json"), "utf8"));

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const started = Date.now();
console.log(`Restore drill: ${pickedName} → ${scratch}`);

// 1. Integrity of the file itself.
const hash = createHash("sha256");
await pipeline(createReadStream(dumpPath), hash);
const sha = hash.digest("hex");
check("backup file checksum", sha === manifest.sha256, sha === manifest.sha256 ? undefined : "the file changed since it was written");

// 2. Restore into a fresh scratch database owned like the original.
await psql("postgres", `DROP DATABASE IF EXISTS ${scratch} WITH (FORCE)`);
const [[owner]] = await psql("postgres", `SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = '${source}'`);
await psql("postgres", `CREATE DATABASE ${scratch} OWNER ${owner}`);
const restoreStarted = Date.now();
try {
  await pgTool("pg_restore", ["-d", scratch, "--exit-on-error", "--no-password"], { stdin: createReadStream(dumpPath) });
  check("pg_restore", true, `${((Date.now() - restoreStarted) / 1000).toFixed(1)} s`);
} catch (e) {
  check("pg_restore", false, String(e.message).slice(0, 300));
}

// 3. The restored copy works.
const q = (sqlText) => psql(scratch, sqlText);
const safe = async (name, fn) => {
  try {
    await fn();
  } catch (e) {
    check(name, false, String(e.message).slice(0, 300));
  }
};

await safe("row counts", async () => {
  const short = [];
  for (const t of COUNTED_TABLES) {
    const [[n]] = await q(`SELECT count(*) FROM ${t}`);
    if (Number(n) < (manifest.counts[t] ?? 0)) short.push(`${t} ${n} < ${manifest.counts[t]}`);
  }
  check("row counts", short.length === 0, short.length ? short.join(", ") : `${COUNTED_TABLES.length} tables`);
});

await safe("migration level", async () => {
  const [[m]] = await q("SELECT max(created_at)::text FROM drizzle.__drizzle_migrations");
  check("migration level", m === manifest.migration, m);
});

await safe("customer ledger balances", async () => {
  const [[ledger, docs]] = await q(`
    SELECT
      (SELECT coalesce(sum(debit - credit), 0) FROM v_customer_ledger)::text,
      ((SELECT coalesce(sum(total), 0) FROM sales_invoices WHERE status = 'Posted')
       + (SELECT coalesce(sum(CASE kind WHEN 'DEBIT' THEN total ELSE -total END), 0) FROM customer_notes WHERE status = 'Posted')
       - (SELECT coalesce(sum(amount), 0) FROM receipts WHERE party_type = 'CUSTOMER' AND status IN ('Posted', 'Reversed'))
       + (SELECT coalesce(sum(amount), 0) FROM receipts WHERE party_type = 'CUSTOMER' AND status = 'Reversed')
       - (SELECT coalesce(sum(a.deduction), 0) FROM allocations a WHERE a.sales_invoice_id IS NOT NULL AND a.reversed_at IS NULL)
      )::text`);
  check("customer ledger balances", ledger === docs, `ledger ₹${ledger}, documents ₹${docs}`);
});

await safe("stock value agrees across views", async () => {
  await q("SELECT public.refresh_stock_views(), public.refresh_report_views()");
  const [[a, b, c]] = await q(`
    SELECT (SELECT coalesce(sum(value), 0) FROM mv_stock_by_sku)::text,
           (SELECT coalesce(sum(value), 0) FROM mv_stock_aging)::text,
           (SELECT coalesce(sum(round(current_length_m * coalesce(cost_per_m, base_cost_per_m, 0), 2)), 0)
              FROM rolls WHERE status IN ('Unmapped', 'Mapped', 'Allocated'))::text`);
  check("stock value agrees across views", a === b && b === c, `₹${c}`);
});

await safe("audit log still append-only", async () => {
  const [[grants]] = await q(`
    SELECT count(*) FROM information_schema.role_table_grants
    WHERE grantee = 'erp_app' AND table_schema = 'audit' AND privilege_type IN ('UPDATE', 'DELETE', 'TRUNCATE')`);
  check("audit log still append-only", Number(grants) === 0, Number(grants) ? `${grants} write grants for erp_app` : undefined);
});

await safe("app role can read", async () => {
  const [[ok]] = await q("SELECT has_table_privilege('erp_app', 'sales_invoices', 'SELECT')::text");
  check("app role can read", ok === "true");
});

// 4. Report and clean up.
const pass = results.every((r) => r.pass);
const report = { dump: pickedName, scratch, pass, seconds: Math.round((Date.now() - started) / 100) / 10, at: new Date().toISOString(), results };
await writeFile(dumpPath.replace(/\.dump$/, ".drill.json"), JSON.stringify(report, null, 2));
if (!keep) await psql("postgres", `DROP DATABASE IF EXISTS ${scratch} WITH (FORCE)`);
console.log(`${pass ? "PASS" : "FAIL"}: restore drill ${pass ? "succeeded" : "failed"} in ${report.seconds} s${keep ? ` (kept ${scratch})` : ""}`);
process.exit(pass ? 0 : 1);
