import { createDb, creditPolicies, postingEvents } from "@erp/db";
import { gstinCheckChar, istToday } from "@erp/domain";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { Client, type TestApp, json, startApp } from "./harness.js";

const gstin = (state: string, pan: string) => {
  const first14 = `${state}${pan}1Z`;
  return first14 + gstinCheckChar(first14);
};
const address = { line1: "4 Collection Lane", city: "Surat", state: "Gujarat", pincode: "395003" };
const daysAgo = (n: number) =>
  new Date(Date.parse(`${istToday()}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

interface Receipt {
  id: string;
  docNo: string | null;
  status: string;
  version: number;
  amount: string;
  allocated: string;
  unallocated: string;
  allocations: {
    invoiceId: string;
    amount: string;
    deduction: string;
    reversedAt: string | null;
  }[];
}
interface OpenItems {
  invoices: { id: string; docNo: string; outstanding: string }[];
  credits: { source: string; id: string; available: string }[];
}
interface Entry {
  sourceType: string;
  amount: string;
  reversalReason: string | null;
  status: string;
  invoiceId: string;
}

/**
 * Stage 4 gate in the API: PRD UAT §11.5 (receipt → 2 invoices → aging updated, nothing
 * unallocated) and §11.6 (ON_SI_POSTED commission, reversed by a credit note), plus partial and
 * on-account money, TDS, a bounce, pro-rata commission, payouts, supplier payments with the
 * Owner's approval, exposure and the nightly credit check.
 */
describe("collections, credit & commission (Stage 4 gate)", () => {
  let t: TestApp;
  let owner: Client;
  let sku: string;
  let rolls: string[];
  let salesmanId: string;
  let custA: string; // ON_SI_POSTED 1 %
  let custB: string; // ON_PAYMENT_RECEIVED 1 %
  let custLate: string; // 0 credit days, for the nightly check
  const today = istToday();

  const post = (url: string, payload: unknown, reason?: string) =>
    owner.request({ method: "POST", url, payload: payload as Record<string, unknown>, reason });
  const ok = async <T>(res: Promise<import("fastify").LightMyRequestResponse>) => {
    const r = await res;
    expect([200, 201], r.body).toContain(r.statusCode);
    return json<T>(r);
  };
  const events = async (type: string) => {
    const h = createDb(inject("ownerDatabaseUrl"), { max: 1 });
    try {
      return await h.db.select().from(postingEvents).where(eq(postingEvents.type, type));
    } finally {
      await h.close();
    }
  };
  const policy = async (customerId: string) => {
    const h = createDb(inject("ownerDatabaseUrl"), { max: 1 });
    try {
      return (
        await h.db.select().from(creditPolicies).where(eq(creditPolicies.customerId, customerId))
      )[0]!;
    } finally {
      await h.close();
    }
  };
  let nextRoll = 0;
  /** A posted invoice for one 1000 m roll at ₹7.00/m: ₹7,000 + 18 % = ₹8,260. */
  const invoice = async (customerId: string, date = today) => {
    let pf = await ok<{ id: string; version: number; lines: { id: string }[] }>(
      post("/api/proformas", {
        customerId,
        date,
        lines: [{ skuId: sku, metres: 1000, ratePerM: "7.00" }],
      }),
    );
    pf = await ok<typeof pf>(post(`/api/proformas/${pf.id}/send`, { version: pf.version }));
    const draft = await ok<{ id: string; version: number }>(
      post("/api/sales-invoices", {
        source: "PROFORMA",
        proformaId: pf.id,
        date,
        rolls: [{ lineId: pf.lines[0]!.id, rollId: rolls[nextRoll++] }],
      }),
    );
    const si = await ok<{ id: string; siNo: string; totals: { total: string } }>(
      post(`/api/sales-invoices/${draft.id}/post`, { version: draft.version }),
    );
    expect(si.totals.total).toBe("8260.00");
    return si;
  };
  const receipt = (
    customerId: string,
    amount: string,
    allocations: { invoiceId: string; amount: string; deduction?: string }[],
    mode = "NEFT",
  ) =>
    ok<Receipt>(
      post("/api/receipts", {
        partyId: customerId,
        date: today,
        mode,
        amount,
        reference: "UTR-1",
        allocations,
      }),
    );
  const postReceipt = (r: Receipt) =>
    ok<Receipt>(post(`/api/receipts/${r.id}/post`, { version: r.version }));
  const open = (customerId: string) =>
    owner.get(`/api/customers/${customerId}/open-items`).then((r) => json<OpenItems>(r));
  const entries = (q = "") =>
    owner.get(`/api/commission/entries?salesmanId=${salesmanId}${q}`).then((r) => json<Entry[]>(r));

  beforeAll(async () => {
    t = await startApp();
    owner = await Client.signIn(t.fastify);
    const cats = json<{ id: string; code: string }[]>(await owner.get("/api/catalogue/categories"));
    const quals = json<{ id: string; name: string }[]>(await owner.get("/api/catalogue/qualities"));
    const product = await ok<{ id: string; skus: { id: string }[] }>(
      post("/api/catalogue/products", {
        categoryId: cats.find((c) => c.code === "SUB")!.id,
        qualityId: quals.find((q) => q.name === "Standard")!.id,
        gsm: 35,
        defaultLengthM: 1000,
        widthsIn: [44],
      }),
    );
    sku = product.skus[0]!.id;
    const supplier = await ok<{ id: string }>(
      post("/api/suppliers", {
        name: "Collections Mills",
        shortCode: "QCL",
        stateCode: "24",
        gstin: gstin("24", "AAQFC4321Q"),
        address,
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
            description: "Sub 35",
            gsm: 35,
            widthIn: 44,
            quantityM: 12000,
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
            description: "Sub 35",
            gsm: 35,
            widthIn: 44,
            rolls: "12 x 1000",
          },
        ],
      }),
    );
    await ok(post(`/api/goods-receipts/${grn.id}/post`, { version: grn.version }));
    rolls = json<{ items: { id: string; barcode: string }[] }>(
      await owner.get(`/api/rolls?grnId=${grn.id}&limit=20`),
    )
      .items.sort((a, b) => a.barcode.localeCompare(b.barcode))
      .map((r) => r.id);

    salesmanId = (await ok<{ id: string }>(post("/api/salesmen", { name: "Commission Kumar" }))).id;
    // Unregistered (B2C) buyers: no IRN, so back-dated invoices are allowed for the overdue test.
    const customer = (legalName: string, creditDays = 30, graceDays = 15) =>
      ok<{ id: string }>(
        post("/api/customers", {
          legalName,
          gstType: "Unregistered",
          stateCode: "24",
          billingAddress: address,
          contacts: [],
          salesmanId,
          creditPolicy: {
            creditLimit: "500000",
            creditDays,
            graceDays,
            autoBlock: true,
            blockRule: "BOTH",
          },
        }),
      ).then((c) => c.id);
    custA = await customer("Collect A Prints");
    custB = await customer("Collect B Prints");
    custLate = await customer("Collect Late Prints", 0, 0);
    const rule = (customerId: string, triggerEvent: string) =>
      ok(
        post(`/api/salesmen/${salesmanId}/commission-rules`, {
          customerId,
          method: "PERCENT_SALES",
          rate: "1",
          triggerEvent,
          validFrom: daysAgo(30),
        }),
      );
    await rule(custA, "ON_SI_POSTED");
    await rule(custB, "ON_PAYMENT_RECEIVED");
  });
  afterAll(() => t.close());

  it("UAT 11.5: a receipt allocated to 2 invoices clears them; aging updated, nothing unallocated", async () => {
    const one = await invoice(custA);
    const two = await invoice(custA);
    const before = json<{ rows: { partyId: string; total: string }[] }>(
      await owner.get("/api/aging?partyType=CUSTOMER"),
    );
    expect(before.rows.find((r) => r.partyId === custA)?.total).toBe("16520.00");

    const suggestion = json<{
      lines: { invoiceId: string; amount: string }[];
      unallocated: string;
    }>(await owner.get(`/api/customers/${custA}/allocation-suggestion?amount=16520`));
    expect(suggestion.lines.map((l) => l.amount)).toEqual(["8260.00", "8260.00"]);
    expect(suggestion.unallocated).toBe("0.00");

    let r = await receipt(custA, "16520", suggestion.lines);
    expect(r).toMatchObject({ status: "Draft", docNo: null });
    r = await postReceipt(r);
    expect(r.docNo).toMatch(/^RC\/\d{4}\/\d{5}$/);
    expect(r).toMatchObject({ status: "Posted", allocated: "16520.00", unallocated: "0.00" });
    expect((await open(custA)).invoices.map((i) => i.id)).not.toContain(one.id);
    expect((await open(custA)).invoices.map((i) => i.id)).not.toContain(two.id);
    const after = json<{ rows: { partyId: string }[] }>(
      await owner.get("/api/aging?partyType=CUSTOMER"),
    );
    expect(after.rows.find((x) => x.partyId === custA)).toBeUndefined();

    const st = json<{ closing: string; entries: { docType: string }[] }>(
      await owner.get(`/api/customers/${custA}/statement`),
    );
    expect(st.closing).toBe("0.00");
    expect(st.entries.map((e) => e.docType)).toEqual(["SI", "SI", "RC"]);
    const ev = (await events("RECEIPT_POSTED")).find((e) => e.docId === r.id)!;
    expect(ev.payload).toMatchObject({
      amount: "16520.00",
      allocated: "16520.00",
      onAccount: "0.00",
    });
    // Posted receipts are frozen.
    expect(
      (
        await owner.request({
          method: "PATCH",
          url: `/api/receipts/${r.id}`,
          payload: {
            partyId: custA,
            date: today,
            mode: "CASH",
            amount: "1",
            allocations: [],
            version: r.version,
          },
        })
      ).statusCode,
    ).toBe(400);
  });

  it("UAT 11.6: ON_SI_POSTED commission accrues on posting; a credit note reverses its share with the reason", async () => {
    const si = await invoice(custA);
    let mine = (await entries()).filter((e) => e.invoiceId === si.id);
    // 1 % of ₹7,000 taxable.
    expect(mine).toMatchObject([
      { sourceType: "SI", amount: "70.00", status: "Accrued", reversalReason: null },
    ]);

    const draft = await ok<{ id: string; version: number }>(
      post("/api/customer-notes", {
        kind: "CREDIT",
        customerId: custA,
        siId: si.id,
        date: today,
        reasonCode: "RATE_DIFFERENCE",
        reason: "Rate revised by ₹1/m",
        lines: [
          {
            description: "Rate difference",
            hsnCode: "48239090",
            taxable: "1000.00",
            gstRate: "18",
          },
        ],
      }),
    );
    const cn = await ok<{ noteNo: string }>(
      post(`/api/customer-notes/${draft.id}/post`, { version: draft.version }),
    );
    mine = (await entries()).filter((e) => e.invoiceId === si.id);
    const reversal = mine.find((e) => e.sourceType === "CN")!;
    expect(reversal.amount).toBe("-10.00");
    expect(reversal.reversalReason).toBe(`Credit note ${cn.noteNo}: Rate revised by ₹1/m`);
  });

  it("part payment, money on account applied later, and TDS that closes an invoice", async () => {
    const a = await invoice(custA);
    const b = await invoice(custA);
    // ₹10,000 against A (₹8,260) → ₹1,740 on account.
    const r = await postReceipt(
      await receipt(custA, "10000", [{ invoiceId: a.id, amount: "8260" }]),
    );
    expect(r.unallocated).toBe("1740.00");
    let items = await open(custA);
    expect(items.credits).toContainEqual(
      expect.objectContaining({ source: "RECEIPT", id: r.id, available: "1740.00" }),
    );
    const listed = json<{ id: string }[]>(
      await owner.get(`/api/receipts?partyId=${custA}&onAccount=true`),
    );
    expect(listed.map((x) => x.id)).toContain(r.id);

    items = json<OpenItems>(
      await await post(`/api/customers/${custA}/apply-credit`, {
        source: "RECEIPT",
        sourceId: r.id,
        allocations: [{ invoiceId: b.id, amount: "1740" }],
      }),
    );
    expect(items.invoices.find((i) => i.id === b.id)?.outstanding).toBe("6520.00");
    expect(items.credits.find((c) => c.id === r.id)).toBeUndefined();
    // Spending it twice is refused.
    expect(
      (
        await post(`/api/customers/${custA}/apply-credit`, {
          source: "RECEIPT",
          sourceId: r.id,
          allocations: [{ invoiceId: b.id, amount: "1" }],
        })
      ).statusCode,
    ).toBe(400);

    // The customer pays ₹6,513.48 and deducts ₹6.52 TDS (0.1 % of ₹6,520, Q32): settled.
    await postReceipt(
      await receipt(custA, "6513.48", [{ invoiceId: b.id, amount: "6513.48", deduction: "6.52" }]),
    );
    expect((await open(custA)).invoices.find((i) => i.id === b.id)).toBeUndefined();
    const st = json<{ entries: { docType: string; credit: string }[] }>(
      await owner.get(`/api/customers/${custA}/statement`),
    );
    expect(st.entries).toContainEqual(expect.objectContaining({ docType: "TDS", credit: "6.52" }));
  });

  it("refuses allocations an invoice can't take", async () => {
    const si = await invoice(custA);
    const over = await receipt(custA, "9000", [{ invoiceId: si.id, amount: "9000" }]);
    const res = await post(`/api/receipts/${over.id}/post`, { version: over.version });
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(json(res))).toMatch(/more than the ₹8260.00 outstanding/);
    const bad = await post("/api/receipts", {
      partyId: custA,
      date: today,
      mode: "CHEQUE",
      amount: "100",
      allocations: [],
    });
    expect(bad.statusCode).toBe(400); // a cheque needs its number
    await ok(post(`/api/receipts/${over.id}/cancel`, { version: over.version }));
  });

  it("ON_PAYMENT_RECEIVED: commission pro-rata to payments; a bounced cheque reverses its share and the invoice owes again", async () => {
    const si = await invoice(custB);
    expect((await entries()).filter((e) => e.invoiceId === si.id)).toEqual([]);
    const half = await postReceipt(
      await receipt(custB, "4130", [{ invoiceId: si.id, amount: "4130" }], "CHEQUE"),
    );
    let mine = (await entries()).filter((e) => e.invoiceId === si.id);
    expect(mine.map((e) => e.amount)).toEqual(["35.00"]);

    const noReason = await post(`/api/receipts/${half.id}/reverse`, {
      version: half.version,
      kind: "BOUNCED",
    });
    expect(json(noReason)).toMatchObject({ code: "REASON_REQUIRED" });
    const bounced = await ok<Receipt>(
      post(
        `/api/receipts/${half.id}/reverse`,
        { version: half.version, kind: "BOUNCED" },
        "Cheque returned: insufficient funds",
      ),
    );
    expect(bounced.status).toBe("Reversed");
    expect(bounced.allocations[0]!.reversedAt).not.toBeNull();
    expect((await open(custB)).invoices.find((i) => i.id === si.id)?.outstanding).toBe("8260.00");
    mine = (await entries()).filter((e) => e.invoiceId === si.id);
    expect(mine.map((e) => e.amount).sort()).toEqual(["-35.00", "35.00"]);
    expect(mine.find((e) => e.amount === "-35.00")?.reversalReason).toMatch(
      /bounced: Cheque returned/,
    );
    const st = json<{ entries: { docType: string }[]; closing: string }>(
      await owner.get(`/api/customers/${custB}/statement`),
    );
    expect(st.entries.map((e) => e.docType)).toEqual(["SI", "RC", "REV"]);
    expect(st.closing).toBe("8260.00");

    await postReceipt(await receipt(custB, "8260", [{ invoiceId: si.id, amount: "8260" }]));
    mine = (await entries()).filter((e) => e.invoiceId === si.id);
    expect(mine.reduce((s, e) => s + Number(e.amount), 0)).toBeCloseTo(70, 2);
  });

  it("a payout batch settles accrued commission up to a date, once", async () => {
    const summary = json<
      { salesmanId: string; accrued: string; paid: string; outstanding: string }[]
    >(await owner.get("/api/commission/summary"));
    const mine = summary.find((s) => s.salesmanId === salesmanId)!;
    expect(Number(mine.outstanding)).toBeGreaterThan(0);
    const draft = await ok<{
      id: string;
      version: number;
      status: string;
      gross: string;
      entryCount: number;
    }>(post("/api/commission/payouts", { salesmanId, upTo: today }));
    expect(draft).toMatchObject({ status: "Draft", gross: mine.outstanding });
    expect((await post("/api/commission/payouts", { salesmanId, upTo: today })).statusCode).toBe(
      400,
    );
    const paid = await ok<{
      payoutNo: string;
      status: string;
      net: string;
      gross: string;
      tds: string;
      entries: { status: string }[];
    }>(
      post(`/api/commission/payouts/${draft.id}/pay`, {
        version: draft.version,
        paidOn: today,
        mode: "NEFT",
        reference: "UTR-C1",
        tds: "1.00",
      }),
    );
    expect(paid.payoutNo).toMatch(/^CP\/\d{4}\/\d{5}$/);
    expect(paid).toMatchObject({ status: "Paid", tds: "1.00" });
    expect(Number(paid.net)).toBeCloseTo(Number(paid.gross) - 1, 2);
    expect(paid.entries.every((e) => e.status === "Paid")).toBe(true);
    const twice = await post(`/api/commission/payouts/${draft.id}/pay`, {
      version: draft.version + 1,
      paidOn: today,
      mode: "NEFT",
    });
    expect(json(twice)).toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    const again = json<typeof summary>(await owner.get("/api/commission/summary")).find(
      (s) => s.salesmanId === salesmanId,
    )!;
    expect(again.outstanding).toBe("0.00");
    expect((await events("COMMISSION_PAID")).some((e) => e.docNo === paid.payoutNo)).toBe(true);
  });

  it("exposure counts confirmed orders and dispatched-unbilled goods, never orders on hold", async () => {
    const check = async () =>
      json<{ exposure: string; otherOpenOrders: string; outstanding: string }>(
        await owner.get(`/api/customers/${custLate}/credit-check`),
      );
    const base = await check();
    let so = await ok<{ id: string; version: number; status: string; pendingApproval: boolean }>(
      post("/api/sales-orders", {
        customerId: custLate,
        date: today,
        lines: [{ skuId: sku, totalM: 1000, ratePerM: "7.00" }],
      }),
    );
    if (so.pendingApproval)
      so = await ok(post(`/api/sales-orders/${so.id}/approve-rates`, { version: so.version }));
    so = await ok(post(`/api/sales-orders/${so.id}/confirm`, { version: so.version }));
    expect(so.status).toBe("Confirmed");
    const confirmed = await check();
    expect(Number(confirmed.otherOpenOrders) - Number(base.otherOpenOrders)).toBeCloseTo(8260, 2);
    so = await ok(
      post(`/api/sales-orders/${so.id}/hold`, { version: so.version }, "Waiting for the customer"),
    );
    expect(so.status).toBe("OnHold");
    expect((await check()).otherOpenOrders).toBe(base.otherOpenOrders);
  });

  it("the nightly check blocks an overdue customer and lifts its own block once paid", async () => {
    const late = await invoice(custLate, daysAgo(5)); // 0 credit days + 0 grace → overdue
    let r = json<{ checked: number }>(await post("/api/credit/nightly-check", {}));
    expect(r.checked).toBeGreaterThan(0);
    let p = await policy(custLate);
    expect(p).toMatchObject({ systemBlock: true, manualBlock: false });
    expect(p.systemBlockReason).toMatch(/OVER_DUE/);

    await postReceipt(await receipt(custLate, "8260", [{ invoiceId: late.id, amount: "8260" }]));
    r = json(await post("/api/credit/nightly-check", {}));
    p = await policy(custLate);
    expect(p).toMatchObject({ systemBlock: false, systemBlockReason: null });
  });

  it("supplier payments: allocated to purchase invoices; above the threshold the approver is recorded", async () => {
    const supplier = await ok<{ id: string }>(
      post("/api/suppliers", {
        name: "Payables Mills",
        shortCode: "QPY",
        stateCode: "24",
        gstin: gstin("24", "AAQFP4321Q"),
        address,
        paymentDays: 30,
      }),
    );
    const draft = await ok<{ id: string; version: number }>(
      post("/api/purchase-invoices", {
        supplierId: supplier.id,
        supplierInvoiceNo: "PAY-1",
        supplierInvoiceDate: today,
        lines: [
          {
            description: "Spot paper",
            gsm: 35,
            widthIn: 44,
            hsnCode: "48099000",
            quantityM: 150000,
            ratePerM: "4.00",
            gstRate: "18",
          },
        ],
      }),
    );
    const pi = await ok<{ id: string; totals: { total: string } }>(
      post(`/api/purchase-invoices/${draft.id}/post`, { version: draft.version }, "Spot purchase"),
    );
    expect(pi.totals.total).toBe("708000.00");
    const items = json<OpenItems>(await owner.get(`/api/suppliers/${supplier.id}/open-items`));
    expect(items.invoices.map((i) => i.id)).toEqual([pi.id]);
    let pay = await ok<Receipt>(
      post("/api/supplier-payments", {
        partyId: supplier.id,
        date: today,
        mode: "RTGS",
        amount: "708000",
        reference: "RTGS-9",
        allocations: [{ invoiceId: pi.id, amount: "708000" }],
      }),
    );
    pay = await ok(post(`/api/supplier-payments/${pay.id}/post`, { version: pay.version }));
    expect(pay.docNo).toMatch(/^PY\/\d{4}\/\d{5}$/);
    const ev = (await events("PAYMENT_POSTED")).find((e) => e.docId === pay.id)!;
    expect((ev.payload as { approvedBy: string | null }).approvedBy).not.toBeNull();
    const ap = json<{ rows: { partyId: string }[] }>(
      await owner.get("/api/aging?partyType=SUPPLIER"),
    );
    expect(ap.rows.find((x) => x.partyId === supplier.id)).toBeUndefined();
    const st = json<{ closing: string; entries: { docType: string }[] }>(
      await owner.get(`/api/suppliers/${supplier.id}/statement`),
    );
    expect(st.entries.map((e) => e.docType)).toEqual(["PI", "PY"]);
    expect(st.closing).toBe("0.00");
  });
});
