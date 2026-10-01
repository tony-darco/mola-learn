/**
 * Marquee selection, the selection menu and the canvas chat panel.
 *
 * - On Alice's saved reader board (written once by canvas-reader-board.spec.ts):
 *   Shift-drag around a section, Ask AI (or Check my work), and the chat
 *   route's first stream event carries that rectangle as the region and
 *   exactly that section's content — its LaTeX, or its handwritten digits —
 *   and nothing from the sections around it. A reply arrives and is stored;
 *   what it says is for a person to judge, not this test.
 * - On scratch canvases: every kind of selected element shows it (an outline,
 *   or a frame's and sticky note's own look) and a click elsewhere clears it;
 *   a plain drag on empty space still pans; Delete from the menu removes the
 *   selection, and Undo brings it back.
 * - A canvas's own chat stays out of the sidebar's chat list, its search box
 *   and the /chats landing, and is still the one its canvas's panel opens.
 *
 *   E2E_PORT=3040 pnpm --filter @mola/web e2e --no-deps canvas-selection
 */
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { ALICE, ALICE_STORAGE } from "./fixtures";
import { LLM_TIMEOUT_MS } from "./helpers";
import { planReaderBoard, READER_BOARD_TITLE, type Rect } from "./support/readerBoard";
import { toScreenRect, type ViewTransform } from "../lib/canvas/marquee";
import type { CanvasChatEvent } from "../lib/canvas/chat";

if (!process.env.DATABASE_URL) process.loadEnvFile(resolve(fileURLToPath(import.meta.url), "../../.env.local"));

/** MathLive re-serializes what it's given ("Q_d" can come back as "Q_{d}"), so compare without braces or spaces. */
const squash = (latex: string) => latex.replace(/[{}\s]/g, "");

/** The canvas's pan and zoom, read off its transformed group (CanvasView). */
async function viewTransform(page: Page): Promise<ViewTransform> {
  const attr = await page.locator("svg.touch-none > g").first().getAttribute("transform");
  const [, x, y, k] = /translate\(([^,]+),([^)]+)\) scale\(([^)]+)\)/.exec(attr ?? "")!;
  return { x: Number(x), y: Number(y), k: Number(k) };
}

/** A world rectangle in page coordinates, at the current pan and zoom. */
async function onScreen(page: Page, rect: Rect): Promise<Rect> {
  const svg = (await page.locator("svg.touch-none").boundingBox())!;
  const s = toScreenRect(rect, await viewTransform(page));
  return { minX: svg.x + s.minX, minY: svg.y + s.minY, maxX: svg.x + s.maxX, maxY: svg.y + s.maxY };
}

/** Shift + drag from the rectangle's top-left corner to its bottom-right, checking the marquee shows while dragging. */
async function shiftDrag(page: Page, rect: Rect) {
  const s = await onScreen(page, rect);
  await page.keyboard.down("Shift");
  await page.mouse.move(s.minX, s.minY);
  await page.mouse.down();
  await page.mouse.move(s.maxX, s.maxY, { steps: 10 });
  await expect(page.getByTestId("marquee")).toBeVisible();
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await expect(page.getByTestId("marquee")).toHaveCount(0);
}

/** Every printed item's top-left corner ("Q1 — math at top-left (1504, 138)", "M1 — … Top-left (303, 146), size …"). */
const topLefts = (text: string) => [...text.matchAll(/top-left \((-?\d+), (-?\d+)\)/gi)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));

const parseEvents = (body: string) => body.split("\n\n").filter((f) => f.startsWith("data: ")).map((f) => JSON.parse(f.slice(6)) as CanvasChatEvent);

const INK = "#1c1b18";
const IMAGE = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='8' height='6'><rect width='8' height='6' fill='%23b6c2d0'/></svg>";

/** A canvas element as saved (packages/shared/src/artifacts.ts). */
function el(id: string, index: string, x: number, y: number, width: number, height: number, type: string, props: Record<string, postgres.JSONValue>) {
  return { id, parentId: null, index, x, y, width, height, rotation: 0, opacity: 1, createdBy: "user", type, props };
}
const text = (id: string, index: string, x: number, y: number) => el(id, index, x, y, 160, 40, "text", {
  text: `box ${id}`, color: INK, fontSize: 18, backgroundColor: null, bold: false, italic: false, textAlign: "left", autoFit: "grow",
});

/** A throwaway canvas of Alice's, panned and zoomed out so the marquee has to work in world coordinates. */
async function scratchCanvas(sql: postgres.Sql, elements: ReturnType<typeof el>[]): Promise<string> {
  const payload = { kind: "canvas", elements, viewport: { x: 60, y: 40, zoom: 0.8 }, background: { pattern: "dots", color: "#ffffff" } };
  const [row] = await sql<{ id: string }[]>`
    insert into artifacts (user_id, kind, title, payload)
    values ((select id from users where email = ${ALICE.email}), 'canvas', 'E2E Selection', ${sql.json(payload)})
    returning id`;
  return row!.id;
}

