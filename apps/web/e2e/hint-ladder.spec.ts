import { test, expect } from "@playwright/test";
import { ALICE_STORAGE, FORBIDDEN_RUNG_NAMES } from "./fixtures";
import { newGeneralChat, pullHint, sendMessage } from "./helpers";

/**
 * The hint ladder (§3, CONTRACTS.md) — a precise, non-negotiable contract.
 * Three real Ollama round trips plus two more for the "don't auto-advance"
 * checks, so this file gets a generous overall budget.
 */
test.use({ storageState: ALICE_STORAGE });
test.setTimeout(10 * 60_000);

test("hint rungs escalate pointing -> teaching -> bottom_out only on explicit pulls, are never named to the student, and lock after bottom-out", async ({
  page,
}) => {
  await page.goto("/");
  await newGeneralChat(page);

  // Ground the exchange in a real conceptual question before pulling hints —
  // hints attach to "the current exchange", and Layer 4's Socratic base only
  // engages for a question the student is trying to learn from.
  await sendMessage(
    page,
    "I'm stuck on why Shortest Job First minimizes average waiting time. Can you help me think it through?",
  );

  const hintDots = page.locator(".hint-dots");

  // Pull #1 -> pointing.
  const rung1 = await pullHint(page);
  expect(rung1).toBe("pointing");
  await expect(hintDots).toHaveAttribute("aria-label", "Hint 1 of 3");
  let reply = await page.locator(".turn-assistant .markdown").last().innerText();
  for (const re of FORBIDDEN_RUNG_NAMES) expect(reply).not.toMatch(re);

  // A plain follow-up message must NOT advance the rung on its own (§3: hints
  // are pulled, never auto-escalated on a timer or a message count).
  await sendMessage(page, "Okay, I see there's a sum involved, but what does each term in it represent?");
  await expect(hintDots).toHaveAttribute("aria-label", "Hint 1 of 3");

  // Pull #2 -> teaching.
  const rung2 = await pullHint(page);
  expect(rung2).toBe("teaching");
  await expect(hintDots).toHaveAttribute("aria-label", "Hint 2 of 3");
  reply = await page.locator(".turn-assistant .markdown").last().innerText();
  for (const re of FORBIDDEN_RUNG_NAMES) expect(reply).not.toMatch(re);

  // Pull #3 -> bottom_out.
  const rung3 = await pullHint(page);
  expect(rung3).toBe("bottom_out");
  await expect(hintDots).toHaveAttribute("aria-label", "Hint 3 of 3");
  reply = await page.locator(".turn-assistant .markdown").last().innerText();
  for (const re of FORBIDDEN_RUNG_NAMES) expect(reply).not.toMatch(re);

  // Locked: the button is disabled/inert after bottom-out — a fourth pull
  // must not escalate further or re-request.
  const hintButton = page.getByRole("button", { name: /hint/i });
  await expect(hintButton).toBeDisabled();
  await expect(page.locator(".hint-bottomed-out")).toBeVisible();
});
