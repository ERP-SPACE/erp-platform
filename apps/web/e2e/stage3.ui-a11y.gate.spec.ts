import AxeBuilder from "@axe-core/playwright";
import { type Page, expect, test } from "@playwright/test";
import { DEMO_STATE, demoUser, themes, useTheme } from "./helpers.js";

test.use({ storageState: DEMO_STATE });

/**
 * Stage 3 gate: sales, invoicing, returns and the godown pick / inspect screens have no
 * WCAG 2.1 A/AA violations in either theme. Runs after stage3.gate (file order), so every
 * list has rows to open.
 */
const SCREENS: { name: string; path: string; ready: string }[] = [
  { name: "sales board", path: "/sales", ready: "Sales Board" },
  { name: "sales orders", path: "/sales/orders", ready: "Sales orders" },
  { name: "new sales order", path: "/sales/orders/new", ready: "New sales order" },
  { name: "challans", path: "/sales/challans", ready: "Delivery challans" },
  { name: "sales invoices", path: "/sales/invoices", ready: "Sales invoices" },
  { name: "new sales invoice", path: "/sales/invoices/new", ready: "New sales invoice" },
  { name: "proformas", path: "/sales/proformas", ready: "Proformas" },
  { name: "new proforma", path: "/sales/proformas/new", ready: "New proforma" },
  { name: "sales returns", path: "/sales/returns", ready: "Sales returns" },
  { name: "new sales return", path: "/sales/returns/new", ready: "New sales return" },
  { name: "notes", path: "/sales/notes", ready: "Credit & debit notes" },
  { name: "new note", path: "/sales/notes/new", ready: "New credit or debit note" },
  { name: "IRN queue", path: "/sales/irn", ready: "IRN queue" },
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

    test("sales document pages have no WCAG A/AA violations", async ({ page }) => {
      for (const list of [
        "/sales/orders",
        "/sales/challans",
        "/sales/invoices",
        "/sales/proformas",
        "/sales/returns",
        "/sales/notes",
      ]) {
        await page.goto(list);
        await page.getByRole("row").nth(1).click();
        await expect(page).not.toHaveURL(new RegExp(`${list}$`));
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await expectNoViolations(page, list);
      }
    });

    test("godown pick and inspect have no WCAG A/AA violations", async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      for (const path of ["/floor/pick", "/floor/inspect"]) {
        await page.goto(path);
        await expect(page.getByRole("navigation", { name: "Godown tasks" })).toBeVisible();
        await expectNoViolations(page, path);
      }
    });
  });
}
