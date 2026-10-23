import AxeBuilder from "@axe-core/playwright";
import { type Page, expect, test } from "@playwright/test";

const audit = async (page: Page) =>
  new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();

for (const theme of ["light", "dark"] as const) {
  test.describe(`${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript((t) => {
        localStorage.setItem("erp:prefs", JSON.stringify({ theme: t, density: "comfortable" }));
      }, theme);
    });

    test("/_design has no WCAG A/AA violations (stage gate)", async ({ page }) => {
      await page.goto("/_design");
      await expect(page.getByRole("heading", { name: "Editorial Ledger" })).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      const results = await audit(page);
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.length} node(s)`)).toEqual([]);
    });

    test("sign-in page has no WCAG A/AA violations", async ({ page }) => {
      await page.goto("/login");
      await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
      const results = await audit(page);
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.length} node(s)`)).toEqual([]);
    });
  });
}

test("the register is keyboard navigable", async ({ page }) => {
  await page.goto("/_design");
  const first = page.getByRole("row", { name: /SO\/2627\/00142/ });
  await first.click();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("row", { name: /SO\/2627\/00141/ })).toBeFocused();
});
