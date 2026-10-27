import { istToday } from "@erp/domain";
import { type APIRequestContext, type Page, expect, test } from "@playwright/test";
import { DEMO_STATE, confirmIfAsked, demoUser, randomGstin } from "./helpers.js";

/**
 * Stage 2 gate: PRD UAT §11.1 (purchases) and §11.2 (inventory) on the real screens. The
 * documents are set up through the API (the arithmetic is proven in the API integration test);
 * every step the UAT names — mapping, posting with a reason, over-receipt approval, landed cost,
 * scanning, lineage, scrap — is done in the browser.
 *
 * Not here, by scope: the Inventory Write-off voucher (Accounting stage — scrap writes the
 * ROLL_SCRAPPED posting event it will consume) and the customer-return credit note (Stage 4).
 */
test.describe.configure({ mode: "serial" });
test.use({ storageState: DEMO_STATE });
test.beforeEach(() => {
  test.skip(!demoUser.email || !demoUser.password, "DEMO_USER_* not set — see .env.example");
});

interface Po {
  id: string;
  poNo: string;
  version: number;
  lines: { id: string }[];
}
interface Grn {
  id: string;
  grnNo: string;
  version: number;
}
interface Roll {
  id: string;
  barcode: string;
  status: string;
  widthIn: string;
}

const today = istToday();
const stamp = Date.now().toString(36).toUpperCase();
const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const shortCode = Array.from({ length: 3 }, () => letters[Math.floor(Math.random() * 24)]).join("");
const supplierName = `E2E Papers ${stamp}`;

let supplierId: string;
let sku: Record<44 | 48 | 60, string>;
let po: Po;
let grn: Grn;
let rolls: Roll[];
let piNo: string;

async function send<T>(
  r: APIRequestContext,
  method: "POST" | "GET",
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
const line = (w: 44 | 48 | 60, extra: Record<string, unknown>) => ({
  description: `Eco Paper ${w}* 29 GSM`,
  gsm: 29,
  widthIn: w,
  ...extra,
});
const rollsOfGrn = async (r: APIRequestContext, grnId: string) =>
  (await send<{ items: Roll[] }>(r, "GET", `/api/rolls?grnId=${grnId}&limit=100`)).items;

async function expectToast(page: Page, text: string | RegExp) {
  await expect(page.getByRole("status").filter({ hasText: text }).first()).toBeVisible();
}

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ storageState: DEMO_STATE });
  const r = context.request;
  try {
    supplierId = (
      await send<{ id: string }>(r, "POST", "/api/suppliers", {
        name: supplierName,
        shortCode,
        stateCode: "24",
        gstin: randomGstin(),
        address: {
          line1: "Laxminarayan Estate",
          city: "Surat",
          state: "Gujarat",
          pincode: "394210",
        },
        paymentDays: 1,
      })
    ).id;
    // An Eco 29 GSM product with 44″, 48″ and 60″ SKUs (reused across runs).
    type Product = {
      gsm: number;
      qualityName: string;
      categoryCode?: string;
      skus: { id: string; widthIn: string; active: boolean }[];
    };
    const products = await send<Product[]>(r, "GET", "/api/catalogue/products");
    let eco = products.find(
      (p) =>
        p.gsm === 29 &&
        p.qualityName === "Eco" &&
        ["44", "48", "60"].every((w) => p.skus.some((s) => s.widthIn === w)),
    );
    if (!eco) {
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
      eco = await send<Product>(r, "POST", "/api/catalogue/products", {
        categoryId: cats.find((c) => c.code === "SUB")!.id,
        qualityId: quals.find((q) => q.name === "Eco")!.id,
        gsm: 29,
        defaultLengthM: 1000,
        widthsIn: [44, 48, 60],
      });
    }
    const of = (w: string) => eco!.skus.find((s) => s.widthIn === w)!.id;
    sku = { 44: of("44"), 48: of("48"), 60: of("60") };

    // PO with 3 SKUs, approved.
    const draft = await send<Po>(r, "POST", "/api/purchase-orders", {
      supplierId,
      date: today,
      lines: [
        line(44, { skuId: sku[44], quantityM: 2000, ratePerM: "4.90", gstRate: "18" }),
        line(60, { skuId: sku[60], quantityM: 1000, ratePerM: "6.68", gstRate: "18" }),
        line(48, { skuId: sku[48], quantityM: 2000, ratePerM: "5.35", gstRate: "18" }),
      ],
    });
    po = await send<Po>(r, "POST", `/api/purchase-orders/${draft.id}/approve`, {
      version: draft.version,
    });

    // Partial GRN (2 of 3 SKUs): the 60″ line arrives without a product → Unmapped.
    const g = await send<Grn>(r, "POST", "/api/goods-receipts", {
      supplierId,
      poId: po.id,
      date: today,
      supplierInvoiceNo: `E${stamp}`,
      supplierBatchRef: "CONT-E2E",
      lines: [
        line(44, { poLineId: po.lines[0]!.id, skuId: sku[44], rolls: "2 X 1000" }),
        line(60, { poLineId: po.lines[1]!.id, rolls: "500+500" }),
      ],
    });
    grn = await send<Grn>(r, "POST", `/api/goods-receipts/${g.id}/post`, { version: g.version });
    rolls = await rollsOfGrn(r, grn.id);
  } finally {
    await context.close();
  }
});

