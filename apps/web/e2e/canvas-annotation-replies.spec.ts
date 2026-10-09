/**
 * Replying to one of the AI's annotations, end to end: the student's "2 + 2
 * = 5", a scripted check that marks the 5 (K1), then a reply typed into
 * K1's note on the board. The reply and the AI's answer show in the note's
 * thread and in the chat sidebar, the reply with a "Re K1" chip; the model's
 * request names K1 (the scripted answer says what it was told); the student
 * draws on the board while the answer is on its way; all of it survives a
 * reload; and once K1 is erased, the sidebar keeps the thread, its chip
 * saying K1 is gone.
 *
 * A reply to an annotation erased meanwhile (in another tab) says "That
 * annotation is no longer on the board", not the request's status. And an
 * open note gets out of the pen's way: picking a drawing tool closes it, and
 * a stroke can start where its card was.
 *
 * The model is scripted (lib/canvas/scripted.ts, "check-sum-then-answer").
 * A last test replies to the real model (the LAN Ollama host), only when
 * asked for:
 *
 *   E2E_PORT=3059 npx playwright test --no-deps e2e/canvas-annotation-replies.spec.ts
 *   E2E_REAL_MODEL=1 E2E_PORT=3059 npx playwright test --no-deps e2e/canvas-annotation-replies.spec.ts
 */
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { generateKeyBetween } from "fractional-indexing";
import postgres from "postgres";
import { ALICE, ALICE_STORAGE } from "./fixtures";
import { textStrokes } from "./support/strokeFont";
import { annotate, newAnnotateTurn } from "../lib/canvas/annotate";
import type { CanvasChatEvent } from "../lib/canvas/chat";
import { finalizeStroke } from "../lib/canvas/stroke";
import { readCanvas } from "../lib/canvas/textSyntax";
import type { CanvasElement } from "@mola/shared";

if (!process.env.DATABASE_URL) process.loadEnvFile(resolve(fileURLToPath(import.meta.url), "../../.env.local"));

const parseEvents = (body: string) => body.split("\n\n").filter((f) => f.startsWith("data: ")).map((f) => JSON.parse(f.slice(6)) as CanvasChatEvent);

/** Handwritten `text` as the pen tool saves it, one element a stroke. */
function handwriting(text: string, x: number, y: number, size: number): CanvasElement[] {
  let index: string | null = null;
  return textStrokes(text, x, y, size).map((stroke, i) => {
    const f = finalizeStroke(stroke)!;
    index = generateKeyBetween(index, null);
    return {
      id: `sum-${i}`, parentId: null, index, x: f.x, y: f.y, width: f.width, height: f.height,
      rotation: 0, opacity: 1, createdBy: "user", type: "draw",
      props: { points: f.points, color: "#1c1b18", strokeWidth: 4, variant: "pen", dash: "solid" },
    };
  });
}

async function openChat(page: Page) {
  await expect(async () => {
    await page.getByRole("button", { name: "Canvas chat" }).click({ timeout: 1_000 });
    await expect(page.getByTestId("canvas-chat")).toBeVisible({ timeout: 1_000 });
  }).toPass();
}

/** Picks a toolbar tool; clicking before hydration does nothing, so retry. */
async function pickTool(page: Page, title: string) {
  const tool = page.getByTitle(title, { exact: true });
  await expect(async () => {
    await tool.click();
    await expect(tool).toHaveAttribute("aria-pressed", "true", { timeout: 1_000 });
  }).toPass();
}

const chatPost = (page: Page, canvasId: string, timeout = 30_000) => page.waitForResponse(
  (r) => new URL(r.url()).pathname === `/api/canvas/${canvasId}/chat` && r.request().method() === "POST",
  { timeout },
);

/** Opens an annotation's note with a click on its icon — retried, since a click before hydration does nothing — and returns its reply box. */
async function openNote(page: Page, annotationId: string) {
  const box = page.getByRole("textbox", { name: "Reply to this note" });
  await expect(async () => {
    await page.locator(`[data-testid="ai-annotation"][data-element-id="${annotationId}"]`).click({ timeout: 1_000 });
    await expect(box).toBeVisible({ timeout: 1_000 });
  }).toPass();
  return box;
}

