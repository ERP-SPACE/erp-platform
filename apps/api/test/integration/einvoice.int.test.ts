import { createDb, einvoiceRequests } from "@erp/db";
import { gstinCheckChar, istToday } from "@erp/domain";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import {
  EINVOICE_PROVIDER,
  EInvoiceProviderError,
} from "../../src/modules/compliance/einvoice-provider.js";
import type { SimulatorProvider } from "../../src/modules/compliance/simulator.provider.js";
import { Client, type TestApp, json, startApp } from "./harness.js";

const gstin = (state: string, pan: string) => {
  const first14 = `${state}${pan}1Z`;
  return first14 + gstinCheckChar(first14);
};
const address = (state: string, pincode: string) => ({
  line1: "7 Udhna Road",
  city: "Surat",
  state,
  pincode,
});

interface EInfo {
  status: string;
  irn: string | null;
  ackNo: string | null;
  signedQr: string | null;
  attempts: number;
  lastError: string | null;
  cancellableUntil: string | null;
}
interface Si {
  id: string;
  siNo: string;
  version: number;
  status: string;
  totals: { total: string; taxable: string };
  einvoice: EInfo;
}

/**
 * ADR-0011 against the offline IRP simulator (the NIC sandbox replaces it once credentials
 * exist, Q27): IRN on posting, retries after an outage, rejections and the manual fallback,
 * e-way bill from the IRN, IRN cancellation with the note, and B2C invoices needing none.
 */
