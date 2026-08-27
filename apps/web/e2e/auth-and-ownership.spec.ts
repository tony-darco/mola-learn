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
    await expect(page.locator("body")).toContainText("no chats yet");

    // Sign out lives in the (app) chrome (Courses/Profile/Settings), not on
    // the bare chat root — navigate there to reach it.
    await page.goto("/courses");
    await page.getByRole("button", { name: "Sign out" }).click();
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
    const aliceChat = chats[0];
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

  test("an unauthenticated visitor to an (app) route is redirected to sign-in server-side, never shown protected content first", async ({
    page,
  }) => {
    // (app)/layout.tsx calls redirect("/sign-in") before rendering anything
    // for courses/profile/settings — this is a real HTTP redirect Next issues
    // server-side, so the response Playwright ultimately lands on IS the
    // sign-in page; there is no client-side flash of protected chrome first.
    await page.goto("/courses");
    expect(new URL(page.url()).pathname).toBe("/sign-in");
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expect(page.locator("body")).not.toContainText("New course");
  });

  test("an unauthenticated visitor to the chat root sees no protected content", async ({ page }) => {
    // NOTE, worth flagging in the report: `/` and `/chats/[id]` do NOT use
    // redirect() when signed out (unlike the (app) route group above) — they
    // render an inline "Not signed in" message with a 200 status instead.
    // That still satisfies "never a flash of protected content", just via a
    // different mechanism than the rest of the app. See report for detail.
    const resp = await page.goto("/");
    expect(resp?.status()).toBe(200);
    await expect(page.locator("body")).toContainText("Not signed in");
    await expect(page.locator("body")).not.toContainText("Scheduling questions");
  });
});
