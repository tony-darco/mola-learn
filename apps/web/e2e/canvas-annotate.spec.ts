/**
 * The canvas chat annotating the board, end to end: the student's "2 + 2 =
 * 5" on a fresh canvas, "Check my work." from the chat panel, and the
 * reply's annotations show up on the open canvas in the AI's ink, as one
 * undo step; they are saved, so they survive a reload; the edit log tells
 * them as Mola's; and nothing the student wrote is touched.
 *
 * The reply comes from a scripted model (lib/canvas/scripted.ts,
 * "check-sum"), so it is the same every run: a check, an error sent with a
 * wrong label and a kind for its mark, then fixed, then the answer.
 *
 * Then the page closes mid-reply ("check-sum-slowly"), before its
 * annotation is placed: opened again, the canvas gets it, saved and logged
 * as Mola's; erased, it stays gone.
 *
 * Annotations on words of typed text ("X1 word 11", "Q1 word 5", from the
 * scripted "check-typed") go on the whole text box or math as far as the
 * server knows; the page draws each mark round the word itself, as laid out
 * in the browser, still there after a reload.
 *
 * A last test asks the real model (the LAN Ollama host) to check the
 * annotate eval's board, only when asked for:
 *
 *   E2E_PORT=3058 npx playwright test --no-deps e2e/canvas-annotate.spec.ts
 *   E2E_REAL_MODEL=1 E2E_PORT=3058 npx playwright test --no-deps e2e/canvas-annotate.spec.ts
 */
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { generateKeyBetween } from "fractional-indexing";
import postgres from "postgres";
import { ALICE, ALICE_STORAGE } from "./fixtures";
import { LLM_TIMEOUT_MS } from "./helpers";
import { textStrokes } from "./support/strokeFont";
import { finalizeStroke } from "../lib/canvas/stroke";
import type { CanvasChatEvent } from "../lib/canvas/chat";
import type { CanvasElement } from "@mola/shared";
import { readCanvas } from "../lib/canvas/textSyntax";
import { makeBoard } from "../evals/canvas-annotate/fixtures";
import { math, textBox } from "../evals/canvas-reader/fixtures";

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

/** Sends a message from the panel and waits for the whole reply; returns its stream's events. */
async function ask(page: Page, canvasId: string, message: string, timeout: number): Promise<CanvasChatEvent[]> {
  const reply = page.waitForResponse(
    (r) => new URL(r.url()).pathname === `/api/canvas/${canvasId}/chat` && r.request().method() === "POST",
    { timeout },
  );
  const input = page.getByPlaceholder("Ask about this canvas…");
  await input.fill(message);
  await input.press("Enter");
  const events = parseEvents(await (await reply).text());
  await expect(input).toBeEnabled({ timeout: 10_000 });
  return events;
}

const annotationsIn = (events: CanvasChatEvent[]) => events.flatMap((e) => (e.type === "annotation" ? [e.element] : []));

/** A fresh canvas of Alice's holding `elements`, and — for a scripted reply — its chat, on that script. */
async function plant(sql: postgres.Sql, title: string, elements: CanvasElement[], model?: string) {
  const payload = { kind: "canvas", elements, viewport: { x: 0, y: 0, zoom: 1 }, background: { pattern: "dots", color: "#ffffff" } };
  const [canvas] = await sql<{ id: string; user_id: string }[]>`
    insert into artifacts (user_id, kind, title, payload)
    values ((select id from users where email = ${ALICE.email}), 'canvas', ${title}, ${sql.json(payload)})
    returning id, user_id`;
  if (model) await sql`insert into chats (user_id, canvas_id, title, model) values (${canvas!.user_id}, ${canvas!.id}, ${title}, ${model})`;
  return canvas!.id;
}

const saved = async (sql: postgres.Sql, canvasId: string) =>
  (await sql<{ payload: { elements: CanvasElement[] } }[]>`select payload from artifacts where id = ${canvasId}`)[0]!.payload.elements;

/** The AI's edits on the canvas no save has acknowledged yet, by id. */
const pending = async (sql: postgres.Sql, canvasId: string) =>
  (await sql<{ id: string }[]>`select id from canvas_ai_edits where canvas_id = ${canvasId} and applied_at is null`).map((r) => r.id);

