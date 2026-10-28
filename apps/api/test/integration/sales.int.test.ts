import { createDb, postingEvents } from "@erp/db";
import { gstinCheckChar, istToday } from "@erp/domain";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { Client, type TestApp, json, startApp } from "./harness.js";

const gstin = (state: string, pan: string) => {
  const first14 = `${state}${pan}1Z`;
  return first14 + gstinCheckChar(first14);
};
const address = (state: string, pincode: string) => ({
  line1: "12 Ring Road",
  city: "Surat",
  state,
  pincode,
});

interface Roll {
  id: string;
  barcode: string;
  status: string;
  widthIn: string;
  currentLengthM: number;
}
interface So {
  id: string;
  soNo: string;
  status: string;
  version: number;
  total: string;
  lines: {
    id: string;
    skuId: string;
    needsApproval: boolean;
    derivedRatePerM: string | null;
    rateSource: string;
  }[];
  credit: { blocked: boolean; reasons: string[]; exposure: string; thisOrder: string } | null;
}
interface Dc {
  id: string;
  dcNo: string;
  status: string;
  version: number;
  rolls: { rollId: string; barcode: string; lengthM: number; cutFromBarcode: string | null }[];
  lines: { soLineId: string; pickedM: number; balanceM: number }[];
}
interface Si {
  id: string;
  siNo: string | null;
  status: string;
  version: number;
  cogs: string | null;
  totals: {
    taxable: string;
    cgst: string;
    sgst: string;
    igst: string;
    roundOff: string;
    total: string;
    regime: string;
  };
  einvoice: { status: string };
  lines: { id: string; kind: string; metres: number | null; rolls: { rollId: string }[] }[];
  blockers: string[];
}

/**
 * PRD UAT §11.3 (pricing & sales) and §11.4 (sales return) end to end: 44″ pricing, override
 * approval, credit hold + release, allocation, picking with a cut, dispatch, invoicing with COGS,
 * proforma conversion, a 700-of-1000 m return and the customer ledger.
 */
