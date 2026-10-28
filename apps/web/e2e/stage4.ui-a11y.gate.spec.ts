import AxeBuilder from "@axe-core/playwright";
import { type Page, expect, test } from "@playwright/test";
import { DEMO_STATE, demoUser, themes, useTheme } from "./helpers.js";

test.use({ storageState: DEMO_STATE });

/**
 * Stage 4 gate: receipts, payments, aging, blocked orders, commission and statements have no
 * WCAG 2.1 A/AA violations in either theme. Runs after stage4.gate (file order), so every
 * list has rows to open.
 */
const SCREENS: { name: string; path: string; ready: string }[] = [
  { name: "receipts", path: "/collections/receipts", ready: "Receipts" },
  { name: "new receipt", path: "/collections/receipts/new", ready: "New receipt" },
  { name: "supplier payments", path: "/collections/payments", ready: "Supplier payments" },
  { name: "new payment", path: "/collections/payments/new", ready: "New payment" },
  { name: "aging", path: "/collections/aging", ready: "Receivables aging" },
  { name: "blocked orders", path: "/collections/blocked", ready: "Blocked orders" },
  { name: "commission", path: "/collections/commission", ready: "Commission" },
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

    test("receipt, statement and payout pages have no WCAG A/AA violations", async ({ page }) => {
      await page.goto("/collections/receipts");
      await page.getByRole("row").nth(1).click();
      await expect(page).toHaveURL(/\/collections\/receipts\/[0-9a-f-]{36}$/);
      await expectNoViolations(page, "receipt");
      await page.goto("/collections/aging");
      await page.getByRole("table", { name: "Receivables aging" }).getByRole("row").nth(1).click();
      await expect(page).toHaveURL(/\/collections\/statement\//);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expectNoViolations(page, "statement");
      await page.goto("/collections/commission");
      await page.getByRole("table", { name: "Commission payouts" }).getByRole("row").nth(1).click();
      await expect(page).toHaveURL(/\/collections\/commission\/[0-9a-f-]{36}$/);
      await expectNoViolations(page, "payout");
    });
  });
}
