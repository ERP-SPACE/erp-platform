import { gstinCheckChar, istToday } from "@erp/domain";
import { type APIRequestContext, type Page, expect, test } from "@playwright/test";
import { DEMO_STATE, demoUser } from "./helpers.js";

/**
 * Stage 3 gate: PRD UAT §11.3 (pricing & sales) and §11.4 (sales return, with the §11.2
 * partial-return item deferred from Stage 2) on the real screens. Stock, customers and their
 * rates are set up through the API; every step the UAT names is done in the browser.
 * The arithmetic (posting events, COGS) is proven in the API integration test.
 *
 * The IRN comes from the offline simulator until NIC sandbox credentials exist (Q27); the same
 * check runs unchanged against the sandbox once NIC_* is set for the API.
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
const gstin = (state: string) => {
  const pan = `${rand(3)}C${rand(1)}${String(Math.floor(Math.random() * 10000)).padStart(4, "0")}${rand(1)}`;
  const first14 = `${state}${pan}1Z`;
  return first14 + gstinCheckChar(first14);
};
const address = (state: string, pincode: string) => ({
  line1: "12 Ring Road",
  city: state === "Gujarat" ? "Surat" : "Bhiwandi",
  state,
  pincode,
});

interface Roll {
  id: string;
  barcode: string;
  widthIn: string;
  currentLengthM: number;
  status: string;
}

const nameA = `E2E Prints ${stamp}`;
const nameB = `E2E Mumbai ${stamp}`;
const transporter = `E2E Roadways ${stamp}`;
let rolls44: Roll[];
let rolls36: Roll[];
let soA: string;
let siNo: string;
let siId: string;

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

/** Sensitive actions may ask for the password again (ADR-0021); answer when asked. */
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

async function scan(page: Page, label: string, barcode: string) {
  await page.getByLabel(label).fill(barcode);
  await page.keyboard.press("Enter");
}

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ storageState: DEMO_STATE });
  const r = context.request;
  try {
    // Every category needs HSN / GST before invoicing (Q9).
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
    // Sublimation Standard 100 GSM at 36″ and 44″ (reused across runs).
    type Product = {
      id: string;
      gsm: number;
      qualityName: string;
      categoryName: string;
      skus: { id: string; widthIn: string }[];
    };
    let product = (await send<Product[]>(r, "GET", "/api/catalogue/products")).find(
      (p) =>
        p.gsm === 100 &&
        p.qualityName === "Standard" &&
        ["36", "44"].every((w) => p.skus.some((s) => s.widthIn === w)),
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
        widthsIn: [36, 44],
      });
    }
    const sku = (w: string) => product!.skus.find((s) => s.widthIn === w)!.id;

    // Stock: 4 × 1000 m at 44″ (₹4.40) and 1000 + 600 m at 36″ (₹4.00), PO → GRN.
    const supplier = await send<{ id: string }>(r, "POST", "/api/suppliers", {
      name: `E2E Sales Mills ${stamp}`,
      shortCode: rand(3),
      stateCode: "24",
      gstin: gstin("24"),
      address: address("Gujarat", "394210"),
      paymentDays: 1,
    });
    const line = (w: 36 | 44, quantityM: number, ratePerM: string) => ({
      skuId: sku(String(w)),
      description: `Sublimation 100 GSM ${w}*`,
      gsm: 100,
      widthIn: w,
      quantityM,
      ratePerM,
      gstRate: "18",
    });
    const po0 = await send<{ id: string; version: number; lines: { id: string }[] }>(
      r,
      "POST",
      "/api/purchase-orders",
      {
        supplierId: supplier.id,
        date: today,
        lines: [line(44, 4000, "4.40"), line(36, 1600, "4.00")],
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
          skuId: sku("44"),
          description: "Sub 44",
          gsm: 100,
          widthIn: 44,
          rolls: "4 x 1000",
        },
        {
          poLineId: po.lines[1]!.id,
          skuId: sku("36"),
          description: "Sub 36",
          gsm: 100,
          widthIn: 36,
          rolls: "1000, 600",
        },
      ],
    });
    await send(r, "POST", `/api/goods-receipts/${grn0.id}/post`, { version: grn0.version });
    const all = (await send<{ items: Roll[] }>(r, "GET", `/api/rolls?grnId=${grn0.id}&limit=100`))
      .items;
    rolls44 = all
      .filter((x) => x.widthIn === "44")
      .sort((a, b) => a.barcode.localeCompare(b.barcode));
    rolls36 = all
      .filter((x) => x.widthIn === "36")
      .sort((a, b) => b.currentLengthM - a.currentLengthM);

    // Customer A: Gujarat, ₹1,00,000, 44″ rate ₹6.60. Customer B: Maharashtra, ₹10,000.
    const customer = (
      legalName: string,
      code: string,
      state: string,
      pincode: string,
      limit: string,
    ) =>
      send<{ id: string }>(r, "POST", "/api/customers", {
        legalName,
        gstType: "Regular",
        gstin: gstin(code),
        stateCode: code,
        billingAddress: address(state, pincode),
        contacts: [],
        creditPolicy: {
          creditLimit: limit,
          creditDays: 30,
          graceDays: 15,
          autoBlock: true,
          blockRule: "BOTH",
        },
      });
    const a = await customer(nameA, "24", "Gujarat", "395002", "100000");
    await customer(nameB, "27", "Maharashtra", "421302", "10000");
    await send(r, "POST", `/api/customers/${a.id}/rates`, {
      productId: product.id,
      baseRate44: "6.60",
      validFrom: today,
    });
    await send(r, "POST", "/api/transporters", { name: transporter, stateCode: "24" });
  } finally {
    await context.close();
  }
});

