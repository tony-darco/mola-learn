/**
 * The canvas chat writing on the board, end to end: the student's "2 + 2 =",
 * a text box with a typo ("teh answer", X1), another ("Start here", X2) and
 * a rectangle (S1) on a fresh canvas. One scripted reply (lib/canvas/
 * scripted.ts, "write-sum") writes "2 + 2 = 4" as math below the student's
 * line, fixes the typo, moves the rectangle, and — after a first try at an
 * arrow to a label that isn't on the board — draws an arrow from X2 to it.
 * All of it appears on the open canvas as the reply goes, what the AI made
 * in Mola's accent; it is one undo step, so one undo takes it all back and
 * redo brings it all back; it is saved, so it survives a reload; the edit
 * log tells it as Mola's; and nothing the student made is deleted.
 *
 * Then the page closes mid-reply ("write-sum-slowly"), before the AI writes:
 * its changes are kept pending, with the elements as they were before, and
 * land on the canvas when it opens again, saved and logged as Mola's. The
 * math, erased, stays gone — and the edits the student keeps stay.
 *
 * A third test asks the real model (the LAN Ollama host) to write the sum
 * and draw an arrow, only when asked for:
 *
 *   E2E_PORT=3061 npx playwright test --no-deps e2e/canvas-writes.spec.ts
 *   E2E_REAL_MODEL=1 E2E_PORT=3061 npx playwright test --no-deps e2e/canvas-writes.spec.ts
 */
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { generateKeyBetween } from "fractional-indexing";
import postgres from "postgres";
import { ALICE, ALICE_STORAGE } from "./fixtures";
import { textStrokes } from "./support/strokeFont";
import { finalizeStroke } from "../lib/canvas/stroke";
import type { AIChange, CanvasChatEvent } from "../lib/canvas/chat";
import type { CanvasElement } from "@mola/shared";
import { shape, textBox } from "../evals/canvas-reader/fixtures";

if (!process.env.DATABASE_URL) process.loadEnvFile(resolve(fileURLToPath(import.meta.url), "../../.env.local"));

const parseEvents = (body: string) => body.split("\n\n").filter((f) => f.startsWith("data: ")).map((f) => JSON.parse(f.slice(6)) as CanvasChatEvent);

/** Mola's accent, as the canvas draws it on a white board. */
const AI_RGB = "rgb(72, 23, 21)";
const TYPO = "teh answer";
const FIXED = "the answer";
const SUM = "2 + 2 = 4";
/** How far the scripted reply moves the rectangle. */
const MOVE = 150;

