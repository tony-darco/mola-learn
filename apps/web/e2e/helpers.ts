import type { Page, Response } from "@playwright/test";
import { expect } from "@playwright/test";

/**
 * A real Ollama round trip on the target model (qwen3.5:27b, a "thinking"
 * model — see CONTRACTS.md's resolved-issues section) can run well past
 * Playwright's ~5s default. 120s is generous but bounded; actual observed
 * timings are reported alongside each spec's results.
 */
export const LLM_TIMEOUT_MS = 120_000;

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
 * Creates a new chat scoped to (the first/only seeded) course, via the
 * sidebar "+" next to the course section header.
 *
 * Note: that button's accessible name is its visible text, "+" — its
 * `title="New chat in {course.name}"` attribute is only a tooltip, not part
 * of the accname computation when the element already has text content — so
 * this locates it by class rather than by an (incorrect) accessible name.
 */
export async function newCourseChat(page: Page): Promise<string> {
  return clickAndGetNewChatId(page, () => page.locator(".sidebar-section-add").first().click());
}
