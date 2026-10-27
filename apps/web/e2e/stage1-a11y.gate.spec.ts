import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { DEMO_STATE, demoUser, themes, useTheme } from "./helpers.js";

test.use({ storageState: DEMO_STATE });

/** Stage 1 gate: the masters screens have no WCAG 2.1 A/AA violations in either theme. */
const SCREENS: { name: string; path: string; ready: RegExp | string }[] = [
  { name: "dashboard", path: "/", ready: /^Good (morning|afternoon|evening)/ },
  { name: "customers list", path: "/customers", ready: "Customers" },
  { name: "new customer form", path: "/customers/new", ready: "New customer" },
  { name: "catalogue", path: "/catalogue", ready: "Catalogue" },
  { name: "suppliers", path: "/suppliers", ready: "Suppliers" },
  { name: "transporters", path: "/transporters", ready: "Transporters" },
  { name: "salesmen", path: "/salesmen", ready: "Salesmen" },
  { name: "bulk rate revision", path: "/pricing/bulk-revision", ready: "Bulk rate revision" },
];

for (const theme of themes) {
  test.describe(`${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      test.skip(!demoUser.email || !demoUser.password, "DEMO_USER_* not set");
      await useTheme(page, theme);
    });

    for (const screen of SCREENS) {
      test(`${screen.name} has no WCAG A/AA violations`, async ({ page }) => {
        await page.goto(screen.path);
        await expect(page.getByRole("heading", { level: 1, name: screen.ready })).toBeVisible();
        await page.waitForLoadState("networkidle");
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        const results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze();
        expect(
          results.violations.map(
            (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
          ),
        ).toEqual([]);
      });
    }

    test("customer 360 and salesman detail have no WCAG A/AA violations", async ({ page }) => {
      await page.goto("/customers");
      await page.getByRole("row").nth(1).click();
      await expect(page).toHaveURL(/\/customers\/[0-9a-f-]{36}/);
      for (const tab of ["Overview", "Credit", "Rates"]) {
        await page.getByRole("tab", { name: new RegExp(`^${tab}`) }).click();
        await page.waitForLoadState("networkidle");
        const r = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze();
        expect(r.violations.map((v) => `${tab} · ${v.id}`)).toEqual([]);
      }
      await page.goto("/salesmen");
      await page.getByRole("row").nth(1).click();
      await expect(page).toHaveURL(/\/salesmen\/[0-9a-f-]{36}/);
      for (const tab of ["Profile", "Defaults", "KYC documents"]) {
        await page.getByRole("tab", { name: new RegExp(`^${tab}`) }).click();
        await page.waitForLoadState("networkidle");
        const r = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze();
        expect(r.violations.map((v) => `${tab} · ${v.id}`)).toEqual([]);
      }
    });
  });
}
