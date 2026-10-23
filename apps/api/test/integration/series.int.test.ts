import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inject } from "vitest";
import { requestContext, type Actor } from "../../src/common/context.js";
import { UnitOfWork } from "../../src/db/unit-of-work.js";
import { SeriesService } from "../../src/modules/series/series.service.js";
import { Client, type TestApp, json, startApp } from "./harness.js";

describe("document numbering (ADR-0003)", () => {
  let t: TestApp;
  let series: SeriesService;
  let uow: UnitOfWork;

  const systemActor = (): Actor => ({
    userId: inject("ownerUserId"),
    name: "Owner",
    email: "owner@test.local",
    companyId: inject("companyId"),
    branchId: null,
    roles: ["owner"],
    permissions: new Set(),
    sessionId: "test",
    sessionCreatedAt: new Date(),
    twoFactorEnabled: false,
  });
  const asOwner = <T>(fn: () => Promise<T>) => requestContext.run({ requestId: "test", actor: systemActor() }, fn);

  beforeAll(async () => {
    t = await startApp();
    series = t.app.get(SeriesService);
    uow = t.app.get(UnitOfWork);
  });
  afterAll(() => t.close());

  it("previews SI/2627/00001 for a fresh FY (stage gate)", async () => {
    const owner = await Client.signIn(t.fastify);
    const res = await owner.get("/api/document-series/preview?type=SI&date=2026-10-23");
    expect(res.statusCode).toBe(200);
    expect(json(res)).toMatchObject({ nextNumber: "SI/2627/00001" });
  });

  it("50 concurrent allocations produce exactly 1..50 — no gaps, no duplicates", async () => {
    const numbers = await Promise.all(
      Array.from({ length: 50 }, () => asOwner(() => uow.run((tx) => series.allocate(tx, "PO", "2026-10-23")))),
    );
    const seqs = numbers.map((n) => Number(n.split("/").at(-1))).sort((a, b) => a - b);
    expect(seqs).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    expect(new Set(numbers).size).toBe(50);
  });

  it("a rolled-back transaction does not consume a number", async () => {
    const first = await asOwner(() => uow.run((tx) => series.allocate(tx, "SO", "2026-10-23")));
    await expect(
      asOwner(() =>
        uow.run(async (tx) => {
          await series.allocate(tx, "SO", "2026-10-23");
          throw new Error("simulated failure after allocating");
        }),
      ),
    ).rejects.toThrow("simulated failure");
    const next = await asOwner(() => uow.run((tx) => series.allocate(tx, "SO", "2026-10-23")));
    expect([first, next]).toEqual(["SO/2627/00001", "SO/2627/00002"]);
  });

  it("restarts at 1 in a new financial year", async () => {
    await asOwner(() => uow.run((tx) => series.allocate(tx, "DC", "2027-03-31")));
    const april = await asOwner(() => uow.run((tx) => series.allocate(tx, "DC", "2027-04-01")));
    expect(april).toBe("DC/2728/00001");
  });

  it("rejects a GST series that could exceed 16 characters", async () => {
    const owner = await Client.signIn(t.fastify);
    const list = json<{ entityType: string; version: number }[]>(await owner.get("/api/document-series"));
    const si = list.find((s) => s.entityType === "SI")!;
    const res = await owner.request({
      method: "PATCH",
      url: "/api/document-series/SI",
      payload: { prefixTemplate: "SALESINV/{FY_FULL}/", padding: 5, resetOnFy: true, version: si.version },
    });
    expect(res.statusCode).toBe(400);
    expect(json(res)).toMatchObject({ code: "VALIDATION_ERROR" });
  });
});
