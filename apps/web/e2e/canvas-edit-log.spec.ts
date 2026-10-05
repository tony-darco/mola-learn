/**
 * The canvas chat's edit log, end to end: changes to the board show up in
 * the chat panel as log entries, in order, a moment after they're saved;
 * they're still there after a reload; and the next message the student
 * sends carries them to the model, as the section before the board ("What
 * the AI saw"). A canvas with no chat yet gets no entries — and no chat.
 *
 * Makes two real round trips to the LAN Ollama host; what the replies say
 * isn't checked.
 *
 *   pnpm --filter @mola/web e2e --no-deps e2e/canvas-edit-log.spec.ts
 */
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { ALICE, ALICE_STORAGE } from "./fixtures";
import { LLM_TIMEOUT_MS } from "./helpers";
import type { CanvasChatEvent } from "../lib/canvas/chat";

if (!process.env.DATABASE_URL) process.loadEnvFile(resolve(fileURLToPath(import.meta.url), "../../.env.local"));

const parseEvents = (body: string) => body.split("\n\n").filter((f) => f.startsWith("data: ")).map((f) => JSON.parse(f.slice(6)) as CanvasChatEvent);

/** The next edit-log sync's response — the panel asks for one after every save. */
const nextSync = (page: Page, canvasId: string) => page.waitForResponse(
  (r) => new URL(r.url()).pathname === `/api/canvas/${canvasId}/chat/edits` && r.request().method() === "POST",
  { timeout: 20_000 },
);

async function enterMath(page: Page, latex: string) {
  const field = page.locator("math-field");
  await expect(field).toBeVisible();
  await field.evaluate((el, value) => { (el as HTMLElement & { value: string }).value = value; }, latex);
  await field.press("Escape");
  await expect(field).toHaveCount(0);
}

/** Picks a toolbar tool; clicking before hydration does nothing, so retry. */
async function pickTool(page: Page, title: string) {
  const tool = page.getByTitle(title, { exact: true });
  await expect(async () => {
    await tool.click();
    await expect(tool).toHaveAttribute("aria-pressed", "true", { timeout: 1_000 });
  }).toPass();
}

async function openChat(page: Page) {
  await expect(async () => {
    await page.getByRole("button", { name: "Canvas chat" }).click({ timeout: 1_000 });
    await expect(page.getByTestId("canvas-chat")).toBeVisible({ timeout: 1_000 });
  }).toPass();
}

/** Sends a message from the panel and waits for the whole turn; returns its stream's events. */
async function ask(page: Page, canvasId: string, message: string): Promise<CanvasChatEvent[]> {
  const reply = page.waitForResponse(
    (r) => new URL(r.url()).pathname === `/api/canvas/${canvasId}/chat` && r.request().method() === "POST",
    { timeout: LLM_TIMEOUT_MS },
  );
  const input = page.getByPlaceholder("Ask about this canvas…");
  await input.fill(message);
  await input.press("Enter");
  const events = parseEvents(await (await reply).text());
  await expect(input).toBeEnabled({ timeout: 10_000 });
  return events;
}

const squash = (s: string) => s.replace(/[{}\s]/g, "");

