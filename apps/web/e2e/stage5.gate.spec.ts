import { gstinCheckChar, istToday } from "@erp/domain";
import { type APIRequestContext, type Page, expect, test } from "@playwright/test";
import { DEMO_STATE, demoUser } from "./helpers.js";

/**
 * Stage 5 gate in the browser: Today shows the day (KPIs, Needs-you, charts); a report drills
 * down to the invoice behind it and agrees with it; the pivot builder adds up, saves and shares
 * a pivot (Q39); an XLSX export is built in the background and downloads. Reconciliation of
 * every report and the 50k-roll Today budget are in the API integration tests.
 */
test.describe.configure({ mode: "serial" });
test.use({ storageState: DEMO_STATE });
test.beforeEach(() => {
  test.skip(!demoUser.email || !demoUser.password, "DEMO_USER_* not set — see .env.example");
});

const today = istToday();
const stamp = Date.now().toString(36).toUpperCase();
const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const rand = (n: number) =>
  Array.from({ length: n }, () => letters[Math.floor(Math.random() * letters.length)]).join("");
const gstin = () => {
  const first14 = `24${rand(3)}C${rand(1)}${String(Math.floor(Math.random() * 10000)).padStart(4, "0")}${rand(1)}1Z`;
  return first14 + gstinCheckChar(first14);
};
const address = { line1: "7 Report Road", city: "Surat", state: "Gujarat", pincode: "395003" };
const customerName = `E2E Reports ${stamp}`;
let invoice: { id: string; siNo: string };

async function send<T>(
  r: APIRequestContext,
  method: "POST" | "GET" | "PATCH",
  url: string,
  data?: unknown,
  reason?: string,
): Promise<T> {
  const res = await r.fetch(url, {
    method,
    data,
    headers: {
      "idempotency-key": crypto.randomUUID(),
      ...(reason ? { "x-change-reason": encodeURIComponent(reason) } : {}),
    },
  });
  expect(res.ok(), `${method} ${url}: ${await res.text()}`).toBe(true);
  return (await res.json()) as T;
}
async function expectToast(page: Page, text: string | RegExp) {
  await expect(page.getByRole("status").filter({ hasText: text }).first()).toBeVisible();
}

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ storageState: DEMO_STATE });
  const r = context.request;
  try {
    type Category = {
      id: string;
      code: string;
      hsnCode: string | null;
      gstRate: string | null;
      version: number;
    };
    for (const c of await send<Category[]>(r, "GET", "/api/catalogue/categories")) {
      if (!c.hsnCode || c.gstRate === null) {
        await send(
          r,
          "PATCH",
          `/api/catalogue/categories/${c.id}`,
          { ...c, hsnCode: c.hsnCode ?? "48239090", gstRate: c.gstRate ?? "18" },
          "E2E: HSN for invoicing",
        );
      }
    }
    type Product = {
      id: string;
      gsm: number;
      qualityName: string;
      skus: { id: string; widthIn: string }[];
    };
    let product = (await send<Product[]>(r, "GET", "/api/catalogue/products")).find(
      (p) => p.gsm === 100 && p.qualityName === "Standard" && p.skus.some((s) => s.widthIn === "44"),
    );
    if (!product) {
      const cats = await send<{ id: string; code: string }[]>(
        r,
        "GET",
        "/api/catalogue/categories",
      );
      const quals = await send<{ id: string; name: string }[]>(
        r,
        "GET",
        "/api/catalogue/qualities",
      );
      product = await send<Product>(r, "POST", "/api/catalogue/products", {
        categoryId: cats.find((c) => c.code === "SUB")!.id,
        qualityId: quals.find((q) => q.name === "Standard")!.id,
        gsm: 100,
        defaultLengthM: 1000,
        widthsIn: [44],
      });
    }
    const sku = product.skus.find((s) => s.widthIn === "44")!.id;
    const supplier = await send<{ id: string }>(r, "POST", "/api/suppliers", {
      name: `E2E Report Mills ${stamp}`,
      shortCode: rand(3),
      stateCode: "24",
      gstin: gstin(),
      address,
      paymentDays: 1,
    });
    const po0 = await send<{ id: string; version: number; lines: { id: string }[] }>(
      r,
      "POST",
      "/api/purchase-orders",
      {
        supplierId: supplier.id,
        date: today,
        lines: [
          {
            skuId: sku,
            description: "Sub 100",
            gsm: 100,
            widthIn: 44,
            quantityM: 2000,
            ratePerM: "5.00",
            gstRate: "18",
          },
        ],
      },
    );
    const po = await send<typeof po0>(r, "POST", `/api/purchase-orders/${po0.id}/approve`, {
      version: po0.version,
    });
    const grn = await send<{ id: string; version: number }>(r, "POST", "/api/goods-receipts", {
      supplierId: supplier.id,
      poId: po.id,
      date: today,
      lines: [
        {
          poLineId: po.lines[0]!.id,
          skuId: sku,
          description: "Sub 100",
          gsm: 100,
          widthIn: 44,
          rolls: "2 x 1000",
        },
      ],
    });
    await send(r, "POST", `/api/goods-receipts/${grn.id}/post`, { version: grn.version });
    const rolls = (
      await send<{ items: { id: string }[] }>(r, "GET", `/api/rolls?grnId=${grn.id}&limit=10`)
    ).items;
    // A B2C buyer (no IRN): 1 roll of 1,000 m at ₹7.00 → ₹7,000 taxable, COGS ₹5,000.
    const customerId = (
      await send<{ id: string }>(r, "POST", "/api/customers", {
        legalName: customerName,
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
      })
    ).id;
    let pf = await send<{ id: string; version: number; lines: { id: string }[] }>(
      r,
      "POST",
      "/api/proformas",
      {
        customerId,
        date: today,
        lines: [{ skuId: sku, metres: 1000, ratePerM: "7.00" }],
      },
    );
    pf = await send(r, "POST", `/api/proformas/${pf.id}/send`, { version: pf.version });
    const d = await send<{ id: string; version: number }>(r, "POST", "/api/sales-invoices", {
      source: "PROFORMA",
      proformaId: pf.id,
      date: today,
      rolls: [{ lineId: pf.lines[0]!.id, rollId: rolls[0]!.id }],
    });
    invoice = await send(r, "POST", `/api/sales-invoices/${d.id}/post`, { version: d.version });
  } finally {
    await context.close();
  }
});

