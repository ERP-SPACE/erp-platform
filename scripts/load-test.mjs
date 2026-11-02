#!/usr/bin/env node
/**
 * Load test (Stage 6 hardening, Q46): 45 virtual users (3× the 15 expected) on the daily mix,
 * against a throwaway stack so the dev database is never touched:
 *
 *   erp_load database → reset, seed, demo masters, the purchase and sales demos (through the
 *   API), then rolls cloned to 50,000 (real barcodes) → API on :3200 → k6 (Docker image
 *   grafana/k6) → summary in docs/load/<date>-k6.json and a table printed here.
 *
 * Usage: pnpm load:test [-- --vus 45]
 */
import { execSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
process.loadEnvFile(resolve(root, ".env"));
const DB = "erp_load";
const PORT = 3200;
const ROLLS = 50_000;
const vusArg = process.argv.indexOf("--vus");
const VUS = vusArg > 0 ? Number(process.argv[vusArg + 1]) : 45;
/** `--quick`: a 20-second run to check the setup before the real one. */
const HOLD = process.argv.includes("--quick") ? "20s" : "3m";
const withDb = (url) => {
  const u = new URL(url);
  u.pathname = `/${DB}`;
  return u.toString();
};
const env = {
  ...process.env,
  DATABASE_URL: withDb(process.env.DATABASE_URL),
  DATABASE_OWNER_URL: withDb(process.env.DATABASE_OWNER_URL),
  DATABASE_SUPERUSER_URL: withDb(
    process.env.DATABASE_SUPERUSER_URL ?? "postgres://postgres:postgres@localhost:5433/postgres",
  ),
  API_PORT: String(PORT),
  API_PUBLIC_URL: `http://localhost:${PORT}`,
  WEB_ORIGIN: "http://localhost:5173",
  STORAGE_DIR: "../../.storage-load",
  NODE_ENV: "development",
  LOG_LEVEL: "warn",
  QUEUE_PREFIX: "load",
  REQUIRE_OWNER_TOTP: "false",
  DEMO_API_URL: `http://localhost:${PORT}`,
};
const run = (cmd) => execSync(cmd, { cwd: root, stdio: "inherit", env });
let api;
const stop = () => {
  if (!api || api.exitCode !== null) return;
  if (process.platform === "win32") {
    try {
      execSync(`taskkill /pid ${api.pid} /T /F`, { stdio: "ignore" });
    } catch {
      /* gone */
    }
  } else api.kill("SIGTERM");
};

let code = 1;
try {
  // 1. Database.
  const psql = `docker compose -f infra/docker/docker-compose.yml exec -T postgres psql -U postgres -d postgres -tAc`;
  if (
    execSync(`${psql} "SELECT 1 FROM pg_database WHERE datname='${DB}'"`, { cwd: root })
      .toString()
      .trim() !== "1"
  ) {
    run(`${psql} "CREATE DATABASE ${DB}"`);
  }
  run("pnpm --filter @erp/db bootstrap");
  run("pnpm --filter @erp/db reset");
  run("pnpm --filter @erp/db seed:demo");

  // 2. API.
  run("pnpm --filter @erp/api build");
  api = spawn("pnpm --filter @erp/api start", {
    cwd: root,
    env,
    shell: true,
    stdio: ["ignore", "ignore", "inherit"],
  });
  for (let i = 0; ; i++) {
    try {
      if ((await fetch(`http://localhost:${PORT}/api/healthz`)).ok) break;
    } catch {
      /* starting */
    }
    if (i > 90) throw new Error("API did not start");
    await new Promise((r) => setTimeout(r, 1000));
  }

  // 3. Realistic documents, then 50,000 rolls (clones of a real one, with valid barcodes).
  run("node scripts/seed-purchase-demo.mjs");
  run("node scripts/seed-sales-demo.mjs");
  const { formatRollBarcode, istToday } = await import("../packages/domain/dist/index.js");
  const pg = createRequire(resolve(root, "packages/db/package.json"))("pg");
  const db = new pg.Client({ connectionString: env.DATABASE_OWNER_URL });
  await db.connect();
  try {
    const {
      rows: [seed],
    } = await db.query("SELECT id FROM rolls WHERE status = 'Mapped' ORDER BY received_at LIMIT 1");
    const cols = (
      await db.query(
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'rolls' AND table_schema = 'public'
         AND column_name NOT IN ('id', 'barcode', 'roll_seq') AND is_generated = 'NEVER'`,
      )
    ).rows.map((r) => `"${r.column_name}"`);
    const {
      rows: [{ n }],
    } = await db.query("SELECT count(*)::int AS n FROM rolls");
    const codes = Array.from({ length: ROLLS - n }, (_, i) =>
      formatRollBarcode({
        postedAt: istToday(),
        supplierCode: "ZLD",
        batchSeq: 1 + Math.floor(i / 9999),
        rollSeq: 1 + (i % 9999),
      }),
    );
    await db.query(
      `INSERT INTO rolls (id, barcode, roll_seq, ${cols.join(", ")})
       SELECT gen_random_uuid(), c.code, 100000 + c.n, ${cols.map((c) => `r.${c}`).join(", ")}
       FROM rolls r CROSS JOIN unnest($1::text[]) WITH ORDINALITY AS c(code, n) WHERE r.id = $2`,
      [codes, seed.id],
    );
    await db.query("ANALYZE rolls");
    await db.query("SELECT public.refresh_stock_views(), public.refresh_report_views()");
    console.log(`Rolls: ${(await db.query("SELECT count(*)::int AS n FROM rolls")).rows[0].n}`);
  } finally {
    await db.end();
  }

  // 4. Five load users (sales managers); the demo admin creates them.
  const loadPassword = `Load-${randomBytes(9).toString("base64url")}`;
  const origin = "http://localhost:5173";
  const signIn = await fetch(`http://localhost:${PORT}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({
      email: process.env.DEMO_USER_EMAIL,
      password: process.env.DEMO_USER_PASSWORD,
    }),
  });
  const cookie = signIn.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  for (let i = 1; i <= 5; i++) {
    const r = await fetch(`http://localhost:${PORT}/api/users`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin,
        cookie,
        "idempotency-key": crypto.randomUUID(),
      },
      body: JSON.stringify({
        name: `Load ${i}`,
        email: `load${i}@erp.local`,
        password: loadPassword,
        roleCodes: ["sales_manager"],
      }),
    });
    if (!r.ok) throw new Error(`load user ${i}: ${r.status} ${await r.text()}`);
  }
  // Sign each load user in once here (people stay signed in all day) and hand the sessions to
  // k6. Sign-in is rate-limited per IP and everything here comes from localhost, so wait out
  // the window when it says 429.
  const sessions = [];
  for (let i = 1; i <= 5; i++) {
    let s;
    for (let attempt = 0; ; attempt++) {
      s = await fetch(`http://localhost:${PORT}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { "content-type": "application/json", origin },
        body: JSON.stringify({ email: `load${i}@erp.local`, password: loadPassword }),
      });
      if (s.status !== 429 || attempt > 3) break;
      console.log(`Sign-in limit reached; waiting a minute (load${i})`);
      await new Promise((r) => setTimeout(r, 62_000));
    }
    const c = s.headers
      .getSetCookie()
      .map((x) => x.split(";")[0])
      .join("; ");
    const me = await fetch(`http://localhost:${PORT}/api/today`, {
      headers: { origin, cookie: c },
    });
    if (!s.ok || !me.ok) {
      throw new Error(
        `load${i}: sign-in ${s.status}, /api/today ${me.status} ${(await me.text()).slice(0, 200)}`,
      );
    }
    sessions.push(c);
  }

  // 5. k6.
  const outDir = resolve(root, "docs/load");
  mkdirSync(outDir, { recursive: true });
  const day = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
  const summary = `${day}-k6.json`;
  const k6 = [
    "docker run --rm",
    `-v "${resolve(root, "infra/load")}:/scripts" -v "${outDir}:/out"`,
    `-e BASE_URL=http://host.docker.internal:${PORT} -e ORIGIN=${origin} -e VUS=${VUS} -e HOLD=${HOLD}`,
    "-e LOAD_SESSIONS",
    `grafana/k6:0.54.0 run --summary-export /out/${summary} /scripts/daily-mix.js`,
  ].join(" ");
  let k6Code = 0;
  try {
    execSync(k6, {
      cwd: root,
      stdio: "inherit",
      env: { ...env, LOAD_SESSIONS: JSON.stringify(sessions) },
    });
  } catch (e) {
    k6Code = e.status ?? 1; // thresholds crossed: still print the table
  }
  const s = JSON.parse(readFileSync(resolve(outDir, summary), "utf8"));
  const rows = Object.entries(s.metrics)
    .filter(([k]) => k.startsWith("http_req_duration{name:"))
    .map(
      ([k, m]) =>
        `${k.slice(23, -1).padEnd(8)} p95 ${m["p(95)"].toFixed(0).padStart(5)} ms   avg ${m.avg.toFixed(0).padStart(5)} ms   max ${m.max.toFixed(0).padStart(6)} ms`,
    );
  console.log(
    `\nLoad test, ${VUS} VUs (${existsSync(resolve(outDir, summary)) ? summary : "no summary"}):\n${rows.join("\n")}`,
  );
  console.log(
    `requests ${s.metrics.http_reqs.count}, ${s.metrics.http_reqs.rate.toFixed(1)}/s, failed ${(s.metrics.http_req_failed.value * 100).toFixed(2)} %`,
  );
  code = k6Code;
} catch (e) {
  console.error(e);
  code = 1;
} finally {
  stop();
}
process.exit(code);
