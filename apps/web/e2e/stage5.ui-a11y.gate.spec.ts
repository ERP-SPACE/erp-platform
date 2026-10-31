import AxeBuilder from "@axe-core/playwright";
import { type Page, expect, test } from "@playwright/test";
import { DEMO_STATE, demoUser, themes, useTheme } from "./helpers.js";

test.use({ storageState: DEMO_STATE });

/**
 * Stage 5 gate: Today, the reports catalogue, report pages (with charts, highlights and
 * totals), the pivot builder and My exports have no WCAG 2.1 A/AA violations in either theme.
 * Runs after stage5.gate (file order), so the pages have data and an export.
 */
const SCREENS: { name: string; path: string; ready: string | RegExp }[] = [
  { name: "today", path: "/", ready: /^Good (morning|afternoon|evening)/ },
  { name: "reports", path: "/reports", ready: "Reports" },
  { name: "gross margin", path: "/reports/gross-margin?groupBy=customer", ready: "Gross margin" },
  { name: "sales trend", path: "/reports/sales-trend?grain=day", ready: "Customer sales trend" },
  { name: "batch aging", path: "/reports/batch-aging", ready: "Batch aging" },
  { name: "credit utilisation", path: "/reports/credit-utilisation", ready: "Credit utilisation" },
  { name: "PO variance", path: "/reports/po-variance", ready: "PO vs GRN vs PI" },
  { name: "pivot builder", path: "/reports/pivot", ready: "Pivot builder" },
  { name: "my exports", path: "/reports/exports", ready: "My exports" },
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
          page.getByRole("heading", {
            level: 1,
            name: screen.ready,
            exact: typeof screen.ready === "string",
          }),
        ).toBeVisible();
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await expectNoViolations(page, screen.name);
      });
    }

    test("the save-pivot dialog has no WCAG A/AA violations", async ({ page }) => {
      await page.goto("/reports/pivot");
      await page.getByRole("button", { name: "Save pivot" }).click();
      await expect(page.getByRole("dialog", { name: "Save pivot" })).toBeVisible();
      await expectNoViolations(page, "save pivot");
    });
  });
}
