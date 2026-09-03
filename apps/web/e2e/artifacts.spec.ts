import { test, expect } from "@playwright/test";
import { ALICE_STORAGE } from "./fixtures";
import { newGeneralChat } from "./helpers";

/**
 * Artifact rendering (contract 6). No flashcard/quiz/mind-map producing tool
 * exists yet in Phase 1 (Agents E/G/H) — `components/chat/fixtures.ts` wires
 * three fixtures, built directly against the frozen zod schema, to a dev-only
 * "Preview artifact renderers" affordance so this can be verified in a real
 * browser ahead of those agents landing. No LLM round trip needed.
 *
 * The redesign changed this flow in two ways this test has to follow, not
 * just re-select around:
 *  1. The preview button only exists on `ChatMain` (an actual open chat) —
 *     `page.goto("/")` now lands on the chat-less `/chat` landing page, so a
 *     chat has to be opened first.
 *  2. `ArtifactPreviewPanel.tsx` no longer has an "Insert 3 fixture
 *     artifacts" button that drops all three into the conversation as real
 *     turns. It's a side panel with three tabs (Flashcards/Quiz/Overview)
 *     that renders exactly one fixture at a time, never inserted into the
 *     chat itself — so each kind is checked by switching tabs, not by
 *     scanning inserted turns.
 */
test.use({ storageState: ALICE_STORAGE });

test("flashcards, quizzes, and mind maps render as real interactive UI, never a raw JSON dump", async ({ page }) => {
  await page.goto("/");
  await newGeneralChat(page);
  await page.getByRole("button", { name: "Preview artifact renderers" }).click();

  // Flashcards tab (the default): a real flip interaction, not static text.
  // FlashcardDeck.tsx has no distinguishing class either, but its flip
  // button carries an aria-label reflecting which face is showing.
  const flipButton = page.getByRole("button", { name: /Showing (question|answer)/ });
  await expect(flipButton).toContainText("What is a CPU burst?");
  await flipButton.click();
  await expect(flipButton).toContainText("A period during which a process uses the CPU");

  // Quiz tab: clicking an option reveals correctness feedback and an
  // explanation. Quiz.tsx conveyed correctness by color alone; it now also
  // sets an aria-label once revealed (a real a11y fix, and a stable hook).
  await page.getByRole("button", { name: "Quiz" }).click();
  await page.getByRole("button", { name: "Shortest Job First" }).click();
  await expect(page.getByRole("button", { name: /Shortest Job First \(correct answer\)/ })).toBeVisible();
  await expect(page.getByText("SJF can starve long jobs if short jobs keep arriving.")).toBeVisible();

  // Overview (mind map) tab: a real labeled node tree, not a payload dump.
  await page.getByRole("button", { name: "Overview" }).click();
  await expect(page.getByText("CPU Scheduling", { exact: true })).toBeVisible();
  await expect(page.getByText("Round Robin", { exact: true })).toBeVisible();
  await expect(page.getByText(/trade-off/)).toBeVisible();

  // None of the three ever shows up as raw JSON anywhere on the page.
  await expect(page.locator("body")).not.toContainText('"kind":"flashcard_deck"');
  await expect(page.locator("body")).not.toContainText('"payload"');
});