test.describe("canvas selection", () => {
  test.use({ storageState: ALICE_STORAGE, viewport: { width: 1920, height: 1200 } });

  test("Ask AI sends exactly the selected section, and the reply is stored", async ({ page }, testInfo) => {
    test.setTimeout(3 * LLM_TIMEOUT_MS + 60_000);
    const plan = planReaderBoard();
    const sql = postgres(process.env.DATABASE_URL!, { max: 1 });

    try {
      const [board] = await sql<{ id: string }[]>`
        select a.id from artifacts a join users u on u.id = a.user_id
        where u.email = ${ALICE.email} and a.kind = 'canvas' and a.title = ${READER_BOARD_TITLE}`;
      test.skip(!board, "no reader board yet — write it with E2E_WRITE_BOARD=1 … canvas-reader-board");
      // A fresh conversation each run, so its history and labels start from nothing.
      await sql`delete from chats where canvas_id = ${board!.id}`;

      await page.goto(`/canvas/${board!.id}`);
      // Open the chat first, so the canvas keeps one size from here on; clicking before hydration does nothing, so retry.
      await expect(async () => {
        await page.getByRole("button", { name: "Canvas chat" }).click({ timeout: 1_000 });
        await expect(page.getByTestId("canvas-chat")).toBeVisible({ timeout: 1_000 });
      }).toPass();
      // The whole board in view, at whatever zoom that takes. Fitting animates, so wait for it to settle.
      await page.getByTitle("Fit to content").click();
      let last = "";
      await expect.poll(async () => {
        const now = JSON.stringify(await viewTransform(page));
        const settled = now === last;
        last = now;
        return settled;
      }, { intervals: [400] }).toBe(true);

      const menu = page.getByTestId("selection-menu");
      const input = page.getByPlaceholder("Ask about this canvas…");
      const cases: { section: string; ask: "Ask AI" | "Check my work"; check: (text: string) => void }[] = [
        { section: "matrix-multiplication-math", ask: "Ask AI", check: (text) => expectLatexOf(text, "matrix-multiplication-math") },
        { section: "economics-math", ask: "Ask AI", check: (text) => expectLatexOf(text, "economics-math") },
        {
          section: "matrix-multiplication-neat",
          ask: "Check my work",
          // The product's entries, however the reader splits a row into cells: "[ 19 22 ]" or "[ 1922 ]".
          check: (text) => {
            const flat = text.replace(/\s/g, "");
            expect(flat).toContain("[1922]");
            expect(flat).toContain("[4350]");
          },
        },
      ];
      function expectLatexOf(text: string, section: string) {
        const sent = [...text.matchAll(/LaTeX: "(.*)"$/gm)].map((m) => squash(m[1]!)).sort();
        expect(sent).toEqual(plan.math.filter((m) => m.section === section).map((m) => squash(m.latex)).sort());
      }

      for (const [i, c] of cases.entries()) {
        const { rect } = plan.sections.find((s) => s.id === c.section)!;
        // A plain click on empty space (the section's corner) clears the last selection; then marquee this section alone.
        const corner = await onScreen(page, rect);
        await page.mouse.click(corner.minX, corner.minY);
        await expect(menu).toHaveCount(0);
        await shiftDrag(page, rect);
        await expect(menu).toBeVisible();
        if (i === 0) await page.screenshot({ path: testInfo.outputPath("selection-menu.png") });

        const reply = page.waitForResponse(
          (r) => new URL(r.url()).pathname === `/api/canvas/${board!.id}/chat` && r.request().method() === "POST",
          { timeout: LLM_TIMEOUT_MS },
        );
        if (c.ask === "Ask AI") {
          await menu.getByRole("button", { name: "Ask AI" }).click();
          await expect(page.getByText(/^Selection · \d+ items?$/)).toBeVisible();
          await input.fill("What is written in this part of the board?");
          await input.press("Enter");
        } else {
          await menu.getByRole("button", { name: "Check my work" }).click();
        }
        const events = parseEvents(await (await reply).text());

        // The first event: what the model was given.
        const first = events[0]!;
        if (first.type !== "canvas_context") throw new Error(`first event is ${first.type}, not canvas_context`);
        expect(first.region, "region").not.toBeNull();
        for (const side of ["minX", "minY", "maxX", "maxY"] as const) {
          expect(Math.abs(first.region![side] - rect[side]), `region ${side}`).toBeLessThan(4);
        }
        expect(first.text).toContain("CANVAS SELECTION, AS TEXT");
        const corners = topLefts(first.text);
        expect(corners.length, "items read").toBeGreaterThan(0);
        for (const p of corners) {
          expect(p.x >= rect.minX && p.x <= rect.maxX && p.y >= rect.minY && p.y <= rect.maxY, `item at (${p.x}, ${p.y}) is outside ${c.section}`).toBe(true);
        }
        c.check(first.text);

        // A reply arrived, and it and the context are stored.
        expect(events.some((e) => e.type === "text_delta"), "reply text").toBe(true);
        expect(events.at(-1)?.type).toBe("message_end");
        const [assistant] = await sql<{ status: string; content: string }[]>`select status, content from messages where id = ${first.messageId}`;
        expect(assistant?.status).toBe("done");
        expect(assistant?.content.length).toBeGreaterThan(0);
        const [user] = await sql<{ canvas_context: unknown }[]>`select canvas_context from messages where id = ${first.userMessageId}`;
        expect(user?.canvas_context).toEqual({ text: first.text, region: first.region });
        await expect(page.getByTestId("canvas-turn-assistant")).toHaveCount(i + 1);
      }

      // Labels are kept with the chat between turns.
      const [chat] = await sql<{ canvas_labels: { elements: Record<string, string> } }[]>`select canvas_labels from chats where canvas_id = ${board!.id}`;
      expect(Object.keys(chat!.canvas_labels.elements).length).toBeGreaterThan(0);

      await page.getByText("What the AI saw").first().click();
      await page.getByTestId("canvas-chat").screenshot({ path: testInfo.outputPath("what-the-ai-saw.png") });
    } finally {
      await sql.end();
    }
  });

  test("every selected element shows it: outlines after a Shift-drag, none after a click elsewhere", async ({ page }, testInfo) => {
    const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
    const canvasId = await scratchCanvas(sql, [
      el("pen", "a0", 200, 420, 100, 40, "draw", { points: [{ x: 0, y: 0 }, { x: 50, y: 40 }, { x: 100, y: 10 }], color: INK, strokeWidth: 3, variant: "pen", dash: "solid" }),
      el("math", "a1", 340, 420, 120, 40, "math", { latex: "x^2+1", color: INK, fontSize: 18 }),
      text("text", "a2", 200, 480),
      el("shape", "a3", 500, 410, 80, 60, "shape", { shapeKind: "rectangle", color: INK, fillColor: null, fillStyle: "none", strokeWidth: 2, dash: "solid" }),
      el("arrow", "a4", 620, 480, 80, 60, "line", { endX: 80, endY: -60, color: INK, strokeWidth: 2, dash: "solid", startArrow: false, endArrow: true }),
      el("image", "a5", 740, 410, 80, 60, "image", { url: IMAGE, naturalWidth: 8, naturalHeight: 6 }),
      el("note", "a6", 860, 410, 100, 100, "note", { text: "note", color: "#fef3c7", textColor: INK, fontSize: 16, bold: false, italic: false, textAlign: "left", autoFit: "grow" }),
      el("frame", "a7", 1000, 400, 160, 120, "frame", { name: "Frame" }),
    ]);

    try {
      await page.goto(`/canvas/${canvasId}`);
      const outlines = page.getByTestId("selection-outline");
      await expect(page.locator('svg.touch-none [data-element-id="frame"]').first()).toBeVisible();

      await shiftDrag(page, { minX: 180, minY: 380, maxX: 1180, maxY: 540 });
      await expect(page.getByTestId("selection-menu")).toBeVisible();
      // One outline per selected element — except frames and sticky notes, which keep their own selected look.
      await expect.poll(async () => (await outlines.evaluateAll((els) => els.map((e) => e.getAttribute("data-outline-for")))).sort())
        .toEqual(["arrow", "image", "math", "pen", "shape", "text"]);
      await expect(page.locator('g[data-element-id="frame"] rect[stroke="var(--accent)"]')).toHaveCount(1);
      await expect(page.locator('g[data-element-id="note"] rect.stroke-accent')).toHaveCount(1);
      await page.screenshot({ path: testInfo.outputPath("selection-outlines.png") });

      const empty = await onScreen(page, { minX: 200, minY: 650, maxX: 200, maxY: 650 });
      await page.mouse.click(empty.minX, empty.minY);
      await expect(outlines).toHaveCount(0);
      await expect(page.locator('g[data-element-id="frame"] rect[stroke="var(--accent)"]')).toHaveCount(0);
      await expect(page.locator('g[data-element-id="note"] rect.stroke-accent')).toHaveCount(0);
      await expect(page.getByTestId("selection-menu")).toHaveCount(0);
    } finally {
      await sql`delete from artifacts where id = ${canvasId}`;
      await sql.end();
    }
  });

  test("a plain drag still pans; Delete from the menu removes the selection, and Undo brings it back", async ({ page }) => {
    const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
    const canvasId = await scratchCanvas(sql, [text("a", "a0", 200, 200), text("b", "a1", 420, 200), text("c", "a2", 900, 200)]);
    const savedIds = async () => {
      const [row] = await sql<{ payload: { elements: { id: string }[] } }[]>`select payload from artifacts where id = ${canvasId}`;
      return row!.payload.elements.map((e) => e.id).sort();
    };

    try {
      await page.goto(`/canvas/${canvasId}`);
      const element = (id: string) => page.locator(`svg.touch-none g[data-element-id="${id}"]`);
      await expect(element("a")).toBeVisible();
      const menu = page.getByTestId("selection-menu");

      // A plain drag on empty space pans, and selects nothing.
      const before = await viewTransform(page);
      const empty = await onScreen(page, { minX: 200, minY: 500, maxX: 200, maxY: 500 });
      await page.mouse.move(empty.minX, empty.minY);
      await page.mouse.down();
      await page.mouse.move(empty.minX + 80, empty.minY + 30, { steps: 6 });
      await page.mouse.up();
      await expect.poll(async () => (await viewTransform(page)).x).toBeCloseTo(before.x + 80, 0);
      await expect(menu).toHaveCount(0);

      // Shift-drag around a and b, not c.
      await shiftDrag(page, { minX: 180, minY: 180, maxX: 600, maxY: 260 });
      await expect(menu).toBeVisible();
      await menu.getByRole("button", { name: "Delete" }).click();
      await expect(element("a")).toHaveCount(0);
      await expect(element("b")).toHaveCount(0);
      await expect(element("c")).toBeVisible();
      await expect(menu).toHaveCount(0);
      await expect.poll(savedIds, { timeout: 15_000 }).toEqual(["c"]);

      await page.getByTitle("Undo", { exact: true }).click();
      await expect(element("a")).toBeVisible();
      await expect(element("b")).toBeVisible();
      await expect.poll(savedIds, { timeout: 15_000 }).toEqual(["a", "b", "c"]);
    } finally {
      await sql`delete from artifacts where id = ${canvasId}`;
      await sql.end();
    }
  });

  test("a canvas's own chat stays out of the chat lists and search, and its canvas still has it", async ({ page }) => {
    const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
    const canvasId = await scratchCanvas(sql, []);
    // Both the newest of Alice's chats, the canvas one newest of all — whatever lists chats would show it first.
    const [canvasChat] = await sql<{ id: string }[]>`
      insert into chats (user_id, canvas_id, title, updated_at)
      values ((select id from users where email = ${ALICE.email}), ${canvasId}, 'E2E Hidden canvas chat', now() + interval '2 minutes')
      returning id`;
    const [control] = await sql<{ id: string }[]>`
      insert into chats (user_id, title, updated_at)
      values ((select id from users where email = ${ALICE.email}), 'E2E Hidden control chat', now() + interval '1 minute')
      returning id`;

    try {
      // The /chats landing opens the newest chat that isn't a canvas's.
      await page.goto("/chats");
      await page.waitForURL(`**/chats/${control!.id}`);

      // The sidebar: as first rendered, as refreshed, and on screen.
      const html = await (await page.request.get("/artifacts")).text();
      expect(html).toContain(control!.id);
      expect(html).not.toContain(canvasChat!.id);
      const list = (await (await page.request.get("/api/chat")).json()) as { chats: { id: string }[] };
      expect(list.chats.map((c) => c.id)).toContain(control!.id);
      expect(list.chats.map((c) => c.id)).not.toContain(canvasChat!.id);
      await expect(page.locator(`a[href="/chats/${control!.id}"]`).first()).toBeVisible();
      await expect(page.locator(`a[href="/chats/${canvasChat!.id}"]`)).toHaveCount(0);

      // The search box.
      await page.getByRole("button", { name: "Search", exact: true }).click();
      await page.getByPlaceholder("Search chats and courses…").fill("E2E Hidden");
      await expect(page.getByRole("button", { name: /E2E Hidden control chat/ })).toBeVisible();
      await expect(page.getByText("E2E Hidden canvas chat")).toHaveCount(0);

      // Still the canvas's own conversation.
      const panel = (await (await page.request.get(`/api/canvas/${canvasId}/chat`)).json()) as { chatId: string | null };
      expect(panel.chatId).toBe(canvasChat!.id);
    } finally {
      await sql`delete from chats where id in (${canvasChat!.id}, ${control!.id})`;
      await sql`delete from artifacts where id = ${canvasId}`;
      await sql.end();
    }
  });
});