test("UAT 11.3: a 36″ rate comes from the 44″ rate; 10 % over it needs a manager before Confirm", async ({
  page,
}) => {
  await page.goto("/sales/orders/new");
  await expect(page.getByRole("heading", { level: 1, name: "New sales order" })).toBeVisible();
  await choose(page, "Customer", new RegExp(nameA));
  await choose(page, "Line 1 · product", /Standard 100 GSM · 44″/);
  await expect(page.getByLabel("Rate ₹/m").first()).toHaveValue(/^6\.60?$/);
  await page.getByLabel("Metres").first().fill("3000");
  await page.getByRole("button", { name: "Add line" }).click();
  await choose(page, "Line 2 · product", /Standard 100 GSM · 36″/);
  // 6.60 × 36 / 44 = ₹5.40/m.
  await expect(page.getByLabel("Rate ₹/m").nth(1)).toHaveValue(/^5\.40?$/);
  await expect(page.getByText("Customer rate").nth(1)).toBeVisible();
  await page.getByLabel("Metres").nth(1).fill("1300");
  // 10 % over: beyond the tolerance whether it is the default 5 % or a raised 7.5 %.
  await page.getByLabel("Rate ₹/m").nth(1).fill("5.95");
  await expect(page.getByText("Needs manager approval")).toBeVisible();
  await page.getByRole("button", { name: "Create order" }).click();

  await expect(page).toHaveURL(/\/sales\/orders\/[0-9a-f-]{36}$/);
  soA = page.url().split("/").at(-1)!;
  await expect(page.getByRole("button", { name: "Confirm order" })).toBeDisabled();
  // 19,800 + 7,735 = 27,535 + 9 % + 9 % = 32,491.30 → ₹32,491.
  await expect(page.getByText(/₹\s32,491\.00/).first()).toBeVisible();
  await page.getByRole("button", { name: "Approve rates" }).click();
  await stepUpIfAsked(page);
  await expect(page.getByText(/Approved · /)).toBeVisible();
  await page.getByRole("button", { name: "Confirm order" }).click();
  await expectToast(page, "Order confirmed");
  await expect(page.getByText("Confirmed", { exact: true }).first()).toBeVisible();
});

test("UAT 11.3: a credit-blocked customer's order goes on hold; exposure includes it; release needs a reason", async ({
  page,
}) => {
  await page.goto("/sales/orders/new");
  await choose(page, "Customer", new RegExp(nameB));
  await choose(page, "Line 1 · product", /Standard 100 GSM · 44″/);
  await page.getByLabel("Metres").first().fill("2000");
  await page.getByLabel("Rate ₹/m").first().fill("6.00");
  await page.getByRole("button", { name: "Create order" }).click();
  await expect(page).toHaveURL(/\/sales\/orders\/[0-9a-f-]{36}$/);
  await page.getByRole("button", { name: "Approve rates" }).click();
  await stepUpIfAsked(page);
  await expect(page.getByText(/Approved · /)).toBeVisible();
  await page.getByRole("button", { name: "Confirm order" }).click();
  await expectToast(page, "Order is on hold for credit");

  // 12,000 + IGST 2,160 = 14,160 against ₹10,000: exposure includes this order.
  await expect(page.getByText("Why it's on hold")).toBeVisible();
  await expect(page.getByText("Over credit limit").first()).toBeVisible();
  await expect(page.getByText(/₹\s14,160\.00/).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "New challan" })).toHaveCount(0);

  await page.getByRole("button", { name: "Release hold" }).click();
  const dialog = page.getByRole("dialog", { name: "Release the credit hold?" });
  await expect(dialog.getByRole("button", { name: "Release hold" })).toBeDisabled();
  await dialog.getByLabel("Reason").fill("Advance cheque received from the owner");
  await dialog.getByRole("button", { name: "Release hold" }).click();
  await stepUpIfAsked(page);
  await expect(page.getByText("Hold released by")).toBeVisible();
});

