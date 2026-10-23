import { fyCode, istToday } from "@erp/domain";
import { expect, test } from "@playwright/test";
import { TOTP } from "otpauth";

/**
 * Stage 0 gate (brief, Part C): sign in → change a setting → see the audit row with a
 * before/after diff → SI series preview. Runs against a freshly reset database.
 */
const email = process.env.SEED_OWNER_EMAIL ?? "owner@erp.local";
const password = process.env.SEED_OWNER_PASSWORD ?? "";

test("Owner signs in, enrols TOTP, changes a setting, sees it audited, previews SI numbering", async ({
  page,
}) => {
  test.skip(!password, "SEED_OWNER_PASSWORD not set — run pnpm setup:local and pnpm db:reset");

  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();

  // First Owner sign-in: TOTP enrolment is mandatory (ADR-0021).
  await expect(page).toHaveURL(/\/setup-2fa/);
  await page.getByLabel("Confirm your password").fill(password);
  await page.getByRole("button", { name: "Continue" }).click();
  const secret = (await page.getByTestId("totp-secret").textContent())!.trim();
  const totp = new TOTP({ secret, digits: 6, period: 30 });
  await page.getByLabel("6-digit code from the app").fill(totp.generate());
  await page.getByRole("button", { name: "Turn on two-step verification" }).click();
  await expect(page.getByTestId("backup-codes")).toBeVisible();
  await page.getByRole("button", { name: "Continue to dashboard" }).click();

  // Dashboard
  await expect(
    page.getByRole("heading", { level: 1, name: /^Good (morning|afternoon|evening)/ }),
  ).toBeVisible();
  await expect(page.getByText("Complete the company GST profile")).toBeVisible();

  // Change the override tolerance with a reason.
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("link", { name: "General" }).click();
  const row = page.locator('[data-setting="pricing.overrideTolerancePct"]');
  await row.getByRole("button", { name: "Edit" }).click();
  await row.getByLabel(/tolerance/i).fill("7.5");
  await row.getByLabel("Reason for this change").fill("Festive season pricing");
  await row.getByRole("button", { name: "Save" }).click();
  await expect(row.getByText("7.5", { exact: true })).toBeVisible();

  // The audit log shows who, why, and the before/after values.
  await page.getByRole("link", { name: "Audit log" }).click();
  await page
    .getByRole("row", { name: /Settings.*pricing\.overrideTolerancePct/ })
    .first()
    .click();
  const diff = page.getByTestId("audit-diff");
  await expect(diff.getByRole("row", { name: /value/ })).toContainText("5");
  await expect(diff.getByRole("row", { name: /value/ })).toContainText("7.5");
  await expect(page.getByRole("dialog").getByText("Festive season pricing")).toBeVisible();

  // Ctrl K → document series; the SI series previews this FY's first number.
  await page.keyboard.press("Control+k");
  await page.getByPlaceholder("Go to, create, or find…").fill("Document number");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/settings\/series/);
  await page.getByRole("row", { name: /^SI\b/ }).click();
  await expect(page.getByTestId("next-number")).toHaveText(`SI/${fyCode(istToday())}/00001`);
});
