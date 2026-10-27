import { gstinCheckChar } from "@erp/domain";
import { type Page, expect } from "@playwright/test";

/** Dev-only demo sign-in created by `pnpm db:seed:demo` (Admin + Sales Manager, no TOTP). */
export const demoUser = {
  email: process.env.DEMO_USER_EMAIL ?? "",
  password: process.env.DEMO_USER_PASSWORD ?? "",
};

export async function signInAsDemo(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(demoUser.email);
  await page.getByLabel("Password").fill(demoUser.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: /^Good (morning|afternoon|evening)/ }),
  ).toBeVisible();
}

/** A fresh, valid Gujarat GSTIN so repeated runs never collide on the unique index. */
export function randomGstin(): string {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const pick = () => letters[Math.floor(Math.random() * 26)]!;
  const pan = `${pick()}${pick()}${pick()}C${pick()}${String(Math.floor(Math.random() * 10000)).padStart(4, "0")}${pick()}`;
  const first14 = `24${pan}1Z`;
  return first14 + gstinCheckChar(first14);
}

export const themes = ["light", "dark"] as const;

export async function useTheme(page: Page, theme: (typeof themes)[number]): Promise<void> {
  await page.addInitScript((t) => {
    localStorage.setItem("erp:prefs", JSON.stringify({ theme: t, density: "comfortable" }));
  }, theme);
}

/** Saved demo session (written by demo.setup.ts, gitignored). */
export const DEMO_STATE = "e2e/.auth/demo.json";

/** Confirms the password if a sensitive action asks for a fresh login (ADR-0021). */
export async function confirmIfAsked(page: Page): Promise<void> {
  const dialog = page.getByRole("dialog", { name: "Confirm it's you" });
  if (await dialog.isVisible().catch(() => false)) {
    await dialog.getByLabel("Password").fill(demoUser.password);
    await dialog.getByRole("button", { name: "Confirm" }).click();
  }
}
