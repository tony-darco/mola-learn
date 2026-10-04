/**
 * Writes the reader board (e2e/support/readerBoard.ts) into a saved canvas
 * owned by Alice, titled READER_BOARD_TITLE: matrix multiplication,
 * economics, chemistry and physics, each in neat handwriting, shaky
 * handwriting, and via the Math tool — all through real input (Pen tool
 * strokes, Math tool clicks).
 *
 * A setup step, not a regression test: the board is kept afterwards so the
 * reader/selection tests can read it without redrawing. Re-running replaces
 * the previous board. Skipped unless asked for:
 *
 *   E2E_WRITE_BOARD=1 E2E_PORT=3000 pnpm --filter @mola/web e2e --no-deps canvas-reader-board
 */
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { ALICE, ALICE_STORAGE } from "./fixtures";
import { planReaderBoard, READER_BOARD_TITLE } from "./support/readerBoard";

if (!process.env.DATABASE_URL) process.loadEnvFile(resolve(fileURLToPath(import.meta.url), "../../.env.local"));

type SavedElement = { type: string; props: { latex?: string } };

/** MathLive re-serializes what it's given ("Q_d" can come back as "Q_{d}"), so compare without braces or spaces. */
const squash = (latex: string) => latex.replace(/[{}\s]/g, "");

test.describe("reader board", () => {
  test.skip(!process.env.E2E_WRITE_BOARD, "writes the persistent reader-board canvas — run with E2E_WRITE_BOARD=1");
  test.use({ storageState: ALICE_STORAGE, viewport: { width: 2400, height: 1250 } });

  test("writes every section through the Pen and Math tools", async ({ page }, testInfo) => {
    test.setTimeout(300_000);
    const plan = planReaderBoard();
    const sql = postgres(process.env.DATABASE_URL!, { max: 1 });

    try {
      // Replace the previous board (only Alice's, only this exact title).
      await sql`
        delete from artifacts
        where kind = 'canvas' and title = ${READER_BOARD_TITLE}
          and user_id = (select id from users where email = ${ALICE.email})`;

      await page.goto("/artifacts");
      await page.getByRole("button", { name: "+ New Canvas" }).click();
      const dialog = page.locator("form").filter({ hasText: "New Whiteboard" });
      await dialog.getByLabel("Name").fill(READER_BOARD_TITLE);
      await dialog.getByRole("button", { name: "Blank" }).click();
      await dialog.getByRole("button", { name: "Create" }).click();
      await page.waitForURL(/\/canvas\/[0-9a-f-]{36}$/);
      const canvasId = page.url().split("/").pop()!;

      const svg = page.locator("svg.touch-none");
      await expect(svg).toBeVisible();
      const box = (await svg.boundingBox())!;
      expect(plan.bounds.maxX, "board is wider than the canvas").toBeLessThan(box.width);
      expect(plan.bounds.maxY, "board is taller than the canvas").toBeLessThan(box.height);

      // Selecting a tool before hydration finishes silently does nothing, so retry until it sticks.
      const pen = page.getByTitle("Pen", { exact: true });
      await expect(async () => {
        await pen.click();
        await expect(pen).toHaveAttribute("aria-pressed", "true", { timeout: 1_000 });
      }).toPass();
      // The thinnest pen — at the default width, 24px lowercase letters fill in and turn to blobs.
      await page.getByRole("button", { name: "S", exact: true }).click();

      for (const stroke of plan.strokes) {
        const [first, ...rest] = stroke;
        await page.mouse.move(box.x + first!.x, box.y + first!.y);
        await page.mouse.down();
        for (const p of rest) await page.mouse.move(box.x + p.x, box.y + p.y);
        await page.mouse.up();
      }

      // Each Math-tool entry: place, set the LaTeX in the editor, Escape to commit.
      const mathTool = page.getByTitle("Math", { exact: true });
      // Pen and Math share one size setting — put it back to the default the pen changed.
      await mathTool.click();
      await page.getByRole("button", { name: "M", exact: true }).click();
      for (const entry of plan.math) {
        await mathTool.click();
        await page.mouse.click(box.x + entry.at.x, box.y + entry.at.y);
        const field = page.locator("math-field");
        await expect(field).toBeVisible();
        await field.evaluate((el, latex) => { (el as HTMLElement & { value: string }).value = latex; }, entry.latex);
        await field.press("Escape");
        await expect(field).toHaveCount(0);
      }

      // Autosave is debounced; poll the database rather than sleeping.
      const readElements = async (): Promise<SavedElement[]> => {
        const [row] = await sql<{ payload: { elements: SavedElement[] } }[]>`select payload from artifacts where id = ${canvasId}`;
        return row?.payload.elements ?? [];
      };
      await expect
        .poll(async () => (await readElements()).length, { timeout: 30_000 })
        .toBe(plan.strokes.length + plan.math.length);

      const saved = await readElements();
      expect(saved.filter((e) => e.type === "draw")).toHaveLength(plan.strokes.length);
      expect(saved.filter((e) => e.type === "math").map((e) => squash(e.props.latex ?? "")).sort())
        .toEqual(plan.math.map((m) => squash(m.latex)).sort());

      console.log(`[e2e] reader board saved at /canvas/${canvasId} (${plan.strokes.length} strokes, ${plan.math.length} math elements)`);
      const shot = testInfo.outputPath("reader-board.png");
      await svg.screenshot({ path: shot });
      await testInfo.attach("reader-board", { path: shot, contentType: "image/png" });
    } finally {
      await sql.end();
    }
  });
});
