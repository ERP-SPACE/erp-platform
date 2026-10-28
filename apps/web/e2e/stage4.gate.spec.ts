import { gstinCheckChar, istToday } from "@erp/domain";
import { type APIRequestContext, type Page, expect, test } from "@playwright/test";
import { DEMO_STATE, demoUser } from "./helpers.js";

/**
 * Stage 4 gate: PRD UAT §11.5 (receipt → 2 invoices → aging updated, unallocated zero) and §11.6
 * (ON_SI_POSTED commission accrues; a credit note reverses it with the reason) on the real
 * screens, plus a cheque bounce and a commission payout. Stock, the customer, the salesman's
 * rule and the invoices are set up through the API; every UAT step runs in the browser.
 * The other §11.5 items (PI / SI vouchers, GST summary) belong to the Accounting stage.
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
const address = { line1: "9 Collection Road", city: "Surat", state: "Gujarat", pincode: "395003" };

const customerName = `E2E Collect ${stamp}`;
const salesmanName = `E2E Salesman ${stamp}`;
let customerId: string;
let salesmanId: string;
let invoices: { id: string; siNo: string }[];

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
async function stepUpIfAsked(page: Page) {
  const dialog = page.getByRole("dialog", { name: "Confirm it's you" });
  try {
    await dialog.waitFor({ state: "visible", timeout: 2_000 });
  } catch {
    return;
  }
  await dialog.getByLabel("Password").fill(demoUser.password);
  await dialog.getByRole("button", { name: "Confirm" }).click();
}
async function choose(page: Page, label: string | RegExp, option: string | RegExp) {
  await page.getByRole("combobox", { name: label }).click();
  await page.getByRole("option", { name: option }).first().click();
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
      (p) => p.gsm === 80 && p.qualityName === "Standard" && p.skus.some((s) => s.widthIn === "44"),
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
        gsm: 80,
        defaultLengthM: 1000,
        widthsIn: [44],
      });
    }
    const sku = product.skus.find((s) => s.widthIn === "44")!.id;
    const supplier = await send<{ id: string }>(r, "POST", "/api/suppliers", {
      name: `E2E Collect Mills ${stamp}`,
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
            description: "Sub 80",
            gsm: 80,
            widthIn: 44,
            quantityM: 3000,
            ratePerM: "4.00",
            gstRate: "18",
          },
        ],
      },
    );
    const po = await send<typeof po0>(r, "POST", `/api/purchase-orders/${po0.id}/approve`, {
      version: po0.version,
    });
    const grn0 = await send<{ id: string; version: number }>(r, "POST", "/api/goods-receipts", {
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
    });
    await send(r, "POST", `/api/goods-receipts/${grn0.id}/post`, { version: grn0.version });
    const rolls = (
      await send<{ items: { id: string; barcode: string }[] }>(
        r,
        "GET",
        `/api/rolls?grnId=${grn0.id}&limit=10`,
      )
    ).items;

    salesmanId = (await send<{ id: string }>(r, "POST", "/api/salesmen", { name: salesmanName }))
      .id;
    // An unregistered (B2C) buyer: no IRN round-trip needed for this gate.
    customerId = (
      await send<{ id: string }>(r, "POST", "/api/customers", {
        legalName: customerName,
        gstType: "Unregistered",
        stateCode: "24",
        billingAddress: address,
        contacts: [],
        salesmanId,
        creditPolicy: {
          creditLimit: "500000",
          creditDays: 30,
          graceDays: 15,
          autoBlock: true,
          blockRule: "BOTH",
        },
      })
    ).id;
    await send(r, "POST", `/api/salesmen/${salesmanId}/commission-rules`, {
      customerId,
      method: "PERCENT_SALES",
      rate: "1",
      triggerEvent: "ON_SI_POSTED",
      validFrom: today,
    });
    // Three invoices of 1000 m at ₹7.00: ₹7,000 + 18 % = ₹8,260 each.
    invoices = [];
    for (const roll of rolls) {
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
        rolls: [{ lineId: pf.lines[0]!.id, rollId: roll.id }],
      });
      invoices.push(
        await send<{ id: string; siNo: string }>(r, "POST", `/api/sales-invoices/${d.id}/post`, {
          version: d.version,
        }),
      );
    }
  } finally {
    await context.close();
  }
});

test("UAT 11.5: a receipt allocated to 2 invoices; aging updated and nothing unallocated", async ({
  page,
}) => {
  await page.goto("/collections/aging");
  const row = page.getByRole("row").filter({ hasText: customerName });
  await expect(row).toContainText(/₹\s24,780\.00/);

  await page.goto("/collections/receipts/new");
  await expect(page.getByRole("heading", { level: 1, name: "New receipt" })).toBeVisible();
  await choose(page, "Customer", new RegExp(customerName));
  await page.getByLabel("Amount").fill("16520");
  await page.getByLabel("UTR / reference").fill(`UTR${stamp}`);
  await page.getByRole("button", { name: "Oldest first" }).click();
  await expect(page.getByLabel(`Apply to ${invoices[0]!.siNo}`)).toHaveValue(/^8,?260(\.00)?$/);
  await expect(page.getByLabel(`Apply to ${invoices[1]!.siNo}`)).toHaveValue(/^8,?260(\.00)?$/);
  await expect(page.getByText(/On account\s₹\s0\.00/)).toBeVisible();
  await page.getByRole("button", { name: "Post receipt" }).click();
  await expectToast(page, /Receipt RC\/\d{4}\/\d{5} posted/);
  await expect(page).toHaveURL(/\/collections\/receipts\/[0-9a-f-]{36}$/);
  await expect(page.getByText("Posted", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: invoices[0]!.siNo })).toContainText(
    /₹\s8,260\.00/,
  );
  await expect(page.getByRole("row").filter({ hasText: invoices[1]!.siNo })).toContainText(
    /₹\s8,260\.00/,
  );

  // Aging now shows only the third invoice.
  await page.goto("/collections/aging");
  await expect(page.getByRole("row").filter({ hasText: customerName })).toContainText(
    /₹\s8,260\.00/,
  );
  const open = await (await page.request.get(`/api/customers/${customerId}/open-items`)).json();
  expect(open.invoices.map((i: { id: string }) => i.id)).toEqual([invoices[2]!.id]);
  expect(open.credits).toEqual([]);
});

test("UAT 11.6: commission accrues on posting; a credit note reverses it automatically with the reason", async ({
  page,
}) => {
  await page.goto(`/collections/commission?salesmanId=${salesmanId}`);
  const entries = page.getByRole("table", { name: "Commission entries" });
  // 1 % of ₹7,000 on each of the three invoices.
  await expect(entries.getByRole("row").filter({ hasText: invoices[2]!.siNo })).toContainText(
    /₹\s70\.00/,
  );

  await page.goto(`/sales/notes/new?siId=${invoices[2]!.id}`);
  await expect(
    page.getByRole("heading", { level: 1, name: "New credit or debit note" }),
  ).toBeVisible();
  await page.getByLabel("Reason (printed on the note)").fill("Rate revised by ₹1/m");
  await page.getByLabel("Line 1 · description").fill("Rate difference");
  await page.getByLabel("Taxable ₹").fill("1000");
  await page.getByRole("button", { name: "Create draft note" }).click();
  await expect(page).toHaveURL(/\/sales\/notes\/[0-9a-f-]{36}$/);
  await page.getByRole("button", { name: "Post credit note" }).click();
  await page
    .getByRole("dialog", { name: "Post this credit note?" })
    .getByRole("button", { name: "Post" })
    .click();
  await stepUpIfAsked(page);
  await expect(
    page.getByRole("heading", { level: 1, name: /CN\/\d{4}\/\d{5} Posted/ }),
  ).toBeVisible();

  await page.goto(`/collections/commission?salesmanId=${salesmanId}`);
  const reversal = page
    .getByRole("table", { name: "Commission entries" })
    .getByRole("row")
    .filter({ hasText: "Rate revised by ₹1/m" });
  await expect(reversal).toContainText(/\(₹\s10\.00\)|-₹\s10\.00|₹\s-10\.00/);
  await expect(reversal).toContainText(/Credit note CN\/\d{4}\/\d{5}/);
});

test("a bounced cheque reverses the receipt; the invoice owes again", async ({ page }) => {
  const r = page.request;
  let receipt = await send<{ id: string; version: number }>(r, "POST", "/api/receipts", {
    partyId: customerId,
    date: today,
    mode: "CHEQUE",
    amount: "7080",
    reference: "000777",
    allocations: [{ invoiceId: invoices[2]!.id, amount: "7080" }],
  });
  receipt = await send(r, "POST", `/api/receipts/${receipt.id}/post`, { version: receipt.version });
  await page.goto(`/collections/receipts/${receipt.id}`);
  await page.getByRole("button", { name: "Reverse / bounced" }).click();
  const dialog = page.getByRole("dialog", { name: "Reverse this money?" });
  await dialog.getByLabel("Reason").fill("Returned unpaid: funds insufficient");
  await dialog.getByRole("button", { name: "Reverse" }).click();
  await stepUpIfAsked(page);
  await expect(page.getByText(/Cheque bounced on .*: Returned unpaid/)).toBeVisible();
  const open = await (await r.get(`/api/customers/${customerId}/open-items`)).json();
  expect(open.invoices[0].outstanding).toBe("7080.00");
});

test("commission payout: drafted, paid with TDS, numbered CP", async ({ page }) => {
  await page.goto(`/collections/commission?salesmanId=${salesmanId}`);
  await page.getByRole("button", { name: "New payout" }).click();
  const draft = page.getByRole("dialog", { name: "New commission payout" });
  await draft.getByRole("button", { name: "Draft payout" }).click();
  await expect(page).toHaveURL(/\/collections\/commission\/[0-9a-f-]{36}$/);
  // ₹70 × 3 − ₹10 = ₹200.
  await page.getByRole("button", { name: /^Pay ₹\s200\.00$/ }).click();
  const pay = page.getByRole("dialog", { name: `Pay ${salesmanName}` });
  await pay.getByLabel("TDS deducted").fill("10");
  await pay.getByRole("button", { name: "Mark as paid" }).click();
  await stepUpIfAsked(page);
  await expect(page.getByRole("heading", { level: 1, name: /CP\/\d{4}\/\d{5}/ })).toBeVisible();
  await expect(page.getByText("Net", { exact: true }).locator("..")).toContainText(/₹\s190\.00/);
});
