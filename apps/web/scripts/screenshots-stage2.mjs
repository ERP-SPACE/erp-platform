#!/usr/bin/env node
/**
 * Captures the Stage 2 screens (light and dark) into docs/screenshots/stage-2/ for review.
 * Needs the dev web (:5173) + API with the purchase demo data (scripts/seed-purchase-demo.mjs)
 * and DEMO_USER_* in .env.
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

const root = resolve(import.meta.dirname, "../../..");
process.loadEnvFile(resolve(root, ".env"));
const base = process.env.SCREENSHOT_BASE_URL ?? "http://localhost:5173";
const out = resolve(root, "docs/screenshots/stage-2");
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
for (const theme of ["light", "dark"]) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    deviceScaleFactor: 1,
    colorScheme: theme,
  });
  await context.addInitScript(
    (t) => localStorage.setItem("erp:prefs", JSON.stringify({ theme: t, density: "comfortable" })),
    theme,
  );
  const page = await context.newPage();
  await page.goto(`${base}/login`);
  await page.getByLabel("Email").fill(process.env.DEMO_USER_EMAIL);
  await page.getByLabel("Password").fill(process.env.DEMO_USER_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(`${base}/`);

  const shot = async (name, full = true) => {
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${out}/${name}-${theme}.png`, fullPage: full });
  };
  const open = async (path, name) => {
    await page.goto(`${base}${path}`);
    await shot(name);
  };

  await open("/purchase/orders", "01-purchase-orders");
  await page.getByRole("row", { name: /PO\/2627\/00001/ }).click();
  await shot("02-purchase-order");
  const poUrl = page.url();
  await page.goto(`${base}/purchase/receipts/new?poId=${poUrl.split("/").pop()}`);
  await shot("03-receive-goods-form");
  await open("/purchase/receipts", "04-goods-receipts");
  await page.getByRole("row", { name: /GRN\/2627\/00001/ }).click();
  await shot("05-goods-receipt");
  await open("/purchase/invoices", "06-purchase-invoices");
  await page.getByRole("row", { name: /2455/ }).click();
  await shot("07-purchase-invoice");
  await page.getByRole("button", { name: "Add charges" }).click();
  await page.getByRole("textbox", { name: "Amount" }).fill("820.82");
  await page.getByRole("button", { name: "Preview split" }).click();
  await page.getByText("Landed cost per roll").first().waitFor();
  await shot("08-landed-cost-preview", false);
  await page.keyboard.press("Escape");
  await open("/inventory", "09-stock");
  await open("/inventory/unmapped", "10-unmapped");
  await page
    .getByRole("checkbox", { name: "Select all rows" })
    .check()
    .catch(() => undefined);
  await open("/inventory/rolls", "11-rolls");
  await page.getByRole("cell", { name: /^2610-SBC-0001-0001-/ }).click();
  await page
    .getByRole("heading", { level: 1 })
    .getByText(/^2610-SBC/)
    .waitFor();
  await shot("12-roll-inspector");
  await context.close();
}
await browser.close();
console.log(`Screenshots written to ${out}`);
