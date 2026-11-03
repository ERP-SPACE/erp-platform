import { STEP_UP_PERMISSIONS, SYSTEM_ROLES, expandGrants } from "@erp/contracts";
import { istToday } from "@erp/domain";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { ExportsService } from "../../src/modules/reports/exports.service.js";
import { Client, OWNER, type TestApp, json, startApp } from "./harness.js";
import { type RouteInfo, concrete, listRoutes } from "./routes.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const address = { line1: "9 Scope Street", city: "Surat", state: "Gujarat", pincode: "395003" };

/** Routes that need a signed-in user but no permission; each one filters by permission itself. */
const SIGNED_IN_ONLY = [
  "GET /api/events", // realtime topics are filtered by permission per subscriber
  "GET /api/me",
  "POST /api/identity/step-up",
  "GET /api/search", // results are filtered by the caller's permissions and customer scope
  "GET /api/dashboard/summary", // each block is computed only for callers who may see it
];
/**
 * Routes guarded by a step-up permission that deliberately do *not* ask for the password again:
 * drafts and previews; the password is asked when the money or the document actually moves.
 */
const STEP_UP_WITHOUT_FRESH = [
  "POST /api/pricing/bulk-revision/preview", // preview only; applying needs the password
  "POST /api/sales-orders/:id/hold", // putting on hold is safe; releasing needs the password
  "POST /api/customer-notes", // draft; posting needs the password
  "PATCH /api/customer-notes/:id", // draft
  "POST /api/credit/nightly-check", // runs the same rules as the 02:00 job
  "POST /api/commission/payouts", // draft batch; paying needs the password
  "POST /api/commission/payouts/:id/cancel", // cancels a draft
];
const key = (r: RouteInfo) => `${r.method} ${r.path}`;

/**
 * Stage 6 hardening: every route is behind a permission (or explicitly allow-listed), a user
 * without a permission gets 403 on every such route, no route answers without a session,
 * sensitive actions ask for the password again, and a customer-scoped user can't reach other
 * customers' records by id, list, report, pivot or export (IDOR).
 */
describe("authorisation on every route (Stage 6 hardening)", () => {
  let t: TestApp;
  let owner: Client;
  let routes: RouteInfo[];

  beforeAll(async () => {
    t = await startApp({ STEP_UP_SECONDS: "2" });
    owner = await Client.signIn(t.fastify);
    routes = listRoutes(t.app);
  });
  afterAll(() => t.close());

  it("every route is public, allow-listed or behind a permission", () => {
    expect(routes.length).toBeGreaterThan(200);
    const open = routes.filter((r) => !r.public && !r.permissions.length).map(key);
    expect(open.sort()).toEqual([...SIGNED_IN_ONLY].sort());
    expect(routes.filter((r) => r.public).map(key)).toEqual(
      expect.arrayContaining(["GET /api/healthz"]),
    );
  });

  it("every route needing a step-up permission asks for the password, except the listed drafts", () => {
    const missing = routes
      .filter((r) => r.permissions.some((p) => STEP_UP_PERMISSIONS.includes(p)) && !r.fresh)
      .map(key);
    expect(missing.sort()).toEqual([...STEP_UP_WITHOUT_FRESH].sort());
    // And each step-up permission guards at least one password-checked route. Approving a big
    // supplier payment is checked inside posting (only above the threshold, Q33).
    for (const p of STEP_UP_PERMISSIONS.filter((x) => x !== "payables.payment.approve")) {
      expect(
        routes.some((r) => r.fresh && r.permissions.includes(p)),
        p,
      ).toBe(true);
    }
  });

  it("no route answers without a session (401)", async () => {
    const failures: string[] = [];
    for (const r of routes.filter((x) => !x.public)) {
      const res = await t.fastify.inject({
        method: r.method as "GET",
        url: concrete(r.path),
        headers: { origin: "http://localhost:5173" },
        ...(r.method === "GET" || r.method === "DELETE" ? {} : { payload: {} }),
      });
      if (res.statusCode !== 401) failures.push(`${key(r)} → ${res.statusCode}`);
    }
    expect(failures).toEqual([]);
  });

  it("a user without the permission gets 403 on every route that needs it", async () => {
    await owner.request({
      method: "POST",
      url: "/api/users",
      payload: {
        name: "Floor Only",
        email: "floor.only@test.local",
        password: "Warehouse-12345",
        roleCodes: ["warehouse"],
      },
    });
    const staff = await Client.signIn(t.fastify, "floor.only@test.local", "Warehouse-12345");
    const has = new Set(expandGrants(SYSTEM_ROLES.find((r) => r.code === "warehouse")!.grants));
    const guarded = routes.filter(
      (r) => r.permissions.length && !r.permissions.every((p) => has.has(p)),
    );
    expect(guarded.length).toBeGreaterThan(120);
    const failures: string[] = [];
    for (const r of guarded) {
      const res = await staff.request({
        method: r.method as "GET",
        url: concrete(r.path),
        ...(r.method === "GET" || r.method === "DELETE" ? {} : { payload: {} }),
      });
      if (res.statusCode !== 403) failures.push(`${key(r)} → ${res.statusCode}`);
    }
    expect(failures).toEqual([]);
  });

  it("every password-checked route refuses a stale login (401 STEP_UP_REQUIRED)", async () => {
    await sleep(2_200);
    const failures: string[] = [];
    for (const r of routes.filter((x) => x.fresh)) {
      const res = await owner.request({
        method: r.method as "POST",
        url: concrete(r.path),
        ...(r.method === "GET" || r.method === "DELETE" ? {} : { payload: {} }),
      });
      const code =
        res.statusCode === 401 ? json<{ code: string }>(res).code : String(res.statusCode);
      if (code !== "STEP_UP_REQUIRED") failures.push(`${key(r)} → ${code}`);
    }
    expect(failures).toEqual([]);
  });
});

