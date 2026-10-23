import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";

// Local runs read the seed Owner credentials from the repo's .env (pnpm setup:local).
const envFile = resolve(import.meta.dirname, "../../.env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

/**
 * Two projects:
 *  - public: pages that need no API (/_design, /login) — accessibility checks in both themes.
 *  - gate:   the Stage 0 gate flow against a real API + freshly reset database
 *            (`pnpm db:reset` first; it enrols TOTP for the seed Owner).
 * E2E_PUBLIC_ONLY=1 starts just the web server, for machines without Docker.
 */
const publicOnly = process.env.E2E_PUBLIC_ONLY === "1";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
    timezoneId: "Asia/Kolkata",
    locale: "en-IN",
  },
  projects: [
    { name: "public", testMatch: /.*\.public\.spec\.ts/, use: { ...devices["Desktop Chrome"] } },
    ...(publicOnly
      ? []
      : [{ name: "gate", testMatch: /.*\.gate\.spec\.ts/, use: { ...devices["Desktop Chrome"] } }]),
  ],
  webServer: [
    ...(publicOnly
      ? []
      : [
          {
            command: "pnpm --filter @erp/api start",
            url: "http://localhost:3000/api/healthz",
            reuseExistingServer: !process.env.CI,
            env: { REQUIRE_OWNER_TOTP: "true" },
            timeout: 60_000,
          },
        ]),
    {
      // The production build, not the dev server: no on-demand compilation during the first test.
      command: "pnpm --filter @erp/web build && pnpm --filter @erp/web preview",
      url: "http://localhost:5173/login",
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
});
