import { createDb, statusTransitions } from "@erp/db";
import { gstinCheckChar, istToday } from "@erp/domain";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { SalesOrdersService } from "../../src/modules/sales/sales-orders.service.js";
import { Client, type TestApp, json, startApp } from "./harness.js";

const gstin = (state: string, pan: string) => {
  const first14 = `${state}${pan}1Z`;
  return first14 + gstinCheckChar(first14);
};
const address = (state: string, pincode: string) => ({
  line1: "3 Textile Market",
  city: "Surat",
  state,
  pincode,
});

interface So {
  id: string;
  version: number;
  status: string;
  heldReasons: string[];
}

/**
 * Stage 3 step 6: printable invoices / notes / challans / proformas (provisional until the IRN
 * exists, ADR-0011), and the automatic credit re-check of orders held for credit.
 */
describe("sales documents & credit re-check", () => {
  let t: TestApp;
  let owner: Client;
  let sku: string;
  let customer: string;
  let rolls: string[];
  const today = istToday();

  const post = (url: string, payload: unknown, reason?: string) =>
    owner.request({ method: "POST", url, payload: payload as Record<string, unknown>, reason });
  const ok = async <T>(res: Promise<import("fastify").LightMyRequestResponse>) => {
    const r = await res;
    expect([200, 201], r.body).toContain(r.statusCode);
    return json<T>(r);
  };
  const html = async (url: string) => {
    const r = await owner.get(`${url}?format=html`);
    expect(r.statusCode, r.body).toBe(200);
    expect(r.headers["content-type"]).toContain("text/html");
    return r.body;
  };
  /** A held order: ₹6.00 × 2000 m + 18 % = ₹14,160 against the customer's limit. */
  const heldOrder = async () => {
    let so = await ok<So>(
      post("/api/sales-orders", {
        customerId: customer,
        date: today,
        lines: [{ skuId: sku, totalM: 2000, ratePerM: "6.00" }],
      }),
    );
    so = await ok<So>(post(`/api/sales-orders/${so.id}/approve-rates`, { version: so.version }));
    return ok<So>(post(`/api/sales-orders/${so.id}/confirm`, { version: so.version }));
  };
  const setLimit = async (limit: string) => {
    const c = json<{ creditPolicy: { version: number } }>(
      await owner.get(`/api/customers/${customer}`),
    );
    await ok(
      owner.request({
        method: "PUT",
        url: `/api/customers/${customer}/credit-policy`,
        payload: {
          creditLimit: limit,
          creditDays: 30,
          graceDays: 15,
          autoBlock: true,
          blockRule: "BOTH",
          version: c.creditPolicy.version,
        },
        reason: "Limit review",
      }),
    );
  };

  beforeAll(async () => {
    t = await startApp();
    owner = await Client.signIn(t.fastify);
    const cats = json<{ id: string; code: string }[]>(await owner.get("/api/catalogue/categories"));
    const quals = json<{ id: string; name: string }[]>(await owner.get("/api/catalogue/qualities"));
    const product = await ok<{ id: string; skus: { id: string }[] }>(
      post("/api/catalogue/products", {
        categoryId: cats.find((c) => c.code === "SUB")!.id,
        qualityId: quals.find((q) => q.name === "Standard")!.id,
        gsm: 80,
        defaultLengthM: 1000,
        widthsIn: [44],
      }),
    );
    sku = product.skus[0]!.id;
    const supplier = await ok<{ id: string }>(
      post("/api/suppliers", {
        name: "Print Docs Mills",
        shortCode: "QPD",
        stateCode: "24",
        gstin: gstin("24", "AAQFP1234Q"),
        address: address("Gujarat", "394210"),
        paymentDays: 1,
      }),
    );
    const po0 = await ok<{ id: string; version: number; lines: { id: string }[] }>(
      post("/api/purchase-orders", {
        supplierId: supplier.id,
        date: today,
        lines: [
          {
            skuId: sku,
            description: "Sub 80 44*",
            gsm: 80,
            widthIn: 44,
            quantityM: 3000,
            ratePerM: "4.00",
            gstRate: "18",
          },
        ],
      }),
    );
    const po = await ok<typeof po0>(
      post(`/api/purchase-orders/${po0.id}/approve`, { version: po0.version }),
    );
    const grn = await ok<{ id: string; version: number }>(
      post("/api/goods-receipts", {
        supplierId: supplier.id,
        poId: po.id,
        date: today,
        lines: [
          {
            poLineId: po.lines[0]!.id,
            skuId: sku,
            description: "Sub 80",
            gsm: 80,
            widthIn: 44,
            rolls: "3 x 1000",
          },
        ],
      }),
    );
    await ok(post(`/api/goods-receipts/${grn.id}/post`, { version: grn.version }));
    rolls = json<{ items: { id: string; barcode: string }[] }>(
      await owner.get(`/api/rolls?grnId=${grn.id}&limit=10`),
    )
      .items.sort((a, b) => a.barcode.localeCompare(b.barcode))
      .map((r) => r.id);
    customer = (
      await ok<{ id: string }>(
        post("/api/customers", {
          legalName: "Docs & Prints Pvt Ltd",
          gstType: "Regular",
          gstin: gstin("24", "AAQCD4444Q"),
          stateCode: "24",
          billingAddress: address("Gujarat", "395003"),
          contacts: [],
          creditPolicy: {
            creditLimit: "10000",
            creditDays: 30,
            graceDays: 15,
            autoBlock: true,
            blockRule: "BOTH",
          },
        }),
      )
    ).id;
  });
  afterAll(() => t.close());

  it("an invoice prints provisional until its IRN exists, then with the IRN and QR", async () => {
    await setLimit("500000");
    let pf = await ok<{ id: string; version: number; lines: { id: string }[] }>(
      post("/api/proformas", {
        customerId: customer,
        date: today,
        lines: [{ skuId: sku, metres: 1000, ratePerM: "6.60" }],
      }),
    );
    const pfPage = await html(`/api/proformas/${pf.id}/pdf`);
    expect(pfPage).toContain("Proforma Invoice");
    expect(pfPage).toContain("not a tax invoice");
    pf = await ok<typeof pf>(post(`/api/proformas/${pf.id}/send`, { version: pf.version }));
    const draft = await ok<{ id: string; version: number }>(
      post("/api/sales-invoices", {
        source: "PROFORMA",
        proformaId: pf.id,
        date: today,
        rolls: [{ lineId: pf.lines[0]!.id, rollId: rolls[0]! }],
      }),
    );
    expect(await html(`/api/sales-invoices/${draft.id}/pdf`)).toContain(">Draft<");
    const si = await ok<{ id: string; siNo: string }>(
      post(`/api/sales-invoices/${draft.id}/post`, { version: draft.version }),
    );

    let page = await html(`/api/sales-invoices/${si.id}/pdf`);
    expect(page).toContain("Provisional — IRN pending");
    expect(page).toContain(si.siNo);
    expect(page).toContain("Gulmohar Creation");
    expect(page).toContain("Docs &#38; Prints Pvt Ltd");
    // 1000 m × ₹6.60 = 6,600 + 18 % = 7,788; rolls listed under the line.
    expect(page).toContain("7,788.00");
    expect(page).toContain("Rupees Seven Thousand Seven Hundred Eighty Eight Only");
    expect(page).toContain("1,000 m");
    expect(page.match(/<article class="page">/g)).toHaveLength(3);

    await ok(post(`/api/einvoice/SI/${si.id}/generate`, {}));
    page = await html(`/api/sales-invoices/${si.id}/pdf`);
    expect(page).not.toContain("Provisional — IRN pending");
    expect(page).toMatch(/IRN<\/b> <span class="mono">[0-9a-f]{64}/);
    expect(page).toContain("<svg");

    const pdf = await owner.get(`/api/sales-invoices/${si.id}/pdf`);
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers["content-type"]).toBe("application/pdf");
    expect(pdf.headers["content-disposition"]).toContain(
      `invoice-${si.siNo.replace(/\//g, "-")}.pdf`,
    );
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");

    const note = await ok<{ id: string; version: number }>(
      post("/api/customer-notes", {
        kind: "CREDIT",
        customerId: customer,
        siId: si.id,
        date: today,
        reasonCode: "DISCOUNT",
        reason: "Volume discount",
        lines: [{ description: "Discount", hsnCode: "48239090", taxable: "100.00", gstRate: "18" }],
      }),
    );
    const notePage = await html(`/api/customer-notes/${note.id}/pdf`);
    expect(notePage).toContain("Credit Note");
    expect(notePage).toContain(si.siNo);
    expect(notePage).toContain("118.00");
  }, 60_000);

  it("a challan prints rolls and metres, no prices", async () => {
    await setLimit("500000");
    let so = await ok<So & { lines: { id: string }[] }>(
      post("/api/sales-orders", {
        customerId: customer,
        date: today,
        lines: [{ skuId: sku, totalM: 1000, ratePerM: "6.60" }],
      }),
    );
    so = await ok<typeof so>(
      post(`/api/sales-orders/${so.id}/approve-rates`, { version: so.version }),
    );
    so = await ok<typeof so>(post(`/api/sales-orders/${so.id}/confirm`, { version: so.version }));
    expect(so.status).toBe("Confirmed");
    const dc = await ok<{ id: string; dcNo: string; version: number }>(
      post("/api/delivery-challans", { soId: so.id, date: today }),
    );
    const barcode = json<{ barcode: string }>(await owner.get(`/api/rolls/${rolls[1]}`)).barcode;
    await ok(post(`/api/delivery-challans/${dc.id}/pick`, { soLineId: so.lines[0]!.id, barcode }));
    const page = await html(`/api/delivery-challans/${dc.id}/pdf`);
    expect(page).toContain("Delivery Challan");
    expect(page).toContain(barcode);
    expect(page).toContain("1 roll · 1,000 m");
    expect(page).not.toContain("Taxable ₹");
  });

  it("a held order is confirmed by itself once the customer is within terms; a manual hold stays", async () => {
    await setLimit("10000");
    const held = await heldOrder();
    expect(held).toMatchObject({ status: "OnHold", heldReasons: ["OVER_LIMIT"] });

    // A manual hold on a confirmed order (no credit reasons) is never auto-released.
    await setLimit("500000");
    let manual = await heldOrder();
    expect(manual.status).toBe("Confirmed");
    manual = await ok<So>(
      post(
        `/api/sales-orders/${manual.id}/hold`,
        { version: manual.version },
        "Customer asked to wait",
      ),
    );
    expect(manual).toMatchObject({ status: "OnHold", heldReasons: [] });

    // With the background jobs running, the limit raised above triggered a re-check.
    const jobs = await startApp({ API_JOBS: "true" });
    try {
      await setLimit("600000");
      let status = "OnHold";
      for (let i = 0; i < 50 && status === "OnHold"; i++) {
        await new Promise((r) => setTimeout(r, 200));
        status = json<So>(await owner.get(`/api/sales-orders/${held.id}`)).status;
      }
      expect(status).toBe("Confirmed");
      const handle = createDb(inject("ownerDatabaseUrl"), { max: 1 });
      try {
        const log = await handle.db
          .select()
          .from(statusTransitions)
          .where(eq(statusTransitions.entityId, held.id));
        expect(log.map((l) => l.reason)).toContain(
          "Credit re-check: customer is within terms again",
        );
      } finally {
        await handle.close();
      }
    } finally {
      await jobs.close();
    }
    expect(json<So>(await owner.get(`/api/sales-orders/${manual.id}`)).status).toBe("OnHold");

    // Directly: nothing else of this customer's is held for credit.
    const svc = t.app.get(SalesOrdersService);
    const r = await svc.recheckHeld({ companyId: inject("companyId"), customerId: customer });
    expect(r).toEqual({ checked: 0, released: 0 });
  }, 60_000);
});
