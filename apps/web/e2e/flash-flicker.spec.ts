import { test, expect } from "@playwright/test";
import { ALICE_STORAGE, FLICKER_CHAT_A, FLICKER_CHAT_B } from "./fixtures";

/**
 * The exact reported flash/flicker/jump bug (PROPOSALS.md §1). Describes the
 * CORRECT behavior. EXPECTED TO FAIL here — not weakened to pass against the
 * current code.
 *
 * Re-verified by hand after the Tailwind redesign merged (a MutationObserver
 * watching for "Loading conversation" while clicking back to an
 * already-visited chat): the redesign's persistent shell
 * (`AppShell.tsx`/`(shell)/layout.tsx`) only keeps the *sidebar* mounted
 * across navigation — it never touched `ChatMain.tsx`, which is what
 * actually owns this bug. `ChatMain` still has no per-chat cache: its
 * history-loading `useEffect` (keyed on `[chatId]`) unconditionally calls
 * `setLoading(true)` and re-fetches `/api/chat/:id` on every chat switch,
 * even to a chat already fetched once this session. The blank-loading flash
 * this test checks for still reproduces. Fixing that for real means giving
 * `ChatMain` (or a context above it) a per-chat cache — out of scope here;
 * this file only needed its selectors fixed to actually reach that
 * conclusion instead of failing on a stale `.turn-assistant` class.
 */
test.use({ storageState: ALICE_STORAGE });

test.describe("chat switching: flash, flicker, and content jumping", () => {
  test("revisiting an already-loaded chat this session shows no blank loading state, and rendered messages never surface raw markdown/LaTeX", async ({
    page,
  }) => {
    await page.goto("/");

    await page.getByRole("link", { name: FLICKER_CHAT_A }).click();
    await expect(page.locator('[data-testid="turn-assistant"] .markdown').last()).toContainText("CPU burst", { timeout: 15_000 });

    await page.getByRole("link", { name: FLICKER_CHAT_B }).click();
    await expect(page.locator('[data-testid="turn-assistant"] .markdown').last()).toContainText("Shortest Job First", {
      timeout: 15_000,
    });

    // Click back to A — already fetched and rendered once this session.
    // Correct behavior: no blank spinner state on the way back.
    await page.getByRole("link", { name: FLICKER_CHAT_A }).click();

    let flashed = false;
    try {
      await page.getByText("Loading conversation").waitFor({ state: "visible", timeout: 800 });
      flashed = true;
    } catch {
      flashed = false;
    }
    expect(
      flashed,
      "revisiting an already-loaded chat this session should not show a blank loading state " +
        "(known bug: ChatShell has no per-chat cache and unconditionally sets loading=true on every " +
        "chatId change — see PROPOSALS.md §1, assigned to the UI lead on feat/ui-redesign)",
    ).toBe(false);

    await expect(page.locator('[data-testid="turn-assistant"] .markdown').last()).toContainText("CPU burst", { timeout: 15_000 });

    // Bold markdown renders correctly — this part is NOT the bug.
    await expect(page.locator(".turn-assistant .markdown strong").first()).toBeVisible();

    // LaTeX never renders at all today (no remark-math/rehype-katex wired in —
    // verified absent from package.json/lockfile). These are soft assertions
    // so the hard checks above still get a clean pass/fail independent of this
    // known, already-tracked gap.
    const assistantText = await page.locator('[data-testid="turn-assistant"] .markdown').last().innerText();
    expect
      .soft(assistantText, "inline LaTeX should not appear as literal $...$ text")
      .not.toContain("$T_{cpu}$");
    expect
      .soft(assistantText, "block LaTeX should not appear as literal $$...$$ text")
      .not.toMatch(/\$\$/);
  });
});
