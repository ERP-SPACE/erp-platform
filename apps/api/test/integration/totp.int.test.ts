import { TOTP } from "otpauth";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, OWNER, type TestApp, json, startApp } from "./harness.js";

/** Full TOTP enrolment + verify (same otpauth path as the web app / E2E gate). */
describe("TOTP enable and verify", () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await startApp({ REQUIRE_OWNER_TOTP: "true" });
  });
  afterAll(() => t.close());

  it("enable returns totpURI; verify-totp accepts a code from that URI", async () => {
    const owner = await Client.signIn(t.fastify);

    const enable = await owner.request({
      method: "POST",
      url: "/api/auth/two-factor/enable",
      payload: { password: OWNER.password },
    });
    expect(enable.statusCode, enable.body).toBe(200);
    const { totpURI } = json<{ totpURI: string }>(enable);
    expect(totpURI).toContain("otpauth://");

    const resume = await owner.request({
      method: "POST",
      url: "/api/auth/two-factor/get-totp-uri",
      payload: { password: OWNER.password },
    });
    expect(resume.statusCode, resume.body).toBe(200);
    expect(new URL(json<{ totpURI: string }>(resume).totpURI).searchParams.get("secret")).toBe(
      new URL(totpURI).searchParams.get("secret"),
    );

    const secret = new URL(totpURI).searchParams.get("secret");
    expect(secret).toBeTruthy();
    const code = new TOTP({ secret: secret!, digits: 6, period: 30 }).generate();

    const verify = await owner.request({
      method: "POST",
      url: "/api/auth/two-factor/verify-totp",
      payload: { code },
    });
    expect(verify.statusCode, verify.body).toBe(200);
  });
});