test.describe("canvas chat annotations", () => {
  test.use({ storageState: ALICE_STORAGE, viewport: { width: 1600, height: 1000 } });

  test("a scripted check puts its annotations on the board in the AI's ink, as one undo step, saved and logged as Mola's", async ({ page }, testInfo) => {
    const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
    let canvasId: string | null = null;
    try {
      const work = handwriting("2 + 2 = 5", 300, 300, 40);
      canvasId = await plant(sql, "E2E Annotate", work, "scripted:check-sum");
      await page.goto(`/canvas/${canvasId}`);
      await openChat(page);

      const events = await ask(page, canvasId, "Check my work.", 30_000);
      expect(events.map((e) => e.type).filter((t) => t !== "text_delta")).toEqual(["canvas_context", "annotation", "annotation", "message_end"]);
      const placed = annotationsIn(events);
      expect(placed.map((e) => [e.props.kind, e.props.mark, e.props.target])).toEqual([
        ["check", "underline", "T1 words 1–3"],
        ["error", "circle", "T1 word 5"],
      ]);
      await expect(page.getByTestId("canvas-turn-assistant")).toContainText("2 + 2 is 4, not 5");

      // On the canvas, in Mola's accent (the board is white), the note a hover away.
      const icons = page.getByTestId("ai-annotation");
      await expect(icons).toHaveCount(2);
      const error = page.locator('[data-testid="ai-annotation"][data-kind="error"]');
      expect(await error.locator("circle").evaluate((el) => getComputedStyle(el).fill)).toBe("rgb(72, 23, 21)");
      await error.hover();
      await expect(page.getByTestId("ai-annotation-note").filter({ hasText: "2 + 2 is 4, not 5." })).toBeVisible();
      await page.locator("svg.touch-none").screenshot({ path: testInfo.outputPath("annotated.png") });

      // Saved, and logged as Mola's.
      const entries = page.getByTestId("canvas-edit-entry");
      await expect(entries.filter({ hasText: /^Mola marked T1 word 5 as an error \(K\d\): "2 \+ 2 is 4, not 5\."$/ })).toHaveCount(1, { timeout: 10_000 });
      await expect(entries.filter({ hasText: /^Mola marked T1 words 1–3 as right \(K\d\): / })).toHaveCount(1);
      const logged = await sql<{ content: string }[]>`
        select m.content from messages m join chats c on c.id = m.chat_id
        where c.canvas_id = ${canvasId} and m.role = 'event' order by m.created_at`;
      expect(logged.map((m) => m.content.replace(/\(K\d\)/, "(K…)")).sort()).toEqual([
        `Mola marked T1 word 5 as an error (K…): "2 + 2 is 4, not 5."`,
        `Mola marked T1 words 1–3 as right (K…): "Right: 2 + 2 is the sum to work out."`,
      ]);
      const afterReply = await saved(sql, canvasId);
      expect(afterReply.filter((e) => e.type === "annotation").map((e) => [e.id, e.createdBy])).toEqual(placed.map((e) => [e.id, "ai"]));
      // Nothing the student wrote was touched; and the save acknowledged both, so neither is pending any more.
      expect(afterReply.filter((e) => e.type !== "annotation")).toEqual(work);
      expect(await pending(sql, canvasId)).toEqual([]);

      // The reply is one undo step: both annotations go together, and come back together.
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.keyboard.press("ControlOrMeta+z");
      await expect(icons).toHaveCount(0);
      await expect(page.locator('path[data-element-id^="sum-"]')).toHaveCount(work.length);
      await page.keyboard.press("ControlOrMeta+Shift+z");
      await expect(icons).toHaveCount(2);

      // Still there after a reload: on the board, and in the log.
      await expect.poll(async () => (await saved(sql, canvasId!)).filter((e) => e.type === "annotation").length).toBe(2);
      await page.reload();
      await expect(page.getByTestId("ai-annotation")).toHaveCount(2);
      await openChat(page);
      await expect(page.getByTestId("canvas-edit-entry").filter({ hasText: /^Mola marked T1 word 5 as an error/ })).toHaveCount(1);
      expect((await saved(sql, canvasId)).filter((e) => e.type !== "annotation")).toEqual(work);
    } finally {
      if (canvasId) {
        await sql`delete from chats where canvas_id = ${canvasId}`;
        await sql`delete from artifacts where id = ${canvasId}`;
      }
      await sql.end();
    }
  });

  test("an annotation placed after the page closed lands when the canvas opens again, and once erased stays gone", async ({ page, context }) => {
    const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
    let canvasId: string | null = null;
    try {
      const work = handwriting("2 + 2 = 5", 300, 300, 40);
      canvasId = await plant(sql, "E2E Annotate (page closed)", work, "scripted:check-sum-slowly");
      await page.goto(`/canvas/${canvasId}`);
      await openChat(page);

      // The reply starts; the page goes while the model is still thinking, before the annotation is placed.
      const started = page.waitForResponse((r) => new URL(r.url()).pathname === `/api/canvas/${canvasId}/chat` && r.request().method() === "POST");
      const input = page.getByPlaceholder("Ask about this canvas…");
      await input.fill("Check my work.");
      await input.press("Enter");
      await started;
      await page.close();

      // The reply runs on without it: the annotation is placed, kept pending, and never reaches the board.
      const reply = async () => (await sql<{ status: string }[]>`
        select m.status from messages m join chats c on c.id = m.chat_id where c.canvas_id = ${canvasId} and m.role = 'assistant'`)[0]?.status;
      await expect.poll(reply, { timeout: 30_000 }).toBe("done");
      const [placed] = await pending(sql, canvasId);
      expect(placed).toBeDefined();
      expect((await saved(sql, canvasId)).some((e) => e.type === "annotation")).toBe(false);

      // Opened again: the page adds it, saves it — no longer pending — and the log tells it as Mola's.
      const again = await context.newPage();
      await again.goto(`/canvas/${canvasId}`);
      const icon = again.locator(`[data-testid="ai-annotation"][data-element-id="${placed}"]`);
      await expect(icon).toHaveCount(1);
      await expect.poll(async () => (await saved(sql, canvasId!)).filter((e) => e.type === "annotation").map((e) => e.id)).toEqual([placed]);
      expect(await pending(sql, canvasId)).toEqual([]);
      await openChat(again);
      const entries = again.getByTestId("canvas-edit-entry");
      await expect(entries).toHaveText([/^Mola marked T1 word 5 as an error \(K1\): "2 \+ 2 is 4, not 5\."$/], { timeout: 10_000 });

      // Erased: gone from the board and the save, logged as the student's, and still gone after a reload.
      await icon.click();
      await again.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await again.keyboard.press("Delete");
      await expect(icon).toHaveCount(0);
      await expect.poll(async () => (await saved(sql, canvasId!)).some((e) => e.type === "annotation")).toBe(false);
      await expect(entries.nth(1)).toHaveText(/^You deleted K1: "2 \+ 2 is 4, not 5\."$/, { timeout: 10_000 });
      await again.reload();
      await expect(again.locator('path[data-element-id^="sum-"]')).toHaveCount(work.length);
      await again.waitForTimeout(2_000); // what a pending edit would take to be added and saved, if there were one
      await expect(again.getByTestId("ai-annotation")).toHaveCount(0);
      expect(await saved(sql, canvasId)).toEqual(work);
      expect(await pending(sql, canvasId)).toEqual([]);
    } finally {
      if (canvasId) {
        await sql`delete from chats where canvas_id = ${canvasId}`;
        await sql`delete from artifacts where id = ${canvasId}`;
      }
      await sql.end();
    }
  });

  test("a mark on a word of typed text goes round that word, in a text box and in math, and stays there after a reload", async ({ page }, testInfo) => {
    const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
    let canvasId: string | null = null;
    try {
      const sentence = "this is a test: 3 + 4 = 7 and 2+2=5";
      const board = [textBox("typed-text", 300, 200, sentence, { width: 380 }), math("typed-math", 300, 320, "12 \\div 4 = 4")];
      const labels = readCanvas(board).doc.items.map((i) => i.label);
      expect(labels).toEqual(["X1", "Q1"]);
      canvasId = await plant(sql, "E2E Annotate (typed words)", board, "scripted:check-typed");
      await page.goto(`/canvas/${canvasId}`);
      await openChat(page);

      const events = await ask(page, canvasId, "Check my work.", 30_000);
      const placed = annotationsIn(events);
      // The server places each on all of its element, under the words' address.
      expect(placed.map((e) => [e.props.target, e.props.targetIds])).toEqual([["X1 word 11", ["typed-text"]], ["Q1 word 5", ["typed-math"]]]);
      expect([placed[0]!.x, placed[0]!.width]).toEqual([board[0]!.x, board[0]!.width]);

      /** The screen rect of the last `count` characters drawn in the element, from the browser's own layout (math: only what KaTeX shows). */
      const lastChars = (elementId: string, count: number) => page.evaluate(([id, n]) => {
        const g = document.querySelector(`[data-element-id="${id}"]`)!;
        const root = g.querySelector(".katex-html") ?? g.querySelector("foreignObject")!;
        const chars: [Text, number][] = [];
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let t = walker.nextNode() as Text | null; t; t = walker.nextNode() as Text | null) {
          for (let i = 0; i < t.data.length; i++) if (!/[\s\u200b]/.test(t.data[i]!)) chars.push([t, i]);
        }
        const [a, b] = [chars[chars.length - (n as number)]!, chars[chars.length - 1]!];
        const range = document.createRange();
        range.setStart(a[0], a[1]);
        range.setEnd(b[0], b[1] + 1);
        const r = range.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      }, [elementId, count] as const);
      /** The screen rect of an annotation's mark. */
      const markOf = (annotationId: string) => page.locator(`[data-testid="ai-annotation-mark"][data-mark-for="${annotationId}"]`);
      const markRect = (annotationId: string) => markOf(annotationId).evaluate((g) => {
        const r = g.firstElementChild!.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      });

      async function expectMarksRoundTheWords() {
        // "2+2=5" (5 characters) is the last word of the sentence; "4" the last of the math.
        for (const [annotation, elementId, count] of [[placed[0]!, "typed-text", 5], [placed[1]!, "typed-math", 1]] as const) {
          await expect(markOf(annotation.id)).toHaveAttribute("data-place", "word");
          const [word, mark, whole] = [
            await lastChars(elementId, count), await markRect(annotation.id),
            await page.locator(`[data-element-id="${elementId}"]`).first().boundingBox(),
          ];
          // Round the word, a little over it...
          expect(mark.left).toBeLessThanOrEqual(word.left + 1);
          expect(mark.right).toBeGreaterThanOrEqual(word.right - 1);
          expect(mark.top).toBeLessThanOrEqual(word.top + 1);
          expect(mark.bottom).toBeGreaterThanOrEqual(word.bottom - 1);
          // ...and no more: not round the whole text box or formula.
          expect(mark.right - mark.left).toBeLessThan(word.right - word.left + 24);
          expect(mark.bottom - mark.top).toBeLessThan(word.bottom - word.top + 24);
          if (elementId === "typed-text") expect(mark.right - mark.left).toBeLessThan(whole!.width / 3);
        }
      }
      await expectMarksRoundTheWords();
      await page.locator("svg.touch-none").screenshot({ path: testInfo.outputPath("typed-words.png") });

      // The same after a reload: the annotations were saved with their words, and the page finds them again.
      await expect.poll(async () => (await saved(sql, canvasId!)).filter((e) => e.type === "annotation").length).toBe(2);
      await page.reload();
      await expect(page.getByTestId("ai-annotation")).toHaveCount(2);
      await expectMarksRoundTheWords();
    } finally {
      if (canvasId) {
        await sql`delete from chats where canvas_id = ${canvasId}`;
        await sql`delete from artifacts where id = ${canvasId}`;
      }
      await sql.end();
    }
  });

  test("the real model checks the annotate eval's board and annotates it", async ({ page }, testInfo) => {
    test.skip(!process.env.E2E_REAL_MODEL, "a real round trip to the LAN Ollama host — run with E2E_REAL_MODEL=1");
    test.setTimeout(3 * LLM_TIMEOUT_MS);
    const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
    let canvasId: string | null = null;
    try {
      const board = makeBoard("clean");
      canvasId = await plant(sql, "E2E Annotate (real model)", board.elements);
      await page.goto(`/canvas/${canvasId}`);
      await openChat(page);

      const events = await ask(page, canvasId, "Check my work.", 3 * LLM_TIMEOUT_MS);
      const placed = annotationsIn(events);
      const reply = events.flatMap((e) => (e.type === "text_delta" ? [e.text] : [])).join("");
      await testInfo.attach("reply.json", { body: JSON.stringify({ reply, placed: placed.map((e) => e.props), planted: board.errors.map((e) => e.address) }, null, 2), contentType: "application/json" });
      console.log(`real model: ${placed.length} annotations: ${placed.map((e) => `${e.props.kind} on ${e.props.target} (${e.props.mark}): ${e.props.note}`).join(" | ")}`);
      console.log(`real model reply: ${reply}`);

      expect(events.find((e) => e.type === "error")).toBeUndefined();
      expect(placed.length).toBeGreaterThan(0);
      expect(placed.length).toBeLessThanOrEqual(3);
      await expect(page.getByTestId("ai-annotation")).toHaveCount(placed.length);
      await expect(page.getByTestId("canvas-edit-entry").filter({ hasText: /^Mola / })).toHaveCount(placed.length, { timeout: 10_000 });
      await page.locator("svg.touch-none").screenshot({ path: testInfo.outputPath("annotated-real.png") });
      expect((await saved(sql, canvasId)).filter((e) => e.type !== "annotation")).toEqual(board.elements);
    } finally {
      if (canvasId) {
        await sql`delete from chats where canvas_id = ${canvasId}`;
        await sql`delete from artifacts where id = ${canvasId}`;
      }
      await sql.end();
    }
  });
});
