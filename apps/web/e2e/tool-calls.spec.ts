import { test, expect } from "@playwright/test";
import { ALICE_STORAGE } from "./fixtures";
import { newCourseChat, sendMessage } from "./helpers";

/**
 * Tool calls (and sub-agent runs, contract 4/6) render as collapsed rows,
 * never as chat turns and never with their internal detail dumped by
 * default. One real Ollama round trip.
 */
test.use({ storageState: ALICE_STORAGE });
test.setTimeout(5 * 60_000);

test("a course-fact lookup renders as a collapsed, expand-on-demand activity row — not inline chat text", async ({
  page,
}) => {
  await page.goto("/");
  await newCourseChat(page);

  const response = await sendMessage(page, "What is this course's number, and who teaches it?");
  const body = await response.text();

  test.skip(
    !body.includes('"type":"tool_call_start"'),
    "the model did not call read_course_fact this run — nondeterministic model behavior, not a suite defect " +
      "(CONTRACTS.md records 3/3 clean tool-calling on qwen3.5:27b for this exact demo tool)",
  );

  const turn = page
    .locator('[data-testid="turn-assistant"]')
    .filter({ has: page.locator('[data-testid="activity-row-tool"]') })
    .last();
  const row = turn.locator('[data-testid="activity-row-tool"]').first();
  await expect(row).toBeVisible();

  // Collapsed by default: the tool's raw result is not on the page at all
  // until the row is expanded.
  await expect(turn.locator('[data-testid="activity-detail"]')).toHaveCount(0);

  // It IS a distinct element from the message bubble, not spliced into the
  // rendered chat text — the activity row never lives inside `.markdown`.
  await expect(turn.locator('.markdown [data-testid^="activity-row"]')).toHaveCount(0);

  await row.locator('[data-testid="activity-row-header"]').click();
  await expect(turn.locator('[data-testid="activity-detail"]').first()).toBeVisible();
});
