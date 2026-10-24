import { gstinCheckChar } from "@erp/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, type TestApp, json, startApp } from "./harness.js";

const gstin = (state: string, pan: string) => {
  const first14 = `${state}${pan}1Z`;
  return first14 + gstinCheckChar(first14);
};
const address = { line1: "12 Ring Road", city: "Surat", state: "Gujarat", pincode: "395002" };

interface Category {
  id: string;
  code: string;
  name: string;
  hsnCode: string | null;
  gstRate: string | null;
  taxReady: boolean;
  version: number;
}
interface Product {
  id: string;
  name: string;
  skus: { id: string; code: string; widthIn: string; version: number }[];
}

describe("catalogue (PRD §5.1)", () => {
  let t: TestApp;
  let owner: Client;
  let sub: Category;
  let premiumId: string;

  beforeAll(async () => {
    t = await startApp();
    owner = await Client.signIn(t.fastify);
    const catsRes = await owner.get("/api/catalogue/categories");
    if (catsRes.statusCode !== 200) throw new Error(catsRes.body);
    const cats = json<Category[]>(catsRes);
    sub = cats.find((c) => c.code === "SUB")!;
    const quals = json<{ id: string; name: string }[]>(await owner.get("/api/catalogue/qualities"));
    premiumId = quals.find((q) => q.name === "Premium")!.id;
  });
  afterAll(() => t.close());

  it("seeded categories start without HSN/GST and are flagged not tax-ready (Q9)", () => {
    expect(sub).toMatchObject({ hsnCode: null, gstRate: null, taxReady: false });
  });

  it("entering HSN + GST makes a category tax-ready; a stale version → 409", async () => {
    const payload = { name: sub.name, hsnCode: "48099000", gstRate: "18", active: true };
    const res = await owner.request({
      method: "PATCH",
      url: `/api/catalogue/categories/${sub.id}`,
      payload: { ...payload, version: sub.version },
    });
    expect(res.statusCode).toBe(200);
    expect(json(res)).toMatchObject({ hsnCode: "48099000", gstRate: "18", taxReady: true });

    const stale = await owner.request({
      method: "PATCH",
      url: `/api/catalogue/categories/${sub.id}`,
      payload: { ...payload, version: sub.version },
    });
    expect(stale.statusCode).toBe(409);
    expect(json(stale)).toMatchObject({ code: "VERSION_CONFLICT" });
  });

  it("rejects an HSN that is not 4, 6 or 8 digits", async () => {
    const res = await owner.request({
      method: "PATCH",
      url: `/api/catalogue/categories/${sub.id}`,
      payload: { name: sub.name, hsnCode: "48099", gstRate: "18", active: true, version: 2 },
    });
    expect(res.statusCode).toBe(400);
  });

  let product: Product;

  it("creates a product with SKUs at allowed widths and generated codes", async () => {
    const res = await owner.request({
      method: "POST",
      url: "/api/catalogue/products",
      payload: { categoryId: sub.id, qualityId: premiumId, gsm: 45, defaultLengthM: 1000, widthsIn: [44, 36] },
    });
    expect(res.statusCode).toBe(201);
    product = json<Product>(res);
    expect(product.name).toBe("Sublimation Paper Premium 45 GSM");
    expect(product.skus.map((s) => [s.widthIn, s.code])).toEqual([
      ["36", "SUB-PRE-045-36"],
      ["44", "SUB-PRE-045-44"],
    ]);
  });

  it("refuses GSM, length or width outside the catalogue settings", async () => {
    const res = await owner.request({
      method: "POST",
      url: "/api/catalogue/products",
      payload: { categoryId: sub.id, qualityId: premiumId, gsm: 47, defaultLengthM: 1200, widthsIn: [50] },
    });
    expect(res.statusCode).toBe(400);
    const paths = json<{ issues: { path: string }[] }>(res).issues.map((i) => i.path);
    expect(paths).toEqual(["gsm", "defaultLengthM", "widthsIn"]);
  });

  it("a duplicate product or SKU width is a 409 DUPLICATE with a field issue", async () => {
    const dupProduct = await owner.request({
      method: "POST",
      url: "/api/catalogue/products",
      payload: { categoryId: sub.id, qualityId: premiumId, gsm: 45, defaultLengthM: 1000 },
    });
    expect(dupProduct.statusCode).toBe(409);
    expect(json(dupProduct)).toMatchObject({ code: "DUPLICATE", issues: [{ path: "gsm" }] });

    const dupSku = await owner.request({
      method: "POST",
      url: `/api/catalogue/products/${product.id}/skus`,
      payload: { widthsIn: [44] },
    });
    expect(dupSku.statusCode).toBe(409);
    expect(json(dupSku)).toMatchObject({ code: "DUPLICATE", issues: [{ path: "widthsIn" }] });

    const added = await owner.request({
      method: "POST",
      url: `/api/catalogue/products/${product.id}/skus`,
      payload: { widthsIn: [63, 24] },
    });
    expect(json<Product>(added).skus.map((s) => s.widthIn)).toEqual(["24", "36", "44", "63"]);
  });

  it("every catalogue change is audited", async () => {
    const res = await owner.get(`/api/audit?table=products&rowId=${product.id}`);
    expect(json<{ items: unknown[] }>(res).items.length).toBeGreaterThan(0);
  });
});

