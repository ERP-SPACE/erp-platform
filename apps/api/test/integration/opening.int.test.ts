import { gstinCheckChar, istToday } from "@erp/domain";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { Client, type TestApp, json, startApp } from "./harness.js";

const gstin = (state: string, pan: string) => {
  const first14 = `${state}${pan}1Z`;
  return first14 + gstinCheckChar(first14);
};
const address = { line1: "1 Opening Lane", city: "Surat", state: "Gujarat", pincode: "395003" };
const daysAgo = (n: number) =>
  new Date(Date.parse(`${istToday()}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
const dmy = (iso: string) => iso.split("-").reverse().join("-");

interface Report {
  rowCount: number;
  okCount: number;
  errors: { line: number; column?: string; message: string }[];
  warnings: { line: number; message: string }[];
  total: string;
  metres: number | null;
  rolls: number | null;
  batchId: string | null;
}
interface Status {
  goLiveDate: string | null;
  openingDate: string | null;
  lockedAt: string | null;
  lockedBy: string | null;
  chapters: {
    chapter: string;
    status: string;
    total: string;
    booksTotal: string | null;
    batches: { id: string; status: string; documents: { docNo: string }[]; discardable: boolean }[];
  }[];
  cash: { id: string; version: number; confirmedAt: string | null }[];
  blockers: string[];
}

/**
 * Stage 6 in the API: PRD UAT §11.7 — opening stock imported as Mapped rolls with their landed
 * cost, opening receivables that match the books and behave like invoices (statement, aging,
 * credit, receipts), payables, bank / cash, discard before go-live, confirmation against the
 * books to the paisa, and the Go-Live lock — automatic on the first live posting on/after the
 * go-live date, or by hand — enforced by the database afterwards.
 */
describe("opening balances and go-live (Stage 6, UAT 11.7)", () => {
  let t: TestApp;
  let owner: Client;
  let skuCode: string;
  let supplierCode: string;
  let supplierId: string;
  let customerCode: string;
  let customerId: string;
  const stamp = Date.now().toString(36).toUpperCase();
  const goLive = istToday();
  const opening = daysAgo(1);

  const post = (url: string, payload: unknown) =>
    owner.request({ method: "POST", url, payload: payload as Record<string, unknown> });
  const ok = async <T>(res: Promise<import("fastify").LightMyRequestResponse>) => {
    const r = await res;
    expect([200, 201], r.body).toContain(r.statusCode);
    return json<T>(r);
  };
  const sqlOwner = async <T extends pg.QueryResultRow>(text: string, values: unknown[] = []) => {
    const c = new pg.Client({ connectionString: inject("ownerDatabaseUrl") });
    await c.connect();
    try {
      return (await c.query<T>(text, values)).rows;
    } finally {
      await c.end();
    }
  };
  const upload = (kind: string, csv: string, dryRun = true) =>
    post("/api/opening/uploads", { kind, fileName: `${kind.toLowerCase()}.csv`, csv, dryRun });
  const status = () => owner.get("/api/opening").then((r) => json<Status>(r));
  const chapter = async (code: string) =>
    (await status()).chapters.find((c) => c.chapter === code)!;
  const setGoLive = async (value: string) => {
    const s = json<{ key: string; version: number }[]>(await owner.get("/api/settings")).find(
      (x) => x.key === "golive.date",
    )!;
    const r = await owner.request({
      method: "PATCH",
      url: "/api/settings/golive.date",
      payload: { value, version: s.version },
      reason: "Opening balances test",
    });
    expect(r.statusCode, r.body).toBe(200);
  };

  beforeAll(async () => {
    t = await startApp();
    owner = await Client.signIn(t.fastify);
    const cats = json<{ id: string; code: string }[]>(await owner.get("/api/catalogue/categories"));
    const quals = json<{ id: string; name: string }[]>(await owner.get("/api/catalogue/qualities"));
    // Another file may have made this product already (shared database): reuse it.
    type Product = { gsm: number; qualityName: string; skus: { code: string; widthIn: string }[] };
    const existing = json<Product[]>(await owner.get("/api/catalogue/products")).find(
      (p) => p.gsm === 65 && p.qualityName === "Economy" && p.skus.some((s) => s.widthIn === "44"),
    );
    const product =
      existing ??
      (await ok<Product>(
        post("/api/catalogue/products", {
          categoryId: cats.find((c) => c.code === "SUB")!.id,
          qualityId: quals.find((q) => q.name === "Economy")!.id,
          gsm: 65,
          defaultLengthM: 1000,
          widthsIn: [44],
        }),
      ));
    skuCode = product.skus.find((s) => s.widthIn === "44")!.code;
    const supplier = await ok<{ id: string; code: string }>(
      post("/api/suppliers", {
        name: "Opening Mills",
        shortCode: "QOB",
        stateCode: "24",
        gstin: gstin("24", "AAQFO4321Q"),
        address,
        paymentDays: 30,
      }),
    );
    supplierId = supplier.id;
    supplierCode = supplier.code;
    const customer = await ok<{ id: string; code: string }>(
      post("/api/customers", {
        legalName: "Opening Traders",
        gstType: "Unregistered",
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
      }),
    );
    customerId = customer.id;
    customerCode = customer.code;
  });
  afterAll(async () => {
    // Leave the shared test database as other files expect it: not live, no go-live date.
    await sqlOwner("DELETE FROM go_live");
    await sqlOwner(`UPDATE settings SET value = '""'::jsonb WHERE key = 'golive.date'`);
    await t.close();
  });

  it("asks for the go-live date before anything is imported", async () => {
    const r = await upload("AR", "customer,invoice_no,date,amount\nX,1,01-01-2026,1");
    expect(r.statusCode).toBe(400);
    expect(json<{ title: string }>(r).title).toMatch(/go-live date/);
    await setGoLive(goLive);
    expect(await status()).toMatchObject({
      goLiveDate: goLive,
      openingDate: opening,
      lockedAt: null,
    });
  });

  it("stock roll by roll: checked first, then Mapped rolls with their landed cost (UAT 11.7)", async () => {
    const csv = [
      "supplier,sku,metres,cost_per_m,received_date",
      `${supplierCode},${skuCode},1000,4.9896,${dmy(daysAgo(40))}`,
      `${supplierCode},${skuCode},960,5.10,`,
      `Nobody,${skuCode},10,1,`,
    ].join("\n");
    const dry = await ok<Report>(upload("STOCK_ROLLS", csv));
    expect(dry).toMatchObject({
      rowCount: 3,
      okCount: 2,
      batchId: null,
      total: "9885.60",
      metres: 1960,
      rolls: 2,
    });
    expect(dry.errors).toEqual([
      { line: 4, column: "supplier", message: 'Unknown supplier "Nobody"' },
    ]);
    // With an error nothing is saved, even when asked to.
    expect((await ok<Report>(upload("STOCK_ROLLS", csv, false))).batchId).toBeNull();

    const good = csv.split("\n").slice(0, 3).join("\n");
    const imported = await ok<Report>(upload("STOCK_ROLLS", good, false));
    expect(imported.batchId).toBeTruthy();
    const rows = await sqlOwner<{
      status: string;
      cost_per_m: string;
      current_length_m: number;
      grn_no: string;
      received: string;
    }>(
      `SELECT r.status, r.cost_per_m::text, r.current_length_m, g.grn_no, (r.received_at AT TIME ZONE 'Asia/Kolkata')::date::text AS received
       FROM rolls r JOIN goods_receipts g ON g.id = r.grn_id WHERE g.opening_batch_id = $1 ORDER BY r.roll_seq`,
      [imported.batchId],
    );
    expect(rows).toEqual([
      {
        status: "Mapped",
        cost_per_m: "4.9896",
        current_length_m: 1000,
        grn_no: expect.stringMatching(/^OB\/\d{4}\/\d{5}$/),
        received: daysAgo(40),
      },
      {
        status: "Mapped",
        cost_per_m: "5.1000",
        current_length_m: 960,
        grn_no: rows[0]!.grn_no,
        received: opening,
      },
    ]);
    const stock = await chapter("STOCK");
    expect(stock).toMatchObject({ status: "Draft", total: "9885.60" });
    expect(stock.batches[0]!.documents[0]!.docNo).toBe(rows[0]!.grn_no);
  });

  it("stock per SKU: standard rolls, the last one shorter, value to the paisa (Q41)", async () => {
    const r = await ok<Report>(
      upload(
        "STOCK_SKU",
        `supplier,sku,metres,value\n${supplierCode},${skuCode},2500,12500.01`,
        false,
      ),
    );
    expect(r).toMatchObject({ rolls: 3, metres: 2500, total: "12500.01" });
    const lengths = await sqlOwner<{ l: number; v: string }>(
      `SELECT r.original_length_m AS l, r.base_value::text AS v FROM rolls r JOIN goods_receipts g ON g.id = r.grn_id
       WHERE g.opening_batch_id = $1 ORDER BY r.roll_seq`,
      [r.batchId],
    );
    expect(lengths.map((x) => x.l)).toEqual([1000, 1000, 500]);
    expect(lengths.reduce((s, x) => s + Number(x.v), 0).toFixed(2)).toBe("12500.01");
  });

  it("a chapter is confirmed only when it matches the books to the paisa (Q43)", async () => {
    const wrong = await post("/api/opening/chapters/STOCK/confirm", { booksTotal: "22385.60" });
    expect(wrong.statusCode).toBe(400);
    expect(json<{ title: string }>(wrong).title).toMatch(/difference ₹0\.01/);
    const s = await ok<Status>(
      post("/api/opening/chapters/STOCK/confirm", { booksTotal: "22385.61" }),
    );
    expect(s.chapters.find((c) => c.chapter === "STOCK")).toMatchObject({
      status: "Confirmed",
      booksTotal: "22385.61",
    });
  });

  it("opening receivables: unknown customers flagged; imported invoices behave like invoices (UAT 11.7)", async () => {
    const no1 = `R/${stamp}/1`;
    const no2 = `R/${stamp}/2`;
    const dry = await ok<Report>(
      upload(
        "AR",
        [
          "customer,invoice_no,date,amount,due_date",
          `${customerCode},${no1},${dmy(daysAgo(80))},"8,260.00",${dmy(daysAgo(50))}`,
          `Opening Traders,${no2},${daysAgo(10)},1500.50,`,
          `Unknown Co,X,${daysAgo(10)},5,`,
        ].join("\n"),
      ),
    );
    expect(dry.errors.map((e) => e.message)).toEqual([
      'Unknown customer "Unknown Co" — add them first or use their code',
    ]);
    const csv = [
      "customer,invoice_no,date,amount,due_date",
      `${customerCode},${no1},${dmy(daysAgo(80))},"8,260.00",${dmy(daysAgo(50))}`,
      `Opening Traders,${no2},${daysAgo(10)},1500.50,`,
    ].join("\n");
    const r = await ok<Report>(upload("AR", csv, false));
    expect(r).toMatchObject({ okCount: 2, total: "9760.50" });

    // The customer ledger matches the books: ₹9,760.50 owed, under the old numbers.
    const st = json<{ closing: string; entries: { docNo: string; debit: string }[] }>(
      await owner.get(`/api/customers/${customerId}/statement`),
    );
    expect(st.closing).toBe("9760.50");
    expect(st.entries.map((e) => e.docNo)).toEqual([no1, no2]);
    // Aging, credit and receipts treat them as invoices: the old one is overdue.
    const credit = json<{ exposure: string; overdueInvoices: number }>(
      await owner.get(`/api/customers/${customerId}/credit-check`),
    );
    expect(credit).toMatchObject({ exposure: "9760.50", overdueInvoices: 1 });
    const open = json<{ invoices: { docNo: string; outstanding: string }[] }>(
      await owner.get(`/api/customers/${customerId}/open-items`),
    );
    expect(open.invoices.map((i) => [i.docNo, i.outstanding])).toEqual([
      [no1, "8260.00"],
      [no2, "1500.50"],
    ]);
    // No sales revenue, GST or commission from opening invoices.
    const [facts] = await sqlOwner<{ n: number }>(
      "SELECT count(*)::int AS n FROM sales_invoice_lines l JOIN sales_invoices si ON si.id = l.si_id WHERE si.opening_batch_id = $1",
      [r.batchId],
    );
    expect(facts!.n).toBe(0);
    // Importing the same numbers again is caught.
    expect((await ok<Report>(upload("AR", csv))).errors).toHaveLength(2);
    await ok(post("/api/opening/chapters/AR/confirm", { booksTotal: "9760.50" }));
  });

  it("a batch is discarded while untouched, and its chapter needs confirming again", async () => {
    const r = await ok<Report>(
      upload(
        "AR",
        `customer,invoice_no,date,amount\n${customerCode},D/${stamp},${daysAgo(5)},100`,
        false,
      ),
    );
    expect((await chapter("AR")).status).toBe("Draft");
    const d = await post(`/api/opening/batches/${r.batchId}/discard`, {
      reason: "Typed the wrong amount",
    });
    expect(d.statusCode, d.body).toBe(200);
    expect(json<{ status: string }>(d).status).toBe("Discarded");
    const [left] = await sqlOwner<{ n: number }>(
      "SELECT count(*)::int AS n FROM sales_invoices WHERE opening_batch_id = $1",
      [r.batchId],
    );
    expect(left!.n).toBe(0);
    await ok(post("/api/opening/chapters/AR/confirm", { booksTotal: "9760.50" }));
  });

  it("opening payables, and bank / cash confirmed by the accountant", async () => {
    const r = await ok<Report>(
      upload(
        "AP",
        `supplier,invoice_no,date,amount\n${supplierCode},INV-${stamp},${daysAgo(20)},59000`,
        false,
      ),
    );
    expect(r.total).toBe("59000.00");
    const pis = await sqlOwner<{ pi_no: string; total: string }>(
      "SELECT pi_no, total::text FROM purchase_invoices WHERE opening_batch_id = $1",
      [r.batchId],
    );
    expect(pis).toEqual([{ pi_no: expect.stringMatching(/^PI\//), total: "59000.00" }]);
    const open = json<{ invoices: { outstanding: string }[] }>(
      await owner.get(`/api/suppliers/${supplierId}/open-items`),
    );
    expect(open.invoices.map((i) => i.outstanding)).toContain("59000.00");
    await ok(post("/api/opening/chapters/AP/confirm", { booksTotal: "59000.00" }));

    await ok(
      post("/api/opening/cash", {
        name: "HDFC current",
        kind: "BANK",
        bankName: "HDFC Bank",
        accountLast4: "4521",
        balance: "-1250.50",
        asOf: opening,
      }),
    );
    const cash = await ok<{ id: string; version: number }[]>(
      post("/api/opening/cash", {
        name: "Cash in hand",
        kind: "CASH",
        balance: "8000",
        asOf: opening,
      }),
    );
    const early = await post("/api/opening/chapters/CASH/confirm", { booksTotal: "6749.50" });
    expect(json<{ title: string }>(early).title).toMatch(/confirmed by the accountant/);
    for (const a of cash)
      await ok(post(`/api/opening/cash/${a.id}/confirm`, { version: a.version }));
    const s = await ok<Status>(
      post("/api/opening/chapters/CASH/confirm", { booksTotal: "6749.50" }),
    );
    expect(s.blockers).toEqual([]);
  });

  it("the first live posting on/after the go-live date locks it; the database enforces the lock", async () => {
    // A trial receipt dated before go-live doesn't lock.
    const rc = (date: string) =>
      post("/api/receipts", {
        partyId: customerId,
        date,
        mode: "CASH",
        amount: "1000",
        reference: null,
        allocations: [],
      }).then((r) => json<{ id: string; version: number; docNo: string | null }>(r));
    const before = await rc(opening);
    await ok(post(`/api/receipts/${before.id}/post`, { version: before.version }));
    expect((await status()).lockedAt).toBeNull();

    const live = await rc(goLive);
    const posted = await ok<{ docNo: string }>(
      post(`/api/receipts/${live.id}/post`, { version: live.version }),
    );
    const s = await status();
    expect(s.lockedAt).not.toBeNull();
    expect(s.lockedBy).toBe(`RC/PY ${posted.docNo}`);
    expect(s.chapters.every((c) => c.batches.every((b) => !b.discardable))).toBe(true);

    const locked = await upload(
      "AR",
      `customer,invoice_no,date,amount\n${customerCode},L/${stamp},${opening},1`,
      false,
    );
    expect(locked.statusCode).toBe(409);
    expect(json<{ code: string }>(locked).code).toBe("OPENING_LOCKED");
    const stockBatch = (await chapter("STOCK")).batches[0]!;
    expect(
      (await post(`/api/opening/batches/${stockBatch.id}/discard`, { reason: "Too late" }))
        .statusCode,
    ).toBe(409);
    // Even straight to the database (as the app's role), an opening invoice can't be changed.
    const app = new pg.Client({ connectionString: inject("databaseUrl") });
    await app.connect();
    try {
      await expect(
        app.query("UPDATE sales_invoices SET total = total + 1 WHERE opening_batch_id IS NOT NULL"),
      ).rejects.toThrow(/OPENING_LOCKED/);
      await expect(app.query("DELETE FROM go_live")).rejects.toThrow(/permission denied/);
    } finally {
      await app.end();
    }
  });

  it("going live by hand: Owner only, password re-check, typed confirmation, once", async () => {
    await sqlOwner("DELETE FROM go_live");
    expect((await post("/api/opening/go-live", { confirm: "go live" })).statusCode).toBe(400);
    const s = await ok<Status>(post("/api/opening/go-live", { confirm: "GO LIVE" }));
    expect(s).toMatchObject({ lockedBy: "manual" });
    expect((await post("/api/opening/go-live", { confirm: "GO LIVE" })).statusCode).toBe(400);
    const [ev] = await sqlOwner<{ n: number }>(
      "SELECT count(*)::int AS n FROM posting_events WHERE type = 'GO_LIVE'",
    );
    expect(ev!.n).toBeGreaterThanOrEqual(1);
  });
});
