/**
 * Writes the diagram board (e2e/support/diagramBoard.ts) into a saved canvas
 * owned by Alice, titled DIAGRAM_BOARD_TITLE: eight hand-drawn diagrams, each
 * neat and shaky, all through real Pen-tool strokes.
 *
 * A setup step, not a regression test: the board is kept afterwards so the
 * sketch-layer checks can read it without redrawing. Re-running replaces the
 * previous board. Skipped unless asked for:
 *
 *   E2E_WRITE_BOARD=1 E2E_PORT=3000 pnpm --filter @mola/web e2e --no-deps canvas-diagram-board
 */
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { ALICE, ALICE_STORAGE } from "./fixtures";
import { DIAGRAM_BOARD_TITLE, planDiagramBoard } from "./support/diagramBoard";

if (!process.env.DATABASE_URL) process.loadEnvFile(resolve(fileURLToPath(import.meta.url), "../../.env.local"));

test.describe("diagram board", () => {
  test.skip(!process.env.E2E_WRITE_BOARD, "writes the persistent diagram-board canvas — run with E2E_WRITE_BOARD=1");
  test.use({ storageState: ALICE_STORAGE, viewport: { width: 2800, height: 1400 } });

  test("draws every section through the Pen tool", async ({ page }, testInfo) => {
    test.setTimeout(300_000);
    const plan = planDiagramBoard();
    const sql = postgres(process.env.DATABASE_URL!, { max: 1 });

    try {
      // Replace the previous board (only Alice's, only this exact title).
      await sql`
        delete from artifacts
        where kind = 'canvas' and title = ${DIAGRAM_BOARD_TITLE}
          and user_id = (select id from users where email = ${ALICE.email})`;

      await page.goto("/artifacts");
      await page.getByRole("button", { name: "+ New Canvas" }).click();
      const dialog = page.locator("form").filter({ hasText: "New Whiteboard" });
      await dialog.getByLabel("Name").fill(DIAGRAM_BOARD_TITLE);
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
      // The thinnest pen — labels are small, and the default width fills them in.
      await page.getByRole("button", { name: "S", exact: true }).click();

      for (const stroke of plan.strokes) {
        const [first, ...rest] = stroke;
        await page.mouse.move(box.x + first!.x, box.y + first!.y);
        await page.mouse.down();
        for (const p of rest) await page.mouse.move(box.x + p.x, box.y + p.y);
        await page.mouse.up();
      }

      // Autosave is debounced; poll the database rather than sleeping.
      const readTypes = async (): Promise<string[]> => {
        const [row] = await sql<{ payload: { elements: { type: string }[] } }[]>`select payload from artifacts where id = ${canvasId}`;
        return (row?.payload.elements ?? []).map((e) => e.type);
      };
      await expect.poll(async () => (await readTypes()).length, { timeout: 30_000 }).toBe(plan.strokes.length);
      expect((await readTypes()).filter((t) => t === "draw")).toHaveLength(plan.strokes.length);

      console.log(`[e2e] diagram board saved at /canvas/${canvasId} (${plan.strokes.length} strokes)`);
      const shot = testInfo.outputPath("diagram-board.png");
      await svg.screenshot({ path: shot });
      await testInfo.attach("diagram-board", { path: shot, contentType: "image/png" });
    } finally {
      await sql.end();
    }
  });
});
