import { describe, expect, it } from "vitest";
import { loadEnv } from "../../src/config/env.js";

const valid = {
  DATABASE_URL: "postgres://erp_app:x@localhost:5433/erp",
  REDIS_URL: "redis://localhost:6380",
  API_PUBLIC_URL: "http://localhost:3000",
  WEB_ORIGIN: "http://localhost:5173",
  AUTH_SECRET: "a".repeat(32),
};

describe("loadEnv", () => {
  it("applies defaults", () => {
    const env = loadEnv(valid);
    expect(env).toMatchObject({
      API_PORT: 3000,
      STEP_UP_SECONDS: 300,
      REQUIRE_OWNER_TOTP: true,
      NODE_ENV: "development",
    });
  });

  it("parses booleans and numbers from strings", () => {
    expect(loadEnv({ ...valid, REQUIRE_OWNER_TOTP: "false", STEP_UP_SECONDS: "60" })).toMatchObject(
      {
        REQUIRE_OWNER_TOTP: false,
        STEP_UP_SECONDS: 60,
      },
    );
  });

  it("refuses to boot with a short secret or missing URLs, naming every problem", () => {
    expect(() => loadEnv({ ...valid, AUTH_SECRET: "short", DATABASE_URL: undefined })).toThrow(
      /DATABASE_URL[\s\S]*AUTH_SECRET/,
    );
  });
});
