import { TOTP } from "otpauth";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, type TestApp, json, startApp } from "./harness.js";

const USER = { email: "totp.tester@test.local", password: "Totp-Tester-12345" };

/** Full TOTP enrolment + verify (same otpauth path as the web app / E2E gate). */
describe("TOTP enable and verify", () => {
  let t: TestApp;

  beforeAll(async () => {
    // A throwaway user: enrolling the shared seed Owner would break later files that sign in
    // as the Owner without a TOTP code (integration files share one database). The Owner can
    // only create users while TOTP isn't required, so that happens on a separate instance.
    const setup = await startApp();
    const admin = await Client.signIn(setup.fastify);
    const created = await admin.request({
      method: "POST",
      url: "/api/users",
      payload: {
        name: "TOTP Tester",
        email: USER.email,
        password: USER.password,
        roleCodes: ["admin"],
      },
    });
    await setup.close();
    if (created.statusCode !== 201) throw new Error(`user setup failed: ${created.body}`);
    t = await startApp({ REQUIRE_OWNER_TOTP: "true" });
  });
  afterAll(() => t.close());

  it("enable returns totpURI; verify-totp accepts a code from that URI", async () => {
    const owner = await Client.signIn(t.fastify, USER.email, USER.password);

    const enable = await owner.request({
      method: "POST",
      url: "/api/auth/two-factor/enable",
      payload: { password: USER.password },
    });
    expect(enable.statusCode, enable.body).toBe(200);
    const { totpURI } = json<{ totpURI: string }>(enable);
    expect(totpURI).toContain("otpauth://");

    const resume = await owner.request({
      method: "POST",
      url: "/api/auth/two-factor/get-totp-uri",
      payload: { password: USER.password },
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
