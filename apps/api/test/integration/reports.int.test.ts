import { REPORT_IDS } from "@erp/contracts";
import { gstinCheckChar, istToday } from "@erp/domain";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { ExportsService } from "../../src/modules/reports/exports.service.js";
import { Client, type TestApp, json, startApp } from "./harness.js";

const gstin = (state: string, pan: string) => {
  const first14 = `${state}${pan}1Z`;
  return first14 + gstinCheckChar(first14);
};
const address = { line1: "5 Report Road", city: "Surat", state: "Gujarat", pincode: "395003" };

interface Report {
  columns: { key: string; kind: string; total?: boolean; cost?: boolean }[];
  rows: {
    cells: Record<string, string | number | null>;
    links?: Record<string, { kind: string; id: string }>;
    tone?: string;
  }[];
  totals: Record<string, string | number | null> | null;
  total: number;
  asOf: string | null;
  series?: { key: string; value: string }[];
}

/**
 * Stage 5 gate in the API: every report reconciles with the documents behind it (sales lines
 * against posted invoices and notes, stock against rolls, purchase variance against PO lines,
 * commission against its entries), totals equal the sum of their rows, cost never reaches a
 * user without `reports.margin.view` (Q36), pivots add up, saved pivots are private until
 * shared (Q39), Today is role-aware, and exports are built as CSV / XLSX / PDF.
 */
