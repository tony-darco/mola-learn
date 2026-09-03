import { test as setup, expect } from "@playwright/test";
import { ALICE, BOB, ALICE_STORAGE, BOB_STORAGE } from "./fixtures";

/**
 * Signs in through the real credentials form (no dev-login shortcut exists
 * anymore — README's "Verifying the security boundary" section) and saves
 * the resulting session cookie so every other spec can `test.use({
 * storageState })` instead of re-doing this UI flow per test.
 */
async function signIn(page: import("@playwright/test").Page, email: string, password: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  // A successful sign-in redirects to "/"; an incorrect one stays on
  // /sign-in?error=1 and this would time out — fail loudly rather than
  // silently saving a signed-out storage state.
  await page.waitForURL((url) => url.pathname === "/", { timeout: 15_000 });
}

setup("authenticate as alice", async ({ page }) => {
  await signIn(page, ALICE.email, ALICE.password);
  await expect(page.locator("body")).not.toContainText("Not signed in");
  await page.context().storageState({ path: ALICE_STORAGE });
});

setup("authenticate as bob", async ({ page }) => {
  await signIn(page, BOB.email, BOB.password);
  await expect(page.locator("body")).not.toContainText("Not signed in");
  await page.context().storageState({ path: BOB_STORAGE });
});
