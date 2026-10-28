import { formatRollBarcode, gstinCheckChar, istToday } from "@erp/domain";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { Client, type TestApp, json, startApp } from "./harness.js";

const gstin = (state: string, pan: string) => {
  const first14 = `${state}${pan}1Z`;
  return first14 + gstinCheckChar(first14);
};
const address = { line1: "1 Perf Road", city: "Surat", state: "Gujarat", pincode: "395002" };
const SEEDED = 50_000;

/** p95 of n timed calls, in ms. */
async function p95(n: number, run: (i: number) => Promise<void>) {
  const times: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = performance.now();
    await run(i);
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  return times[Math.ceil(n * 0.95) - 1]!;
}

/**
 * Performance budgets (CLAUDE.md), measured on 50,000 seeded rolls: scan lookup < 500 ms,
 * credit check < 1 s, list p95 < 300 ms. Rolls are cloned in SQL from one real GRN roll (the
 * API would take minutes); timings go through the full HTTP stack in-process.
 */
describe("performance budgets (Stage 3 gate)", () => {
  let t: TestApp;
  let owner: Client;
  let customerId: string;
  const barcodes: string[] = [];

  beforeAll(async () => {
    t = await startApp();
    owner = await Client.signIn(t.fastify);
    const post = async <T>(url: string, payload: unknown) => {
      const r = await owner.request({
        method: "POST",
        url,
        payload: payload as Record<string, unknown>,
      });
      expect([200, 201], r.body).toContain(r.statusCode);
      return json<T>(r);
    };
    const today = istToday();
    const cats = json<{ id: string; code: string }[]>(await owner.get("/api/catalogue/categories"));
    const quals = json<{ id: string; name: string }[]>(await owner.get("/api/catalogue/qualities"));
    const product = await post<{ id: string; skus: { id: string }[] }>("/api/catalogue/products", {
      categoryId: cats.find((c) => c.code === "SUB")!.id,
      qualityId: quals.find((q) => q.name === "Standard")!.id,
      gsm: 55,
      defaultLengthM: 1000,
      widthsIn: [44],
    });
    const sku = product.skus[0]!.id;
    const supplier = await post<{ id: string }>("/api/suppliers", {
      name: "Perf Mills",
      shortCode: "QPF",
      stateCode: "24",
      gstin: gstin("24", "AAQFP9999Q"),
      address,
      paymentDays: 1,
    });
    const po0 = await post<{ id: string; version: number; lines: { id: string }[] }>(
      "/api/purchase-orders",
      {
        supplierId: supplier.id,
        date: today,
        lines: [
          {
            skuId: sku,
            description: "Perf 55",
            gsm: 55,
            widthIn: 44,
            quantityM: 1000,
            ratePerM: "4.00",
            gstRate: "18",
          },
        ],
      },
    );
    const po = await post<typeof po0>(`/api/purchase-orders/${po0.id}/approve`, {
      version: po0.version,
    });
    const grn = await post<{ id: string; version: number }>("/api/goods-receipts", {
      supplierId: supplier.id,
      poId: po.id,
      date: today,
      lines: [
        {
          poLineId: po.lines[0]!.id,
          skuId: sku,
          description: "Perf 55",
          gsm: 55,
          widthIn: 44,
          rolls: "1 x 1000",
        },
      ],
    });
    await post(`/api/goods-receipts/${grn.id}/post`, { version: grn.version });
    customerId = (
      await post<{ id: string }>("/api/customers", {
        legalName: "Perf Customer",
        gstType: "Regular",
        gstin: gstin("24", "AAQCP8888Q"),
        stateCode: "24",
        billingAddress: address,
        contacts: [],
        creditPolicy: {
          creditLimit: "500000",
          creditDays: 30,
          graceDays: 15,
          autoBlock: true,
          blockRule: "BOTH",
        },
      })
    ).id;

    // Clone the roll 50,000 times as the owner role (every column but id / barcode / sequence).
    const db = new pg.Client({ connectionString: inject("ownerDatabaseUrl") });
    await db.connect();
    try {
      const cols = (
        await db.query<{ column_name: string }>(
          `SELECT column_name FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'rolls'
              AND column_name NOT IN ('id', 'barcode', 'roll_seq')
              AND is_generated = 'NEVER'`,
        )
      ).rows.map((r) => `"${r.column_name}"`);
      // Real, scannable barcodes (valid check characters) under a made-up supplier code.
      const codes = Array.from({ length: SEEDED }, (_, i) =>
        formatRollBarcode({
          postedAt: today,
          supplierCode: "ZPF",
          batchSeq: 1 + Math.floor(i / 9999),
          rollSeq: 1 + (i % 9999),
        }),
      );
      await db.query(
        `INSERT INTO rolls (id, barcode, roll_seq, ${cols.join(", ")})
         SELECT gen_random_uuid(), c.code, 100000 + c.n, ${cols.map((col) => `r.${col}`).join(", ")}
           FROM rolls r CROSS JOIN unnest($1::text[]) WITH ORDINALITY AS c(code, n)
          WHERE r.grn_id = $2`,
        [codes, grn.id],
      );
      for (let i = 0; i < 30; i++) barcodes.push(codes[Math.floor(Math.random() * SEEDED)]!);
      await db.query("ANALYZE rolls");
      const n = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM rolls");
      expect(n.rows[0]!.n).toBeGreaterThanOrEqual(SEEDED);
    } finally {
      await db.end();
    }
  }, 240_000);
  afterAll(() => t.close());

  it("scan lookup p95 < 500 ms", async () => {
    const ms = await p95(30, async (i) => {
      const r = await owner.get(`/api/rolls/${barcodes[i]}`);
      expect(r.statusCode).toBe(200);
    });
    console.info(`perf · scan lookup p95 ${ms.toFixed(0)} ms (budget 500 ms)`);
    expect(ms).toBeLessThan(500);
  });

  it("credit check p95 < 1 s", async () => {
    const ms = await p95(20, async () => {
      const r = await owner.get(`/api/customers/${customerId}/credit-check`);
      expect(r.statusCode).toBe(200);
    });
    console.info(`perf · credit check p95 ${ms.toFixed(0)} ms (budget 1000 ms)`);
    expect(ms).toBeLessThan(1000);
  });

  it("roll list p95 < 300 ms", async () => {
    const ms = await p95(20, async () => {
      const r = await owner.get("/api/rolls?status=Mapped&limit=100");
      expect(r.statusCode).toBe(200);
    });
    console.info(`perf · roll list p95 ${ms.toFixed(0)} ms (budget 300 ms)`);
    expect(ms).toBeLessThan(300);
  });
});
