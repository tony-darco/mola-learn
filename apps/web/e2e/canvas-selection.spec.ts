/**
 * Marquee selection, the selection menu and the canvas chat panel.
 *
 * - On Alice's saved reader board (written once by canvas-reader-board.spec.ts):
 *   Shift-drag around a section, Ask AI (or Check my work), and the chat
 *   route's first stream event carries that rectangle as the region and
 *   exactly that section's content — its LaTeX, or its handwritten digits —
 *   and nothing from the sections around it. A reply arrives and is stored;
 *   what it says is for a person to judge, not this test.
 * - On a scratch canvas: a plain drag on empty space still pans; Delete from
 *   the menu removes the selection, and Undo brings it back.
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

  test("a plain drag still pans; Delete from the menu removes the selection, and Undo brings it back", async ({ page }) => {
    const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
    const box = (id: string, index: string, x: number, y: number) => ({
      id, parentId: null, index, x, y, width: 160, height: 40, rotation: 0, opacity: 1, createdBy: "user", type: "text",
      props: { text: `box ${id}`, color: "#1c1b18", fontSize: 18, backgroundColor: null, bold: false, italic: false, textAlign: "left", autoFit: "grow" },
    });
    const payload = {
      kind: "canvas",
      elements: [box("a", "a0", 200, 200), box("b", "a1", 420, 200), box("c", "a2", 900, 200)],
      // Panned and zoomed out, so the marquee has to work in world coordinates.
      viewport: { x: 60, y: 40, zoom: 0.8 },
      background: { pattern: "dots", color: "#ffffff" },
    };
    const [canvas] = await sql<{ id: string }[]>`
      insert into artifacts (user_id, kind, title, payload)
      values ((select id from users where email = ${ALICE.email}), 'canvas', 'E2E Selection', ${sql.json(payload)})
      returning id`;
    const savedIds = async () => {
      const [row] = await sql<{ payload: { elements: { id: string }[] } }[]>`select payload from artifacts where id = ${canvas!.id}`;
      return row!.payload.elements.map((e) => e.id).sort();
    };

    try {
      await page.goto(`/canvas/${canvas!.id}`);
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
      await sql`delete from artifacts where id = ${canvas!.id}`;
      await sql.end();
    }
  });
});
