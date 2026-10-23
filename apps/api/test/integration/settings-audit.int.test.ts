import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { Client, type TestApp, json, startApp } from "./harness.js";

interface SettingRow {
  key: string;
  value: unknown;
  version: number;
}

describe("settings + audit trail (stage gate)", () => {
  let t: TestApp;
  let owner: Client;

  beforeAll(async () => {
    t = await startApp();
    owner = await Client.signIn(t.fastify);
  });
  afterAll(() => t.close());

  const tolerance = async () =>
    json<SettingRow[]>(await owner.get("/api/settings")).find(
      (s) => s.key === "pricing.overrideTolerancePct",
    )!;

  it("changing a setting writes an audit row with before/after, user and reason", async () => {
    const before = await tolerance();
    const res = await owner.request({
      method: "PATCH",
      url: "/api/settings/pricing.overrideTolerancePct",
      payload: { value: 7.5, version: before.version },
      reason: "Owner widened tolerance for festive season",
    });
    expect(res.statusCode).toBe(200);
    expect(json(res)).toMatchObject({ value: 7.5, version: before.version + 1 });

    const audit = json<{ items: Record<string, unknown>[] }>(
      await owner.get("/api/audit?table=settings&rowId=pricing.overrideTolerancePct"),
    );
    const latest = audit.items[0]!;
    expect(latest).toMatchObject({
      action: "UPDATE",
      userId: inject("ownerUserId"),
      userName: "Test Owner",
      reason: "Owner widened tolerance for festive season",
      changedKeys: ["value"],
    });
    expect((latest.before as { value: unknown }).value).toBe(before.value);
    expect((latest.after as { value: unknown }).value).toBe(7.5);
  });

  it("a stale version gets 409 with who changed it", async () => {
    const current = await tolerance();
    const res = await owner.request({
      method: "PATCH",
      url: "/api/settings/pricing.overrideTolerancePct",
      payload: { value: 6, version: current.version - 1 },
    });
    expect(res.statusCode).toBe(409);
    expect(json(res)).toMatchObject({
      code: "VERSION_CONFLICT",
      current: { version: current.version },
    });
  });

  it("an invalid value is rejected with field issues", async () => {
    const current = await tolerance();
    const res = await owner.request({
      method: "PATCH",
      url: "/api/settings/pricing.overrideTolerancePct",
      payload: { value: -3, version: current.version },
    });
    expect(res.statusCode).toBe(400);
    expect(json(res)).toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("the company GSTIN must match its state code", async () => {
    const company = json<{ version: number; address: unknown }>(await owner.get("/api/company"));
    const res = await owner.request({
      method: "PATCH",
      url: "/api/company",
      payload: {
        legalName: "Test Papers Pvt Ltd",
        tradeName: null,
        gstin: "27AAPFU0939F1ZV",
        stateCode: "24",
        pan: null,
        address: { line1: "Ring Road", city: "Surat", state: "Gujarat", pincode: "395002" },
        bank: null,
        email: null,
        phone: null,
        signatoryName: null,
        version: company.version,
      },
    });
    expect(res.statusCode).toBe(400);
    expect(json<{ issues: { path: string }[] }>(res).issues.map((i) => i.path)).toContain(
      "stateCode",
    );
  });

  it("the runtime DB role cannot rewrite history", async () => {
    const client = new pg.Client({ connectionString: inject("databaseUrl") });
    await client.connect();
    try {
      await expect(client.query("UPDATE audit.audit_log SET reason = 'tampered'")).rejects.toThrow(
        /permission denied/,
      );
      await expect(client.query("DELETE FROM audit.audit_log")).rejects.toThrow(
        /permission denied/,
      );
      await expect(
        client.query("INSERT INTO audit.audit_log (table_name, action) VALUES ('x', 'INSERT')"),
      ).rejects.toThrow(/permission denied/);
      await expect(client.query("DELETE FROM posting_events")).rejects.toThrow(/permission denied/);
      await expect(client.query("UPDATE status_transitions SET reason = 'x'")).rejects.toThrow(
        /permission denied/,
      );
    } finally {
      await client.end();
    }
  });
});
