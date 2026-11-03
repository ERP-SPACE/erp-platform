import AxeBuilder from "@axe-core/playwright";
import { type Page, expect, test } from "@playwright/test";
import { DEMO_STATE, demoUser, themes, useTheme } from "./helpers.js";

test.use({ storageState: DEMO_STATE });

/**
 * Stage 6 gate: every chapter of the Opening Balance Wizard has no WCAG 2.1 A/AA violations in
 * either theme. Runs after stage6.gate (file order), so the chapters have imports, a confirmed
 * total and the "live" state.
 */
const STEPS = ["STOCK", "AR", "AP", "CASH", "REVIEW", "GOLIVE"] as const;

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

    for (const step of STEPS) {
      test(`opening balances · ${step} has no WCAG A/AA violations`, async ({ page }) => {
        await page.goto(`/settings/opening?step=${step}`);
        await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
        await expect(page.getByText("Opening balances").first()).toBeVisible();
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await expectNoViolations(page, step);
      });
    }
  });
}