test("Reports: Refresh now brings the new invoice into the figures", async ({ page }) => {
  await page.goto("/reports");
  await expect(page.getByRole("heading", { level: 1, name: "Reports" })).toBeVisible();
  // The views may have refreshed seconds ago (30 s debounce): wait it out once if so.
  for (let i = 0; i < 2; i++) {
    await page.getByRole("button", { name: "Refresh now" }).click();
    const done = page
      .getByRole("status")
      .filter({ hasText: /Figures (refreshed|are already up to date)/ })
      .first();
    await expect(done).toBeVisible();
    if ((await done.textContent())?.includes("refreshed")) break;
    await page.waitForTimeout(31_000);
  }
});

test("Today: the day in one sentence, KPIs, Needs you and the three charts", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { level: 1, name: /^Good (morning|afternoon|evening)/ }),
  ).toBeVisible();
  await expect(page.getByTestId("today-sentence")).toContainText(
    /invoiced today across \d+ invoices?/,
  );
  await expect(page.getByText("Invoiced today", { exact: true })).toBeVisible();
  await expect(page.getByText("Gross margin, this month")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Needs you" })).toBeVisible();
  await expect(
    page.getByRole("table", { name: /Sales \(taxable\) for the last 30 days/ }),
  ).toBeAttached();
  await expect(
    page.getByRole("table", { name: "Receivables by age since the invoice date" }),
  ).toBeAttached();
  await expect(page.getByRole("table", { name: /Stock in hand by GSM and width/ })).toBeAttached();
  await page.getByText("Invoiced today", { exact: true }).click();
  await expect(page).toHaveURL(/\/sales\/invoices$/);
});

test("a report agrees with its invoice and drills down to it", async ({ page }) => {
  await page.goto("/reports");
  await page.getByRole("link", { name: /^Gross margin/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Gross margin" })).toBeVisible();
  await page.getByRole("radio", { name: "Customer" }).click();
  const row = page.getByRole("row").filter({ hasText: customerName });
  await expect(row).toContainText(/₹\s7,000\.00/);
  await expect(row).toContainText(/₹\s5,000\.00/);
  await expect(row).toContainText(/28\.6\s%/);

  await page.goto(`/reports/price-vs-cogs?q=${encodeURIComponent(customerName)}`);
  const roll = page.getByRole("row").filter({ hasText: invoice.siNo });
  await expect(roll).toContainText(/₹\s7\.00/);
  await roll.getByRole("link", { name: invoice.siNo }).click();
  await expect(page).toHaveURL(new RegExp(`/sales/invoices/${invoice.id}$`));
});

test("pivot: customer by month adds up; saved and shared with a role (Q39)", async ({ page }) => {
  await page.goto("/reports/pivot");
  await expect(page.getByRole("heading", { level: 1, name: "Pivot builder" })).toBeVisible();
  const table = page.getByRole("table", { name: "Pivot result" });
  await expect(table.getByRole("row").filter({ hasText: customerName })).toContainText(
    /₹\s7,000\.00/,
  );
  await expect(table.getByRole("row").filter({ hasText: customerName })).toContainText(/1,000\sm/);

  const name = `E2E pivot ${stamp}`;
  await page.getByRole("button", { name: "Save pivot" }).click();
  const dialog = page.getByRole("dialog", { name: "Save pivot" });
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByRole("checkbox", { name: "Sales Executive" }).click();
  await dialog.getByRole("button", { name: "Save" }).click();
  await expectToast(page, `Saved “${name}”`);
  await expect(page.getByRole("button", { name: new RegExp(`${name}.*Shared`) })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
});

test("export: Excel is built in the background and downloads from My exports", async ({ page }) => {
  await page.goto("/reports/gross-margin?groupBy=customer");
  await page.getByRole("button", { name: "Export" }).click();
  await page.getByRole("menuitem", { name: "Excel (.xlsx)" }).click();
  await expectToast(page, "Gross margin is being prepared");
  await page.getByRole("link", { name: "My exports" }).click();
  const row = page
    .getByRole("row")
    .filter({ hasText: "Gross margin" })
    .filter({ hasText: "XLSX" })
    .first();
  await expect(row.getByText("Ready")).toBeVisible({ timeout: 30_000 });
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    row.getByRole("link", { name: "Download" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^Gross-margin-\d{4}-\d{2}-\d{2}\.xlsx$/);
});