describe("a customer-scoped user can't reach other customers (IDOR)", () => {
  let t: TestApp;
  let owner: Client;
  let scoped: Client;
  let mine: string;
  let other: string;
  let otherProforma: string;
  const stamp = Date.now().toString(36).toUpperCase();

  const ok = async <T>(res: Promise<import("fastify").LightMyRequestResponse>) => {
    const r = await res;
    expect([200, 201], r.body).toContain(r.statusCode);
    return json<T>(r);
  };
  const post = (c: Client, url: string, payload: unknown) =>
    c.request({ method: "POST", url, payload: payload as Record<string, unknown> });

  beforeAll(async () => {
    t = await startApp();
    owner = await Client.signIn(t.fastify);
    await ok(
      post(owner, "/api/users", {
        name: "Scoped Manager",
        email: `scoped.${stamp.toLowerCase()}@test.local`,
        password: "Scoped-Manager-12345",
        roleCodes: ["sales_manager"],
      }),
    );
    const users = json<{ id: string; email: string }[]>(await owner.get("/api/users"));
    const userId = users.find((u) => u.email === `scoped.${stamp.toLowerCase()}@test.local`)!.id;
    const customer = (legalName: string, accountManagerUserId: string | null) =>
      ok<{ id: string }>(
        post(owner, "/api/customers", {
          legalName,
          gstType: "Unregistered",
          stateCode: "24",
          billingAddress: address,
          contacts: [],
          accountManagerUserId,
          creditPolicy: {
            creditLimit: "100000",
            creditDays: 30,
            graceDays: 15,
            autoBlock: true,
            blockRule: "BOTH",
          },
        }),
      ).then((c) => c.id);
    mine = await customer(`Scoped Mine ${stamp}`, userId);
    other = await customer(`Scoped Other ${stamp}`, null);
    // Scopes have no screen yet: set "own customers" straight in the database.
    const db = new pg.Client({ connectionString: inject("ownerDatabaseUrl") });
    await db.connect();
    try {
      await db.query(
        `INSERT INTO user_scopes (id, user_id, scope_type, scope_value) VALUES (gen_random_uuid(), $1, 'own_customers', NULL)`,
        [userId],
      );
    } finally {
      await db.end();
    }
    let products = json<{ skus: { id: string }[] }[]>(await owner.get("/api/catalogue/products"));
    if (!products.some((p) => p.skus.length)) {
      const cats = json<{ id: string; code: string }[]>(
        await owner.get("/api/catalogue/categories"),
      );
      const quals = json<{ id: string; name: string }[]>(
        await owner.get("/api/catalogue/qualities"),
      );
      await ok(
        post(owner, "/api/catalogue/products", {
          categoryId: cats.find((c) => c.code === "SUB")!.id,
          qualityId: quals.find((q) => q.name === "Economy")!.id,
          gsm: 80,
          defaultLengthM: 1000,
          widthsIn: [44],
        }),
      );
      products = json<{ skus: { id: string }[] }[]>(await owner.get("/api/catalogue/products"));
    }
    const sku = products.find((p) => p.skus.length)!.skus[0]!.id;
    otherProforma = (
      await ok<{ id: string }>(
        post(owner, "/api/proformas", {
          customerId: other,
          date: istToday(),
          lines: [{ skuId: sku, metres: 1000, ratePerM: "7.00" }],
        }),
      )
    ).id;
    scoped = await Client.signIn(
      t.fastify,
      `scoped.${stamp.toLowerCase()}@test.local`,
      "Scoped-Manager-12345",
    );
  });
  afterAll(() => t.close());

  it("by id: the other customer and their documents are not found", async () => {
    expect((await scoped.get(`/api/customers/${mine}`)).statusCode).toBe(200);
    for (const url of [
      `/api/customers/${other}`,
      `/api/customers/${other}/statement`,
      `/api/customers/${other}/credit-check`,
      `/api/customers/${other}/open-items`,
      `/api/proformas/${otherProforma}`,
      `/api/proformas/${otherProforma}/pdf?format=html`,
    ]) {
      const res = await scoped.get(url);
      expect([403, 404], `${url} → ${res.statusCode}`).toContain(res.statusCode);
    }
    // Writing against the other customer is refused too.
    const write = await post(scoped, "/api/proformas", {
      customerId: other,
      date: istToday(),
      lines: [],
    });
    expect([400, 403, 404]).toContain(write.statusCode);
    expect(write.statusCode).not.toBe(201);
  });

  it("in lists, search, reports, pivots and exports the other customer never appears", async () => {
    const names = (body: string) => body.includes(`Scoped Other ${stamp}`);
    expect(names((await scoped.get("/api/customers")).body)).toBe(false);
    expect(names((await scoped.get(`/api/search?q=Scoped`)).body)).toBe(false);
    expect(names((await scoped.get("/api/proformas")).body)).toBe(false);
    expect(names((await scoped.get("/api/reports/credit-utilisation?pageSize=500")).body)).toBe(
      false,
    );
    expect(names((await scoped.get("/api/reports/churn-risk?pageSize=500")).body)).toBe(false);
    const pv = await post(scoped, "/api/reports/pivot", {
      rows: ["customer"],
      cols: [],
      measures: ["value"],
      from: "2020-04-01",
      to: istToday(),
    });
    expect(pv.statusCode).toBe(200);
    expect(names(pv.body)).toBe(false);
    // The owner, unscoped, does see it.
    expect(names((await owner.get("/api/reports/credit-utilisation?pageSize=500")).body)).toBe(
      true,
    );

    const e = await ok<{ id: string }>(
      post(scoped, "/api/reports/exports", {
        kind: "report",
        reportId: "credit-utilisation",
        query: { pageSize: 500 },
        format: "csv",
      }),
    );
    await t.app.get(ExportsService).build(e.id);
    const csv = await scoped.get(`/api/reports/exports/${e.id}/download`);
    expect(csv.statusCode).toBe(200);
    expect(csv.body).toContain(`Scoped Mine ${stamp}`);
    expect(names(csv.body)).toBe(false);
  });

  it("another user's export or saved pivot is not reachable by id", async () => {
    const e = await ok<{ id: string }>(
      post(owner, "/api/reports/exports", {
        kind: "report",
        reportId: "sku-sales",
        query: {},
        format: "csv",
      }),
    );
    expect((await scoped.get(`/api/reports/exports/${e.id}`)).statusCode).toBe(404);
    expect((await scoped.get(`/api/reports/exports/${e.id}/download`)).statusCode).toBe(404);
    const p = await ok<{ id: string }>(
      post(owner, "/api/reports/pivots", {
        name: `Owner only ${stamp}`,
        spec: { rows: ["sku"], cols: [], measures: ["value"], from: "2026-04-01", to: istToday() },
      }),
    );
    expect((await scoped.get(`/api/reports/pivots/${p.id}`)).statusCode).toBe(404);
    expect(OWNER.email).toBeTruthy();
  });
});