/** A fresh canvas of Alice's holding `elements`, and its chat, on `model`. */
async function plant(sql: postgres.Sql, title: string, elements: CanvasElement[], model: string) {
  const payload = { kind: "canvas", elements, viewport: { x: 0, y: 0, zoom: 1 }, background: { pattern: "dots", color: "#ffffff" } };
  const [canvas] = await sql<{ id: string; user_id: string }[]>`
    insert into artifacts (user_id, kind, title, payload)
    values ((select id from users where email = ${ALICE.email}), 'canvas', ${title}, ${sql.json(payload)})
    returning id, user_id`;
  await sql`insert into chats (user_id, canvas_id, title, model) values (${canvas!.user_id}, ${canvas!.id}, ${title}, ${model})`;
  return canvas!.id;
}

const saved = async (sql: postgres.Sql, canvasId: string) =>
  (await sql<{ payload: { elements: CanvasElement[] } }[]>`select payload from artifacts where id = ${canvasId}`)[0]!.payload.elements;

test.describe("replies to the AI's annotations", () => {
  test.use({ storageState: ALICE_STORAGE, viewport: { width: 1600, height: 1000 } });

  test("a reply from an annotation's note: in its thread and the sidebar, named to the model, kept over a reload and after the annotation is erased", async ({ page }, testInfo) => {
    const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
    let canvasId: string | null = null;
    try {
      const work = handwriting("2 + 2 = 5", 300, 300, 40);
      canvasId = await plant(sql, "E2E Annotation replies", work, "scripted:check-sum-then-answer");
      await page.goto(`/canvas/${canvasId}`);
      await openChat(page);

      // The scripted check marks the 5: K1.
      let response = chatPost(page, canvasId);
      const input = page.getByPlaceholder("Ask about this canvas…");
      await input.fill("Check my work.");
      await input.press("Enter");
      const [k1] = parseEvents(await (await response).text()).flatMap((e) => (e.type === "annotation" ? [e.element] : []));
      expect(k1!.props).toMatchObject({ kind: "error", target: "T1 word 5" });
      await expect(input).toBeEnabled();

      // A reply, typed into K1's note.
      const box = await openNote(page, k1!.id);
      response = chatPost(page, canvasId);
      await box.fill("Why is it 4?");
      await box.press("Enter");
      const sent = await response;
      expect(sent.request().postDataJSON()).toEqual({ message: "Why is it 4?", annotationId: k1!.id });

      // While the answer is on its way, the student draws on the board — nothing waits for the reply.
      await pickTool(page, "Pen");
      const svg = page.locator("svg.touch-none");
      const at = (await svg.boundingBox())!;
      await page.mouse.move(at.x + 200, at.y + 700);
      await page.mouse.down();
      await page.mouse.move(at.x + 420, at.y + 720, { steps: 8 });
      await page.mouse.up();
      await expect(page.locator("path[data-element-id]:not([data-element-id^='sum-'])")).toHaveCount(1);
      await pickTool(page, "Select");

      // The model was told which annotation this replies to, and the answer says so.
      const events = parseEvents(await sent.text());
      const context = events[0]!;
      if (context.type !== "canvas_context") throw new Error(`first event is ${context.type}, not canvas_context`);
      expect(context.replyTo).toEqual({ label: "K1", kind: "error", target: "T1 word 5", note: "2 + 2 is 4, not 5." });
      const answer = "On K1, where I marked T1 word 5 as an error: count on 2 from 2 and you get 4.";
      expect(events.flatMap((e) => (e.type === "text_delta" ? [e.text] : [])).join("")).toBe(answer);

      // In K1's thread on the board, and in the sidebar with its chip.
      const thread = page.getByTestId("ai-annotation-thread");
      await expect(thread.getByTestId("ai-annotation-reply")).toHaveText(["Why is it 4?"]);
      await expect(thread.getByTestId("ai-annotation-answer")).toHaveText([answer]);
      const reply = page.getByTestId("canvas-turn-user").last();
      await expect(reply).toContainText("Why is it 4?");
      await expect(reply.getByTestId("canvas-reply-chip")).toHaveText("Re K1");
      await expect(page.getByTestId("canvas-turn-assistant").last()).toHaveText(answer);
      await page.screenshot({ path: testInfo.outputPath("reply.png") });

      // Stored as the student's message, with K1's id; the stroke drawn meanwhile saved like any other.
      const asked = await sql<{ content: string; annotation_id: string | null }[]>`
        select m.content, m.annotation_id from messages m join chats c on c.id = m.chat_id
        where c.canvas_id = ${canvasId} and m.role = 'user' order by m.created_at`;
      expect(asked.map((m) => [m.content, m.annotation_id])).toEqual([["Check my work.", null], ["Why is it 4?", k1!.id]]);
      await expect.poll(async () => (await saved(sql, canvasId!)).filter((e) => e.type === "draw").length).toBe(work.length + 1);

      // After a reload: the thread on the note, the chip in the sidebar.
      await page.reload();
      await openNote(page, k1!.id);
      await expect(thread.getByTestId("ai-annotation-reply")).toHaveText(["Why is it 4?"]);
      await expect(thread.getByTestId("ai-annotation-answer")).toHaveText([answer]);
      await openChat(page);
      await expect(page.getByTestId("canvas-reply-chip")).toHaveText("Re K1");

      // K1 erased: the sidebar keeps the thread, its chip saying K1 is gone — and still does after a reload.
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.keyboard.press("Delete");
      await expect(page.getByTestId("ai-annotation")).toHaveCount(0);
      const chip = page.getByTestId("canvas-reply-chip");
      await expect(chip).toHaveText("Re K1 · no longer on the board");
      await expect(chip).toHaveAttribute("data-gone", "");
      await expect.poll(async () => (await saved(sql, canvasId!)).some((e) => e.type === "annotation")).toBe(false);
      await page.reload();
      await openChat(page);
      await expect(page.getByTestId("canvas-turn-user").last()).toContainText("Why is it 4?");
      await expect(chip).toHaveText("Re K1 · no longer on the board");
      await expect(page.getByTestId("canvas-turn-assistant").last()).toHaveText(answer);
      await page.getByTestId("canvas-chat").screenshot({ path: testInfo.outputPath("erased.png") });
    } finally {
      if (canvasId) {
        await sql`delete from chats where canvas_id = ${canvasId}`;
        await sql`delete from artifacts where id = ${canvasId}`;
      }
      await sql.end();
    }
  });

  /** "2 + 2 = 5" with K1 on the 5, saved on a fresh canvas as a check would leave it; the chat is on `model`. */
  async function plantChecked(sql: postgres.Sql, title: string, model: string) {
    const work = handwriting("2 + 2 = 5", 300, 300, 40);
    const [k1] = annotate(
      { annotations: [{ target: "T1 word 5", kind: "error", mark: "circle", note: "2 + 2 is 4, not 5." }] },
      { elements: work, doc: readCanvas(work).doc }, newAnnotateTurn(),
    ).placed;
    return { work, k1: k1!, canvasId: await plant(sql, title, [...work, k1!], model) };
  }

  test("a reply to an annotation erased meanwhile says it is no longer on the board, not the request's status", async ({ page }) => {
    const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
    let canvasId: string | null = null;
    try {
      const planted = await plantChecked(sql, "E2E Annotation replies (erased meanwhile)", "scripted:check-sum-then-answer");
      canvasId = planted.canvasId;
      await page.goto(`/canvas/${canvasId}`);
      const box = await openNote(page, planted.k1.id);

      // Erased in another tab: the board as saved has no K1 now (a newer version, so this page's own save is a conflict and writes
      // nothing), though this page still shows it.
      await sql`
        update artifacts set version = version + 1, payload = jsonb_set(payload, '{elements}', (
          select coalesce(jsonb_agg(e), '[]'::jsonb) from jsonb_array_elements(payload->'elements') e where e->>'type' <> 'annotation'))
        where id = ${canvasId}`;
      expect(await saved(sql, canvasId).then((es) => es.some((e) => e.type === "annotation"))).toBe(false);

      const response = chatPost(page, canvasId);
      await box.fill("Why is it 4?");
      await box.press("Enter");
      expect((await response).status()).toBe(404);

      const thread = page.getByTestId("ai-annotation-thread");
      await expect(thread.getByTestId("ai-annotation-answer")).toHaveText(["That annotation is no longer on the board."]);
      await expect(page.getByText("request failed")).toHaveCount(0);
      // Sending a reply from a note doesn't open the chat sidebar.
      await expect(page.getByTestId("canvas-chat")).toHaveCount(0);
      // Nothing was asked of the model, and nothing stored.
      const asked = await sql`select 1 from messages m join chats c on c.id = m.chat_id where c.canvas_id = ${canvasId}`;
      expect(asked).toHaveLength(0);
    } finally {
      if (canvasId) {
        await sql`delete from chats where canvas_id = ${canvasId}`;
        await sql`delete from artifacts where id = ${canvasId}`;
      }
      await sql.end();
    }
  });

  test("an open note gets out of the pen's way: picking a drawing tool closes it, and a stroke can start where its card was", async ({ page }) => {
    const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
    let canvasId: string | null = null;
    try {
      const planted = await plantChecked(sql, "E2E Annotation replies (pen)", "scripted:check-sum-then-answer");
      canvasId = planted.canvasId;
      await page.goto(`/canvas/${canvasId}`);

      // Open, its card is on the board, over the work around the 5.
      const reply = await openNote(page, planted.k1.id);
      const card = page.locator("[data-annotation-card]");
      await expect(card).toBeVisible();
      const over = (await card.boundingBox())!;

      // The pen picked: the card goes, the reply box with it.
      await pickTool(page, "Pen");
      await expect(card).toBeHidden();
      await expect(reply).toBeHidden();

      // A stroke from where the card was reaches the board, and is saved with the student's work.
      await page.mouse.move(over.x + 40, over.y + over.height / 2);
      await page.mouse.down();
      await page.mouse.move(over.x + 180, over.y + over.height / 2 + 10, { steps: 8 });
      await page.mouse.up();
      await expect(page.locator("path[data-element-id]:not([data-element-id^='sum-'])")).toHaveCount(1);
      await expect.poll(async () => (await saved(sql, canvasId!)).filter((e) => e.type === "draw").length).toBe(planted.work.length + 1);

      // Back on Select, the note opens again, and a reply can still be typed into it.
      await pickTool(page, "Select");
      const again = await openNote(page, planted.k1.id);
      await again.fill("Why is it 4?");
      await expect(again).toHaveValue("Why is it 4?");
    } finally {
      if (canvasId) {
        await sql`delete from chats where canvas_id = ${canvasId}`;
        await sql`delete from artifacts where id = ${canvasId}`;
      }
      await sql.end();
    }
  });

  test("the real model answers a reply to its annotation", async ({ page }, testInfo) => {
    test.skip(!process.env.E2E_REAL_MODEL, "a real round trip to the LAN Ollama host — run with E2E_REAL_MODEL=1");
    // Ten minutes for the answer, queue included: past that the host is too busy for a smoke run.
    test.setTimeout(11 * 60_000);
    const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
    let canvasId: string | null = null;
    try {
      // "2 + 2 = 5" with the 5 already marked as an error, as a check would leave it.
      const work = handwriting("2 + 2 = 5", 300, 300, 40);
      const [k1] = annotate(
        { annotations: [{ target: "T1 word 5", kind: "error", mark: "circle", note: "2 + 2 is 4, not 5." }] },
        { elements: work, doc: readCanvas(work).doc }, newAnnotateTurn(),
      ).placed;
      canvasId = await plant(sql, "E2E Annotation replies (real model)", [...work, k1!], "gemma4:26b");
      await page.goto(`/canvas/${canvasId}`);

      const box = await openNote(page, k1!.id);
      const response = chatPost(page, canvasId, 10 * 60_000);
      await box.fill("Why is it 4? I counted 5.");
      await box.press("Enter");
      const events = parseEvents(await (await response).text());
      const placed = events.flatMap((e) => (e.type === "annotation" ? [e.element] : []));
      const answer = events.flatMap((e) => (e.type === "text_delta" ? [e.text] : [])).join("");
      await testInfo.attach("reply.json", { body: JSON.stringify({ answer, placed: placed.map((e) => e.props) }, null, 2), contentType: "application/json" });
      console.log(`real model answer: ${answer}`);
      console.log(`real model annotations: ${placed.map((e) => `${e.props.kind} on ${e.props.target} (${e.props.mark}): ${e.props.note}`).join(" | ") || "none"}`);

      expect(events.find((e) => e.type === "error")).toBeUndefined();
      expect(events[0]).toMatchObject({ type: "canvas_context", replyTo: { label: "K1", kind: "error", target: "T1 word 5" } });
      expect(answer.trim()).not.toBe("");
      await expect(page.getByTestId("ai-annotation-thread").getByTestId("ai-annotation-answer")).not.toBeEmpty();
      await page.screenshot({ path: testInfo.outputPath("reply-real.png") });
      expect((await saved(sql, canvasId)).filter((e) => e.type !== "annotation")).toEqual(work);
    } finally {
      if (canvasId) {
        await sql`delete from chats where canvas_id = ${canvasId}`;
        await sql`delete from artifacts where id = ${canvasId}`;
      }
      await sql.end();
    }
  });
});