describe("sales (Stage 3 gate)", () => {
  let t: TestApp;
  let owner: Client;
  let sku44: string;
  let sku36: string;
  let customerA: string;
  let customerB: string;
  let rolls44: Roll[];
  let rolls36: Roll[];
  let so: So;
  let dc: Dc;
  let si: Si;
  const today = istToday();

  const events = async (type: string) => {
    const handle = createDb(inject("ownerDatabaseUrl"), { max: 1 });
    try {
      return await handle.db.select().from(postingEvents).where(eq(postingEvents.type, type));
    } finally {
      await handle.close();
    }
  };
  const post = (url: string, payload: unknown, reason?: string) =>
    owner.request({ method: "POST", url, payload: payload as Record<string, unknown>, reason });
  const ok = async <T>(res: Promise<import("fastify").LightMyRequestResponse>) => {
    const r = await res;
    expect([200, 201], r.body).toContain(r.statusCode);
    return json<T>(r);
  };
  const roll = async (id: string) =>
    json<Roll & { status: string }>(await owner.get(`/api/rolls/${id}`));

  beforeAll(async () => {
    t = await startApp();
    owner = await Client.signIn(t.fastify);
    // Stock: 4 × 1000 m at 44″ (₹4.40) and 1000 + 600 m at 36″ (₹4.00), via PO → GRN.
    const cats = json<{ id: string; code: string }[]>(await owner.get("/api/catalogue/categories"));
    const quals = json<{ id: string; name: string }[]>(await owner.get("/api/catalogue/qualities"));
    const product = await ok<{ id: string; skus: { id: string; widthIn: string }[] }>(
      post("/api/catalogue/products", {
        categoryId: cats.find((c) => c.code === "SUB")!.id,
        qualityId: quals.find((q) => q.name === "Standard")!.id,
        gsm: 100,
        defaultLengthM: 1000,
        widthsIn: [36, 44],
      }),
    );
    sku44 = product.skus.find((s) => s.widthIn === "44")!.id;
    sku36 = product.skus.find((s) => s.widthIn === "36")!.id;
    const supplier = await ok<{ id: string }>(
      post("/api/suppliers", {
        name: "Sales Test Mills",
        shortCode: "QSL",
        stateCode: "24",
        gstin: gstin("24", "AAQFS1234Q"),
        address: address("Gujarat", "394210"),
        paymentDays: 1,
      }),
    );
    const line = (skuId: string, widthIn: number, quantityM: number, ratePerM: string) => ({
      skuId,
      description: `Sublimation 100 GSM ${widthIn}*`,
      gsm: 100,
      widthIn,
      quantityM,
      ratePerM,
      gstRate: "18",
    });
    const po0 = await ok<{ id: string; version: number; lines: { id: string }[] }>(
      post("/api/purchase-orders", {
        supplierId: supplier.id,
        date: today,
        lines: [line(sku44, 44, 4000, "4.40"), line(sku36, 36, 1600, "4.00")],
      }),
    );
    const po = await ok<typeof po0>(
      post(`/api/purchase-orders/${po0.id}/approve`, { version: po0.version }),
    );
    const grn0 = await ok<{ id: string; version: number }>(
      post("/api/goods-receipts", {
        supplierId: supplier.id,
        poId: po.id,
        date: today,
        lines: [
          {
            poLineId: po.lines[0]!.id,
            skuId: sku44,
            description: "Sub 44",
            gsm: 100,
            widthIn: 44,
            rolls: "4 x 1000",
          },
          {
            poLineId: po.lines[1]!.id,
            skuId: sku36,
            description: "Sub 36",
            gsm: 100,
            widthIn: 36,
            rolls: "1000, 600",
          },
        ],
      }),
    );
    await ok(post(`/api/goods-receipts/${grn0.id}/post`, { version: grn0.version }));
    const all = json<{ items: Roll[] }>(
      await owner.get(`/api/rolls?grnId=${grn0.id}&limit=100`),
    ).items;
    rolls44 = all
      .filter((r) => r.widthIn === "44")
      .sort((a, b) => a.barcode.localeCompare(b.barcode));
    rolls36 = all
      .filter((r) => r.widthIn === "36")
      .sort((a, b) => b.currentLengthM - a.currentLengthM);

    // Customer A: Gujarat, ₹1,00,000 limit, 44″ rate ₹6.60. Customer B: Maharashtra, ₹10,000.
    const customer = (legalName: string, state: string, code: string, pan: string, limit: string) =>
      ok<{ id: string }>(
        post("/api/customers", {
          legalName,
          gstType: "Regular",
          gstin: gstin(code, pan),
          stateCode: code,
          billingAddress: address(state, code === "24" ? "395002" : "421302"),
          contacts: [],
          creditPolicy: {
            creditLimit: limit,
            creditDays: 30,
            graceDays: 15,
            autoBlock: true,
            blockRule: "BOTH",
          },
        }),
      );
    customerA = (await customer("Shree Sales Prints", "Gujarat", "24", "AAQCS1111Q", "100000")).id;
    customerB = (await customer("Mumbai Transfer Co", "Maharashtra", "27", "AAQCM2222Q", "10000"))
      .id;
    await ok(
      post(`/api/customers/${customerA}/rates`, {
        productId: product.id,
        baseRate44: "6.60",
        validFrom: today,
      }),
    );
  });
  afterAll(() => t.close());

  it("UAT 11.3 — a 36″ rate is derived from the customer's 44″ rate", async () => {
    const q = json<{
      source: string;
      base44: string;
      ratePerM: string;
      gstRate: string;
      availableM: number;
    }>(await owner.get(`/api/sales-orders/rate-quote?customerId=${customerA}&skuId=${sku36}`));
    expect(q).toMatchObject({
      source: "PARTY_RATE",
      base44: "6.6",
      ratePerM: "5.40",
      gstRate: "18",
      availableM: 1600,
    });
  });

  it("UAT 11.3 — a rate more than 5 % off needs a manager's approval before Confirm", async () => {
    so = await ok<So>(
      post("/api/sales-orders", {
        customerId: customerA,
        date: today,
        lines: [
          { skuId: sku44, totalM: 3000, ratePerM: "6.60" },
          { skuId: sku36, totalM: 1300, ratePerM: "5.80" }, // 7.4 % above ₹5.40
        ],
      }),
    );
    expect(so.soNo).toMatch(/^SO\/\d{4}\/\d{5}$/);
    expect(so.lines.map((l) => l.needsApproval)).toEqual([false, true]);
    // 19,800 + 7,540 = 27,340 taxable; CGST + SGST 9 % each = 4,921.20; 32,261.20 → ₹32,261.
    expect(so.total).toBe("32261.00");
    const blocked = await post(`/api/sales-orders/${so.id}/confirm`, { version: so.version });
    expect(blocked.statusCode).toBe(422);
    expect(json(blocked)).toMatchObject({
      code: "APPROVAL_REQUIRED",
      issues: [{ path: "lines.1.ratePerM" }],
    });
    so = await ok<So>(post(`/api/sales-orders/${so.id}/approve-rates`, { version: so.version }));
    so = await ok<So>(post(`/api/sales-orders/${so.id}/confirm`, { version: so.version }));
    expect(so).toMatchObject({
      status: "Confirmed",
      credit: { blocked: false, thisOrder: "32261.00" },
    });
  });

  it("allocation suggests FIFO full rolls, then remnants, and offers one cut", async () => {
    const preview = json<{
      lines: { status: string; rolls: { lengthM: number }[]; cut: { cutM: number } | null }[];
    }>(await owner.get(`/api/sales-orders/${so.id}/allocation`));
    expect(preview.lines[0]).toMatchObject({ status: "FULFILLED", cut: null });
    expect(preview.lines[0]!.rolls.map((r) => r.lengthM)).toEqual([1000, 1000, 1000]);
    // 1300 m at 36″: the 1000 m roll whole, then 300 m cut from the 600 m remnant.
    expect(preview.lines[1]!.rolls.map((r) => r.lengthM)).toEqual([1000]);
    expect(preview.lines[1]!.cut).toMatchObject({ cutM: 300, leftoverM: 300 });
  });

  it("picking holds rolls; a roll can't be taken twice; over-picking is refused", async () => {
    dc = await ok<Dc>(post("/api/delivery-challans", { soId: so.id, date: today }));
    expect(dc.dcNo).toMatch(/^DC\/\d{4}\/\d{5}$/);
    expect((await post("/api/delivery-challans", { soId: so.id, date: today })).statusCode).toBe(
      400,
    );
    const line44 = so.lines[0]!.id;
    for (const r of rolls44.slice(0, 3)) {
      dc = await ok<Dc>(
        post(`/api/delivery-challans/${dc.id}/pick`, {
          soLineId: line44,
          barcode: r.barcode.toLowerCase(),
        }),
      );
    }
    expect((await roll(rolls44[0]!.id)).status).toBe("Allocated");
    const again = await post(`/api/delivery-challans/${dc.id}/pick`, {
      soLineId: line44,
      rollId: rolls44[0]!.id,
    });
    expect(again.statusCode).toBe(409);
    expect(json(again)).toMatchObject({ code: "ROLL_UNAVAILABLE" });
    const over = await post(`/api/delivery-challans/${dc.id}/pick`, {
      soLineId: line44,
      rollId: rolls44[3]!.id,
    });
    expect(over.statusCode).toBe(400);
    const wrong = await post(`/api/delivery-challans/${dc.id}/pick`, {
      soLineId: so.lines[1]!.id,
      rollId: rolls44[3]!.id,
    });
    expect(wrong.statusCode).toBe(400);
  });

  it("a cut makes a new barcoded piece for the line; the parent stays in stock, shorter", async () => {
    const line36 = so.lines[1]!.id;
    dc = await ok<Dc>(
      post(`/api/delivery-challans/${dc.id}/pick`, { soLineId: line36, rollId: rolls36[0]!.id }),
    );
    const cut = await ok<{
      child: Roll & { rollId: string; lengthM: number };
      parent: { lengthM: number };
      labelRollIds: string[];
    }>(
      post(`/api/delivery-challans/${dc.id}/cut`, {
        soLineId: line36,
        rollId: rolls36[1]!.id,
        cutM: 300,
      }),
    );
    expect(cut.parent.lengthM).toBe(300);
    expect(cut.child.lengthM).toBe(300);
    expect(cut.labelRollIds).toHaveLength(2);
    const parent = await roll(rolls36[1]!.id);
    expect(parent).toMatchObject({
      status: "Mapped",
      currentLengthM: 300,
      barcode: rolls36[1]!.barcode,
    });
    dc = json<Dc>(await owner.get(`/api/delivery-challans/${dc.id}`));
    expect(dc.rolls.find((r) => r.rollId === cut.child.rollId)).toMatchObject({
      cutFromBarcode: rolls36[1]!.barcode,
    });
    expect(dc.lines.map((l) => l.balanceM)).toEqual([0, 0]);
  });

  it("dispatch: rolls go out, the order closes, DC_POSTED is written", async () => {
    dc = await ok<Dc>(post(`/api/delivery-challans/${dc.id}/post`, { version: dc.version }));
    expect(dc.status).toBe("Open");
    expect((await roll(rolls44[0]!.id)).status).toBe("Dispatched");
    so = json<So>(await owner.get(`/api/sales-orders/${so.id}`));
    expect(so.status).toBe("Closed");
    expect((await events("DC_POSTED")).some((e) => e.docId === dc.id)).toBe(true);
  });

  it("UAT 11.3 — SI from the DC: totals, COGS at landed cost, IRN queued, DC closed", async () => {
    si = await ok<Si>(post("/api/sales-invoices", { source: "DC", dcIds: [dc.id], date: today }));
    expect(si).toMatchObject({ status: "Draft", siNo: null, blockers: [] });
    expect(si.totals).toMatchObject({
      taxable: "27340.00",
      cgst: "2460.60",
      sgst: "2460.60",
      total: "32261.00",
      regime: "CGST_SGST",
    });
    si = await ok<Si>(post(`/api/sales-invoices/${si.id}/post`, { version: si.version }));
    expect(si.siNo).toMatch(/^SI\/\d{4}\/\d{5}$/);
    // 3 × 1000 m × ₹4.40 + 1300 m × ₹4.00.
    expect(si.cogs).toBe("18400.00");
    expect(si.einvoice.status).toBe("Pending");
    expect(json<Dc>(await owner.get(`/api/delivery-challans/${dc.id}`)).status).toBe("Closed");
    const ev = (await events("SI_POSTED")).find((e) => e.docId === si.id)!;
    expect(ev.payload).toMatchObject({
      siNo: si.siNo,
      cogs: "18400.00",
      totals: { total: "32261.00" },
    });
    const twice = await post("/api/sales-invoices", { source: "DC", dcIds: [dc.id], date: today });
    expect(twice.statusCode).toBe(400);
  });

  it("UAT 11.3 — a credit-blocked customer's order goes on hold; exposure includes it; release needs a reason", async () => {
    let held = await ok<So>(
      post("/api/sales-orders", {
        customerId: customerB,
        date: today,
        lines: [{ skuId: sku44, totalM: 2000, ratePerM: "6.00" }],
      }),
    );
    // No customer rate yet → any rate is a manager's call.
    expect(held.lines[0]).toMatchObject({ rateSource: "NONE", needsApproval: true });
    held = await ok<So>(
      post(`/api/sales-orders/${held.id}/approve-rates`, { version: held.version }),
    );
    held = await ok<So>(post(`/api/sales-orders/${held.id}/confirm`, { version: held.version }));
    // 12,000 + IGST 2,160 = 14,160 > ₹10,000 limit (inter-state: IGST).
    expect(held).toMatchObject({
      status: "OnHold",
      credit: {
        blocked: true,
        reasons: ["OVER_LIMIT"],
        exposure: "14160.00",
        thisOrder: "14160.00",
      },
    });
    expect((await post("/api/delivery-challans", { soId: held.id, date: today })).statusCode).toBe(
      400,
    );
    const noReason = await post(`/api/sales-orders/${held.id}/release`, { version: held.version });
    expect(noReason.statusCode).toBe(422);
    held = await ok<So>(
      post(
        `/api/sales-orders/${held.id}/release`,
        { version: held.version },
        "Advance cheque received",
      ),
    );
    expect(held.status).toBe("Confirmed");
    // Customer A's exposure now counts the posted invoice.
    const credit = json<{ outstanding: string }>(
      await owner.get(`/api/customers/${customerA}/credit-check`),
    );
    expect(credit.outstanding).toBe("32261.00");
  });

  it("UAT 11.3 — proforma → SI: the proforma is Converted and the SI links back", async () => {
    let pf = await ok<{
      id: string;
      version: number;
      status: string;
      lines: { id: string }[];
      total: string;
    }>(
      post("/api/proformas", {
        customerId: customerA,
        date: today,
        lines: [{ skuId: sku44, metres: 1000, ratePerM: "6.60" }],
      }),
    );
    expect(pf.total).toBe("7788.00");
    pf = await ok<typeof pf>(post(`/api/proformas/${pf.id}/send`, { version: pf.version }));
    expect(pf.status).toBe("Sent");
    let inv = await ok<Si>(
      post("/api/sales-invoices", {
        source: "PROFORMA",
        proformaId: pf.id,
        date: today,
        rolls: [{ lineId: pf.lines[0]!.id, rollId: rolls44[3]!.id }],
      }),
    );
    expect((await roll(rolls44[3]!.id)).status).toBe("Allocated");
    inv = await ok<Si>(post(`/api/sales-invoices/${inv.id}/post`, { version: inv.version }));
    expect(inv.totals.total).toBe("7788.00");
    expect((await roll(rolls44[3]!.id)).status).toBe("Dispatched");
    const after = json<{ status: string; convertedSiId: string; convertedSiNo: string }>(
      await owner.get(`/api/proformas/${pf.id}`),
    );
    expect(after).toMatchObject({
      status: "Converted",
      convertedSiId: inv.id,
      convertedSiNo: inv.siNo,
    });
    // A direct / proforma sale is corrected with a return, not cancelled.
    expect(
      (await post(`/api/sales-invoices/${inv.id}/cancel`, { version: inv.version }, "Wrong rate"))
        .statusCode,
    ).toBe(400);
  });

  it("UAT 11.4 — 700 m of a 1000 m roll back: credit note at 70 %, cost back at 70 %, then scrapped at that cost", async () => {
    const r1 = rolls44[0]!;
    let sr = await ok<{
      id: string;
      version: number;
      total: string;
      rolls: { taxable: string; cost: string }[];
    }>(
      post("/api/sales-returns", {
        siId: si.id,
        date: today,
        reason: "Coating marks",
        rolls: [{ rollId: r1.id, returnedM: 700 }],
      }),
    );
    // The roll's share of its line: ₹19,800 × 1000/3000 = ₹6,600 → 70 % = ₹4,620. Cost ₹4,400 → ₹3,080.
    expect(sr.rolls[0]).toMatchObject({ taxable: "4620.00", cost: "3080.00" });
    expect(sr.total).toBe("5452.00"); // 4,620 + 18 % = 5,451.60
    const dup = await post("/api/sales-returns", {
      siId: si.id,
      date: today,
      reason: "Again",
      rolls: [{ rollId: r1.id, returnedM: 100 }],
    });
    expect(dup.statusCode).toBe(409);
    sr = await ok<typeof sr>(post(`/api/sales-returns/${sr.id}/post`, { version: sr.version }));
    const detail = json<{ srNo: string; cnNo: string; awaitingInspection: number }>(
      await owner.get(`/api/sales-returns/${sr.id}`),
    );
    expect(detail.srNo).toMatch(/^SR\//);
    expect(detail.cnNo).toMatch(/^CN\//);
    expect(detail.awaitingInspection).toBe(1);
    expect(await roll(r1.id)).toMatchObject({
      status: "Returned",
      currentLengthM: 700,
      barcode: r1.barcode,
    });
    await ok(post(`/api/sales-returns/${sr.id}/inspect`, { outcome: "SCRAP", rollId: r1.id }));
    expect((await roll(r1.id)).status).toBe("Scrap");
    const scrapped = (await events("ROLL_SCRAPPED")).find((e) => e.docId === r1.id)!;
    expect(scrapped.payload).toMatchObject({ total: "3080.00" });
  });

  it("the customer ledger: invoices owe, the credit note reduces; ageing by due date", async () => {
    const ledger = json<{
      entries: { docType: string; debit: string; credit: string; balance: string }[];
      closing: string;
      aging: { bucket: string; amount: string }[];
    }>(await owner.get(`/api/customers/${customerA}/ledger`));
    expect(ledger.entries.map((e) => e.docType)).toEqual(["SI", "SI", "CN"]);
    // 32,261 + 7,788 − 5,452.
    expect(ledger.closing).toBe("34597.00");
    expect(ledger.aging[0]).toMatchObject({ bucket: "Not due" });
  });

  it("a posted invoice with a return against it can't be cancelled", async () => {
    const fresh = json<Si>(await owner.get(`/api/sales-invoices/${si.id}`));
    const res = await post(
      `/api/sales-invoices/${si.id}/cancel`,
      { version: fresh.version },
      "Wrong customer",
    );
    expect(res.statusCode).toBe(400);
  });
});
