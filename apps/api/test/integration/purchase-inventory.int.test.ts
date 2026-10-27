import { createDb, postingEvents } from "@erp/db";
import { gstinCheckChar, istToday, parseRollBarcode } from "@erp/domain";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { Client, type TestApp, json, startApp } from "./harness.js";

const gstin = (state: string, pan: string) => {
  const first14 = `${state}${pan}1Z`;
  return first14 + gstinCheckChar(first14);
};
const address = {
  line1: "B/4 Laxminarayan Estate",
  city: "Surat",
  state: "Gujarat",
  pincode: "394210",
};

interface Product {
  id: string;
  skus: { id: string; widthIn: string }[];
}
interface Po {
  id: string;
  status: string;
  version: number;
  lines: { id: string; widthIn: number; receivedM: number; invoicedM: number }[];
}
interface Grn {
  id: string;
  grnNo: string;
  status: string;
  version: number;
  unmappedRolls: number;
  rollCount: number;
  overReceiptApprovedByName: string | null;
}
interface Roll {
  id: string;
  barcode: string;
  status: string;
  widthIn: string;
  originalLengthM: number;
  currentLengthM: number;
  baseCostPerM: string | null;
  landedCostPerM: string | null;
  version: number;
}

/**
 * PRD UAT §11.1 (purchases) and §11.2 (inventory) end to end, with the owner's real Shree
 * Balajee invoice 2455 (10,000 m @ ₹4.90 at 44″ and 4,950 m @ ₹6.68 at 60″).
 */
