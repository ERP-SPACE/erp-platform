import { test as setup } from "@playwright/test";
import { DEMO_STATE, demoUser, signInAsDemo } from "./helpers.js";

/**
 * Signs the demo user in once and saves the session for the Stage 1 specs — signing in per
 * test would trip the sign-in rate limit (20/min).
 */
setup("sign in as the demo user", async ({ page }) => {
  setup.skip(!demoUser.email || !demoUser.password, "DEMO_USER_* not set — see .env.example");
  await signInAsDemo(page);
  await page.context().storageState({ path: DEMO_STATE });
});
