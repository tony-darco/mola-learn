/**
 * The handwriting the canvas-syntax eval reads: the matrix-reduction plan the
 * pen-tool e2e draws, turned into the canvas elements the app would have
 * saved for it — same `finalizeStroke`, same fractional-index ordering, pen
 * variant. Ids are `s0`, `s1`, … so a stroke id maps straight back to its
 * `plan.meta` entry.
 */
import { generateKeyBetween } from "fractional-indexing";
import type { CanvasElement } from "@mola/shared";
import { finalizeStroke } from "@/lib/canvas/stroke";
import { COLOR_PALETTE, STROKE_WIDTHS } from "@/lib/canvas/styleConstants";
import { planMatrixReduction, type MatrixPlan } from "@/e2e/support/matrixPlan";

export type FixtureName = "clean" | "jitter";
export type Fixture = { name: string; jitterSeed?: number; plan: MatrixPlan; elements: CanvasElement[] };

export function planElements(plan: Pick<MatrixPlan, "strokes">): CanvasElement[] {
  let index: string | null = null;
  return plan.strokes.map((stroke, i) => {
    const f = finalizeStroke(stroke);
    if (!f) throw new Error(`fixtures: stroke ${i} has fewer than 2 points`);
    index = generateKeyBetween(index, null);
    return {
      id: `s${i}`, parentId: null, index,
      x: f.x, y: f.y, width: f.width, height: f.height,
      rotation: 0, opacity: 1, createdBy: "user", type: "draw",
      // The pen tool's defaults: first palette color, "M" width.
      props: { points: f.points, color: COLOR_PALETTE[0]!, strokeWidth: STROKE_WIDTHS.M, variant: "pen", dash: "solid" },
    };
  });
}

export function makeFixture(name: string, jitterSeed?: number): Fixture {
  const plan = planMatrixReduction({ jitterSeed });
  return { name, jitterSeed, plan, elements: planElements(plan) };
}

export const FIXTURES: Record<FixtureName, Fixture> = {
  clean: makeFixture("clean"),
  jitter: makeFixture("jitter", 1),
};
