// Writes the OpenAPI document to packages/contracts/openapi.json without serving traffic.
// Database and Redis connections are lazy, so neither needs to be running.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildOpenApi, createApp } from "./bootstrap.js";
import { loadEnv } from "./config/env.js";

const env = loadEnv({
  DATABASE_URL: "postgres://unused:unused@localhost:5432/unused",
  REDIS_URL: "redis://localhost:6379",
  API_PUBLIC_URL: "http://localhost:3000",
  WEB_ORIGIN: "http://localhost:5173",
  AUTH_SECRET: "openapi-export-only-not-a-real-secret-000",
  ...process.env,
  LOG_LEVEL: "silent",
});
const app = await createApp(env, { logger: false });
await app.init();
const out = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "packages", "contracts", "openapi.json");
writeFileSync(out, `${JSON.stringify(buildOpenApi(app), null, 2)}\n`);
await app.close();
console.log(`OpenAPI written to ${out}`);
