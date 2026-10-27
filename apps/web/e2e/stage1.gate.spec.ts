import { expect, test } from "@playwright/test";
import { DEMO_STATE, confirmIfAsked, demoUser, randomGstin } from "./helpers.js";

/**
 * Stage 1 gate (brief, Part C): a customer is created by keyboard only in under 60 s; a
 * salesman's defaults pre-fill a new customer; Customer 360 tabs; bulk rate revision.
 * Needs `pnpm db:reset && pnpm db:seed:demo` with DEMO_USER_EMAIL / DEMO_USER_PASSWORD set.
 * (Overlapping rate ranges rejected by the DB is the API integration test.)
 */
test.describe.configure({ mode: "serial" });

test.use({ storageState: DEMO_STATE });

test.beforeEach(() => {
  test.skip(!demoUser.email || !demoUser.password, "DEMO_USER_* not set — see .env.example");
});

const stamp = Date.now().toString(36).toUpperCase();
const salesmanCustomer = `Prefill Test ${stamp}`;

test("GATE: a customer is created with the keyboard only in under 60 seconds", async ({ page }) => {
  const started = Date.now();
  const name = `Keyboard Prints ${stamp}`;
  const gstin = randomGstin();
  const kb = page.keyboard;

  await page.goto("/customers");
  await expect(page.getByRole("heading", { level: 1, name: "Customers" })).toBeVisible();
  await kb.press("Alt+n");
  await expect(page).toHaveURL(/\/customers\/new$/);

  // Legal name has focus; Enter moves to the next field.
  await expect(page.getByLabel("Legal name")).toBeFocused();
  await kb.type(name);
  await kb.press("Enter"); // → trade name
  await kb.press("Enter"); // → phone
  await kb.type("9876501234");
  await kb.press("Enter"); // → email
  await kb.type("accounts@keyboard.example");
  await kb.press("Enter"); // → business type
  await kb.type("Print shop");
  await kb.press("Enter"); // → GST registration (stays Regular)
  await kb.press("Tab"); // → GSTIN
  await expect(page.getByLabel("GSTIN")).toBeFocused();
  await kb.type(gstin); // fills state and PAN
  await expect(page.getByLabel("PAN")).toHaveValue(gstin.slice(2, 12));
  await kb.press("Enter"); // → GST state (pre-filled)
  await kb.press("Tab"); // → PAN (pre-filled)
  await kb.press("Enter"); // → address line 1
  await expect(page.getByLabel("Address line 1")).toBeFocused();
  await kb.type("12 Ring Road");
  await kb.press("Enter"); // → line 2
  await kb.press("Enter"); // → city
  await kb.type("Surat");
  await kb.press("Enter"); // → PIN
  await kb.type("395002");
  await kb.press("Control+s");

  await expect(page).toHaveURL(/\/customers\/[0-9a-f-]{36}/);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(page.getByText(gstin).first()).toBeVisible();
  const seconds = (Date.now() - started) / 1000;
  test
    .info()
    .annotations.push({ type: "keyboard-create-seconds", description: seconds.toFixed(1) });
  expect(seconds).toBeLessThan(60);
});