test("UAT 11.1: the partial receipt's unknown rolls are bulk-mapped from Unmapped", async ({
  page,
}) => {
  const unmapped = rolls.filter((r) => r.status === "Unmapped");
  expect(unmapped).toHaveLength(2);
  await page.goto("/inventory/unmapped");
  await expect(page.getByRole("heading", { level: 1, name: "Unmapped rolls" })).toBeVisible();
  for (const r of unmapped) {
    await page.getByRole("row").filter({ hasText: r.barcode }).getByRole("checkbox").check();
  }
  await page.getByRole("button", { name: "Map 2 rolls" }).click();
  const dialog = page.getByRole("dialog", { name: "Map 2 rolls" });
  await dialog.getByLabel("Product (SKU)").click();
  await page
    .getByRole("option", { name: /Eco.*60″/ })
    .first()
    .click();
  await dialog.getByRole("button", { name: "Map rolls" }).click();
  await expectToast(page, "2 rolls mapped");
  await expect(page.getByRole("row").filter({ hasText: unmapped[0]!.barcode })).toHaveCount(0);
});

test("UAT 11.1: GRN over-receipt is blocked, then approved with a reason and recorded", async ({
  page,
}) => {
  // 3,000 m against the 2,000 m ordered at 48″.
  const draft = await send<Grn>(page.request, "POST", "/api/goods-receipts", {
    supplierId,
    poId: po.id,
    date: today,
    lines: [line(48, { poLineId: po.lines[2]!.id, skuId: sku[48], rolls: "3 x 1000" })],
  });
  await page.goto(`/purchase/receipts/${draft.id}`);
  await page.getByRole("button", { name: "Post receipt" }).click();
  const dialog = page.getByRole("dialog", { name: "More than the purchase order" });
  await expect(dialog).toContainText("3,000 m against 2,000 m");
  const approve = dialog.getByRole("button", { name: "Approve and post" });
  await expect(approve).toBeDisabled();
  await dialog.getByLabel("Reason for this change").fill("Supplier sent one extra roll; same rate");
  await approve.click();
  await expectToast(page, /posted/);
  await expect(page.getByText("Over-receipt approved by")).toBeVisible();
  const audit = await send<{ items: { reason: string | null }[] }>(
    page.request,
    "GET",
    `/api/audit?table=goods_receipts&rowId=${draft.id}`,
  );
  expect(audit.items.some((i) => i.reason === "Supplier sent one extra roll; same rate")).toBe(
    true,
  );
});