describe("reports, pivot, Today and exports (Stage 5 gate)", () => {
  let t: TestApp;
  let owner: Client;
  let exec: Client; // sales executive: no cost, no export
  let sku: string;
  let supplierId: string;
  let salesmanId: string;
  let custA: string;
  let custB: string;
  let si1: { id: string; siNo: string };
  let si2: { id: string; siNo: string };
  let rolls: { id: string; barcode: string }[];
  const today = istToday();

  const post = (c: Client, url: string, payload: unknown, reason?: string) =>
    c.request({ method: "POST", url, payload: payload as Record<string, unknown>, reason });
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
  const refresh = () =>
    sqlOwner("SELECT public.refresh_stock_views(), public.refresh_report_views()");
  const report = (c: Client, id: string, q = "") =>
    c.get(`/api/reports/${id}?pageSize=500&from=${today}&to=${today}${q}`).then((r) => {
      expect(r.statusCode, r.body).toBe(200);
      return json<Report>(r);
    });
  /** A posted invoice through a proforma: one line, `n` rolls of 1000 m. */
  const invoice = async (
    customerId: string,
    rollIds: string[],
    ratePerM: string,
    discountPct = "0",
  ) => {
    let pf = await ok<{ id: string; version: number; lines: { id: string }[] }>(
      post(owner, "/api/proformas", {
        customerId,
        date: today,
        lines: [{ skuId: sku, metres: rollIds.length * 1000, ratePerM, discountPct }],
      }),
    );
    pf = await ok<typeof pf>(post(owner, `/api/proformas/${pf.id}/send`, { version: pf.version }));
    const draft = await ok<{ id: string; version: number }>(
      post(owner, "/api/sales-invoices", {
        source: "PROFORMA",
        proformaId: pf.id,
        date: today,
        rolls: rollIds.map((rollId) => ({ lineId: pf.lines[0]!.id, rollId })),
      }),
    );
    return ok<{ id: string; siNo: string }>(
      post(owner, `/api/sales-invoices/${draft.id}/post`, { version: draft.version }),
    );
  };

  beforeAll(async () => {
    t = await startApp();
    owner = await Client.signIn(t.fastify);
    const cats = json<{ id: string; code: string }[]>(await owner.get("/api/catalogue/categories"));
    const quals = json<{ id: string; name: string }[]>(await owner.get("/api/catalogue/qualities"));
    const product = await ok<{ skus: { id: string }[] }>(
      post(owner, "/api/catalogue/products", {
        categoryId: cats.find((c) => c.code === "SUB")!.id,
        qualityId: quals.find((q) => q.name === "Standard")!.id,
        gsm: 45,
        defaultLengthM: 1000,
        widthsIn: [44],
      }),
    );
    sku = product.skus[0]!.id;
    supplierId = (
      await ok<{ id: string }>(
        post(owner, "/api/suppliers", {
          name: "Report Mills",
          shortCode: "QRP",
          stateCode: "24",
          gstin: gstin("24", "AAQFR4321Q"),
          address,
          paymentDays: 1,
        }),
      )
    ).id;
    const po0 = await ok<{ id: string; version: number; lines: { id: string }[] }>(
      post(owner, "/api/purchase-orders", {
        supplierId,
        date: today,
        lines: [
          {
            skuId: sku,
            description: "Sub 45",
            gsm: 45,
            widthIn: 44,
            quantityM: 8000,
            ratePerM: "4.00",
            gstRate: "18",
          },
        ],
      }),
    );
    const po = await ok<typeof po0>(
      post(owner, `/api/purchase-orders/${po0.id}/approve`, { version: po0.version }),
    );
    const grn = await ok<{ id: string; version: number }>(
      post(owner, "/api/goods-receipts", {
        supplierId,
        poId: po.id,
        date: today,
        lines: [
          {
            poLineId: po.lines[0]!.id,
            skuId: sku,
            description: "Sub 45",
            gsm: 45,
            widthIn: 44,
            rolls: "6 x 1000",
          },
        ],
      }),
    );
    await ok(post(owner, `/api/goods-receipts/${grn.id}/post`, { version: grn.version }));
    rolls = json<{ items: { id: string; barcode: string }[] }>(
      await owner.get(`/api/rolls?grnId=${grn.id}&limit=20`),
    ).items.sort((a, b) => a.barcode.localeCompare(b.barcode));

    salesmanId = (await ok<{ id: string }>(post(owner, "/api/salesmen", { name: "Report Rao" })))
      .id;
    const customer = (legalName: string) =>
      ok<{ id: string }>(
        post(owner, "/api/customers", {
          legalName,
          gstType: "Unregistered",
          stateCode: "24",
          billingAddress: address,
          contacts: [],
          salesmanId,
          creditPolicy: {
            creditLimit: "100000",
            creditDays: 30,
            graceDays: 15,
            autoBlock: true,
            blockRule: "BOTH",
          },
        }),
      ).then((c) => c.id);
    custA = await customer("Report Traders A");
    custB = await customer("Report Prints B");
    await ok(
      post(owner, `/api/salesmen/${salesmanId}/commission-rules`, {
        customerId: custA,
        method: "PERCENT_SALES",
        rate: "2",
        triggerEvent: "ON_SI_POSTED",
        validFrom: today,
      }),
    );

    // A: one line of 2 rolls at ₹7.00 → ₹14,000 (split over two rolls); B: 1 roll at ₹6.50 less 10 %.
    si1 = await invoice(custA, [rolls[0]!.id, rolls[1]!.id], "7.00");
    si2 = await invoice(custB, [rolls[2]!.id], "6.50", "10");
    // A rate-difference credit note of ₹500 on A's invoice (no SKU).
    const draft = await ok<{ id: string; version: number }>(
      post(owner, "/api/customer-notes", {
        kind: "CREDIT",
        customerId: custA,
        siId: si1.id,
        date: today,
        reasonCode: "RATE_DIFFERENCE",
        reason: "Rate revised",
        lines: [
          { description: "Rate difference", hsnCode: "48239090", taxable: "500.00", gstRate: "18" },
        ],
      }),
    );
    await ok(post(owner, `/api/customer-notes/${draft.id}/post`, { version: draft.version }));
    // B returns 300 m of its roll: a credit note with the roll's SKU and cost.
    const sr = await ok<{ id: string; version: number }>(
      post(owner, "/api/sales-returns", {
        siId: si2.id,
        date: today,
        reason: "Coating marks",
        rolls: [{ rollId: rolls[2]!.id, returnedM: 300 }],
      }),
    );
    await ok(
      post(owner, `/api/sales-returns/${sr.id}/post`, { version: sr.version }),
    );
    // A receipt from A with ₹1,000 left on account.
    const rc = await ok<{ id: string; version: number }>(
      post(owner, "/api/receipts", {
        partyId: custA,
        date: today,
        mode: "NEFT",
        amount: "5000",
        reference: "UTR-R5",
        allocations: [{ invoiceId: si1.id, amount: "4000" }],
      }),
    );
    await ok(post(owner, `/api/receipts/${rc.id}/post`, { version: rc.version }));

    await post(owner, "/api/users", {
      name: "Report Exec",
      email: "report.exec@test.local",
      password: "Sales-Exec-12345",
      roleCodes: ["sales_executive"],
    });
    exec = await Client.signIn(t.fastify, "report.exec@test.local", "Sales-Exec-12345");
    await refresh();
  }, 120_000);
  afterAll(() => t.close());

  it("gross margin reconciles with posted invoices and notes (Q37: revenue − landed COGS)", async () => {
    const docs = await sqlOwner<{ customer_id: string; value: string; cogs: string }>(
      `SELECT customer_id, sum(v)::text AS value, sum(c)::text AS cogs FROM (
         SELECT customer_id, taxable AS v, coalesce(cogs, 0) AS c FROM sales_invoices WHERE status = 'Posted'
         UNION ALL
         SELECT n.customer_id, CASE n.kind WHEN 'CREDIT' THEN -n.taxable ELSE n.taxable END,
                -coalesce((SELECT sum(cost) FROM sales_return_rolls x WHERE x.return_id = n.sales_return_id), 0)
         FROM customer_notes n WHERE n.status = 'Posted') d
       WHERE customer_id = ANY($1) GROUP BY customer_id`,
      [[custA, custB]],
    );
    for (const d of docs) {
      const r = await report(
        owner,
        "gross-margin",
        `&groupBy=customer&customerId=${d.customer_id}`,
      );
      expect(r.totals).toMatchObject({
        value: Number(d.value).toFixed(2),
        cogs: Number(d.cogs).toFixed(2),
      });
    }
    const a = docs.find((d) => d.customer_id === custA)!;
    expect(a.value).toBe("13500.00"); // ₹14,000 − ₹500 credit note
  });

  it("a line's value is split over its rolls exactly (largest remainder) and price vs COGS per roll adds up", async () => {
    const r = await report(owner, "price-vs-cogs", `&customerId=${custA}`);
    expect(r.rows).toHaveLength(2);
    expect(r.rows.every((x) => x.links?.barcode?.kind === "roll")).toBe(true);
    const facts = await sqlOwner<{ v: string }>(
      "SELECT sum(value)::text AS v FROM mv_sales_lines WHERE doc_id = $1",
      [si1.id],
    );
    expect(facts[0]!.v).toBe("14000.00");
    expect(r.rows.map((x) => x.cells.rate)).toEqual(["7.00", "7.00"]);
  });

  it("SKU sales count returns by SKU; notes without a SKU stay out of it", async () => {
    const r = await report(owner, "sku-sales", `&skuId=${sku}`);
    // 3,000 m sold − 300 m returned; ₹14,000 + ₹5,850 − the returned share.
    const ret = await sqlOwner<{ taxable: string }>(
      "SELECT srr.taxable::text FROM sales_return_rolls srr JOIN sales_returns sr ON sr.id = srr.return_id WHERE sr.si_id = $1",
      [si2.id],
    );
    expect(r.totals).toMatchObject({
      metres: "2700",
      value: (14000 + 5850 - Number(ret[0]!.taxable)).toFixed(2),
    });
  });

  it("discount impact comes from the invoice lines", async () => {
    const r = await report(owner, "discount-impact", `&customerId=${custB}`);
    expect(r.totals).toMatchObject({
      gross: "6500.00",
      lineDiscount: "650.00",
      discount: "650.00",
    });
  });

  it("stock reports reconcile with the rolls in stock", async () => {
    const [s] = await sqlOwner<{ rolls: number; metres: string; value: string }>(
      `SELECT count(*)::int AS rolls, sum(current_length_m)::text AS metres,
              sum(round(current_length_m * coalesce(cost_per_m, base_cost_per_m, 0), 2))::text AS value
       FROM rolls WHERE sku_id = $1 AND status IN ('Unmapped', 'Mapped', 'Allocated')`,
      [sku],
    );
    const bySku = await report(owner, "stock-by-sku", `&skuId=${sku}`);
    expect(bySku.totals).toMatchObject({
      rolls: s!.rolls,
      metres: s!.metres,
      value: Number(s!.value).toFixed(2),
    });
    const aging = await report(owner, "batch-aging", `&skuId=${sku}`);
    expect(aging.totals).toMatchObject({ metres: s!.metres, value: Number(s!.value).toFixed(2) });
    expect(aging.asOf).not.toBeNull();
    expect(aging.series?.length).toBeGreaterThan(0);
  });

  it("PO vs GRN vs PI: ordered 8,000 m, received 6,000 m, nothing invoiced yet", async () => {
    const r = await report(owner, "po-variance", `&supplierId=${supplierId}`);
    expect(r.totals).toMatchObject({
      ordered: "8000",
      received: "6000",
      invoiced: "0",
      short: "2000",
      uninvoiced: "6000",
    });
    expect(r.rows[0]!.tone).toBe("warning");
  });

  it("commission summary reconciles with the entries; salesman performance carries it", async () => {
    const [e] = await sqlOwner<{ net: string }>(
      "SELECT sum(amount)::text AS net FROM commission_entries WHERE salesman_id = $1",
      [salesmanId],
    );
    expect(e!.net).toBe("270.00"); // 2 % of ₹14,000 − 2 % of ₹500
    const c = await report(owner, "commission-summary", `&salesmanId=${salesmanId}`);
    expect(c.totals).toMatchObject({ net: "270.00", outstanding: "270.00", paid: "0.00" });
    const p = await report(owner, "salesman-performance", `&salesmanId=${salesmanId}`);
    expect(p.totals).toMatchObject({ commission: "270.00" });
  });

  it("credit utilisation uses the live exposure of the credit check; unallocated money is listed", async () => {
    const check = json<{ exposure: string }>(
      await owner.get(`/api/customers/${custA}/credit-check`),
    );
    const u = await report(owner, "credit-utilisation", `&q=Report Traders A`);
    expect(u.rows[0]!.cells).toMatchObject({ exposure: check.exposure, limit: "100000.00" });
    const a = await report(owner, "allocation-status", `&q=Report Traders A`);
    expect(a.rows[0]!.cells).toMatchObject({ unallocated: "1000.00" });
  });

  it("Refresh now refreshes the views, at most once every 30 s", async () => {
    const first = json<{ refreshed: boolean; asOf: string | null }>(
      await post(owner, "/api/reports/refresh", {}),
    );
    const second = json<{ refreshed: boolean; asOf: string | null }>(
      await post(exec, "/api/reports/refresh", {}),
    );
    expect(first.asOf).not.toBeNull();
    expect(second).toEqual({ refreshed: false, asOf: first.asOf });
  });

  it("every report answers, and its totals equal the sum of its rows", async () => {
    for (const id of REPORT_IDS) {
      const r = await owner.get(`/api/reports/${id}?pageSize=500`);
      expect(r.statusCode, `${id}: ${r.body}`).toBe(200);
      const body = json<Report>(r);
      if (!body.totals || body.total > 500) continue;
      for (const c of body.columns.filter((x) => x.total)) {
        const sum = body.rows.reduce((s, row) => s + Number(row.cells[c.key] ?? 0), 0);
        expect(Number(body.totals[c.key]), `${id}.${c.key}`).toBeCloseTo(sum, 2);
      }
    }
  });

  it("cost never reaches a user without reports.margin.view (Q36)", async () => {
    expect((await exec.get("/api/reports/gross-margin")).statusCode).toBe(403);
    const stock = await report(exec, "stock-by-sku", `&skuId=${sku}`);
    expect(stock.columns.map((c) => c.key)).not.toContain("value");
    expect(stock.rows[0]!.cells).not.toHaveProperty("value");
    const pv = await ok<{ grandTotal: Record<string, unknown>; hiddenMeasures: string[] }>(
      post(exec, "/api/reports/pivot", {
        rows: ["customer"],
        cols: [],
        measures: ["value", "margin"],
        from: today,
        to: today,
      }),
    );
    expect(pv.hiddenMeasures).toEqual(["margin"]);
    expect(pv.grandTotal).not.toHaveProperty("cogs");
    expect(
      (
        await post(exec, "/api/reports/exports", {
          kind: "report",
          reportId: "sku-sales",
          format: "csv",
        })
      ).statusCode,
    ).toBe(403);
    const catalogue = json<{ reports: { id: string }[] }>(await exec.get("/api/reports"));
    expect(catalogue.reports.map((r) => r.id)).not.toContain("gross-margin");
  });

  it("the pivot adds up to the gross-margin report", async () => {
    const pv = await ok<{
      rowKeys: string[][];
      cells: ({ value: string } | null)[][];
      rowTotals: { value: string }[];
      grandTotal: { value: string; margin: string };
    }>(
      post(owner, "/api/reports/pivot", {
        rows: ["customer"],
        cols: ["month"],
        measures: ["value", "margin"],
        from: today,
        to: today,
        filters: { customerIds: [custA, custB] },
      }),
    );
    expect(pv.rowKeys).toEqual([["Report Prints B"], ["Report Traders A"]]);
    const gm = await report(owner, "gross-margin", `&groupBy=month`);
    const both = await Promise.all(
      [custA, custB].map((c) => report(owner, "gross-margin", `&groupBy=month&customerId=${c}`)),
    );
    const want = both.reduce((s, r) => s + Number(r.totals!.value), 0);
    expect(Number(pv.grandTotal.value)).toBeCloseTo(want, 2);
    expect(Number(gm.totals!.value)).toBeGreaterThanOrEqual(want - 0.001);
  });

  it("saved pivots are private until shared with a role (Q39); only the owner changes them", async () => {
    const spec = {
      rows: ["sku"],
      cols: ["month"],
      measures: ["metres", "value"],
      from: today,
      to: today,
    };
    const mine = await ok<{ id: string; version: number; mine: boolean }>(
      post(owner, "/api/reports/pivots", { name: "SKU by month", spec, range: "thisMonth" }),
    );
    expect(mine.mine).toBe(true);
    expect(
      json<{ id: string }[]>(await exec.get("/api/reports/pivots")).map((p) => p.id),
    ).not.toContain(mine.id);
    const shared = await owner.request({
      method: "PUT",
      url: `/api/reports/pivots/${mine.id}`,
      payload: {
        name: "SKU by month",
        spec,
        range: "thisMonth",
        sharedWithRoles: ["sales_executive"],
        version: mine.version,
      },
    });
    expect(shared.statusCode, shared.body).toBe(200);
    const seen = json<{ id: string; mine: boolean; spec: { from: string } }[]>(
      await exec.get("/api/reports/pivots"),
    ).find((p) => p.id === mine.id);
    expect(seen).toMatchObject({ mine: false, spec: { from: `${today.slice(0, 8)}01` } });
    const del = await exec.request({ method: "DELETE", url: `/api/reports/pivots/${mine.id}` });
    expect(del.statusCode).toBe(403);
    // Sharing needs reports.pivot.share, which a sales executive lacks.
    const share = await post(exec, "/api/reports/pivots", {
      name: "Mine",
      spec,
      sharedWithRoles: ["owner"],
    });
    expect(share.statusCode).toBe(403);
  });

  it("Today: the owner sees everything; a sales executive sees their worklist without margin", async () => {
    const o = json<{
      view: string;
      sentence: string | null;
      kpis: { invoicesToday: { count: number } | null; grossMargin: unknown };
      needsYou: { kind: string; href: string }[];
      charts: {
        salesTrend: unknown[] | null;
        arAging: unknown[] | null;
        stockHeatmap: unknown[] | null;
      };
    }>(await owner.get("/api/today"));
    expect(o.view).toBe("all");
    expect(o.sentence).toMatch(/invoiced today across \d+ invoices?/);
    expect(o.kpis.invoicesToday!.count).toBeGreaterThanOrEqual(2);
    expect(o.kpis.grossMargin).not.toBeNull();
    expect(o.charts.salesTrend).toHaveLength(30);
    expect(o.charts.arAging?.length).toBeGreaterThan(0);
    expect(o.charts.stockHeatmap?.length).toBeGreaterThan(0);
    expect(o.needsYou.map((n) => n.kind)).toContain("moneyOnAccount");
    const s = json<{
      view: string;
      kpis: { grossMargin: unknown; unmappedRolls: unknown };
      needsYou: { kind: string }[];
    }>(await exec.get("/api/today"));
    expect(s.view).toBe("sales");
    expect(s.kpis.grossMargin).toBeNull();
    expect(s.needsYou.map((n) => n.kind)).not.toContain("moneyOnAccount");
  });

  it("exports: CSV, XLSX and PDF are built in the background and downloaded by their owner only", async () => {
    const exports = t.app.get(ExportsService);
    const made: Record<string, { id: string }> = {};
    for (const format of ["csv", "xlsx", "pdf"]) {
      const e = await ok<{ id: string; status: string }>(
        post(owner, "/api/reports/exports", {
          kind: "report",
          reportId: "gross-margin",
          query: { groupBy: "customer", from: today, to: today, customerId: custA },
          format,
        }),
      );
      expect(e.status).toBe("Queued");
      await exports.build(e.id);
      made[format] = e;
    }
    const csv = await owner.get(`/api/reports/exports/${made.csv!.id}/download`);
    expect(csv.statusCode).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.body).toContain("Month / SKU / customer,Metres,Revenue,COGS,Gross margin,Margin %");
    expect(csv.body).toContain("Report Traders A,2000,13500.00");
    const xlsx = await owner.get(`/api/reports/exports/${made.xlsx!.id}/download`);
    expect(xlsx.rawPayload.subarray(0, 2).toString()).toBe("PK");
    const pdf = await owner.get(`/api/reports/exports/${made.pdf!.id}/download`);
    expect(pdf.rawPayload.subarray(0, 4).toString()).toBe("%PDF");
    const list = json<{ id: string; status: string; rowCount: number }[]>(
      await owner.get("/api/reports/exports"),
    );
    expect(list.find((x) => x.id === made.csv!.id)).toMatchObject({ status: "Ready", rowCount: 1 });
    // Pivot export too.
    const p = await ok<{ id: string }>(
      post(owner, "/api/reports/exports", {
        kind: "pivot",
        spec: {
          rows: ["customer"],
          cols: [],
          measures: ["value"],
          from: today,
          to: today,
          filters: { customerIds: [custA] },
        },
        format: "csv",
      }),
    );
    await exports.build(p.id);
    expect((await owner.get(`/api/reports/exports/${p.id}/download`)).body).toContain(
      "Report Traders A,13500.00",
    );
    // Someone else's export is not found.
    const other = await Client.signIn(t.fastify, "report.exec@test.local", "Sales-Exec-12345");
    expect((await other.get(`/api/reports/exports/${made.csv!.id}`)).statusCode).toBe(403);
  });
});