test("GATE: choosing a salesman pre-fills credit terms and starting rates", async ({ page }) => {
  await page.goto("/customers/new");
  await page.getByLabel("Legal name").fill(salesmanCustomer);
  await page.getByLabel("GST registration").click();
  await page.getByRole("option", { name: "Unregistered" }).click();
  await page.getByLabel("Address line 1").fill("4 Textile Market");
  await page.getByRole("textbox", { name: "City", exact: true }).fill("Surat");
  await page.getByLabel("PIN code").fill("395003");
  // The address "State" text box (the GST state is a combobox).
  await page.getByRole("textbox", { name: /^State/ }).fill("Gujarat");

  // Company defaults before a salesman is chosen (Q7: ₹1,00,000 / 30 / 15).
  await expect(page.getByLabel("Credit limit")).toHaveValue("100000");

  // Keyboard: focus the salesman select, open it, pick the first salesman.
  const salesman = page.getByLabel("Salesman");
  await salesman.focus();
  await page.keyboard.press("Enter");
  const firstSalesman = page.getByRole("option").nth(1);
  const salesmanName = (await firstSalesman.textContent())!.split(" · ")[0]!;
  // The open list focuses the current choice; arrow keys only work once it has.
  await expect(page.getByRole("option", { name: "No salesman" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(firstSalesman).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(salesman).toContainText(salesmanName);

  const prefill = page.getByTestId("salesman-defaults");
  await expect(prefill).toContainText("Credit terms pre-filled from this salesman");
  await expect(prefill).toContainText("Starting rates");
  await expect(page.getByLabel("Credit limit")).not.toHaveValue("100000");
  const limit = await page.getByLabel("Credit limit").inputValue();

  await page.getByRole("button", { name: "Create customer" }).click();
  await expect(page.getByRole("heading", { level: 1, name: salesmanCustomer })).toBeVisible();
  await expect(page.getByText(salesmanName).first()).toBeVisible();
  await expect(page.getByText(`₹ ${Number(limit).toLocaleString("en-IN")}`).first()).toBeVisible();

  // The salesman's default rates became this customer's rates from today.
  await page.getByRole("tab", { name: "Rates" }).click();
  await expect(page.getByRole("cell", { name: "Salesman default" }).first()).toBeVisible();
});

test("Customer 360 shows every tab", async ({ page }) => {
  await page.goto("/customers");
  await page.getByPlaceholder("Search name, code, GSTIN, city").fill(salesmanCustomer);
  await page.getByRole("row", { name: new RegExp(salesmanCustomer) }).click();
  await expect(page.getByRole("heading", { level: 1, name: salesmanCustomer })).toBeVisible();

  const tabs: [string, RegExp | string][] = [
    ["Overview", "Credit limit"],
    ["Profile & contacts", "Billing"],
    ["Credit", "Credit policy"],
    ["Rates", "44″ calculator"],
    ["Salesman & commission", /commission rule|Open salesman/i],
    ["WhatsApp", "Consent"],
    ["Activity", /created the customer|Audit access needed/],
  ];
  for (const [tab, text] of tabs) {
    await page.getByRole("tab", { name: new RegExp(`^${tab.replace(/[&]/g, "\\$&")}`) }).click();
    await expect(page.getByRole("tabpanel").getByText(text).first()).toBeVisible();
  }

  // The 44″ calculator derives other widths by ratio (₹20 at 44″ → ₹10.91 at 24″).
  await page.getByRole("tab", { name: /^Rates/ }).click();
  await page.getByLabel("₹/m at 44″").fill("20");
  await expect(page.getByRole("row", { name: /24″.*10\.91/ })).toBeVisible();
});

test("bulk rate revision: scope → change → preview → reason → applied", async ({ page }) => {
  await page.goto("/pricing/bulk-revision");
  await page.getByLabel("Filter customers").fill(salesmanCustomer);
  await page.getByRole("checkbox", { name: salesmanCustomer }).click();
  await page.getByRole("button", { name: "Next: change" }).click();

  await page.getByLabel("Percent").fill("2");
  await page.getByRole("button", { name: "Preview changes" }).click();
  await expect(page.getByText(/^\d+ rates for 1 customers$/)).toBeVisible();
  const rows = page.getByRole("table", { name: "Rate changes" }).getByRole("row");
  await expect(rows.nth(1)).toContainText(salesmanCustomer);

  await page.getByRole("button", { name: "Next: apply" }).click();
  const apply = page.getByRole("button", { name: /^Revise \d+ rates$/ });
  await expect(apply).toBeDisabled();
  await page.getByLabel("Reason for this change").fill("E2E: 2% paper price rise");
  await apply.click();
  await page.waitForTimeout(500);
  await confirmIfAsked(page);
  await expect(page.getByText(/^\d+ rates revised$/)).toBeVisible();
  await expect(page).toHaveURL(/\/customers$/);
});