describe("suppliers & transporters (PRD §5.4)", () => {
  let t: TestApp;
  let owner: Client;

  beforeAll(async () => {
    t = await startApp();
    owner = await Client.signIn(t.fastify);
  });
  afterAll(() => t.close());

  const supplier = (overrides: Record<string, unknown> = {}) => ({
    name: "Shree Ambika Paper Mills",
    stateCode: "24",
    gstin: gstin("24", "AAACS1234K"),
    address,
    ...overrides,
  });

  it("allocates SUP-0001…, derives PAN and a unique barcode short code", async () => {
    const first = json(await owner.request({ method: "POST", url: "/api/suppliers", payload: supplier() }));
    expect(first).toMatchObject({ code: "SUP-0001", shortCode: "SAP", pan: "AAACS1234K" });

    const second = json(
      await owner.request({
        method: "POST",
        url: "/api/suppliers",
        payload: supplier({ name: "Shree Ambika Papers", gstin: null }),
      }),
    );
    expect(second).toMatchObject({ code: "SUP-0002" });
    expect(second.shortCode).not.toBe("SAP");
  });

  it("an explicit short code already in use → 409 on shortCode", async () => {
    const res = await owner.request({
      method: "POST",
      url: "/api/suppliers",
      payload: supplier({ name: "Another Mill", gstin: null, shortCode: "sap" }),
    });
    expect(res.statusCode).toBe(409);
    expect(json(res)).toMatchObject({ code: "DUPLICATE", issues: [{ path: "shortCode" }] });
  });

  it("GSTIN from another state is rejected on stateCode", async () => {
    const res = await owner.request({
      method: "POST",
      url: "/api/suppliers",
      payload: supplier({ name: "Mumbai Mill", gstin: gstin("27", "AAACM9876Q") }),
    });
    expect(res.statusCode).toBe(400);
    expect(json(res)).toMatchObject({ issues: [{ path: "stateCode" }] });
  });

  it("search finds by name or code; inactive suppliers hide by default", async () => {
    const list = json<{ id: string; code: string; version: number; name: string }[]>(
      await owner.get("/api/suppliers?q=ambika"),
    );
    expect(list).toHaveLength(2);
    const target = list[1]!;
    const full = json<Record<string, unknown>>(await owner.get(`/api/suppliers/${target.id}`));
    const res = await owner.request({
      method: "PATCH",
      url: `/api/suppliers/${target.id}`,
      payload: {
        name: full.name,
        stateCode: full.stateCode,
        address: full.address,
        paymentDays: 45,
        active: false,
        version: target.version,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(json<unknown[]>(await owner.get("/api/suppliers?q=ambika"))).toHaveLength(1);
    expect(json<unknown[]>(await owner.get("/api/suppliers?q=ambika&active=all"))).toHaveLength(2);
  });

  it("transporters get TRN-001 and accept a transporter ID without GSTIN", async () => {
    const res = await owner.request({
      method: "POST",
      url: "/api/transporters",
      payload: { name: "Patel Roadways", stateCode: "24", transporterId: "24ABCDE1234F1Z5" },
    });
    expect(res.statusCode).toBe(201);
    expect(json(res)).toMatchObject({ code: "TRN-001", gstin: null });
  });

  it("warehouse staff can view the catalogue but not edit suppliers", async () => {
    await owner.request({
      method: "POST",
      url: "/api/users",
      payload: {
        name: "Floor Staff",
        email: "floor@test.local",
        password: "Warehouse-12345",
        roleCodes: ["warehouse"],
      },
    });
    const staff = await Client.signIn(t.fastify, "floor@test.local", "Warehouse-12345");
    expect((await staff.get("/api/catalogue/products")).statusCode).toBe(200);
    expect((await staff.get("/api/suppliers")).statusCode).toBe(403);
    const res = await staff.request({ method: "POST", url: "/api/suppliers", payload: supplier() });
    expect(res.statusCode).toBe(403);
  });
});
