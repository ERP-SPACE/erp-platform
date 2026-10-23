import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, OWNER, type TestApp, json, startApp } from "./harness.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("authentication, permissions, step-up, idempotency", () => {
  let t: TestApp;
  let owner: Client;

  beforeAll(async () => {
    t = await startApp({ STEP_UP_SECONDS: "2" });
    owner = await Client.signIn(t.fastify);
  });
  afterAll(() => t.close());

  it("no session → 401 UNAUTHENTICATED; health stays public", async () => {
    const res = await t.fastify.inject({ method: "GET", url: "/api/settings" });
    expect(res.statusCode).toBe(401);
    expect(json(res)).toMatchObject({ code: "UNAUTHENTICATED" });
    expect((await t.fastify.inject({ method: "GET", url: "/api/healthz" })).statusCode).toBe(200);
  });

  it("idempotent user creation: replay returns the same result; reuse with another body → 422", async () => {
    const body = { name: "Godown Staff", email: "godown@test.local", password: "Warehouse-12345", roleCodes: ["warehouse"] };
    const first = await owner.request({ method: "POST", url: "/api/users", payload: body, idempotencyKey: "create-godown-1" });
    expect(first.statusCode).toBe(201);
    const replay = await owner.request({ method: "POST", url: "/api/users", payload: body, idempotencyKey: "create-godown-1" });
    expect(replay.statusCode).toBe(201);
    expect(replay.headers["idempotent-replay"]).toBe("true");
    expect(json(replay)).toEqual(json(first));

    const users = json<{ email: string }[]>(await owner.get("/api/users"));
    expect(users.filter((u) => u.email === body.email)).toHaveLength(1);

    const reused = await owner.request({
      method: "POST",
      url: "/api/users",
      payload: { ...body, email: "other@test.local" },
      idempotencyKey: "create-godown-1",
    });
    expect(reused.statusCode).toBe(422);
    expect(json(reused)).toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
  });

  it("a role without the permission gets 403", async () => {
    const staff = await Client.signIn(t.fastify, "godown@test.local", "Warehouse-12345");
    const res = await staff.get("/api/settings");
    expect(res.statusCode).toBe(403);
    expect(json(res)).toMatchObject({ code: "FORBIDDEN" });
  });

  it("sensitive actions need a fresh login; step-up restores access", async () => {
    await sleep(2_200); // let the 2-second test window expire
    const list = json<{ entityType: string; version: number; prefixTemplate: string }[]>(
      await owner.get("/api/document-series"),
    );
    const po = list.find((s) => s.entityType === "PO")!;
    const patch = () =>
      owner.request({
        method: "PATCH",
        url: "/api/document-series/PO",
        payload: { prefixTemplate: po.prefixTemplate, padding: 6, resetOnFy: true, version: po.version },
      });

    const stale = await patch();
    expect(stale.statusCode).toBe(401);
    expect(json(stale)).toMatchObject({ code: "STEP_UP_REQUIRED" });

    const wrong = await owner.request({ method: "POST", url: "/api/identity/step-up", payload: { password: "nope" } });
    expect(wrong.statusCode).toBe(400);

    const ok = await owner.request({ method: "POST", url: "/api/identity/step-up", payload: { password: OWNER.password } });
    expect(ok.statusCode).toBe(200);
    expect((await patch()).statusCode).toBe(200);
  });

  it("deactivated users cannot sign in", async () => {
    await owner.request({ method: "POST", url: "/api/identity/step-up", payload: { password: OWNER.password } });
    const users = json<{ id: string; email: string }[]>(await owner.get("/api/users"));
    const staff = users.find((u) => u.email === "godown@test.local")!;
    const res = await owner.request({ method: "PATCH", url: `/api/users/${staff.id}`, payload: { active: false } });
    expect(res.statusCode).toBe(200);
    await expect(Client.signIn(t.fastify, "godown@test.local", "Warehouse-12345")).rejects.toThrow(/sign-in failed/);
  });
});

describe("Owner TOTP enrolment (ADR-0021)", () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await startApp({ REQUIRE_OWNER_TOTP: "true" });
  });
  afterAll(() => t.close());

  it("blocks everything except /me until the Owner enrols TOTP", async () => {
    const owner = await Client.signIn(t.fastify);
    const me = await owner.get("/api/me");
    expect(me.statusCode).toBe(200);
    expect(json(me)).toMatchObject({ totpEnrolmentRequired: true });
    const blocked = await owner.get("/api/settings");
    expect(blocked.statusCode).toBe(403);
    expect(json(blocked)).toMatchObject({ code: "TOTP_ENROLMENT_REQUIRED" });
  });
});