test("UAT 11.1: a PI line without a PO line warns and the reason is mandatory", async ({
  page,
}) => {
  const pi = await send<{ id: string }>(page.request, "POST", "/api/purchase-invoices", {
    supplierId,
    supplierInvoiceNo: `S${stamp}`,
    supplierInvoiceDate: today,
    lines: [
      line(44, {
        description: "Eco 44* 29 GSM (spot buy)",
        hsnCode: "48099000",
        quantityM: 1000,
        ratePerM: "4.95",
        gstRate: "18",
      }),
    ],
  });
  await page.goto(`/purchase/invoices/${pi.id}`);
  await page.getByRole("button", { name: "Post invoice" }).click();
  const dialog = page.getByRole("dialog", { name: "Post this purchase invoice?" });
  await expect(dialog).toContainText("1 line is not on a purchase order");
  const post = dialog.getByRole("button", { name: "Post invoice" });
  await expect(post).toBeDisabled();
  await dialog.getByLabel("Reason for this change").fill("Spot purchase without a PO");
  await post.click();
  await expectToast(page, /Posted as PI\//);
});

test("UAT 11.1: PI against the receipt, then landed cost by metres updates every roll", async ({
  page,
}) => {
  const draft = await send<{ id: string }>(page.request, "POST", "/api/purchase-invoices", {
    supplierId,
    supplierInvoiceNo: `E${stamp}`,
    supplierInvoiceDate: today,
    poId: po.id,
    grnIds: [grn.id],
    lines: [
      line(44, {
        poLineId: po.lines[0]!.id,
        skuId: sku[44],
        hsnCode: "48099000",
        quantityM: 2000,
        ratePerM: "4.90",
        gstRate: "18",
      }),
      line(60, {
        poLineId: po.lines[1]!.id,
        skuId: sku[60],
        hsnCode: "48099000",
        quantityM: 1000,
        ratePerM: "6.68",
        gstRate: "18",
      }),
    ],
  });
  await page.goto(`/purchase/invoices/${draft.id}`);
  await page.getByRole("button", { name: "Post invoice" }).click();
  await page
    .getByRole("dialog", { name: "Post this purchase invoice?" })
    .getByRole("button", { name: "Post invoice" })
    .click();
  await expectToast(page, /Posted as PI\//);
  const toast = page
    .getByRole("status")
    .filter({ hasText: /Posted as PI\// })
    .first();
  piNo = (await toast.innerText()).match(/PI\/\d{4}\/\d{5}/)![0];

  // ₹300 freight over 3,000 m → ₹0.10 a metre.
  await page.getByRole("button", { name: "Add charges" }).click();
  const dialog = page.getByRole("dialog", { name: "Add landed cost" });
  await dialog.getByLabel("Amount").fill("300");
  await dialog.getByLabel("Split").click();
  await page.getByRole("option", { name: "By metres" }).click();
  await dialog.getByRole("button", { name: "Preview split" }).click();
  await dialog.getByRole("button", { name: "Apply to 4 rolls" }).click();
  await expect(page.getByText("Applied")).toBeVisible();

  const after = await rollsOfGrn(page.request, grn.id);
  const landed = (
    await send<{ items: (Roll & { landedCostPerM: string | null })[] }>(
      page.request,
      "GET",
      `/api/rolls?grnId=${grn.id}&limit=100`,
    )
  ).items;
  expect(after).toHaveLength(4);
  // 44″: ₹4.90 + ₹0.10; 60″: ₹6.68 + ₹0.10.
  expect(landed.filter((r) => r.widthIn === "44").map((r) => r.landedCostPerM)).toEqual(["5", "5"]);
  expect(landed.filter((r) => r.widthIn === "60").map((r) => r.landedCostPerM)).toEqual([
    "6.78",
    "6.78",
  ]);
});

test("UAT 11.2: scanning a roll on the godown phone shows its lineage", async ({ page }) => {
  const roll = rolls.find((r) => r.widthIn === "44")!;
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/floor");
  await page.getByLabel("Scan a roll label").fill(roll.barcode);
  await page.keyboard.press("Enter");
  const card = page.getByRole("article");
  await expect(card).toContainText(roll.barcode);
  await expect(card).toContainText(supplierName);
  await expect(card).toContainText(grn.grnNo);
  await expect(card).toContainText("CONT-E2E");

  // The office inspector: supplier → lot → GRN → PI → cost.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/inventory/roll/${roll.id}`);
  const origin = page
    .getByRole("region", { name: "Where it came from" })
    .or(page.locator("section", { hasText: "Where it came from" }))
    .first();
  for (const text of [supplierName, "CONT-E2E", grn.grnNo, piNo])
    await expect(origin).toContainText(text);
  await expect(page.getByRole("definition").filter({ hasText: "5.0000" })).toBeVisible();
});

test("UAT 11.2: scrapping a roll needs a reason and takes it out of stock", async ({ page }) => {
  const roll = rolls.find((r) => r.widthIn === "44")!;
  await page.goto(`/inventory/roll/${roll.id}`);
  await page.getByRole("button", { name: "Scrap" }).click();
  const dialog = page.getByRole("dialog", { name: "Scrap rolls" });
  const scrap = dialog.getByRole("button", { name: "Scrap rolls" });
  await expect(scrap).toBeDisabled();
  await dialog.getByLabel("Reason for this change").fill("Water damage in the godown");
  await scrap.click();
  await confirmIfAsked(page);
  await expectToast(page, "1 roll scrapped");
  const after = await send<Roll>(page.request, "GET", `/api/rolls/${roll.id}`);
  expect(after.status).toBe("Scrap");
});
