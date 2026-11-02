// Shared by db-backup.mjs and db-restore-drill.mjs: where the Postgres tools are and how to call them.
//
// Locally Postgres runs in Docker Compose and its tools are only inside the container, so by
// default every tool runs there as the `postgres` superuser. On a server with the tools
// installed, set PG_TOOLS=host (and PG_TOOLS_URL to a superuser URL) to run them directly.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

export const root = resolve(import.meta.dirname, "..", "..");
if (existsSync(resolve(root, ".env"))) process.loadEnvFile(resolve(root, ".env"));

const COMPOSE = ["compose", "-f", resolve(root, "infra/docker/docker-compose.yml")];
const onHost = process.env.PG_TOOLS === "host";

/** The application database's name, from DATABASE_OWNER_URL / DATABASE_URL. */
export function databaseName() {
  const url = process.env.DATABASE_OWNER_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_OWNER_URL is not set (.env)");
  return new URL(url).pathname.replace(/^\//, "");
}

/**
 * Runs a Postgres tool (pg_dump, pg_restore, psql) as the superuser. `stdin`/`stdout` may be
 * streams; resolves with captured stdout text when no stdout stream is given.
 */
export function pgTool(tool, args, { stdout, stdin } = {}) {
  const [cmd, argv] = onHost
    ? [tool, args.map((a, i) => (args[i - 1] === "-d" ? hostUrl(a) : a))]
    : ["docker", [...COMPOSE, "exec", "-T", "postgres", tool, "-U", "postgres", ...args]];
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, argv, { stdio: [stdin ? "pipe" : "ignore", stdout ? "pipe" : "pipe", "pipe"] });
    let out = "";
    let err = "";
    if (stdout) child.stdout.pipe(stdout);
    else child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    if (stdin) stdin.pipe(child.stdin);
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolvePromise(out) : reject(new Error(`${tool} exited ${code}: ${err.trim().slice(0, 800)}`)),
    );
  });
}

/** PG_TOOLS_URL (a superuser connection) pointed at database `db`. */
function hostUrl(db) {
  const url = process.env.PG_TOOLS_URL;
  if (!url) throw new Error("PG_TOOLS=host needs PG_TOOLS_URL (a superuser connection URL)");
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
}

/** One SQL statement through psql, rows as arrays of strings (tab-separated, no headers). */
export async function psql(db, statement) {
  const text = await pgTool("psql", ["-d", db, "-X", "-A", "-t", "-F", "\t", "-v", "ON_ERROR_STOP=1", "-c", statement]);
  return text
    .split("\n")
    .filter((l) => l.length)
    .map((l) => l.split("\t"));
}

/** Tables whose row counts the backup records and the restore drill compares. */
export const COUNTED_TABLES = [
  "companies",
  "customers",
  "suppliers",
  "skus",
  "rolls",
  "purchase_orders",
  "goods_receipts",
  "purchase_invoices",
  "sales_orders",
  "delivery_challans",
  "sales_invoices",
  "customer_notes",
  "receipts",
  "allocations",
  "commission_entries",
  "posting_events",
  "status_transitions",
  "document_sequences",
  "audit.audit_log",
];
