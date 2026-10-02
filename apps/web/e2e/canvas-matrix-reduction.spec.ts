/**
 * Deterministic pen-tool test: hand-writes a Gauss–Jordan matrix reduction
 * onto a fresh canvas, one pen stroke at a time, through real mouse input.
 *
 * Nothing here is model-driven. The strokes come from a fixed stroke font
 * (e2e/support/*), so every run replays the identical pointer path, and the
 * assertions compare what the canvas saved against that plan.
 *
 *   pnpm --filter @mola/web e2e canvas-matrix-reduction
 *   E2E_KEEP_CANVAS=1 pnpm --filter @mola/web e2e canvas-matrix-reduction   # keep the canvas to look at it
 */
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { ALICE_STORAGE } from "./fixtures";
import { EXAMPLE_SYSTEM, reduce } from "./support/matrixReduction";
import { planMatrixReduction } from "./support/matrixPlan";

if (!process.env.DATABASE_URL) process.loadEnvFile(resolve(fileURLToPath(import.meta.url), "../../.env.local"));

const CANVAS_TITLE = "E2E Matrix Reduction";
/** Coalesced pointermoves can shave a corner off a stroke's bounding box; anything beyond a few px is a real placement bug. */
const BBOX_TOLERANCE_PX = 3;

type SavedStroke = {
  id: string; index: string; type: string; parentId: string | null; createdBy: string;
  x: number; y: number; width: number; height: number;
  props: { variant: string; points: { x: number; y: number }[] };
};

test.describe("matrix reduction plan", () => {
  test("every step follows from the last and ends at [I | solution]", () => {
    const steps = reduce(EXAMPLE_SYSTEM);
    expect(steps).toHaveLength(EXAMPLE_SYSTEM.ops.length + 1);
    expect(steps[steps.length - 1]!.matrix).toEqual([
      [1, 0, 0, 1],
      [0, 1, 0, 2],
      [0, 0, 1, 3],
    ]);

    // x=1, y=2, z=3 must satisfy the original equations, not just the reduced form.
    for (const row of EXAMPLE_SYSTEM.matrix) {
      expect(row[0]! * 1 + row[1]! * 2 + row[2]! * 3).toBe(row[3]);
    }
  });

  test("the stroke plan is deterministic and drawable", () => {
    const a = planMatrixReduction();
    const b = planMatrixReduction();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));

    expect(a.strokes.length).toBeGreaterThan(100);
    for (const stroke of a.strokes) expect(stroke.length).toBeGreaterThanOrEqual(2);
  });
});

test.describe("pen tool on the canvas", () => {
  test.use({ storageState: ALICE_STORAGE, viewport: { width: 1600, height: 1100 } });

  test("hand-writes the reduction, stroke for stroke", async ({ page }, testInfo) => {
    const plan = planMatrixReduction();
    const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
    let canvasId: string | null = null;

    try {
      // Create the canvas the way a user would.
      await page.goto("/artifacts");
      await page.getByRole("button", { name: "+ New Canvas" }).click();
      const dialog = page.locator("form").filter({ hasText: "New Whiteboard" });
      await dialog.getByLabel("Name").fill(CANVAS_TITLE);
      await dialog.getByRole("button", { name: "Blank" }).click();
      await dialog.getByRole("button", { name: "Create" }).click();
      await page.waitForURL(/\/canvas\/[0-9a-f-]{36}$/);
      canvasId = page.url().split("/").pop()!;

      const svg = page.locator("svg.touch-none");
      await expect(svg).toBeVisible();
      const box = (await svg.boundingBox())!;
      expect(plan.bounds.maxX, "plan is wider than the canvas").toBeLessThan(box.width);
      expect(plan.bounds.maxY, "plan is taller than the canvas").toBeLessThan(box.height);

      // Selecting the tool before hydration finishes silently does nothing, so retry until it sticks.
      const pen = page.getByTitle("Pen", { exact: true });
      await expect(async () => {
        await pen.click();
        await expect(pen).toHaveAttribute("aria-pressed", "true", { timeout: 1_000 });
      }).toPass();

      for (const stroke of plan.strokes) {
        const [first, ...rest] = stroke;
        await page.mouse.move(box.x + first!.x, box.y + first!.y);
        await page.mouse.down();
        for (const p of rest) await page.mouse.move(box.x + p.x, box.y + p.y);
        await page.mouse.up();
      }

      // Autosave is debounced; poll the database rather than sleeping.
      const readStrokes = async (): Promise<SavedStroke[]> => {
        const [row] = await sql<{ payload: { elements: SavedStroke[] } }[]>`select payload from artifacts where id = ${canvasId!}`;
        return row?.payload.elements ?? [];
      };
      await expect.poll(async () => (await readStrokes()).length, { timeout: 30_000 }).toBe(plan.strokes.length);

      // Elements are created in draw order, so sorting by their fractional
      // index (plain `<`, never localeCompare) must give the plan back.
      const saved = (await readStrokes()).sort((a, b) => (a.index < b.index ? -1 : a.index > b.index ? 1 : 0));
      saved.forEach((el, i) => {
        const planned = plan.strokes[i]!;
        const xs = planned.map((p) => p.x);
        const ys = planned.map((p) => p.y);
        const at = `stroke ${i}`;

        expect(el.type, at).toBe("draw");
        expect(el.props.variant, at).toBe("pen");
        expect(el.createdBy, at).toBe("user");
        expect(el.parentId, at).toBeNull();
        expect(el.props.points.length, at).toBeGreaterThanOrEqual(2);
        expect(el.props.points.length, at).toBeLessThanOrEqual(planned.length);
        expect(Math.abs(el.x - Math.min(...xs)), `${at} x`).toBeLessThanOrEqual(BBOX_TOLERANCE_PX);
        expect(Math.abs(el.y - Math.min(...ys)), `${at} y`).toBeLessThanOrEqual(BBOX_TOLERANCE_PX);
        expect(Math.abs(el.width - (Math.max(...xs) - Math.min(...xs))), `${at} width`).toBeLessThanOrEqual(BBOX_TOLERANCE_PX);
        expect(Math.abs(el.height - (Math.max(...ys) - Math.min(...ys))), `${at} height`).toBeLessThanOrEqual(BBOX_TOLERANCE_PX);
      });

      // What was saved is what comes back on a fresh load.
      await page.reload();
      await expect(svg.locator("path[data-element-id]")).toHaveCount(plan.strokes.length);
      const shot = testInfo.outputPath("matrix-reduction.png");
      await svg.screenshot({ path: shot });
      await testInfo.attach("matrix-reduction", { path: shot, contentType: "image/png" });
    } finally {
      if (canvasId && process.env.E2E_KEEP_CANVAS) console.log(`[e2e] kept canvas at /canvas/${canvasId}`);
      else if (canvasId) await sql`delete from artifacts where id = ${canvasId}`;
      await sql.end();
    }
  });
});
