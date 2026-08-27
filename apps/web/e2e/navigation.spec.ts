import { test, expect } from "@playwright/test";
import { ALICE_STORAGE } from "./fixtures";
import { newCourseChat, newGeneralChat, sendMessage } from "./helpers";

test.use({ storageState: ALICE_STORAGE });

test("a new general chat lands in the general Chats section, a new course chat lands under its course", async ({
  page,
}) => {
  await page.goto("/");

  const generalChatId = await newGeneralChat(page);
  const generalSection = page
    .locator(".sidebar-section")
    .filter({ has: page.locator(".sidebar-section-header", { hasText: "Chats" }) });
  await expect(generalSection.locator(`a[href="/chats/${generalChatId}"]`)).toBeVisible();

  const courseChatId = await newCourseChat(page);
  const courseSection = page
    .locator(".sidebar-section")
    .filter({ has: page.locator(".sidebar-section-header", { hasText: "CMSC 421" }) });
  await expect(courseSection.locator(`a[href="/chats/${courseChatId}"]`)).toBeVisible();
  await expect(generalSection.locator(`a[href="/chats/${courseChatId}"]`)).toHaveCount(0);
});

test.describe("live-turn dependent navigation checks", () => {
  test.setTimeout(5 * 60_000);

  test("reloading mid-conversation restores history instead of showing it empty", async ({ page }) => {
    await page.goto("/");
    await newGeneralChat(page);

    await sendMessage(page, "Just acknowledge this message in one short sentence.");

    const beforeReload = await page.locator(".turn-user").last().innerText();
    const assistantBefore = await page.locator(".turn-assistant .markdown").last().innerText();
    expect(assistantBefore.length).toBeGreaterThan(0);

    await page.reload();

    await expect(page.locator(".turn-user").last()).toHaveText(beforeReload, { timeout: 15_000 });
    await expect(page.locator(".turn-assistant .markdown").last()).not.toBeEmpty({ timeout: 15_000 });
  });

  test("sidebar list re-sorts to reflect a chat's own new activity", async ({ page }) => {
    await page.goto("/");
    const chatXId = await newGeneralChat(page);
    const chatYId = await newGeneralChat(page); // created after X — starts above it in a recency list

    await page.goto(`/chats/${chatXId}`);
    await sendMessage(page, "hello");

    const hrefs = await page.locator(".sidebar-chat-link").evaluateAll((els) => els.map((el) => el.getAttribute("href")));
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
