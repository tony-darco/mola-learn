import { test, expect } from "@playwright/test";
import { ALICE_STORAGE, COMPACTION_CHAT } from "./fixtures";

/**
 * Compaction (§4): older turns collapse behind a summary by default, the raw
 * transcript is always retrievable, and nothing is destructively hidden.
 *
 * Seeded directly via the DB in global-setup.ts rather than generated through
 * a real 16+ turn LLM conversation — 20 raw turns with a boundary at turn 12
 * (COMPACT_THRESHOLD=16, KEEP_RAW=8 in lib/agent/compaction.ts), mirroring
 * exactly what `maybeCompact` would have written.
 *
 * Uses exact-text locators throughout: "User message 1" is a substring of
 * "User message 10", so a substring match would collide across the fixture's
 * ten numbered turns.
 */
test.use({ storageState: ALICE_STORAGE });

test("older turns collapse behind a summary by default, and the raw transcript expands without a request", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("link", { name: COMPACTION_CHAT }).click();

  const banner = page.locator('[data-testid="compacted-banner"]');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("12 earlier messages summarized");
  // The chat scrolls to the bottom on load (it's a long seeded transcript),
  // so the banner starts off-screen above the fold.
  await banner.scrollIntoViewIfNeeded();

  // Collapsed by default: the earliest raw turns are not on the page...
  await expect(page.getByText("User message 1", { exact: true })).toHaveCount(0);
  // ...but the kept tail (last 8 raw turns) IS shown.
  await expect(page.getByText("User message 7", { exact: true })).toBeVisible();
  await expect(page.getByText("Assistant reply 10", { exact: true })).toBeVisible();

  // The summary itself is retrievable on demand.
  await banner.getByRole("button", { name: "Show summary" }).click();
  await expect(banner).toContainText("process scheduling fundamentals");

  // Nothing was destructively hidden — the raw folded turns expand in place.
  await banner.getByRole("button", { name: "Show raw messages" }).click();
  await expect(page.getByText("User message 1", { exact: true })).toBeVisible();
  await expect(page.getByText("Assistant reply 6", { exact: true })).toBeVisible();

  // And collapse again.
  await banner.getByRole("button", { name: "Collapse raw messages" }).click();
  await expect(page.getByText("User message 1", { exact: true })).toHaveCount(0);
});