describe("per-user rate limits (Stage 6 hardening)", () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await startApp();
  });
  afterAll(() => t.close());

  it("heavy actions have their own budget: the 7th Refresh now in a minute gets 429 with Retry-After", async () => {
    const owner = await Client.signIn(t.fastify);
    const email = `limits.${Date.now().toString(36)}@test.local`;
    await owner.request({
      method: "POST",
      url: "/api/users",
      payload: {
        name: "Limit Tester",
        email,
        password: "Limit-Tester-12345",
        roleCodes: ["sales_executive"],
      },
    });
    const user = await Client.signIn(t.fastify, email, "Limit-Tester-12345");
    const codes: number[] = [];
    let last: import("fastify").LightMyRequestResponse | undefined;
    for (let i = 0; i < 7; i++) {
      last = await user.request({ method: "POST", url: "/api/reports/refresh", payload: {} });
      codes.push(last.statusCode);
    }
    // A minute boundary may split the burst; at most one window resets.
    expect(codes.slice(0, 6).every((c) => c === 200)).toBe(true);
    if (codes[6] === 429) {
      expect(json<{ code: string }>(last!).code).toBe("RATE_LIMITED");
      expect(Number(last!.headers["retry-after"])).toBeGreaterThan(0);
    } else {
      expect(new Date().getSeconds()).toBeLessThan(5);
    }
    // Other users are not affected.
    expect(
      (await owner.request({ method: "POST", url: "/api/reports/refresh", payload: {} }))
        .statusCode,
    ).toBe(200);
  });
});
