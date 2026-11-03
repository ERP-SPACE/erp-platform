import { gstinCheckChar, istToday } from "@erp/domain";
import { type APIRequestContext, type Page, expect, test } from "@playwright/test";
import { DEMO_STATE, demoUser } from "./helpers.js";

/**
 * Stage 6 gate in the browser: PRD UAT §11.7 on the Opening Balance Wizard.
 *  - opening stock CSV → checked, imported → rolls Mapped with their landed cost;
 *  - opening receivables CSV → an unknown customer is flagged before import; once fixed, the
 *    customer's ledger matches the books;
 *  - each chapter confirmed against the books to the paisa (or not needed);
 *  - the first live posting on the go-live date locks the wizard.
 * The opening ledger journal (UAT §11.7, third item) belongs to the Accounting stage; the
 * database-level lock, discard and the manual "Go live" are covered in the API tests.
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
const address = { line1: "3 Opening Road", city: "Surat", state: "Gujarat", pincode: "395003" };
const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000)
  .toISOString()
  .slice(0, 10);
const dmy = (iso: string) => iso.split("-").reverse().join("-");

let supplierCode: string;
let skuCode: string;
let customerId: string;
let customerCode: string;
const customerName = `E2E Opening ${stamp}`;

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
async function chooseCsv(page: Page, name: string, csv: string) {
  await page
    .locator("input[type=file]")
    .setInputFiles({ name, mimeType: "text/csv", buffer: Buffer.from(csv) });
}

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ storageState: DEMO_STATE });
  const r = context.request;
  try {
    // Go live today: opening balances are dated yesterday.
    const s = (
      await send<{ key: string; version: number; value: unknown }[]>(r, "GET", "/api/settings")
    ).find((x) => x.key === "golive.date")!;
    if (s.value !== today)
      await send(
        r,
        "PATCH",
        "/api/settings/golive.date",
        { value: today, version: s.version },
        "E2E: go-live date",
      );
    const products = await send<{ skus: { code: string }[] }[]>(
      r,
      "GET",
      "/api/catalogue/products",
    );
    skuCode = products.find((p) => p.skus.length)!.skus[0]!.code;
    supplierCode = (
      await send<{ code: string }>(r, "POST", "/api/suppliers", {
        name: `E2E Opening Mills ${stamp}`,
        shortCode: rand(3),
        stateCode: "24",
        gstin: gstin(),
        address,
        paymentDays: 30,
      })
    ).code;
    const c = await send<{ id: string; code: string }>(r, "POST", "/api/customers", {
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
    });
    customerId = c.id;
    customerCode = c.code;
  } finally {
    await context.close();
  }
});

test("UAT 11.7: opening stock is checked, imported as Mapped rolls with landed cost, and confirmed", async ({
  page,
}) => {
  await page.goto("/settings/opening?step=STOCK");
  await expect(
    page.getByText(`Go-live ${today}; opening balances are dated ${yesterday}.`),
  ).toBeVisible();
  await chooseCsv(
    page,
    "godown-stock.csv",
    [
      "supplier,sku,metres,cost_per_m,received_date",
      `${supplierCode},${skuCode},1000,4.9896,${dmy(yesterday)}`,
      `${supplierCode},${skuCode},960,5.10,`,
    ].join("\n"),
  );
  await expect(page.getByText("Ready to import")).toBeVisible();
  await page.getByRole("button", { name: /^Import 2 rows · ₹\s9,885\.60$/ }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Imported 2 rows" }).first(),
  ).toBeVisible();
  const imports = page.getByRole("table", { name: "Stock imports" });
  const row = imports.getByRole("row").filter({ hasText: "godown-stock.csv" });
  await expect(row).toContainText(/₹\s9,885\.60/);

  // The rolls exist, Mapped, at their landed cost.
  const grn = row.getByRole("link", { name: /^OB\/\d{4}\/\d{5}$/ });
  await grn.click();
  await expect(page).toHaveURL(/\/purchase\/receipts\/[0-9a-f-]{36}$/);
  const grnId = page.url().split("/").at(-1)!;
  const rolls = (await (await page.request.get(`/api/rolls?grnId=${grnId}&limit=10`)).json()) as {
    items: {
      status: string;
      landedCostPerM: string | null;
      baseCostPerM: string | null;
      currentLengthM: number;
    }[];
  };
  expect(
    rolls.items
      .map((x) => [
        x.status,
        x.currentLengthM,
        Number(x.landedCostPerM ?? x.baseCostPerM).toFixed(4),
      ])
      .sort(),
  ).toEqual([
    ["Mapped", 1000, "4.9896"],
    ["Mapped", 960, "5.1000"],
  ]);

  // Confirm against the books: a paisa out is refused, the exact figure is accepted.
  await page.goto("/settings/opening?step=STOCK");
  const stockTotal = (await (await page.request.get("/api/opening")).json()).chapters.find(
    (c: { chapter: string }) => c.chapter === "STOCK",
  ).total as string;
  const books = page.getByLabel("Total in your books (₹)");
  await books.fill((Number(stockTotal) + 0.01).toFixed(2));
  await expect(page.getByText(/Difference ₹\s-0\.01|Difference \(₹\s0\.01\)/)).toBeVisible();
  await books.fill(stockTotal);
  await expect(page.getByText("Matches")).toBeVisible();
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByText(/Confirmed: ₹\s[\d,]+\.\d{2} matches the books/)).toBeVisible();
});

test("UAT 11.7: opening receivables — an unknown customer is flagged; the ledger then matches the books", async ({
  page,
}) => {
  await page.goto("/settings/opening?step=AR");
  const no1 = `GC/${stamp}/1`;
  const no2 = `GC/${stamp}/2`;
  await chooseCsv(
    page,
    "debtors.csv",
    [
      "customer,invoice_no,date,amount,due_date",
      `${customerCode},${no1},${dmy(yesterday)},"8,260.00",`,
      `Nobody Traders ${stamp},X1,${dmy(yesterday)},100,`,
    ].join("\n"),
  );
  await expect(page.getByText(`Unknown customer "Nobody Traders ${stamp}"`)).toBeVisible();
  await expect(page.getByRole("button", { name: /^Import / })).toHaveCount(0);

  await chooseCsv(
    page,
    "debtors-fixed.csv",
    [
      "customer,invoice_no,date,amount,due_date",
      `${customerCode},${no1},${dmy(yesterday)},"8,260.00",`,
      `${customerName},${no2},${yesterday},1500.50,`,
    ].join("\n"),
  );
  await page.getByRole("button", { name: /^Import 2 rows/ }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Imported 2 rows" }).first(),
  ).toBeVisible();

  const arTotal = (await (await page.request.get("/api/opening")).json()).chapters.find(
    (c: { chapter: string }) => c.chapter === "AR",
  ).total as string;
  await page.getByLabel("Total in your books (₹)").fill(arTotal);
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByText(/Confirmed: ₹\s[\d,]+\.\d{2} matches the books/)).toBeVisible();

  // The customer's ledger shows the old invoice numbers and owes what the books say.
  await page.goto(`/collections/statement/CUSTOMER/${customerId}`);
  await expect(page.getByRole("heading", { level: 1, name: customerName })).toBeVisible();
  const entries = page.getByRole("table", { name: "Statement entries" });
  await expect(entries.getByRole("row").filter({ hasText: no1 })).toContainText(/₹\s8,260\.00/);
  await expect(entries.getByRole("row").filter({ hasText: no2 })).toContainText(/₹\s9,760\.50/);
});

test("the remaining chapters are settled and the review shows every chapter against the books", async ({
  page,
}) => {
  for (const step of ["AP", "CASH"] as const) {
    await page.goto(`/settings/opening?step=${step}`);
    const notNeeded = page.getByRole("button", { name: "Not needed" });
    if (await notNeeded.isVisible()) {
      await notNeeded.click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("Reason").fill("Nothing outstanding at the cut-over (E2E)");
      await dialog.getByRole("button", { name: "Mark not needed" }).click();
      await expect(page.getByText(/Marked as not needed/)).toBeVisible();
    }
  }
  await page.goto("/settings/opening?step=REVIEW");
  const review = page.getByRole("table", { name: "Opening balances review" });
  await expect(review.getByRole("row").filter({ hasText: "Receivables" })).toContainText("Nil");
  await page.goto("/settings/opening?step=GOLIVE");
  // The demo manager is an Admin: going live by hand is the Owner's.
  await expect(page.getByText("Only the Owner can go live.")).toBeVisible();
});

test("UAT 11.7: the first live posting on the go-live date locks the wizard", async ({ page }) => {
  const r = page.request;
  const rc = await send<{ id: string; version: number }>(r, "POST", "/api/receipts", {
    partyId: customerId,
    date: today,
    mode: "CASH",
    amount: "1000",
    reference: null,
    allocations: [],
  });
  await send(r, "POST", `/api/receipts/${rc.id}/post`, { version: rc.version });
  await page.goto("/settings/opening?step=STOCK");
  await expect(page.getByText(/Live since \d/)).toBeVisible();
  await expect(page.getByText(/Opening balances are now read-only/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Choose (CSV|another) file/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Discard" })).toHaveCount(0);
  const refused = await r.fetch("/api/opening/uploads", {
    method: "POST",
    data: {
      kind: "AR",
      fileName: "late.csv",
      csv: "customer,invoice_no,date,amount\nX,1,01-01-2026,1",
      dryRun: true,
    },
    headers: { "idempotency-key": crypto.randomUUID() },
  });
  expect(refused.status()).toBe(409);
});