describe("purchase & inventory (Stage 2 gate)", () => {
  let t: TestApp;
  let owner: Client;
  let supplierId: string;
  let sku44: string;
  let sku60: string;
  let sku48: string;
  let po: Po;
  let grn: Grn;
  let piId: string;
  const today = istToday();

  const events = async (type: string) => {
    const handle = createDb(inject("ownerDatabaseUrl"), { max: 1 });
    try {
      return await handle.db.select().from(postingEvents).where(eq(postingEvents.type, type));
    } finally {
      await handle.close();
    }
  };
  const rollsOf = async (grnId: string) =>
    json<{ items: Roll[] }>(await owner.get(`/api/rolls?grnId=${grnId}&limit=100`)).items.sort(
      (a, b) => a.barcode.localeCompare(b.barcode),
    );

  beforeAll(async () => {
    t = await startApp();
    owner = await Client.signIn(t.fastify);
    const supplier = json<{ id: string }>(
      await owner.request({
        method: "POST",
        url: "/api/suppliers",
        payload: {
          name: "Shree Balajee & Co",
          shortCode: "SBC",
          stateCode: "24",
          gstin: gstin("24", "AAXPR0176M"),
          address,
          paymentDays: 1,
        },
      }),
    );
    supplierId = supplier.id;
    const cats = json<{ id: string; code: string }[]>(await owner.get("/api/catalogue/categories"));
    const quals = json<{ id: string; name: string }[]>(await owner.get("/api/catalogue/qualities"));
    const product = json<Product>(
      await owner.request({
        method: "POST",
        url: "/api/catalogue/products",
        payload: {
          categoryId: cats.find((c) => c.code === "SUB")!.id,
          qualityId: quals.find((q) => q.name === "Eco")!.id,
          gsm: 29,
          defaultLengthM: 1000,
          widthsIn: [44, 48, 60],
        },
      }),
    );
    const byWidth = (w: string) => product.skus.find((s) => s.widthIn === w)!.id;
    [sku44, sku48, sku60] = [byWidth("44"), byWidth("48"), byWidth("60")];
  });
  afterAll(() => t.close());

  it("UAT 11.1 — PO with 3 SKUs is created and approved", async () => {
    const line = (skuId: string, widthIn: number, quantityM: number, ratePerM: string) => ({
      skuId,
      description: `Eco Paper ${widthIn}* 29 GSM`,
      gsm: 29,
      widthIn,
      quantityM,
      ratePerM,
      gstRate: "18",
    });
    const created = await owner.request({
      method: "POST",
      url: "/api/purchase-orders",
      payload: {
        supplierId,
        date: today,
        lines: [
          line(sku44, 44, 10000, "4.90"),
          line(sku60, 60, 5000, "6.68"),
          line(sku48, 48, 2000, "5.35"),
        ],
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    po = json<Po>(created);
    expect(po).toMatchObject({ status: "Draft" });
    const approved = await owner.request({
      method: "POST",
      url: `/api/purchase-orders/${po.id}/approve`,
      payload: { version: po.version },
    });
    expect(approved.statusCode, approved.body).toBe(200);
    po = json<Po>(approved);
    expect(po.status).toBe("Approved");
  });

  it("UAT 11.1 — partial GRN (2 of 3 SKUs) creates barcoded rolls; unknown items arrive Unmapped", async () => {
    const created = await owner.request({
      method: "POST",
      url: "/api/goods-receipts",
      payload: {
        supplierId,
        poId: po.id,
        date: today,
        supplierInvoiceNo: "2455",
        supplierBatchRef: "CONT-13",
        lines: [
          {
            poLineId: po.lines[0]!.id,
            skuId: sku44,
            description: "Eco Papers 44* 29 GSM",
            gsm: 29,
            widthIn: 44,
            rolls: "10 X 1000 MTRS",
          },
          // Raw attributes only — the rolls arrive Unmapped and are mapped below.
          {
            poLineId: po.lines[1]!.id,
            description: "Eco Paper 60* 29 GSM",
            gsm: 29,
            widthIn: 60,
            rolls: "4 X 1000, 500+450 MTRS",
          },
        ],
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    grn = json<Grn>(created);
    const posted = await owner.request({
      method: "POST",
      url: `/api/goods-receipts/${grn.id}/post`,
      payload: { version: grn.version },
    });
    expect(posted.statusCode, posted.body).toBe(200);
    grn = json<Grn>(posted);
    expect(grn).toMatchObject({ status: "Posted", rollCount: 16, unmappedRolls: 6 });

    const rolls = await rollsOf(grn.id);
    expect(rolls).toHaveLength(16);
    expect(
      rolls
        .filter((r) => r.status === "Unmapped")
        .map((r) => r.originalLengthM)
        .sort(),
    ).toEqual([1000, 1000, 1000, 1000, 450, 500].sort());
    // Barcodes: valid check characters and consecutive roll sequences in one batch.
    const parsed = rolls.map((r) => parseRollBarcode(r.barcode));
    expect(parsed.every((p) => p.valid)).toBe(true);
    expect(parsed.map((p) => (p.valid ? p.rollSeq : 0)).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 16 }, (_, i) => i + 1),
    );
    expect(rolls[0]!.barcode).toMatch(/^\d{4}-SBC-0001-/);

    po = json<Po>(await owner.get(`/api/purchase-orders/${po.id}`));
    expect(po.status).toBe("PartiallyReceived");
    expect(po.lines.map((l) => l.receivedM)).toEqual([10000, 4950, 0]);
  });

  it("UAT 11.1 — bulk-map the Unmapped rolls to a SKU", async () => {
    const unmapped = (await rollsOf(grn.id)).filter((r) => r.status === "Unmapped");
    const wrong = await owner.request({
      method: "POST",
      url: "/api/rolls/map",
      payload: { rollIds: unmapped.map((r) => r.id), skuId: sku44 },
    });
    expect(wrong.statusCode).toBe(400); // 60″ rolls can't become a 44″ SKU
    const res = await owner.request({
      method: "POST",
      url: "/api/rolls/map",
      payload: { rollIds: unmapped.map((r) => r.id), skuId: sku60 },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(json(res)).toEqual({ mapped: 6, skuId: sku60 });
    expect((await rollsOf(grn.id)).every((r) => r.status === "Mapped")).toBe(true);
  });

  it("UAT 11.1 — raise the PI: totals match the supplier's invoice to the rupee; rolls take its rates", async () => {
    const created = await owner.request({
      method: "POST",
      url: "/api/purchase-invoices",
      payload: {
        supplierId,
        supplierInvoiceNo: "2455",
        supplierInvoiceDate: today,
        poId: po.id,
        grnIds: [grn.id],
        roundOff: "0.12",
        lines: [
          {
            poLineId: po.lines[0]!.id,
            skuId: sku44,
            description: "Eco Papers 44* 29 GSM",
            gsm: 29,
            widthIn: 44,
            hsnCode: "48099000",
            quantityM: 10000,
            ratePerM: "4.90",
            gstRate: "18",
          },
          {
            poLineId: po.lines[1]!.id,
            skuId: sku60,
            description: "Eco Paper 60* 29 GSM",
            gsm: 29,
            widthIn: 60,
            hsnCode: "48099000",
            quantityM: 4950,
            ratePerM: "6.68",
            gstRate: "18",
          },
        ],
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const draft = json<{ id: string; version: number }>(created);
    piId = draft.id;
    const posted = await owner.request({
      method: "POST",
      url: `/api/purchase-invoices/${piId}/post`,
      payload: { version: draft.version },
    });
    expect(posted.statusCode, posted.body).toBe(200);
    expect(json(posted)).toMatchObject({
      status: "Posted",
      piNo: expect.stringMatching(/^PI\/\d{4}\/00001$/),
      rollCount: 16,
      totals: {
        taxable: "82066.00",
        cgst: "7385.94",
        sgst: "7385.94",
        roundOff: "0.12",
        total: "96838.00",
      },
    });
    const rolls = await rollsOf(grn.id);
    expect(rolls.find((r) => r.widthIn === "44")!.baseCostPerM).toBe("4.9");
    expect(rolls.find((r) => r.widthIn === "60")!.baseCostPerM).toBe("6.68");
    expect((await events("PI_POSTED")).some((e) => e.docId === piId)).toBe(true);
  });

  it("UAT 11.1 — landed cost by METER: per-roll shares sum to the charge to the paisa", async () => {
    const charges = {
      charges: [
        { code: "FREIGHT", amount: "1495.00", basis: "METER", vendorName: "Patel Roadways" },
      ],
    };
    const preview = json<{
      charges: { amount: string; allocated: string }[];
      rows: { lengthM: number; shares: Record<string, string> }[];
    }>(
      await owner.request({
        method: "POST",
        url: `/api/purchase-invoices/${piId}/landed-cost/preview`,
        payload: charges,
      }),
    );
    expect(preview.charges[0]).toMatchObject({ amount: "1495.00", allocated: "1495.00" });
    // 14,950 m in all → ₹0.10 per metre.
    expect(preview.rows.find((r) => r.lengthM === 450)!.shares.FREIGHT).toBe("45.00");

    const applied = await owner.request({
      method: "POST",
      url: `/api/purchase-invoices/${piId}/landed-cost`,
      payload: charges,
    });
    expect(applied.statusCode, applied.body).toBe(200);
    const rolls = await rollsOf(grn.id);
    // 44″ roll: (₹4,900 base + ₹100 freight) ÷ 1000 m.
    expect(rolls.find((r) => r.widthIn === "44")!.landedCostPerM).toBe("5");
    expect(
      json<{ landedCostAllocated: boolean }>(await owner.get(`/api/purchase-invoices/${piId}`))
        .landedCostAllocated,
    ).toBe(true);
    expect((await events("LANDED_COST_ALLOCATED")).length).toBe(1);
  });

  it("landed cost can be reversed with a reason; rolls give their share back", async () => {
    const [charge] = json<{ id: string }[]>(
      await owner.get(`/api/purchase-invoices/${piId}/landed-cost`),
    );
    const noReason = await owner.request({
      method: "POST",
      url: `/api/landed-cost-charges/${charge!.id}/reverse`,
    });
    expect(noReason.statusCode).toBe(422);
    const res = await owner.request({
      method: "POST",
      url: `/api/landed-cost-charges/${charge!.id}/reverse`,
      reason: "Freight bill was for another lot",
    });
    expect(res.statusCode, res.body).toBe(200);
    expect((await rollsOf(grn.id)).find((r) => r.widthIn === "44")!.landedCostPerM).toBe("4.9");
    // Re-apply for the inventory checks below.
    await owner.request({
      method: "POST",
      url: `/api/purchase-invoices/${piId}/landed-cost`,
      payload: { charges: [{ code: "FREIGHT", amount: "1495.00", basis: "METER" }] },
    });
  });

  it("UAT 11.1 — GRN over-receipt is blocked without approval; approval with a reason is audited", async () => {
    const draft = json<Grn>(
      await owner.request({
        method: "POST",
        url: "/api/goods-receipts",
        payload: {
          supplierId,
          poId: po.id,
          date: today,
          lines: [
            {
              poLineId: po.lines[2]!.id,
              skuId: sku48,
              description: "Eco 48* 29 GSM",
              gsm: 29,
              widthIn: 48,
              rolls: "3 x 1000",
            },
          ],
        },
      }),
    );
    const blocked = await owner.request({
      method: "POST",
      url: `/api/goods-receipts/${draft.id}/post`,
      payload: { version: draft.version },
    });
    expect(blocked.statusCode).toBe(422);
    expect(json(blocked)).toMatchObject({
      code: "APPROVAL_REQUIRED",
      issues: [{ message: expect.stringMatching(/3,000 m against 2,000 m/) }],
    });

    const noReason = await owner.request({
      method: "POST",
      url: `/api/goods-receipts/${draft.id}/post-over-receipt`,
      payload: { version: draft.version },
    });
    expect(noReason.statusCode).toBe(422);
    const approved = await owner.request({
      method: "POST",
      url: `/api/goods-receipts/${draft.id}/post-over-receipt`,
      payload: { version: draft.version },
      reason: "Supplier sent one extra roll; accepted at the same rate",
    });
    expect(approved.statusCode, approved.body).toBe(200);
    expect(json(approved)).toMatchObject({
      status: "Posted",
      overReceiptApprovedByName: "Test Owner",
    });
    const audit = json<{ items: { reason: string | null }[] }>(
      await owner.get(`/api/audit?table=goods_receipts&rowId=${draft.id}`),
    );
    expect(
      audit.items.some(
        (i) => i.reason === "Supplier sent one extra roll; accepted at the same rate",
      ),
    ).toBe(true);
    expect(json<Po>(await owner.get(`/api/purchase-orders/${po.id}`)).status).toBe(
      "PartiallyReceived",
    );
  });

  it("UAT 11.1 — a PI line without a PO line warns and needs a reason", async () => {
    const draft = json<{ id: string; version: number; linesWithoutPo: number }>(
      await owner.request({
        method: "POST",
        url: "/api/purchase-invoices",
        payload: {
          supplierId,
          supplierInvoiceNo: "2460",
          supplierInvoiceDate: today,
          lines: [
            {
              description: "Eco 44* 29 GSM (spot buy)",
              gsm: 29,
              widthIn: 44,
              hsnCode: "48099000",
              quantityM: 1000,
              ratePerM: "4.95",
              gstRate: "18",
            },
          ],
        },
      }),
    );
    expect(draft.linesWithoutPo).toBe(1);
    const noReason = await owner.request({
      method: "POST",
      url: `/api/purchase-invoices/${draft.id}/post`,
      payload: { version: draft.version },
    });
    expect(noReason.statusCode).toBe(422);
    expect(json(noReason)).toMatchObject({ code: "REASON_REQUIRED" });
    const ok = await owner.request({
      method: "POST",
      url: `/api/purchase-invoices/${draft.id}/post`,
      payload: { version: draft.version },
      reason: "Spot purchase without a PO",
    });
    expect(ok.statusCode, ok.body).toBe(200);
    const dup = await owner.request({
      method: "POST",
      url: "/api/purchase-invoices",
      payload: {
        supplierId,
        supplierInvoiceNo: "2460",
        supplierInvoiceDate: today,
        lines: [
          {
            description: "Spot buy",
            gsm: 29,
            widthIn: 44,
            hsnCode: "48099000",
            quantityM: 1,
            ratePerM: "1",
            gstRate: "18",
          },
        ],
      },
    });
    expect(dup.statusCode).toBe(409); // the same supplier invoice can't be entered twice
  });

  it("UAT 11.2 — scanning a roll shows its lineage: supplier → lot → GRN → PI → cost", async () => {
    const roll = (await rollsOf(grn.id)).find((r) => r.widthIn === "44")!;
    const res = await owner.get(`/api/rolls/${encodeURIComponent(roll.barcode.toLowerCase())}`);
    expect(res.statusCode, res.body).toBe(200);
    const inspector = json<{
      supplierName: string;
      supplierBatchRef: string;
      grnNo: string;
      piNo: string;
      landedCost: string;
      events: { kind: string; title: string }[];
    }>(res);
    expect(inspector).toMatchObject({
      supplierName: "Shree Balajee & Co",
      supplierBatchRef: "CONT-13",
      grnNo: grn.grnNo,
      landedCost: "100.00",
    });
    expect(inspector.piNo).toMatch(/^PI\//);
    // One "received" entry (who posted it, supplier, lot, length), then cost entries.
    expect(inspector.events.map((e) => e.kind)).toEqual(
      expect.arrayContaining(["DOCUMENT", "COST"]),
    );
    expect(inspector.events.filter((e) => e.title.startsWith("Received on"))).toHaveLength(1);
    const tampered = roll.barcode.slice(0, -1) + (roll.barcode.endsWith("0") ? "1" : "0");
    const bad = await owner.get(`/api/rolls/${tampered}`);
    expect(bad.statusCode).toBe(400);
  });

  it("labels: PDF without cost, logged; a reprint needs a reason", async () => {
    const res = await owner.request({
      method: "POST",
      url: "/api/labels",
      payload: { grnId: grn.id },
    });
    expect(res.statusCode, res.body.slice(0, 200)).toBe(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
    expect(res.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
    const reprint = await owner.request({
      method: "POST",
      url: "/api/labels",
      payload: { rollIds: [(await rollsOf(grn.id))[0]!.id], reprint: true },
    });
    expect(reprint.statusCode).toBe(422);
    const roll = (await rollsOf(grn.id))[0]!;
    const inspector = json<{ labelPrints: number }>(await owner.get(`/api/rolls/${roll.id}`));
    expect(inspector.labelPrints).toBe(1);
  });

  it("big batches queue for the worker: job status, and no file until it is rendered", async () => {
    const queued = await owner.request({
      method: "POST",
      url: "/api/labels/jobs",
      payload: { grnId: grn.id },
    });
    expect(queued.statusCode, queued.body).toBe(202);
    const { jobId, count } = json<{ jobId: string; count: number }>(queued);
    expect(count).toBe(16);
    const status = json<{ state: string; count: number; fileName: string | null }>(
      await owner.get(`/api/labels/jobs/${jobId}`),
    );
    expect(status).toMatchObject({ count: 16, fileName: null });
    expect(["waiting", "active", "delayed"]).toContain(status.state);
    expect((await owner.get(`/api/labels/jobs/${jobId}/file`)).statusCode).toBe(404);
    expect((await owner.get("/api/labels/jobs/does-not-exist")).statusCode).toBe(404);
  });

  it("stock summary from the views: rolls, metres, value; unmapped and dead-stock counts", async () => {
    expect(
      (await owner.request({ method: "POST", url: "/api/inventory/stock/refresh" })).statusCode,
    ).toBe(204);
    const stock = json<{
      totals: { rolls: number; metres: number; value: string | null; unmappedRolls: number };
    }>(await owner.get("/api/inventory/stock?by=sku"));
    expect(stock.totals).toMatchObject({ rolls: 19, metres: 17950, unmappedRolls: 0 });
    expect(stock.totals.value).not.toBeNull();
  });

  it("purchase return + debit note: rolls go back at the invoiced rate", async () => {
    const roll = (await rollsOf(grn.id)).find(
      (r) => r.widthIn === "60" && r.originalLengthM === 450,
    )!;
    const draft = json<{ id: string; version: number; totals: { taxable: string } }>(
      await owner.request({
        method: "POST",
        url: "/api/purchase-returns",
        payload: {
          supplierId,
          piId,
          date: today,
          reason: "Coating defect on the outer layers",
          rollIds: [roll.id],
        },
      }),
    );
    expect(draft.totals.taxable).toBe("3006.00"); // 450 m × ₹6.68
    const posted = await owner.request({
      method: "POST",
      url: `/api/purchase-returns/${draft.id}/post`,
      payload: { version: draft.version },
    });
    expect(posted.statusCode, posted.body).toBe(200);
    expect(json(posted)).toMatchObject({
      status: "Posted",
      prNo: expect.stringMatching(/^PR\//),
      dnNo: expect.stringMatching(/^DN\//),
      totals: { taxable: "3006.00", cgst: "270.54", total: "3547.00" },
    });
    expect(json<{ status: string }>(await owner.get(`/api/rolls/${roll.id}`)).status).toBe(
      "ReturnedToSupplier",
    );
    const again = await owner.request({
      method: "POST",
      url: "/api/purchase-returns",
      payload: { supplierId, date: today, reason: "again", rollIds: [roll.id] },
    });
    expect(again.statusCode).toBe(400);
  });

  it("UAT 11.2 — scrap needs a reason and writes ROLL_SCRAPPED at landed cost", async () => {
    const roll = (await rollsOf(grn.id)).find((r) => r.widthIn === "44")!;
    const noReason = await owner.request({
      method: "POST",
      url: "/api/rolls/scrap",
      payload: { rollIds: [roll.id] },
    });
    expect(noReason.statusCode).toBe(422);
    const res = await owner.request({
      method: "POST",
      url: "/api/rolls/scrap",
      payload: { rollIds: [roll.id] },
      reason: "Water damage in godown",
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(json(res)).toEqual({ scrapped: 1, value: "5000.00" }); // 1000 m × ₹5.00 landed
    const scrapped = await events("ROLL_SCRAPPED");
    expect(scrapped.at(-1)!.payload).toMatchObject({
      reason: "Water damage in godown",
      total: "5000.00",
    });
  });

  it("warehouse staff receive and map but never see cost", async () => {
    await owner.request({
      method: "POST",
      url: "/api/users",
      payload: {
        name: "Godown",
        email: "godown2@test.local",
        password: "Warehouse-12345",
        roleCodes: ["warehouse"],
      },
    });
    const staff = await Client.signIn(t.fastify, "godown2@test.local", "Warehouse-12345");
    const page = json<{ items: Roll[] }>(await staff.get(`/api/rolls?grnId=${grn.id}`));
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.every((r) => r.baseCostPerM === null && r.landedCostPerM === null)).toBe(
      true,
    );
    expect((await staff.get(`/api/purchase-invoices/${piId}/landed-cost`)).statusCode).toBe(200);
    expect(
      (
        await staff.request({
          method: "POST",
          url: "/api/rolls/scrap",
          payload: { rollIds: [page.items[0]!.id] },
          reason: "x",
        })
      ).statusCode,
    ).toBe(403);
  });
});