test.describe("canvas edit log", () => {
  test.use({ storageState: ALICE_STORAGE, viewport: { width: 1600, height: 1000 } });

  test("changes show in the chat panel in order, survive a reload, and reach the model with the next message", async ({ page }, testInfo) => {
    test.setTimeout(2 * LLM_TIMEOUT_MS + 120_000);
    const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
    let canvasId: string | null = null;
    try {
      const payload = { kind: "canvas", elements: [], viewport: { x: 0, y: 0, zoom: 1 }, background: { pattern: "dots", color: "#ffffff" } };
      const [row] = await sql<{ id: string }[]>`
        insert into artifacts (user_id, kind, title, payload)
        values ((select id from users where email = ${ALICE.email}), 'canvas', 'E2E Edit Log', ${sql.json(payload)})
        returning id`;
      canvasId = row!.id;
      await page.goto(`/canvas/${canvasId}`);
      await openChat(page);
      const svg = page.locator("svg.touch-none");
      const box = (await svg.boundingBox())!;
      const entries = page.getByTestId("canvas-edit-entry");

      // No chat yet: the panel knows (its first load said so), so a save asks for no sync, and no chat is made for one.
      const syncs: string[] = [];
      page.on("request", (r) => { if (new URL(r.url()).pathname.endsWith("/chat/edits")) syncs.push(r.url()); });
      await pickTool(page, "Math");
      await page.mouse.click(box.x + 300, box.y + 200);
      await enterMath(page, "x+2");
      await expect.poll(async () => (await sql<{ n: number }[]>`
        select jsonb_array_length(payload->'elements') as n from artifacts where id = ${canvasId}`)[0]?.n).toBe(1);
      await page.waitForTimeout(2_000); // what a sync would take to be asked for, if it were going to be
      expect(syncs).toEqual([]);
      expect(await sql`select id from chats where canvas_id = ${canvasId}`).toHaveLength(0);

      // The first message makes the chat; it reads the whole board, and there's nothing before it to tell.
      const first = (await ask(page, canvasId, "What is on the board?"))[0]!;
      if (first.type !== "canvas_context") throw new Error(`first event is ${first.type}, not canvas_context`);
      expect(first.changes).toBeUndefined();
      expect(first.text).toMatch(/Q1 — math at top-left/);
      await expect(entries).toHaveCount(0);

      // Edit the math, then draw an arrow: two entries, in that order, each a moment after its save.
      const math = svg.locator("foreignObject[data-element-id]").filter({ has: page.locator(".katex") });
      await pickTool(page, "Select");
      await math.dblclick();
      let sync = nextSync(page, canvasId);
      await enterMath(page, "x+2=5");
      await sync;
      await expect(entries).toHaveCount(1, { timeout: 5_000 });
      await expect(entries.nth(0)).toHaveText(/^You changed Q1 from "x\+2" to "x\+2=5"$/);

      await pickTool(page, "Arrow");
      sync = nextSync(page, canvasId);
      await page.mouse.move(box.x + 300, box.y + 400);
      await page.mouse.down();
      await page.mouse.move(box.x + 600, box.y + 450, { steps: 8 });
      await page.mouse.up();
      await sync;
      await expect(entries).toHaveCount(2, { timeout: 5_000 });
      await expect(entries.nth(1)).toHaveText(/^You drew an arrow A1 from .+ to .+$/);
      const logged = await entries.allTextContents();
      await page.getByTestId("canvas-chat").screenshot({ path: testInfo.outputPath("edit-log.png") });

      // Stored as messages of their own, between the turns, so a reload shows them where they were.
      const rows = await sql<{ role: string; content: string }[]>`
        select m.role, m.content from messages m join chats c on c.id = m.chat_id
        where c.canvas_id = ${canvasId} order by m.created_at`;
      expect(rows.map((r) => r.role)).toEqual(["user", "assistant", "event", "event"]);
      expect(rows.slice(2).map((r) => r.content)).toEqual(logged);

      await page.reload();
      await openChat(page);
      await expect(entries).toHaveText(logged);
      await expect(page.getByTestId("canvas-turn-user")).toHaveCount(1);

      // The next message carries them, before the board, told as the student's.
      const second = (await ask(page, canvasId, "What did I just change?"))[0]!;
      if (second.type !== "canvas_context") throw new Error(`first event is ${second.type}, not canvas_context`);
      expect(second.changes).toMatch(/^WHAT CHANGED ON THE BOARD \(in order\)\n/);
      const told = second.changes!.split("\n").filter((l) => l.startsWith("- "));
      expect(told).toEqual(logged.map((l) => `- ${l.replace(/^You /, "The student ")}`));
      expect(squash(second.text)).toContain(squash(`LaTeX: "x+2=5"`));

      const saw = page.getByTestId("canvas-turn-user").nth(1);
      await saw.getByText("What the AI saw").click();
      await expect(saw.locator("pre")).toContainText("WHAT CHANGED ON THE BOARD (in order)");
      await expect(saw.locator("pre")).toContainText(told[0]!.slice(2));
      await page.getByTestId("canvas-chat").screenshot({ path: testInfo.outputPath("what-the-ai-saw.png") });

      // And it's stored with the message, as "What the AI saw" shows it after a reload.
      const [stored] = await sql<{ canvas_context: { changes?: string } }[]>`select canvas_context from messages where id = ${second.userMessageId}`;
      expect(stored!.canvas_context.changes).toBe(second.changes);
    } finally {
      if (canvasId) {
        await sql`delete from chats where canvas_id = ${canvasId}`;
        await sql`delete from artifacts where id = ${canvasId}`;
      }
      await sql.end();
    }
  });
});