test("UAT 11.3: order → challan (transporter, vehicle, FIFO and a cut) → invoice with IRN and the customer's balance", async ({
  page,
}) => {
  await page.goto(`/sales/orders/${soA}`);
  await page.getByRole("button", { name: "New challan" }).click();
  await expect(page).toHaveURL(/\/sales\/challans\/[0-9a-f-]{36}$/);
  await expect(page.getByText("Draft", { exact: true }).first()).toBeVisible();

  // 44″: three full rolls, scanned (lower case works too).
  await choose(page, "Picking for", /44″/);
  for (const roll of rolls44.slice(0, 3)) {
    await scan(page, "Scan a roll", roll.barcode.toLowerCase());
    await expectToast(page, `Picked ${roll.barcode}`);
  }
  // Scanning the same roll again is refused.
  await scan(page, "Scan a roll", rolls44[0]!.barcode);
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: /already|Allocated/i })
      .first(),
  ).toBeVisible();

  // 36″: the 1000 m roll, then 300 m cut from the 600 m roll.
  await choose(page, "Picking for", /36″/);
  await scan(page, "Scan a roll", rolls36[0]!.barcode);
  await expectToast(page, `Picked ${rolls36[0]!.barcode}`);
  await page.getByRole("button", { name: "Cut", exact: true }).click();
  const cut = page.getByRole("dialog", { name: /^Cut / });
  await cut.getByLabel("Cut length").fill("300");
  await cut.getByRole("button", { name: "Cut and pick" }).click();
  await expectToast(page, /Cut 300 m/);
  await expect(page.getByText("Picked rolls · 5")).toBeVisible();

  await choose(page, "Transporter", transporter);
  await page.getByLabel("Vehicle no.").fill("GJ05AB1234");
  await page.getByLabel("Distance").fill("18");
  await page.getByRole("button", { name: "Save transport" }).click();
  await expectToast(page, "Transport details saved");
  await page.getByRole("button", { name: "Dispatch", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Dispatch this challan?" })
    .getByRole("button", { name: "Dispatch" })
    .click();
  await expectToast(page, /dispatched/);

  await page.getByRole("link", { name: "Invoice this challan" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "New sales invoice" })).toBeVisible();
  await expect(page.getByRole("checkbox").first()).toBeChecked();
  await page.getByRole("button", { name: "Create draft invoice" }).click();
  await expect(page).toHaveURL(/\/sales\/invoices\/[0-9a-f-]{36}$/);
  siId = page.url().split("/").at(-1)!;
  await expect(page.getByText(/₹\s32,491\.00/).first()).toBeVisible();
  await page.getByRole("button", { name: "Post invoice" }).click();
  await page
    .getByRole("dialog", { name: "Post this invoice?" })
    .getByRole("button", { name: "Post invoice" })
    .click();
  await expectToast(page, /Posted as SI\/\d{4}\/\d{5}/);
  siNo = (await (await page.request.get(`/api/sales-invoices/${siId}`)).json()).siNo;
  expect(siNo).toMatch(/^SI\/\d{4}\/\d{5}$/);

  // IRN: the queue reports it right after posting; the print stops being provisional.
  await expect(async () => {
    await page.reload();
    await expect(page.getByText("IRN generated").first()).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 30_000 });
  await expect(page.getByText(/^[0-9a-f]{64}$/)).toBeVisible();
  const print = await page.request.get(`/api/sales-invoices/${siId}/pdf?format=html`);
  const html = await print.text();
  expect(html).not.toContain("Provisional — IRN pending");
  expect(html).toContain(siNo);
  expect(html).toContain("<svg");

  // E-way bill from the IRN.
  await page.getByRole("button", { name: "Generate from IRN" }).click();
  const ewb = page.getByRole("dialog", { name: "Generate e-way bill" });
  await ewb.getByRole("button", { name: "Generate" }).click();
  await expectToast(page, /E-way bill \d{12}/);

  // The customer's balance carries the invoice.
  await page.getByRole("link", { name: nameA }).click();
  await page.getByRole("tab", { name: "Ledger" }).click();
  await expect(page.getByRole("row").filter({ hasText: siNo })).toContainText(/₹\s32,491\.00/);
});

