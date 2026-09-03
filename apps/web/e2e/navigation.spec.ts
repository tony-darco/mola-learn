import { test, expect } from "@playwright/test";
import { ALICE_STORAGE } from "./fixtures";
import { newCourseChat, newGeneralChat, sendMessage } from "./helpers";

test.use({ storageState: ALICE_STORAGE });

/**
 * The redesign removed per-course sidebar grouping entirely: there is one
 * flat "Chats" list regardless of a chat's course, and a course is now just
 * a navigational link to its own hub page (`Sidebar.tsx` — no more
 * `.sidebar-section`/`.sidebar-section-header` per course). So "lands under
 * its course" can no longer mean "appears in a course-labeled sidebar
 * section" — that concept is gone. What still means something, and is what
 * this now checks: both a general and a course-scoped chat show up in the
 * sidebar's one Chats list, and the course-scoped one is actually persisted
 * with the course's id (via the API, since the sidebar itself no longer
 * surfaces that association visually at all).
 */
test("a new general chat and a new course chat both land in the sidebar's Chats list, and the course chat is scoped to its course", async ({
  page,
}) => {
  await page.goto("/");

  const generalChatId = await newGeneralChat(page);
  await expect(page.locator(`[data-testid="sidebar-chat-link"][href="/chats/${generalChatId}"]`)).toBeVisible();

  const courseChatId = await newCourseChat(page);
  await expect(page.locator(`[data-testid="sidebar-chat-link"][href="/chats/${courseChatId}"]`)).toBeVisible();

  const res = await page.request.get(`/api/chat/${courseChatId}`);
  expect(res.ok()).toBe(true);
  const { chat } = (await res.json()) as { chat: { courseId: string | null } };
  expect(chat.courseId, "a chat started from a course's own page should be scoped to that course").not.toBeNull();
});

test.describe("live-turn dependent navigation checks", () => {
  test.setTimeout(5 * 60_000);

  test("reloading mid-conversation restores history instead of showing it empty", async ({ page }) => {
    await page.goto("/");
    await newGeneralChat(page);

    const messageText = "Just acknowledge this message in one short sentence.";
    await sendMessage(page, messageText);

    const assistantBefore = await page.locator('[data-testid="turn-assistant"] .markdown').last().innerText();
    expect(assistantBefore.length).toBeGreaterThan(0);

    await page.reload();

    // toContainText rather than an exact round-tripped toHaveText: innerText()
    // (used if you capture "before" text) and toHaveText's own normalization
    // disagree on the whitespace between the "You" role label and the
    // message paragraph, which is a comparison-method mismatch, not a
    // real content difference.
    await expect(page.locator('[data-testid="turn-user"]').last()).toContainText(messageText, { timeout: 15_000 });
    await expect(page.locator('[data-testid="turn-assistant"] .markdown').last()).not.toBeEmpty({ timeout: 15_000 });
  });

  test("sidebar list re-sorts to reflect a chat's own new activity", async ({ page }) => {
    await page.goto("/");
    const chatXId = await newGeneralChat(page);
    const chatYId = await newGeneralChat(page); // created after X — starts above it in a recency list

    await page.goto(`/chats/${chatXId}`);
    await sendMessage(page, "hello");

    const hrefs = await page
      .locator('[data-testid="sidebar-chat-link"]')
      .evaluateAll((els) => els.map((el) => el.getAttribute("href")));
    const xIndex = hrefs.indexOf(`/chats/${chatXId}`);
    const yIndex = hrefs.indexOf(`/chats/${chatYId}`);
    expect(xIndex, "chat X must appear in the sidebar").toBeGreaterThanOrEqual(0);
    expect(yIndex, "chat Y must appear in the sidebar").toBeGreaterThanOrEqual(0);

    // Expected behavior: X was just used, so it should now rank above Y.
    //
    // FOUND BY THIS SUITE (not previously tracked in PROPOSALS.md or
    // CHECKPOINT-1-NOTES.md): `chats.updatedAt` is never bumped when a
    // message is sent — confirmed by inspection of
    // app/api/chat/[chatId]/route.ts, which never issues an UPDATE on the
    // `chats` row (the only `db.update(...).set({ updatedAt: ... })` in that
    // file touches `messages`). The sidebar sorts by
    // `desc(chats.updatedAt)` (app/api/chat/route.ts), so a chat you are
    // actively talking in never rises above one you merely created earlier
    // and never opened again. Left as a real, currently-failing assertion
    // rather than weakened — see report.
    expect(
      xIndex,
      "the chat just messaged in should rank above one created later but never used",
    ).toBeLessThan(yIndex);
  });
});
