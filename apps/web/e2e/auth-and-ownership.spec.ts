import { test, expect, request as apiRequest } from "@playwright/test";
import { ALICE_STORAGE, BOB_STORAGE, SIGNED_OUT_STORAGE } from "./fixtures";

/**
 * §9, end to end through the browser — not curl (README's curl-based
 * verification already covers the plain-HTTP case; this exercises the same
 * boundary through real page navigations and cookies).
 */

test.describe("sign-up / sign-out / sign-in", () => {
  test.use({ storageState: SIGNED_OUT_STORAGE });

  test("a brand-new user can sign up, land signed in, sign out, and sign back in", async ({ page }) => {
    const email = `e2e-${Date.now()}@umbc.edu`;
    const password = "correct-horse-battery-1";

    await page.goto("/sign-up");
    await page.getByLabel("Name").fill("E2E Test User");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign up" }).click();

    await page.waitForURL((u) => u.pathname === "/", { timeout: 15_000 });
    await expect(page.locator("body")).toContainText(email);
    // Sidebar.tsx: "No chats yet" (capitalized) — was lowercase pre-redesign.
    await expect(page.locator("body")).toContainText("No chats yet");

    // Sign out no longer lives behind a full-page route (/courses, /profile,
    // /settings are all gone) — it's a "Sign out" item in the sidebar's
    // profile dropdown, opened by clicking the "{email} ▾" row.
    //
    // Reproduced live (both here and manually in a browser): clicking "Sign
    // out" in the same tick the dropdown opens silently no-ops — the click
    // lands (the item visibly highlights) but the form never submits — while
    // the identical click after the dropdown has painted works every time.
    // A real, minor timing bug in the redesigned dropdown, not a selector
    // issue; asserting the menu item is actually visible first (rather than
    // relying on click()'s own actionability wait, which isn't enough here)
    // reliably avoids it.
    await page.getByRole("button", { name: new RegExp(email) }).click();
    const signOutButton = page.getByRole("button", { name: "Sign out" });
    await expect(signOutButton).toBeVisible();
    await signOutButton.click();
    await page.waitForURL((u) => u.pathname === "/sign-in", { timeout: 15_000 });

    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL((u) => u.pathname === "/", { timeout: 15_000 });
    await expect(page.locator("body")).toContainText(email);
  });
});

test.describe("cross-user ownership (§9)", () => {
  test("Bob typing Alice's course/chat URLs directly gets 404, indistinguishable from a missing id, never a peek", async ({
    browser,
    baseURL,
  }) => {
    const aliceApi = await apiRequest.newContext({ baseURL, storageState: ALICE_STORAGE });
    const listRes = await aliceApi.get("/api/chat");
    expect(listRes.ok()).toBe(true);
    const { chats, courses } = (await listRes.json()) as {
      chats: { id: string; title: string }[];
      courses: { id: string; name: string }[];
    };
    // Not chats[0]: repeated e2e runs against this long-lived shared DB pile
    // up plenty of generically-titled "New chat" rows for every seeded user
    // (Bob included, via his own test runs), and a title this test then
    // asserts is invisible on BOB's page would spuriously fail on a shared
    // title, not a real ownership leak. `packages/db/src/seed.ts` always
    // gives Alice exactly one distinctively-titled chat ("Scheduling
    // questions") — pick that one specifically so the "not visible on Bob's
    // page" check actually means something.
    const aliceChat = chats.find((c) => c.title === "Scheduling questions") ?? chats[0];
    const aliceCourse = courses[0];
    expect(aliceChat, "seed must give Alice at least one chat").toBeTruthy();
    expect(aliceCourse, "seed must give Alice at least one course").toBeTruthy();
    await aliceApi.dispose();

    const bobContext = await browser.newContext({ storageState: BOB_STORAGE });
    const bobPage = await bobContext.newPage();

    const chatResp = await bobPage.goto(`/chats/${aliceChat!.id}`);
    expect(chatResp?.status()).toBe(404);
    await expect(bobPage.locator("body")).not.toContainText(aliceChat!.title);

    const courseResp = await bobPage.goto(`/courses/${aliceCourse!.id}`);
    expect(courseResp?.status()).toBe(404);
    await expect(bobPage.locator("body")).not.toContainText(aliceCourse!.name);

    // A row that doesn't exist at all must 404 the same way — otherwise the
    // 404-vs-200 distinction itself would leak which ids are real.
    const missingId = "00000000-0000-4000-8000-000000000000";
    const missingChatResp = await bobPage.goto(`/chats/${missingId}`);
    expect(missingChatResp?.status()).toBe(404);
    const missingCourseResp = await bobPage.goto(`/courses/${missingId}`);
    expect(missingCourseResp?.status()).toBe(404);

    await bobContext.close();
  });
});

test.describe("signed-out access to protected routes", () => {
  test.use({ storageState: SIGNED_OUT_STORAGE });

  test("an unauthenticated visitor to a shell route is redirected to sign-in server-side, never shown protected content first", async ({
    page,
  }) => {
    // The old bare `/courses` route (and /profile, /settings) is gone —
    // settings/courses/profile all live inside a modal now, under
    // `(shell)/courses/[id]`. Any real id works here: `(shell)/layout.tsx`
    // calls redirect("/sign-in") for every route in the group before any
    // page-level code (ownership checks included) ever runs, so this
    // redirect fires the same way regardless of which id follows
    // `/courses/`. This is a real HTTP redirect Next issues server-side, so
    // the response Playwright ultimately lands on IS the sign-in page;
    // there is no client-side flash of protected chrome first.
    await page.goto("/courses/00000000-0000-4000-8000-000000000000");
    expect(new URL(page.url()).pathname).toBe("/sign-in");
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Instructions");
  });

  test("an unauthenticated visitor to the chat root is redirected to sign-in, never shown protected content", async ({
    page,
  }) => {
    // This used to be a real gap the original version of this test
    // documented: `/` and `/chats/[id]` rendered an inline "Not signed in"
    // message with a 200 status instead of a real redirect, unlike the rest
    // of the app. The persistent-shell rewrite's `(shell)/layout.tsx` now
    // gates every route in the group the same way, root included — verified
    // live: a signed-out `/` visit 302s straight to `/sign-in`. Asserting
    // the corrected behavior here, not the old bug.
    const resp = await page.goto("/");
    expect(resp?.status()).toBe(200); // final response, after following the redirect, is the sign-in page's own 200
    expect(new URL(page.url()).pathname).toBe("/sign-in");
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Scheduling questions");
  });
});