describe("e-invoicing (ADR-0011)", () => {
  let t: TestApp;
  let owner: Client;
  let sim: SimulatorProvider;
  let sku: string;
  let b2b: string;
  let b2c: string;
  let rolls: string[];
  let si: Si;
  const today = istToday();

  const post = (url: string, payload: unknown, reason?: string) =>
    owner.request({ method: "POST", url, payload: payload as Record<string, unknown>, reason });
  const ok = async <T>(res: Promise<import("fastify").LightMyRequestResponse>) => {
    const r = await res;
    expect([200, 201], r.body).toContain(r.statusCode);
    return json<T>(r);
  };
  const logged = async (docId: string) => {
    const handle = createDb(inject("ownerDatabaseUrl"), { max: 1 });
    try {
      return await handle.db
        .select()
        .from(einvoiceRequests)
        .where(and(eq(einvoiceRequests.docId, docId)));
    } finally {
      await handle.close();
    }
  };

  /** A posted invoice for one roll, through a proforma (no picking needed). */
  const invoice = async (customerId: string, rollId: string) => {
    let pf = await ok<{ id: string; version: number; lines: { id: string }[] }>(
      post("/api/proformas", {
        customerId,
        date: today,
        lines: [{ skuId: sku, metres: 1000, ratePerM: "7.00" }],
      }),
    );
    pf = await ok<typeof pf>(post(`/api/proformas/${pf.id}/send`, { version: pf.version }));
    const draft = await ok<Si>(
      post("/api/sales-invoices", {
        source: "PROFORMA",
        proformaId: pf.id,
        date: today,
        rolls: [{ lineId: pf.lines[0]!.id, rollId }],
      }),
    );
    return ok<Si>(post(`/api/sales-invoices/${draft.id}/post`, { version: draft.version }));
  };

  beforeAll(async () => {
    t = await startApp();
    owner = await Client.signIn(t.fastify);
    sim = t.app.get(EINVOICE_PROVIDER);
    const cats = json<{ id: string; code: string }[]>(await owner.get("/api/catalogue/categories"));
    const quals = json<{ id: string; name: string }[]>(await owner.get("/api/catalogue/qualities"));
    const product = await ok<{ id: string; skus: { id: string }[] }>(
      post("/api/catalogue/products", {
        categoryId: cats.find((c) => c.code === "SUB")!.id,
        qualityId: quals.find((q) => q.name === "Standard")!.id,
        gsm: 65,
        defaultLengthM: 1000,
        widthsIn: [44],
      }),
    );
    sku = product.skus[0]!.id;
    const supplier = await ok<{ id: string }>(
      post("/api/suppliers", {
        name: "IRN Test Mills",
        shortCode: "QEI",
        stateCode: "24",
        gstin: gstin("24", "AAQFE1234Q"),
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
            description: "Sub 75 44*",
            gsm: 65,
            widthIn: 44,
            quantityM: 6000,
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
            description: "Sub 75",
            gsm: 65,
            widthIn: 44,
            rolls: "6 x 1000",
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
    const customer = (legalName: string, extra: Record<string, unknown>) =>
      ok<{ id: string }>(
        post("/api/customers", {
          legalName,
          stateCode: "24",
          billingAddress: address("Gujarat", "395003"),
          contacts: [],
          creditPolicy: {
            creditLimit: "500000",
            creditDays: 30,
            graceDays: 15,
            autoBlock: false,
            blockRule: "BOTH",
          },
          ...extra,
        }),
      );
    b2b = (
      await customer("Irn Prints LLP", { gstType: "Regular", gstin: gstin("24", "AAQFI3333Q") })
    ).id;
    b2c = (await customer("Walk-in Printer", { gstType: "Unregistered", gstin: null })).id;
  });
  afterAll(() => t.close());

  it("a posted B2B invoice is queued, then gets an IRN, ack and signed QR that match its totals", async () => {
    si = await invoice(b2b, rolls[0]!);
    expect(si.einvoice).toMatchObject({ status: "Pending", irn: null });
    const info = await ok<EInfo>(post(`/api/einvoice/SI/${si.id}/generate`, {}));
    expect(info).toMatchObject({ status: "Generated", attempts: 1, lastError: null });
    expect(info.irn).toMatch(/^[0-9a-f]{64}$/);
    expect(info.ackNo).toMatch(/^\d{15}$/);
    expect(info.signedQr).toBeTruthy();
    expect(Date.parse(info.cancellableUntil!) - Date.now()).toBeGreaterThan(23 * 3_600_000);
    const [req] = await logged(si.id);
    const payload = req!.request as {
      DocDtls: { Typ: string; No: string };
      TranDtls: { SupTyp: string };
      ItemList: { HsnCd: string; Unit: string; Qty: number }[];
      ValDtls: { AssVal: number; TotInvVal: number };
    };
    expect(req).toMatchObject({
      action: "GENERATE",
      ok: true,
      provider: "SIMULATOR",
      docType: "SI",
    });
    expect(payload.DocDtls).toMatchObject({ Typ: "INV", No: si.siNo });
    expect(payload.TranDtls.SupTyp).toBe("B2B");
    expect(payload.ItemList).toMatchObject([{ Unit: "MTR", Qty: 1000 }]);
    expect(payload.ValDtls.TotInvVal).toBe(Number(si.totals.total));
    expect(payload.ValDtls.AssVal).toBe(Number(si.totals.taxable));
    // Asking again changes nothing.
    const again = await ok<EInfo>(post(`/api/einvoice/SI/${si.id}/generate`, {}));
    expect(again.irn).toBe(info.irn);
    expect(await logged(si.id)).toHaveLength(1);
  });

  it("a portal outage leaves the invoice Pending for the queue to retry; it shows on the IRN queue", async () => {
    const inv = await invoice(b2b, rolls[1]!);
    sim.failNext(new EInvoiceProviderError("The e-invoice portal is unavailable (HTTP 503)", true));
    const res = await post(`/api/einvoice/SI/${inv.id}/generate`, {});
    expect(res.statusCode).toBe(422);
    expect(json(res)).toMatchObject({ code: "EINVOICE_FAILED" });
    const queue = json<
      { id: string; status: string; attempts: number; lastError: string; daysLeft: number }[]
    >(await owner.get("/api/einvoice/queue"));
    expect(queue.find((q) => q.id === inv.id)).toMatchObject({
      status: "Pending",
      attempts: 1,
      lastError: expect.stringContaining("503"),
      daysLeft: 30,
    });
    const info = await ok<EInfo>(post(`/api/einvoice/SI/${inv.id}/generate`, {}));
    expect(info).toMatchObject({ status: "Generated", attempts: 2 });
    const log = json<{ ok: boolean }[]>(await owner.get(`/api/einvoice/SI/${inv.id}/requests`));
    expect(log.map((l) => l.ok)).toEqual([true, false]);
  });

  it("an IRP rejection marks it Failed; an IRN made on the portal can be recorded by hand (with a reason)", async () => {
    const inv = await invoice(b2b, rolls[2]!);
    sim.failNext(new EInvoiceProviderError("2172: GSTIN of buyer is not active", false, "2172"));
    expect((await post(`/api/einvoice/SI/${inv.id}/generate`, {})).statusCode).toBe(422);
    let got = json<Si>(await owner.get(`/api/sales-invoices/${inv.id}`));
    expect(got.einvoice).toMatchObject({
      status: "Failed",
      lastError: expect.stringContaining("2172"),
    });
    const manual = {
      irn: "a".repeat(64),
      ackNo: "112610000012345",
      ackDate: new Date().toISOString(),
    };
    expect(json(await post(`/api/einvoice/SI/${inv.id}/manual`, manual))).toMatchObject({
      code: "REASON_REQUIRED",
    });
    await ok(
      post(`/api/einvoice/SI/${inv.id}/manual`, manual, "Generated on the portal after GSTIN fix"),
    );
    got = json<Si>(await owner.get(`/api/sales-invoices/${inv.id}`));
    expect(got.einvoice).toMatchObject({
      status: "Generated",
      irn: manual.irn,
      ackNo: manual.ackNo,
    });
  });

  it("with the queue running, posting alone gets the IRN (no one has to ask)", async () => {
    const worker = await startApp({ EINVOICE_QUEUE: "true" });
    try {
      const inv = await invoice(b2b, rolls[5]!);
      expect(inv.einvoice.status).toBe("Pending");
      let status = "Pending";
      for (let i = 0; i < 50 && status === "Pending"; i++) {
        await new Promise((r) => setTimeout(r, 200));
        status = json<Si>(await owner.get(`/api/sales-invoices/${inv.id}`)).einvoice.status;
      }
      expect(status).toBe("Generated");
    } finally {
      await worker.close();
    }
  });

  it("a B2C invoice needs no IRN", async () => {
    const inv = await invoice(b2c, rolls[3]!);
    expect(inv.einvoice.status).toBe("NotRequired");
    const info = await ok<EInfo>(post(`/api/einvoice/SI/${inv.id}/generate`, {}));
    expect(info.status).toBe("NotRequired");
    expect(await logged(inv.id)).toHaveLength(0);
  });

  it("the e-way bill is generated from the IRN, once, and copied to the invoice", async () => {
    const pending = await invoice(b2b, rolls[4]!);
    const early = await post(`/api/einvoice/SI/${pending.id}/eway-bill`, {
      distanceKm: 280,
      vehicleNo: "GJ05AB1234",
    });
    expect(early.statusCode).toBe(409);
    expect(json(early)).toMatchObject({ code: "IRN_PENDING" });

    const ewb = await ok<{ ewayBillNo: string; ewayBillDate: string; validUntil: string }>(
      post(`/api/einvoice/SI/${si.id}/eway-bill`, { distanceKm: 280, vehicleNo: "gj05ab1234" }),
    );
    expect(ewb.ewayBillNo).toMatch(/^\d{12}$/);
    expect(ewb.ewayBillDate).toBe(today);
    // 280 km → 2 days.
    expect(Date.parse(ewb.validUntil) - Date.parse(ewb.ewayBillDate)).toBe(2 * 86_400_000);
    const got = json<{ transport: { ewayBillNo: string; vehicleNo: string; distanceKm: number } }>(
      await owner.get(`/api/sales-invoices/${si.id}`),
    );
    expect(got.transport).toMatchObject({
      ewayBillNo: ewb.ewayBillNo,
      vehicleNo: "GJ05AB1234",
      distanceKm: 280,
    });
    expect(
      (
        await post(`/api/einvoice/SI/${si.id}/eway-bill`, {
          distanceKm: 280,
          vehicleNo: "GJ05AB1234",
        })
      ).statusCode,
    ).toBe(400);
  });

  it("cancelling a posted note cancels its IRN; if the IRP refuses, nothing is cancelled", async () => {
    const note = async () => {
      const draft = await ok<{ id: string; version: number }>(
        post("/api/customer-notes", {
          kind: "DEBIT",
          customerId: b2b,
          siId: si.id,
          date: today,
          reasonCode: "RATE_DIFFERENCE",
          reason: "Rate revised to ₹7.20",
          lines: [
            {
              description: "Rate difference",
              hsnCode: "48239090",
              taxable: "200.00",
              gstRate: "18",
            },
          ],
        }),
      );
      const n = await ok<{ id: string; version: number; einvoice: EInfo }>(
        post(`/api/customer-notes/${draft.id}/post`, { version: draft.version }),
      );
      expect(n.einvoice.status).toBe("Pending");
      await ok(post(`/api/einvoice/DN/${n.id}/generate`, {}));
      return json<{ id: string; version: number; status: string; einvoice: EInfo }>(
        await owner.get(`/api/customer-notes/${n.id}`),
      );
    };
    const refused = await note();
    expect(refused.einvoice.status).toBe("Generated");
    sim.failNext(
      new EInvoiceProviderError(
        "2270: The allowed cancellation time limit is crossed",
        false,
        "2270",
      ),
    );
    const res = await post(
      `/api/customer-notes/${refused.id}/cancel`,
      { version: refused.version },
      "Wrong rate",
    );
    expect(res.statusCode).toBe(422);
    expect(json(res)).toMatchObject({ code: "EINVOICE_FAILED" });
    const still = json<{ status: string; einvoice: EInfo }>(
      await owner.get(`/api/customer-notes/${refused.id}`),
    );
    expect(still).toMatchObject({ status: "Posted", einvoice: { status: "Generated" } });
    // The refused call is still on record.
    expect((await logged(refused.id)).map((r) => [r.action, r.ok])).toContainEqual([
      "CANCEL",
      false,
    ]);

    await ok(
      post(`/api/customer-notes/${refused.id}/cancel`, { version: refused.version }, "Wrong rate"),
    );
    const done = json<{ status: string; einvoice: EInfo }>(
      await owner.get(`/api/customer-notes/${refused.id}`),
    );
    expect(done).toMatchObject({ status: "Cancelled", einvoice: { status: "Cancelled" } });
    // A cancelled note is never reported again.
    const after = await ok<EInfo>(post(`/api/einvoice/DN/${refused.id}/generate`, {}));
    expect(after.status).toBe("Cancelled");
  });
});
