/**
 * The sketch layer against the diagram board's truth (e2e/support/
 * diagramBoard.ts): eight diagrams, neat and shaky — molecules, a car, a ball
 * on a slope, a circuit, a graph, a triangle — each read on its own and
 * checked part by part, label by label, join by join, bond by bond (see
 * evals/canvas-diagrams/checks.ts). Drawn clean, everything must come out
 * exactly as drawn; drawn by many hands, as well as when it was tuned.
 */
import { describe, expect, it } from "vitest";
import { readCanvas } from "../lib/canvas/textSyntax";
import { checkBoard, strokeElements, sumChecks } from "../evals/canvas-diagrams/checks";
import { planDiagramBoard } from "../e2e/support/diagramBoard";

const share = (c: { expected: number; right: number }) => c.right / c.expected;

/** Every section of the board drawn in the hands of `seeds`, added up. */
const overSeeds = (seeds: number[]) => sumChecks(seeds.flatMap((seed) => checkBoard(planDiagramBoard({ seed }))));

/**
 * Floors, the same for the tuning hands and the held-out ones, each just
 * under the lower of the two measured (see below).
 */
function expectFloors(sum: ReturnType<typeof sumChecks>) {
  expect(sum.parts.found / sum.parts.expected).toBeGreaterThanOrEqual(0.995);
  expect(sum.parts.right / sum.parts.expected).toBeGreaterThanOrEqual(0.98);
  expect(sum.parts.extra / sum.parts.expected).toBeLessThanOrEqual(0.003);
  expect(sum.labels.found / sum.labels.expected).toBeGreaterThanOrEqual(0.985);
  expect(sum.labels.right / sum.labels.expected).toBeGreaterThanOrEqual(0.84);
  expect(share(sum.labels.attached)).toBeGreaterThanOrEqual(0.97);
  expect(share(sum.joins)).toBeGreaterThanOrEqual(0.995);
  expect(share(sum.bonds)).toBeGreaterThanOrEqual(0.975);
  expect(sum.oneDrawing / sum.sections).toBeGreaterThanOrEqual(0.995);
  expect(sum.perfect / sum.sections).toBeGreaterThanOrEqual(0.65);
}

describe("sketch layer on the diagram board", () => {
  it("reads every clean diagram exactly as it was drawn", () => {
    const checks = checkBoard(planDiagramBoard({ clean: true }));
    expect(checks.filter((c) => c.misses.length).map((c) => `${c.section}: ${c.misses.join("; ")}`)).toEqual([]);
    expect(checks.every((c) => c.drawings === 1)).toBe(true);
    // And states every fact about it: which way each arrow points, every right angle and none other, the ring, what sits across a corner.
    expect(checks.filter((c) => c.factMisses.length).map((c) => `${c.section}: ${c.factMisses.join("; ")}`)).toEqual([]);
  }, 60_000);

  it("never says what a drawing depicts, only its parts and how they join", () => {
    // The board as saved: molecules, a car, a slope, a circuit, a graph, a triangle — none of which may be named.
    const plan = planDiagramBoard();
    const { text } = readCanvas(strokeElements(plan.strokes));
    expect(text).toMatch(/Closed ring of 6/);
    expect(text).toMatch(/right angle/);
    expect(text).toMatch(/pointing up/);
    const depicted = /\b(car|wheels?|vehicle|molecules?|atoms?|bonds?|carbon|oxygen|hydrogen|methane|glucose|benzene|sugar|forces?|weight|gravity|ramp|incline|slope|ball|circuit|battery|resistor|wires?|current|voltage|axis|axes|graph|supply|demand|equilibrium|price|quantity|hypotenuse|pythagoras|velocity|speed)\b/i;
    expect(text.match(depicted)).toBeNull();
  }, 60_000);

  it("reads the diagrams in the hands it was tuned on (seeds 1–20)", () => {
    // Measured once tuning was frozen, over 320 sections: parts 1756/1760
    // found, 1741 of the right kind, 1 extra; labels 1271/1280 found, 1086
    // read right, 549/560 attached right; joins 1475/1480; bonds 828/840; one
    // drawing per section in 319; 213 sections perfect.
    expectFloors(overSeeds(Array.from({ length: 20 }, (_, i) => i + 1)));
  }, 180_000);

  it("reads the held-out hands (seeds 300–349) as well as the ones it was tuned on", () => {
    // Seeds 300–349 were first looked at once tuning was frozen, in a single
    // run. Measured then, over 800 sections: parts 4385/4400 found, 4337 of
    // the right kind, 8 extra; labels 3167/3200 found, 2732 read right,
    // 1362/1400 attached right; joins 3691/3700; bonds 2057/2100; one drawing
    // per section in 798; 556 sections perfect. Most misses are labels the
    // recognizer misreads (small, shaky, single letters: "b" as "6", "S" as
    // "5", "v" as "u"); of the drawing itself, a small angle's arc as shaky as
    // a straight line, a car body's eight corners miscounted, and a hashed
    // bond's short strokes taken for writing beside its label.
    expectFloors(overSeeds(Array.from({ length: 50 }, (_, i) => i + 300)));
  }, 300_000);
});
