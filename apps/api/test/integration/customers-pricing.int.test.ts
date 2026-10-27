import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, userScopes } from "@erp/db";
import { gstinCheckChar, istToday } from "@erp/domain";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { addDays } from "../../src/common/dates.js";
import { Client, type TestApp, json, startApp } from "./harness.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const gstin = (state: string, pan: string) => {
  const first14 = `${state}${pan}1Z`;
  return first14 + gstinCheckChar(first14);
};
const address = { line1: "4 Textile Market", city: "Surat", state: "Gujarat", pincode: "395003" };

interface Detail {
  id: string;
  code: string;
  version: number;
  salesmanName: string | null;
  contacts: { name: string; isPrimary: boolean }[];
  creditPolicy: {
    creditLimit: string;
    creditDays: number;
    graceDays: number;
    manualBlock: boolean;
    blockReason: string | null;
    version: number;
  };
}
interface Rate {
  id: string;
  productId: string;
  baseRate44: string;
  validFrom: string;
  validTo: string | null;
  source: string;
  current: boolean;
}

describe("customers, rates and salesmen (Stage 1 gate)", () => {
  let t: TestApp;
  let owner: Client;
  let storageDir: string;
  let productA: string;
  let productB: string;
  let salesmanId: string;
  let customer: Detail;
  const today = istToday();

  const newCustomer = (overrides: Record<string, unknown> = {}) => ({
    legalName: "Shiv Prints Pvt Ltd",
    gstType: "Regular",
    gstin: gstin("24", "AAACS4321P"),
    stateCode: "24",
    billingAddress: address,
    contacts: [],
    ...overrides,
  });

  beforeAll(async () => {
    storageDir = await mkdtemp(join(tmpdir(), "erp-storage-"));
    t = await startApp({ STORAGE_DIR: storageDir, UPLOAD_MAX_BYTES: "2048" });
    owner = await Client.signIn(t.fastify);
    const cats = json<{ id: string; code: string }[]>(await owner.get("/api/catalogue/categories"));
    const quals = json<{ id: string; name: string }[]>(await owner.get("/api/catalogue/qualities"));
    const make = async (gsm: number) =>
      json<{ id: string }>(
        await owner.request({
          method: "POST",
          url: "/api/catalogue/products",
          payload: {
            categoryId: cats.find((c) => c.code === "BTR")!.id,
            qualityId: quals.find((q) => q.name === "Standard")!.id,
            gsm,
            defaultLengthM: 1000,
            widthsIn: [44],
          },
        }),
      ).id;
    productA = await make(55);
    productB = await make(65);
  });
  afterAll(async () => {
    await t.close();
    await rm(storageDir, { recursive: true, force: true });
  });

  it("creates a salesman SLS-0001 with default credit terms and product rates", async () => {
    const res = await owner.request({
      method: "POST",
      url: "/api/salesmen",
      payload: { name: "Vipul Desai", defaultCreditLimit: "250000", defaultCreditDays: 45 },
    });
    expect(res.statusCode).toBe(201);
    const s = json<{ id: string; code: string }>(res);
    expect(s.code).toBe("SLS-0001");
    salesmanId = s.id;
    const rates = await owner.request({
      method: "PUT",
      url: `/api/salesmen/${salesmanId}/default-rates`,
      payload: { rates: [{ productId: productA, baseRate44: "18.50" }] },
    });
    expect(json<{ defaultRates: unknown[] }>(rates).defaultRates).toHaveLength(1);
  });

  it("GATE: salesman defaults pre-fill a new customer (credit + rates)", async () => {
    const preview = json<{
      creditPolicy: Record<string, unknown>;
      creditSource: string;
      rates: unknown[];
    }>(await owner.get(`/api/customers/defaults?salesmanId=${salesmanId}`));
    // Limit and days from the salesman; grace falls back to the setting (Q7: 15).
    expect(preview).toMatchObject({
      creditSource: "salesman",
      creditPolicy: { creditLimit: "250000", creditDays: 45, graceDays: 15, blockRule: "BOTH" },
      rates: [{ productId: productA, baseRate44: "18.5" }],
    });

    const res = await owner.request({
      method: "POST",
      url: "/api/customers",
      payload: newCustomer({
        salesmanId,
        contacts: [
          { name: "Rakesh Shah", isPrimary: true },
          { name: "Accounts desk", isPrimary: true },
        ],
      }),
    });
    expect(res.statusCode).toBe(201);
    customer = json<Detail>(res);
    expect(customer.code).toBe("CUST-0001");
    expect(customer.salesmanName).toBe("Vipul Desai");
    expect(customer.creditPolicy).toMatchObject({
      creditLimit: "250000",
      creditDays: 45,
      graceDays: 15,
    });
    // Only one contact stays primary.
    expect(customer.contacts.filter((c) => c.isPrimary).map((c) => c.name)).toEqual([
      "Rakesh Shah",
    ]);

    const rates = json<Rate[]>(await owner.get(`/api/customers/${customer.id}/rates`));
    expect(rates).toMatchObject([
      {
        productId: productA,
        baseRate44: "18.5",
        validFrom: today,
        source: "salesman_default",
        current: true,
      },
    ]);
  });

  it("without a salesman the credit.defaults setting applies (₹1,00,000 / 30 / 15)", async () => {
    const res = await owner.request({
      method: "POST",
      url: "/api/customers",
      payload: newCustomer({ legalName: "Om Digital", gstType: "Unregistered", gstin: null }),
    });
    expect(res.statusCode).toBe(201);
    expect(json<Detail>(res).creditPolicy).toMatchObject({
      creditLimit: "100000",
      creditDays: 30,
      graceDays: 15,
    });
  });

  it("a registered customer needs a GSTIN; a duplicate GSTIN is 409", async () => {
    const missing = await owner.request({
      method: "POST",
      url: "/api/customers",
      payload: newCustomer({ legalName: "No GST", gstin: null }),
    });
    expect(missing.statusCode).toBe(400);
    expect(json(missing)).toMatchObject({ issues: [{ path: "gstin" }] });
    const dup = await owner.request({
      method: "POST",
      url: "/api/customers",
      payload: newCustomer(),
    });
    expect(dup.statusCode).toBe(409);
    expect(json(dup)).toMatchObject({ code: "DUPLICATE", issues: [{ path: "gstin" }] });
  });

  it("revising a rate closes the running one the day before; history records old → new", async () => {
    const from = addDays(today, 10);
    const res = await owner.request({
      method: "POST",
      url: `/api/customers/${customer.id}/rates`,
      payload: { productId: productA, baseRate44: "19.25", validFrom: from },
      reason: "Paper price rise",
    });
    expect(res.statusCode).toBe(201);
    const rates = json<Rate[]>(res).filter((r) => r.productId === productA);
    expect(rates).toMatchObject([
      { baseRate44: "19.25", validFrom: from, validTo: null },
      { baseRate44: "18.5", validFrom: today, validTo: addDays(from, -1) },
    ]);
    const history = json<
      { previousRate44: string | null; newRate44: string; reason: string | null }[]
    >(await owner.get(`/api/customers/${customer.id}/rate-history`));
    expect(history[0]).toMatchObject({
      previousRate44: "18.5",
      newRate44: "19.25",
      reason: "Paper price rise",
    });
  });

  it("GATE: an overlapping rate range is rejected by the database → 409 OVERLAP", async () => {
    const res = await owner.request({
      method: "POST",
      url: `/api/customers/${customer.id}/rates`,
      payload: {
        productId: productA,
        baseRate44: "17",
        validFrom: addDays(today, 5),
        validTo: addDays(today, 20),
        mode: "add",
      },
    });
    expect(res.statusCode).toBe(409);
    expect(json(res)).toMatchObject({ code: "OVERLAP", issues: [{ path: "validFrom" }] });
  });

  it("bulk revision previews, then applies atomically with step-up + reason", async () => {
    await owner.request({
      method: "POST",
      url: `/api/customers/${customer.id}/rates`,
      payload: { productId: productB, baseRate44: "20", validFrom: today },
    });
    const effectiveFrom = addDays(today, 30);
    const body = { customerIds: [customer.id], mode: "PERCENT", value: "5", effectiveFrom };
    const preview = json<{
      rows: { productId: string; oldRate44: string; newRate44: string }[];
      customers: number;
    }>(
      await owner.request({
        method: "POST",
        url: "/api/pricing/bulk-revision/preview",
        payload: body,
      }),
    );
    expect(preview.customers).toBe(1);
    expect(preview.rows.map((r) => [r.oldRate44, r.newRate44]).sort()).toEqual([
      ["19.25", "20.21"],
      ["20", "21.00"],
    ]);

    const noReason = await owner.request({
      method: "POST",
      url: "/api/pricing/bulk-revision",
      payload: body,
    });
    expect(noReason.statusCode).toBe(422);
    expect(json(noReason)).toMatchObject({ code: "REASON_REQUIRED" });

    const applied = await owner.request({
      method: "POST",
      url: "/api/pricing/bulk-revision",
      payload: body,
      reason: "Q3 price list",
    });
    expect(applied.statusCode).toBe(200);
    expect(json(applied)).toEqual({ revised: 2, customers: 1 });
    const rates = json<Rate[]>(await owner.get(`/api/customers/${customer.id}/rates`));
    expect(
      rates.filter((r) => r.validFrom === effectiveFrom && r.source === "bulk_revision"),
    ).toHaveLength(2);
  });

  it("manual block needs a reason, stores it, and is audited", async () => {
    const noReason = await owner.request({
      method: "POST",
      url: `/api/customers/${customer.id}/block`,
      payload: { blocked: true, version: customer.creditPolicy.version },
    });
    expect(noReason.statusCode).toBe(422);
    const res = await owner.request({
      method: "POST",
      url: `/api/customers/${customer.id}/block`,
      payload: { blocked: true, version: customer.creditPolicy.version },
      reason: "Cheque returned",
    });
    expect(res.statusCode).toBe(200);
    expect(json<Detail>(res).creditPolicy).toMatchObject({
      manualBlock: true,
      blockReason: "Cheque returned",
    });
    const list = json<{ id: string; blocked: boolean }[]>(
      await owner.get("/api/customers?blocked=true"),
    );
    expect(list.map((c) => c.id)).toEqual([customer.id]);
    const audit = json<{ items: { reason: string | null }[] }>(
      await owner.get(`/api/audit?table=credit_policies&rowId=${customer.id}`),
    );
    expect(audit.items.some((i) => i.reason === "Cheque returned")).toBe(true);
  });

  it("commission rules for the same customer cannot overlap", async () => {
    const rule = {
      customerId: customer.id,
      method: "PERCENT_SALES",
      rate: "1.5",
      triggerEvent: "ON_PAYMENT_RECEIVED",
      validFrom: today,
    };
    const first = await owner.request({
      method: "POST",
      url: `/api/salesmen/${salesmanId}/commission-rules`,
      payload: rule,
    });
    expect(first.statusCode).toBe(201);
    const second = await owner.request({
      method: "POST",
      url: `/api/salesmen/${salesmanId}/commission-rules`,
      payload: { ...rule, validFrom: addDays(today, 3), method: "PER_METER", rate: "0.25" },
    });
    expect(second.statusCode).toBe(409);
    expect(json(second)).toMatchObject({ code: "OVERLAP" });
  });

  it("KYC upload accepts a real PDF, rejects other types and oversize files", async () => {
    const upload = (bytes: Buffer, name: string) => {
      const boundary = "----erpTestBoundary";
      const body = Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="docType"\r\n\r\nPAN\r\n` +
            `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/pdf\r\n\r\n`,
        ),
        bytes,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);
      return owner.request({
        method: "POST",
        url: `/api/salesmen/${salesmanId}/kyc`,
        headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
        payload: body,
      });
    };
    const ok = await upload(Buffer.from("%PDF-1.7\n% test document\n"), "pan.pdf");
    expect(ok.statusCode).toBe(201);
    const doc = json<{ id: string; contentType: string; fileName: string }>(ok);
    expect(doc).toMatchObject({ contentType: "application/pdf", fileName: "pan.pdf" });

    const fake = await upload(Buffer.from("MZ not really a pdf"), "evil.pdf");
    expect(fake.statusCode).toBe(400);
    const big = await upload(
      Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(4096, 1)]),
      "big.pdf",
    );
    expect(big.statusCode).toBe(400);

    const download = await owner.get(`/api/kyc-documents/${doc.id}/file`);
    expect(download.statusCode).toBe(200);
    expect(download.headers["content-disposition"]).toContain("attachment");
    expect(download.body.startsWith("%PDF")).toBe(true);
  });

  it("customer scoping: an own-customers user sees only the customers they manage", async () => {
    await owner.request({
      method: "POST",
      url: "/api/users",
      payload: {
        name: "Field Exec",
        email: "exec@test.local",
        password: "Sales-Exec-12345",
        roleCodes: ["sales_executive"],
      },
    });
    const users = json<{ id: string; email: string }[]>(await owner.get("/api/users"));
    const exec = users.find((u) => u.email === "exec@test.local")!;
    const handle = createDb(inject("ownerDatabaseUrl"), { max: 1 });
    await handle.db.insert(userScopes).values({ userId: exec.id, scopeType: "own_customers" });
    await handle.close();

    const client = await Client.signIn(t.fastify, "exec@test.local", "Sales-Exec-12345");
    expect(json<unknown[]>(await client.get("/api/customers"))).toHaveLength(0);
    expect((await client.get(`/api/customers/${customer.id}`)).statusCode).toBe(404);

    const created = await client.request({
      method: "POST",
      url: "/api/customers",
      payload: newCustomer({
        legalName: "Exec's Own Account",
        gstType: "Unregistered",
        gstin: null,
      }),
    });
    expect(created.statusCode).toBe(201);
    const mine = json<{ legalName: string }[]>(await client.get("/api/customers"));
    expect(mine.map((c) => c.legalName)).toEqual(["Exec's Own Account"]);
  });

  it("search and dashboard summary respect permissions", async () => {
    const results = json<{ results: { type: string; title: string }[] }>(
      await owner.get("/api/search?q=shiv"),
    );
    expect(results.results).toContainEqual(
      expect.objectContaining({ type: "customer", title: "Shiv Prints Pvt Ltd" }),
    );
    const summary = json(await owner.get("/api/dashboard/summary"));
    expect(summary).toMatchObject({ activeCustomers: 3, blockedCustomers: 1 });
  });
});

describe("credit changes need a fresh login (ADR-0021)", () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await startApp({ STEP_UP_SECONDS: "1" });
  });
  afterAll(() => t.close());

  it("updating a credit limit after the step-up window → 401 STEP_UP_REQUIRED", async () => {
    const owner = await Client.signIn(t.fastify);
    const [c] = json<{ id: string }[]>(await owner.get("/api/customers"));
    const detail = json<Detail>(await owner.get(`/api/customers/${c!.id}`));
    await sleep(1_200);
    const res = await owner.request({
      method: "PUT",
      url: `/api/customers/${c!.id}/credit-policy`,
      payload: {
        creditLimit: "500000",
        creditDays: 30,
        graceDays: 15,
        autoBlock: true,
        blockRule: "BOTH",
        version: detail.creditPolicy.version,
      },
      reason: "Raised after review",
    });
    expect(res.statusCode).toBe(401);
    expect(json(res)).toMatchObject({ code: "STEP_UP_REQUIRED" });
  });
});