/** The board: T1 "2 + 2 =" in handwriting, X1 the typo, X2 "Start here", S1 a rectangle. */
function board(): CanvasElement[] {
  let index: string | null = null;
  const strokes = textStrokes("2 + 2 =", 100, 150, 40).map((stroke, i): CanvasElement => {
    const f = finalizeStroke(stroke)!;
    return {
      id: `sum-${i}`, parentId: null, index: "a0", x: f.x, y: f.y, width: f.width, height: f.height,
      rotation: 0, opacity: 1, createdBy: "user", type: "draw",
      props: { points: f.points, color: "#1c1b18", strokeWidth: 4, variant: "pen", dash: "solid" },
    };
  });
  return [...strokes, textBox("x1", 100, 450, TYPO), textBox("x2", 500, 150, "Start here"), shape("s1", "rectangle", 500, 450, 120, 70)]
    .map((e) => ({ ...e, index: (index = generateKeyBetween(index, null)) }));
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

const changesIn = (events: CanvasChatEvent[]) => events.flatMap((e) => (e.type === "change" ? [e.change] : []));
/** What a change is, by its element and whether it changed one already there. */
const kindOf = (c: AIChange) => `${c.element.type} ${c.before ? "changed" : "new"}`;

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

/** The AI's changes on the canvas no save has acknowledged yet: each one's id, its element's type, and its element's text before the change, if it changed one. */
const pending = async (sql: postgres.Sql, canvasId: string) =>
  sql<{ id: string; type: string; before_text: string | null; before_x: number | null }[]>`
    select id, element->>'type' as type, before->'props'->>'text' as before_text, (before->>'x')::float as before_x
    from canvas_ai_edits where canvas_id = ${canvasId} and applied_at is null order by created_at`;

/** The edit log's entries that are Mola's, as the chat tells them. */
const logged = async (sql: postgres.Sql, canvasId: string) =>
  (await sql<{ content: string }[]>`
    select m.content from messages m join chats c on c.id = m.chat_id
    where c.canvas_id = ${canvasId} and m.role = 'event' and m.content like 'Mola %' order by m.content`).map((m) => m.content);

const MOLA_LOG = [
  `Mola changed X1 from "${TYPO}" to "${FIXED}"`,
  `Mola drew an arrow A1 from X2 to S1`,
  `Mola moved S1`,
  `Mola wrote math Q1: "${SUM}"`,
];

/** A canvas element's drawn color: the first element inside it that has one of its own. */
const colorOf = (el: Locator, selector: string, prop: "color" | "stroke") => el.locator(selector).first().evaluate((n, p) => getComputedStyle(n)[p as "color" | "stroke"], prop);

/** Where a canvas element is drawn, on the page. */
const drawnAt = async (el: Locator) => (await el.boundingBox())!;

test.describe("canvas chat writes", () => {
  test.use({ storageState: ALICE_STORAGE, viewport: { width: 1600, height: 1000 } });

  test("a scripted reply writes math, fixes a typo, moves a shape and draws an arrow: live, in the AI's ink, one undo step, saved and logged as Mola's", async ({ page }, testInfo) => {
    const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
    let canvasId: string | null = null;
    try {
      const work = board();
      canvasId = await plant(sql, "E2E Writes", work, "scripted:write-sum");
      await page.goto(`/canvas/${canvasId}`);
      await openChat(page);
      const shapeBox = page.locator('[data-element-id="s1"]');
      const typoBox = page.locator('[data-element-id="x1"]');
      await expect(typoBox).toContainText(TYPO);
      const rectAt = await drawnAt(shapeBox);

      const events = await ask(page, canvasId, "Write 2 + 2 = 4 under my line, fix my typo, move the box right and join Start here to it.", 30_000);
      expect(events.map((e) => e.type).filter((t) => t !== "text_delta")).toEqual(["canvas_context", "change", "change", "change", "change", "message_end"]);
      // The typo fixed and the sum written (one call), the box moved (the arrow to S9 refused), the arrow (to S1, once the box had moved).
      const made = changesIn(events);
      expect(made.map(kindOf)).toEqual(["text changed", "math new", "shape changed", "line new"]);
      const [fix, sum, move, arrow] = made as [AIChange, AIChange, AIChange, AIChange];
      expect(fix.element).toMatchObject({ id: "x1", createdBy: "user", props: { text: FIXED } });
      expect(sum.element).toMatchObject({ createdBy: "ai", props: { latex: SUM, color: "#481715" } });
      expect(move.element).toMatchObject({ id: "s1", createdBy: "user", x: 500 + MOVE, y: 450 });
      expect(arrow.element).toMatchObject({ createdBy: "ai", props: { endArrow: true, startArrow: false, color: "#481715" } });
      await expect(page.getByTestId("canvas-turn-assistant")).toContainText("fixed the typo in X1");

      // On the canvas as it happened. What the AI made is in its ink; the typo, fixed, is still the student's text.
      const mathBox = page.locator(`[data-element-id="${sum.element.id}"]`);
      const arrowBox = page.locator(`[data-element-id="${arrow.element.id}"]`);
      await expect(mathBox.locator(".katex")).toBeVisible();
      await expect(mathBox).toContainText("2");
      expect(await colorOf(mathBox, "div", "color")).toBe(AI_RGB);
      expect(await colorOf(arrowBox, "line:not([stroke='transparent'])", "stroke")).toBe(AI_RGB);
      await expect(typoBox).toContainText(FIXED);
      expect(await colorOf(typoBox, "div", "color")).not.toBe(AI_RGB);
      await expect.poll(async () => (await drawnAt(shapeBox)).x - rectAt.x).toBeCloseTo(MOVE, -1);
      // The sum is below the student's line: under the handwriting, above the typo's box.
      const sumAt = await drawnAt(mathBox);
      const handwritingAt = await drawnAt(page.locator('path[data-element-id^="sum-"]').first());
      expect(sumAt.y).toBeGreaterThan(handwritingAt.y + handwritingAt.height);
      expect(sumAt.y + sumAt.height).toBeLessThan((await drawnAt(typoBox)).y);
      await page.locator("svg.touch-none").screenshot({ path: testInfo.outputPath("written.png") });

      // Logged as Mola's, whichever save brought them: in the chat and in the stored log.
      const entries = page.getByTestId("canvas-edit-entry");
      await expect(entries.filter({ hasText: /^Mola / })).toHaveCount(4, { timeout: 10_000 });
      await expect(entries.filter({ hasText: /^Mola wrote math Q1: "2 \+ 2 = 4"$/ })).toHaveCount(1);
      await expect(entries.filter({ hasText: /^Mola changed X1 from "teh answer" to "the answer"$/ })).toHaveCount(1);
      await expect(entries.filter({ hasText: /^Mola moved S1$/ })).toHaveCount(1);
      await expect(entries.filter({ hasText: /^Mola drew an arrow A1 from X2 to S1$/ })).toHaveCount(1);
      expect(await logged(sql, canvasId)).toEqual(MOLA_LOG);

      // Saved: all that was there still is, X1 and S1 the student's with the change in them, and the new things the AI's.
      const afterReply = await saved(sql, canvasId);
      expect(afterReply.filter((e) => e.createdBy === "ai").map((e) => e.id).sort()).toEqual([sum.element.id, arrow.element.id].sort());
      const byId = new Map(afterReply.map((e) => [e.id, e]));
      for (const e of work) expect(byId.has(e.id), `${e.id} is still on the canvas`).toBe(true);
      expect(work.filter((e) => e.id !== "x1" && e.id !== "s1").map((e) => byId.get(e.id))).toEqual(work.filter((e) => e.id !== "x1" && e.id !== "s1"));
      expect(byId.get("x1")).toMatchObject({ createdBy: "user", props: { text: FIXED } });
      expect(byId.get("s1")).toMatchObject({ createdBy: "user", x: 500 + MOVE, y: 450 });
      expect((await pending(sql, canvasId))).toEqual([]);

      // One reply, one undo step: the sum and the arrow go, the typo is back and the box is where it was — and redo does it all again.
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.keyboard.press("ControlOrMeta+z");
      await expect(mathBox).toHaveCount(0);
      await expect(arrowBox).toHaveCount(0);
      await expect(typoBox).toContainText(TYPO);
      await expect.poll(async () => (await drawnAt(shapeBox)).x - rectAt.x).toBeCloseTo(0, -1);
      await page.keyboard.press("ControlOrMeta+Shift+z");
      await expect(mathBox).toHaveCount(1);
      await expect(arrowBox).toHaveCount(1);
      await expect(typoBox).toContainText(FIXED);
      await expect.poll(async () => (await drawnAt(shapeBox)).x - rectAt.x).toBeCloseTo(MOVE, -1);

      // Still there after a reload: on the board, in the save and in the log.
      await expect.poll(async () => (await saved(sql, canvasId!)).filter((e) => e.createdBy === "ai").length).toBe(2);
      await page.reload();
      await expect(page.locator(`[data-element-id="${sum.element.id}"] .katex`)).toBeVisible();
      await expect(page.locator(`[data-element-id="${arrow.element.id}"]`)).toHaveCount(1);
      await expect(page.locator('[data-element-id="x1"]')).toContainText(FIXED);
      await expect.poll(async () => (await drawnAt(page.locator('[data-element-id="s1"]'))).x - rectAt.x).toBeCloseTo(MOVE, -1);
      await openChat(page);
      await expect(page.getByTestId("canvas-edit-entry").filter({ hasText: /^Mola / })).toHaveCount(4);
      expect(await logged(sql, canvasId)).toEqual(MOLA_LOG);
      expect((await saved(sql, canvasId)).filter((e) => e.createdBy !== "ai")).toHaveLength(work.length);
    } finally {
      if (canvasId) {
        await sql`delete from chats where canvas_id = ${canvasId}`;
        await sql`delete from artifacts where id = ${canvasId}`;
      }
      await sql.end();
    }
  });

  test("changes made after the page closed land when the canvas opens again; the math, once erased, stays gone and the edits stay", async ({ page, context }) => {
    const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
    let canvasId: string | null = null;
    try {
      const work = board();
      canvasId = await plant(sql, "E2E Writes (page closed)", work, "scripted:write-sum-slowly");
      await page.goto(`/canvas/${canvasId}`);
      await openChat(page);

      // The reply starts; the page goes while the model is still thinking, before it writes.
      const started = page.waitForResponse((r) => new URL(r.url()).pathname === `/api/canvas/${canvasId}/chat` && r.request().method() === "POST");
      const input = page.getByPlaceholder("Ask about this canvas…");
      await input.fill("Write the sum, fix my typo and move the box.");
      await input.press("Enter");
      await started;
      await page.close();

      // The reply runs on without it: three changes kept pending — the typo and the move with the element as it was — none on the canvas.
      const reply = async () => (await sql<{ status: string }[]>`
        select m.status from messages m join chats c on c.id = m.chat_id where c.canvas_id = ${canvasId} and m.role = 'assistant'`)[0]?.status;
      await expect.poll(reply, { timeout: 30_000 }).toBe("done");
      const waiting = await pending(sql, canvasId);
      expect(waiting.map((p) => [p.type, p.before_text, p.before_x])).toEqual([["text", TYPO, 100], ["math", null, null], ["shape", null, 500]]);
      expect(await saved(sql, canvasId)).toEqual(work);
      const sumId = waiting.find((p) => p.type === "math")!.id;

      // Opened again: the page applies all three, saves them — no longer pending — and the log tells them as Mola's.
      const again = await context.newPage();
      await again.goto(`/canvas/${canvasId}`);
      const sumBox = again.locator(`[data-element-id="${sumId}"]`);
      await expect(sumBox.locator(".katex")).toBeVisible();
      expect(await colorOf(sumBox, "div", "color")).toBe(AI_RGB);
      await expect(again.locator('[data-element-id="x1"]')).toContainText(FIXED);
      const rectAt = await drawnAt(again.locator('[data-element-id="s1"]'));
      await expect.poll(async () => {
        const els = await saved(sql, canvasId!);
        return [els.find((e) => e.id === sumId)?.type, els.find((e) => e.id === "s1")?.x, (await pending(sql, canvasId!)).length];
      }).toEqual(["math", 500 + MOVE, 0]);
      await openChat(again);
      await expect(again.getByTestId("canvas-edit-entry").filter({ hasText: /^Mola / })).toHaveCount(3, { timeout: 10_000 });
      expect(await logged(sql, canvasId)).toEqual([MOLA_LOG[0], MOLA_LOG[2], MOLA_LOG[3]]);

      // The math erased by the student: gone from the board and the save, and still gone after a reload. The edits the AI made stay.
      await sumBox.click();
      await again.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await again.keyboard.press("Delete");
      await expect(sumBox).toHaveCount(0);
      await expect.poll(async () => (await saved(sql, canvasId!)).some((e) => e.id === sumId)).toBe(false);
      await expect(again.getByTestId("canvas-edit-entry").filter({ hasText: /^You deleted Q1: "2 \+ 2 = 4"$/ })).toHaveCount(1, { timeout: 10_000 });
      await again.reload();
      await expect(again.locator('[data-element-id="x1"]')).toContainText(FIXED);
      await again.waitForTimeout(2_000); // what a pending change would take to be applied and saved, if there were one
      await expect(again.locator(`[data-element-id="${sumId}"]`)).toHaveCount(0);
      await expect.poll(async () => (await drawnAt(again.locator('[data-element-id="s1"]'))).x).toBeCloseTo(rectAt.x, -1);
      const left = await saved(sql, canvasId);
      expect(left.map((e) => e.id)).toEqual(work.map((e) => e.id));
      expect(left.find((e) => e.id === "x1")).toMatchObject({ createdBy: "user", props: { text: FIXED } });
      expect(left.find((e) => e.id === "s1")).toMatchObject({ createdBy: "user", x: 500 + MOVE });
      expect(await pending(sql, canvasId)).toEqual([]);
    } finally {
      if (canvasId) {
        await sql`delete from chats where canvas_id = ${canvasId}`;
        await sql`delete from artifacts where id = ${canvasId}`;
      }
      await sql.end();
    }
  });

  test("the real model writes the sum and draws an arrow", async ({ page }, testInfo) => {
    test.skip(!process.env.E2E_REAL_MODEL, "a real round trip to the LAN Ollama host — run with E2E_REAL_MODEL=1");
    // Ten minutes for each answer, queue included: past that the host is too busy for a smoke run.
    test.setTimeout(25 * 60_000);
    const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
    let canvasId: string | null = null;
    try {
      const work = board();
      canvasId = await plant(sql, "E2E Writes (real model)", work);
      await page.goto(`/canvas/${canvasId}`);
      await openChat(page);

      const written = await ask(page, canvasId, "can you write 2 + 2 for me", 10 * 60_000);
      const drawn = await ask(page, canvasId, "draw an arrow from X1 to X2", 10 * 60_000);
      const report = [written, drawn].map((events) => ({
        reply: events.flatMap((e) => (e.type === "text_delta" ? [e.text] : [])).join(""),
        changes: changesIn(events).map((c) => ({ kind: kindOf(c), element: c.element.type === "math" ? c.element.props.latex : c.element.type === "text" ? c.element.props.text : c.element.type })),
      }));
      await testInfo.attach("replies.json", { body: JSON.stringify(report, null, 2), contentType: "application/json" });
      console.log(`real model, "can you write 2 + 2 for me": ${JSON.stringify(report[0])}`);
      console.log(`real model, "draw an arrow from X1 to X2": ${JSON.stringify(report[1])}`);

      expect([...written, ...drawn].find((e) => e.type === "error")).toBeUndefined();
      expect(changesIn(written).filter((c) => c.element.type === "math" || c.element.type === "text").length).toBeGreaterThan(0);
      expect(changesIn(drawn).filter((c) => c.element.type === "line" && !c.before)).toHaveLength(1);
      await page.locator("svg.touch-none").screenshot({ path: testInfo.outputPath("written-real.png") });
      // Whatever it wrote or drew, the student's work is all still there.
      const left = new Map((await saved(sql, canvasId)).map((e) => [e.id, e]));
      for (const e of work) expect(left.has(e.id), `${e.id} is still on the canvas`).toBe(true);
    } finally {
      if (canvasId) {
        await sql`delete from chats where canvas_id = ${canvasId}`;
        await sql`delete from artifacts where id = ${canvasId}`;
      }
      await sql.end();
    }
  });
});
