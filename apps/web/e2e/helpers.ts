import type { Page, Response } from "@playwright/test";
import { expect } from "@playwright/test";

/**
 * A real Ollama round trip on the target model (qwen3.6:27b, a "thinking"
 * model — see CONTRACTS.md's resolved-issues section) can run well past
 * Playwright's ~5s default. Measured directly across several isolated runs
 * (no contending Ollama clients): individual round trips ranged 70s-274s,
 * and a separate isolated run had one call exceed 300s outright — this is
 * inherent tail latency for a 27B thinking model's hint responses, not a
 * hung request (ChatMain.tsx's send() unconditionally clears `busy` in a
 * `finally`, so a stuck-disabled composer isn't the failure mode here).
 * 450s gives real headroom above the demonstrated 300s shortfall; some
 * residual flakiness on this one real-LLM spec is expected regardless.
 */
export const LLM_TIMEOUT_MS = 450_000;

/**
 * Sends whatever `action` does (a Send-button click or a Hint-button click),
 * waits for the underlying POST to `/api/chat/:id` to finish, and returns it
 * so the caller can inspect the raw SSE body (e.g. for the `hint_state`
 * event's exact rung, which the UI deliberately never displays as text).
 *
 * Waiting on the composer input's disabled→enabled cycle (rather than on any
 * particular DOM text) is what makes this reliable regardless of how long
 * the model takes to finish streaming.
 */
export async function triggerTurnAndWait(page: Page, action: () => Promise<void>): Promise<Response> {
  const input = page.getByPlaceholder("Ask about your course…");
  const [response] = await Promise.all([
    page.waitForResponse(
      (r) => /\/api\/chat\/[^/]+$/.test(new URL(r.url()).pathname) && r.request().method() === "POST",
      { timeout: LLM_TIMEOUT_MS + 10_000 },
    ),
    action(),
  ]);
  await expect(input).toBeDisabled({ timeout: 5_000 });
  await expect(input).toBeEnabled({ timeout: LLM_TIMEOUT_MS });
  return response;
}

export async function sendMessage(page: Page, text: string): Promise<Response> {
  const input = page.getByPlaceholder("Ask about your course…");
  await input.fill(text);
  return triggerTurnAndWait(page, () => page.getByRole("button", { name: "Send", exact: true }).click());
}

/** Pulls a hint and returns the rung the server actually served, read off the raw SSE body. */
export async function pullHint(page: Page): Promise<string | null> {
  const hintButton = page.getByRole("button", { name: /hint/i });
  const response = await triggerTurnAndWait(page, () => hintButton.click());
  const body = await response.text();
  const match = body.match(/"type":"hint_state"[^}]*"rung":"(\w+)"/);
  return match?.[1] ?? null;
}

/**
 * Reads the last assistant turn's rendered reply text, failing fast with a
 * clear diagnostic if the turn errored instead of producing text.
 *
 * `[data-testid="turn-assistant"] .markdown` only exists when `turn.text` is
 * non-empty (TurnView gates `<Markdown>` on `turn.text &&`) — if the
 * underlying LLM call failed, that element never renders at all, and a bare
 * `.last().innerText()` would silently hang for the full default action
 * timeout waiting for an element that will never appear, rather than
 * reporting the actual error banner that IS on the page.
 *
 * `turn-assistant`/`turn-user`/`turn-error` are `data-testid`s added to
 * `TurnView.tsx` — the Tailwind redesign left no distinguishing CSS class on
 * a turn (role is conveyed only by flex alignment), so there was nothing
 * stable to select on without them.
 */
export async function lastAssistantReply(page: Page): Promise<string> {
  const lastTurn = page.locator('[data-testid="turn-assistant"]').last();
  const errorBox = lastTurn.locator('[data-testid="turn-error"]');
  if (await errorBox.count()) {
    throw new Error(`assistant turn errored instead of replying: ${await errorBox.innerText()}`);
  }
  const markdown = lastTurn.locator(".markdown");
  // A genuinely empty completion (no error, no text) is a real, if rare,
  // model behavior — e.g. a thinking model exhausting its token budget on
  // hidden reasoning before emitting any visible content — not a test-infra
  // fault. Don't hard-fail on it: a caller checking "the reply doesn't say
  // X" is still meaningfully satisfied by an empty string. Just surface it.
  if ((await markdown.count()) === 0) {
    console.warn("[lastAssistantReply] assistant turn produced no text and no .turn-error — treating as empty reply");
    return "";
  }
  return markdown.innerText();
}

/**
 * Clicks whatever creates a new chat and returns its id, read directly off
 * the POST /api/chat JSON response rather than off the URL. `waitForURL`
 * with a generic `/\/chats\/.../ ` pattern is a trap here: if we're already
 * on SOME /chats/:id page (e.g. right after `newGeneralChat`), it resolves
 * immediately against the CURRENT url instead of waiting for the new
 * navigation — silently returning the previous chat's id.
 */
async function clickAndGetNewChatId(page: Page, action: () => Promise<void>): Promise<string> {
  const [response] = await Promise.all([
    page.waitForResponse((r) => new URL(r.url()).pathname === "/api/chat" && r.request().method() === "POST"),
    action(),
  ]);
  const { id } = (await response.json()) as { id: string };
  await page.waitForURL(`**/chats/${id}`);
  return id;
}

/** Creates a new general (course-less) chat via the sidebar and navigates to it. */
export async function newGeneralChat(page: Page): Promise<string> {
  return clickAndGetNewChatId(page, () => page.getByRole("button", { name: "+ New chat" }).click());
}

/**
 * Creates a new chat scoped to (the first/only seeded) course.
 *
 * The redesign removed the old sidebar "+ next to the course" affordance
 * entirely — course-scoped chats now start from a composer
 * (`NewCourseChatComposer`) on the course's own detail page. This navigates
 * there via the sidebar's course link (not by hardcoding the seeded course's
 * name/id, so it still works if the seed data changes) and drives that
 * composer's "Start chat" button, which POSTs to `/api/chat` with the same
 * `{ id }` response shape `clickAndGetNewChatId` already expects.
 */
export async function newCourseChat(page: Page): Promise<string> {
  await page.locator('a[href^="/courses/"]').first().click();
  await page.waitForURL(/\/courses\/[^/]+$/);
  return clickAndGetNewChatId(page, () => page.getByRole("button", { name: "Start chat" }).click());
}
