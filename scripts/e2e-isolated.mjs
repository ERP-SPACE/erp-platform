#!/usr/bin/env node
/**
 * Runs the Playwright suites against an isolated stack so the dev database and servers are
 * never touched (the Stage 0 gate needs a freshly reset database and enrols the Owner's TOTP).
 *
 *   erp_e2e database (same Postgres container) → reset + seed + demo seed
 *   API on :3100 → web production build served on :5174 (proxy /api → :3100)
 *
 * Usage: pnpm test:e2e:isolated [-- <playwright args>]
 */
import { execSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const envFile = resolve(root, ".env");
if (!existsSync(envFile)) {
  console.error("Missing .env — run `pnpm setup:local` first.");
  process.exit(1);
}
process.loadEnvFile(envFile);

const DB = "erp_e2e";
const API_PORT = 3100;
const WEB_PORT = 5174;
const withDb = (url) => {
  const u = new URL(url);
  u.pathname = `/${DB}`;
  return u.toString();
};
const superuserUrl =
  process.env.DATABASE_SUPERUSER_URL ?? "postgres://postgres:postgres@localhost:5433/postgres";

const env = {
  ...process.env,
  DATABASE_URL: withDb(process.env.DATABASE_URL),
  DATABASE_OWNER_URL: withDb(process.env.DATABASE_OWNER_URL),
  DATABASE_SUPERUSER_URL: withDb(superuserUrl),
  API_PORT: String(API_PORT),
  API_PUBLIC_URL: `http://localhost:${API_PORT}`,
  WEB_ORIGIN: `http://localhost:${WEB_PORT}`,
  API_PROXY_TARGET: `http://localhost:${API_PORT}`,
  STORAGE_DIR: "../../.storage-e2e",
  REQUIRE_OWNER_TOTP: "true",
  NODE_ENV: "development",
  LOG_LEVEL: "warn",
  // Own BullMQ keys, so the dev API's IRN consumer never takes the e2e stack's jobs.
  QUEUE_PREFIX: "e2e",
  E2E_BASE_URL: `http://localhost:${WEB_PORT}`,
  E2E_API_URL: `http://localhost:${API_PORT}`,
};

const run = (cmd, extra = {}) =>
  execSync(cmd, { cwd: root, stdio: "inherit", env: { ...env, ...extra } });

const children = [];
function start(name, cmd) {
  const child = spawn(cmd, { cwd: root, env, shell: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (d) => process.env.E2E_VERBOSE && process.stdout.write(`[${name}] ${d}`));
  child.stderr.on("data", (d) => process.stderr.write(`[${name}] ${d}`));
  children.push(child);
  return child;
}
function stopAll() {
  for (const child of children) {
    if (child.exitCode !== null) continue;
    if (process.platform === "win32") {
      try {
        execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: "ignore" });
      } catch {
        /* already gone */
      }
    } else child.kill("SIGTERM");
  }
}
async function waitFor(url, label, seconds = 90) {
  for (let i = 0; i < seconds; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`${label} did not come up at ${url}`);
}

let code = 1;
try {
  // 1. Database: create once (owned by erp_owner), then reset + seed every run.
  const psql = `docker compose -f infra/docker/docker-compose.yml exec -T postgres psql -U postgres -d postgres -tAc`;
  const exists = execSync(`${psql} "SELECT 1 FROM pg_database WHERE datname='${DB}'"`, {
    cwd: root,
  })
    .toString()
    .trim();
  if (exists !== "1") run(`${psql} "CREATE DATABASE ${DB}"`);
  run("pnpm --filter @erp/db bootstrap");
  run("pnpm --filter @erp/db reset");
  run("pnpm --filter @erp/db seed:demo");

  // 2. Builds, then servers on the spare ports.
  run("pnpm --filter @erp/api build");
  run("pnpm --filter @erp/web build");
  start("api", "pnpm --filter @erp/api start");
  start("web", `pnpm --filter @erp/web exec vite preview --port ${WEB_PORT} --strictPort`);
  await waitFor(`http://localhost:${API_PORT}/api/healthz`, "API");
  await waitFor(`http://localhost:${WEB_PORT}/login`, "Web");

  // 3. Playwright against them (webServer entries are reused because the URLs answer).
  const args = process.argv.slice(2).join(" ");
  run(`pnpm --filter @erp/web exec playwright test ${args}`);
  code = 0;
} catch (error) {
  if (error?.status === undefined) console.error(error);
  code = error?.status ?? 1;
} finally {
  stopAll();
}
process.exit(code);
