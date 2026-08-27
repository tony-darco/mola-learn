import { test, expect } from "@playwright/test";
import { ALICE_STORAGE } from "./fixtures";

/**
 * Artifact rendering (contract 6). No flashcard/quiz/mind-map producing tool
 * exists yet in Phase 1 (Agents E/G/H) — `components/chat/fixtures.ts` wires
 * three fixtures, built directly against the frozen zod schema, to a dev-only
 * "Preview artifact renderers" affordance in the composer specifically so
 * this can be verified in a real browser ahead of those agents landing. No
 * LLM round trip needed.
 */
test.use({ storageState: ALICE_STORAGE });

test("flashcards, quizzes, and mind maps render as real interactive UI, never a raw JSON dump", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Preview artifact renderers" }).click();
  await page.getByRole("button", { name: /Insert 3 fixture artifacts/ }).click();

  // Flashcard deck: a real flip interaction, not static text.
  const flashcard = page.locator(".flashcard").first();
  await expect(flashcard).toContainText("What is a CPU burst?");
  await flashcard.click();
  await expect(flashcard).toContainText("A period during which a process uses the CPU");

  // Quiz: clicking an option reveals correctness feedback and an explanation.
  await page.locator(".quiz-option", { hasText: "Shortest Job First" }).click();
  await expect(page.locator(".quiz-option-correct")).toBeVisible();
  await expect(page.locator(".quiz-explanation")).toBeVisible();

  // Mind map: a real labeled node tree, not a payload dump.
  await expect(page.locator(".mind-map-node-label", { hasText: "CPU Scheduling" })).toBeVisible();
  await expect(page.locator(".mind-map-node-label", { hasText: "Round Robin" })).toBeVisible();
  await expect(page.locator(".mind-map-edge")).toContainText("trade-off");

  // None of the three ever shows up as raw JSON anywhere on the page.
  await expect(page.locator("body")).not.toContainText('"kind":"flashcard_deck"');
  await expect(page.locator("body")).not.toContainText('"payload"');
});
