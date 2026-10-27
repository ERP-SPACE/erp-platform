import AxeBuilder from "@axe-core/playwright";
import { type Page, expect, test } from "@playwright/test";
import { DEMO_STATE, demoUser, themes, useTheme } from "./helpers.js";

test.use({ storageState: DEMO_STATE });

/** Runs after stage2.gate (file order), so the document pages have rows. Stage 2 gate: purchase, inventory and godown screens have no WCAG 2.1 A/AA violations. */
const SCREENS: { name: string; path: string; ready: string }[] = [
  { name: "purchase orders", path: "/purchase/orders", ready: "Purchase orders" },
  { name: "new purchase order", path: "/purchase/orders/new", ready: "New purchase order" },
  { name: "goods receipts", path: "/purchase/receipts", ready: "Goods receipts" },
  { name: "receive goods", path: "/purchase/receipts/new", ready: "Receive goods" },
  { name: "purchase invoices", path: "/purchase/invoices", ready: "Purchase invoices" },
  {
    name: "enter purchase invoice",
    path: "/purchase/invoices/new",
    ready: "Enter purchase invoice",
  },
  { name: "purchase returns", path: "/purchase/returns", ready: "Purchase returns" },
  { name: "stock", path: "/inventory", ready: "Stock" },
  { name: "rolls", path: "/inventory/rolls", ready: "Rolls" },
  { name: "unmapped rolls", path: "/inventory/unmapped", ready: "Unmapped rolls" },
];

async function expectNoViolations(page: Page, label: string) {
  await page.waitForLoadState("networkidle");
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    results.violations.map(
      (v) => `${label} · ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
    ),
  ).toEqual([]);
}

for (const theme of themes) {
  test.describe(`${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      test.skip(!demoUser.email || !demoUser.password, "DEMO_USER_* not set");
      await useTheme(page, theme);
    });

    for (const screen of SCREENS) {
      test(`${screen.name} has no WCAG A/AA violations`, async ({ page }) => {
        await page.goto(screen.path);
        await expect(
          page.getByRole("heading", { level: 1, name: screen.ready, exact: true }),
        ).toBeVisible();
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await expectNoViolations(page, screen.name);
      });
    }

    test("document pages and the roll inspector have no WCAG A/AA violations", async ({ page }) => {
      for (const list of [
        "/purchase/orders",
        "/purchase/receipts",
        "/purchase/invoices",
        "/inventory/rolls",
      ]) {
        await page.goto(list);
        // stage2.gate has created at least one of each.
        await page.getByRole("row").nth(1).click();
        await expect(page).not.toHaveURL(new RegExp(`${list}$`));
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await expectNoViolations(page, list);
      }
    });

    test("godown phone screens have no WCAG A/AA violations", async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      for (const path of ["/floor", "/floor/map", "/floor/receive"]) {
        await page.goto(path);
        await expect(page.getByRole("navigation", { name: "Godown tasks" })).toBeVisible();
        await expectNoViolations(page, path);
      }
    });
  });
}