test("UAT 11.3: proforma → invoice: the proforma is Converted and links to its invoice", async ({
  page,
}) => {
  await page.goto("/sales/proformas/new");
  await choose(page, "Customer", new RegExp(nameA));
  await choose(page, "Line 1 · product", /Standard 100 GSM · 44″/);
  await page.getByLabel("Metres").first().fill("1000");
  await expect(page.getByLabel("Rate ₹/m").first()).toHaveValue(/^6\.60?$/);
  await page.getByRole("button", { name: "Create proforma" }).click();
  await expect(page).toHaveURL(/\/sales\/proformas\/[0-9a-f-]{36}$/);
  await expect(page.getByText(/₹\s7,788\.00/).first()).toBeVisible();
  await page.getByRole("button", { name: "Mark as sent" }).click();
  await expectToast(page, "Marked as sent");

  await page.getByRole("link", { name: "Convert to invoice" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "New sales invoice" })).toBeVisible();
  await scan(page, "Scan the rolls being sold", rolls44[3]!.barcode);
  await expect(page.getByText("1,000 m of 1,000 m")).toBeVisible();
  await page.getByRole("button", { name: "Create draft invoice" }).click();
  await expect(page).toHaveURL(/\/sales\/invoices\/[0-9a-f-]{36}$/);
  await page.getByRole("button", { name: "Post invoice" }).click();
  await page
    .getByRole("dialog", { name: "Post this invoice?" })
    .getByRole("button", { name: "Post invoice" })
    .click();
  await expectToast(page, /Posted as SI\//);
  const pfNo = await page.request.get("/api/proformas").then((r) => r.json());
  const pf = (pfNo as { id: string; customerName: string; status: string }[]).find(
    (p) => p.customerName === nameA,
  )!;
  await page.goto(`/sales/proformas/${pf.id}`);
  await expect(page.getByText("Converted", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: /^Invoice SI\// })).toBeVisible();
});

test("UAT 11.4: 700 m of a 1000 m roll comes back → credit note at 70 % → roll Returned → scrapped at the godown", async ({
  page,
}) => {
  const roll = rolls44[0]!;
  await page.goto(`/sales/returns/new?siId=${siId}`);
  await expect(page.getByRole("heading", { level: 1, name: "New sales return" })).toBeVisible();
  await page.getByLabel("Reason").fill("Coating defect on the outer 300 m");
  await page.getByRole("checkbox", { name: new RegExp(roll.barcode) }).check();
  await page.getByLabel(`Metres returned of ${roll.barcode}`).fill("700");
  await page.getByRole("button", { name: "Record return" }).click();
  await expect(page).toHaveURL(/\/sales\/returns\/[0-9a-f-]{36}$/);
  await page.getByRole("button", { name: "Post and issue credit note" }).click();
  await page
    .getByRole("dialog", { name: "Post this return?" })
    .getByRole("button", { name: "Post return" })
    .click();
  await expectToast(page, /credit note CN\//);
  // 700 m × ₹6.60 = ₹4,620 taxable (70 % of the roll as billed).
  const row = page.getByRole("row").filter({ hasText: roll.barcode });
  await expect(row).toContainText(/₹\s4,620\.00/);
  // 70 % of its cost goes back to stock: 700 m × ₹4.40 = ₹3,080 (shown to cost viewers).
  await expect(row).toContainText(/₹\s3,080\.00/);
  await expect(row.getByRole("button", { name: "Scrap" })).toBeVisible();

  const detail = await (await page.request.get(`/api/rolls/${roll.id}`)).json();
  expect(detail).toMatchObject({ status: "Returned", currentLengthM: 700, barcode: roll.barcode });

  // The godown inspects it and scraps it.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/floor/inspect");
  // The waiting list loads first; a scan before that would not find the roll.
  await expect(page.getByRole("button", { name: new RegExp(roll.barcode) })).toBeVisible();
  await scan(page, "Scan a returned roll", roll.barcode);
  await expect(page.getByText(/700\sm of 1,000\sm/)).toBeVisible();
  await page.getByRole("button", { name: "Scrap" }).first().click();
  await page
    .getByRole("dialog", { name: `Scrap ${roll.barcode}?` })
    .getByRole("button", { name: "Scrap roll" })
    .click();
  await expectToast(page, `${roll.barcode} scrapped`);
  const after = await (await page.request.get(`/api/rolls/${roll.id}`)).json();
  // Scrapped at its partial cost (700 m × ₹4.40 = ₹3,080, proven in the API integration test).
  expect(after).toMatchObject({ status: "Scrap", currentLengthM: 700 });
});
