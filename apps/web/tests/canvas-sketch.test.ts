/**
 * The sketch layer (lib/canvas/textSyntax/sketch.ts) on small drawings of its
 * own: each part found as drawn, joins, labels attached where they were
 * written, lines between labels as a graph, and writing left as writing. The
 * diagram board (e2e/support/diagramBoard.ts), clean and over many hands, is
 * in canvas-diagrams.test.ts.
 */
import { describe, expect, it } from "vitest";
import type { CanvasElement } from "@mola/shared";
import { readCanvas } from "../lib/canvas/textSyntax";
import type { Drawing } from "../lib/canvas/textSyntax/sketch";
import { drawn } from "../evals/canvas-reader/fixtures";
import { arrowStrokes, penStroke, writeText, type Pt } from "../e2e/support/strokeFont";

const line = (id: string, ...points: [number, number][]) => drawn(id, penStroke(points.map(([x, y]) => ({ x, y }))));
const ring = (id: string, cx: number, cy: number, r: number) =>
  drawn(id, penStroke(Array.from({ length: 41 }, (_, i): Pt => ({ x: cx + r * Math.cos((i * Math.PI) / 20), y: cy + r * Math.sin((i * Math.PI) / 20) }))));
/** Handwriting centred on (cx, cy), cap height 24. */
const write = (id: string, text: string, cx: number, cy: number) =>
  writeText(text, cx - writeText(text, 0, 0, 24).width / 2, cy - 12, 24).glyphs.flatMap((g) => g.strokes).map((s, i) => drawn(`${id}${i}`, s));
/** A line of writing well away from the drawing: every board has some, and sizes are judged against it. */
const aside = () => write("eq", "y = 2x + 3 = 11", 300, 600);
const drawingsOf = (elements: CanvasElement[]): Drawing[] => readCanvas([...elements, ...aside()]).doc.drawings.map((d) => d.drawing);
const kinds = (d: Drawing) => d.parts.map((p) => `${p.kind}${p.count ? `(${p.count})` : ""}`).sort();

describe("sketch: parts", () => {
  it("finds a triangle, the square marking its right angle, and where they meet; labels go beside its sides", () => {
    const [d, ...more] = drawingsOf([
      line("tri", [100, 300], [400, 300], [400, 100], [100, 300]),
      line("mark", [378, 300], [378, 278], [400, 278]),
      ...write("b", "b", 250, 325), ...write("a", "a", 425, 200), ...write("c", "c", 230, 185),
    ]);
    expect(more).toEqual([]);
    expect(kinds(d!)).toEqual(["polyline(1)", "triangle"]);
    expect(d!.joins.map((j) => j.how)).toEqual(["meet"]);
    // Corners in the order they were drawn, so sides are numbered that way.
    expect(d!.parts.find((p) => p.kind === "triangle")!.points.map((p) => [Math.round(p.x), Math.round(p.y)])).toEqual([[100, 300], [400, 300], [400, 100]]);
    expect(d!.labels.map((l) => [l.place, l.index])).toEqual([["side", 2], ["side", 1], ["side", 0]]);
  });

  it("says which corners are right angles, that the square sits across the triangle's, and that it meets the side square on", () => {
    const elements = [
      line("tri", [100, 300], [400, 300], [400, 100], [100, 300]),
      line("mark", [378, 300], [378, 278], [400, 278]),
      ...write("b", "b", 250, 325), ...write("a", "a", 425, 200), ...write("c", "c", 230, 185),
    ];
    const [d] = drawingsOf(elements);
    const tri = d!.parts.findIndex((p) => p.kind === "triangle");
    const mark = d!.parts.findIndex((p) => p.kind === "polyline");
    expect(d!.parts[tri]!.right).toEqual([1]);
    expect(d!.parts[mark]!.right).toEqual([1]);
    expect(d!.cornerMarks.map((c) => [c.mark, c.part, Math.round(c.at.x), Math.round(c.at.y)])).toEqual([[mark, tri, 400, 300]]);
    expect(d!.joins.map((j) => j.right)).toEqual([true]);
    const text = readCanvas([...elements, ...aside()]).text;
    expect(text).toMatch(/triangle, corners \(0, 61\), \(92, 61\) and \(92, 0\); a right angle at \(92, 61\)\./);
    expect(text).toMatch(/line with 1 corner, through [^;]*; the corner is a right angle\./);
    expect(text).toMatch(/P\d sits across the corner \(92, 61\) of P\d, an end on each side of it/);
    expect(text).toMatch(/P\d meets P\d at \(\d+, \d+\), at a right angle/);
  });

  it("calls no corner of an equilateral triangle, or of a zigzag, a right angle", () => {
    const [d] = drawingsOf([
      line("tri", [100, 300], [300, 300], [200, 127], [100, 300]),
      line("zig", [340, 140], [350, 126], [360, 154], [370, 126], [380, 154], [390, 126], [400, 140]),
    ]);
    expect(d!.parts.flatMap((p) => p.right ?? [])).toEqual([]);
  });

  it("finds lines drawn one by one that close a ring, and lists them round it", () => {
    // A hexagon of six separate strokes, and a square of four that also meet at right angles.
    const hex = Array.from({ length: 6 }, (_, i): [number, number] => [200 + 80 * Math.cos((i * Math.PI) / 3), 200 + 80 * Math.sin((i * Math.PI) / 3)]);
    const square: [number, number][] = [[400, 120], [520, 120], [520, 240], [400, 240]];
    const elements = [
      ...hex.map((p, i) => line(`h${i}`, p, hex[(i + 1) % 6]!)),
      ...square.map((p, i) => line(`q${i}`, p, square[(i + 1) % 4]!)),
    ];
    const ds = drawingsOf(elements).sort((a, b) => a.parts.length - b.parts.length);
    expect(ds.map((d) => d.rings.map((r) => r.parts.length))).toEqual([[4], [6]]);
    // In order round it: each part meets the next.
    for (const d of ds) {
      const [r] = d.rings;
      r!.parts.forEach((p, k) => {
        const q = r!.parts[(k + 1) % r!.parts.length]!;
        expect(d.joins.some((j) => j.how === "meet" && ((j.a === p && j.b === q) || (j.a === q && j.b === p)))).toBe(true);
      });
    }
    expect(ds[0]!.joins.filter((j) => j.right)).toHaveLength(4);
    expect(ds[1]!.joins.filter((j) => j.right)).toHaveLength(0);
    const text = readCanvas([...elements, ...aside()]).text;
    expect(text).toMatch(/^P\d, P\d, P\d, P\d, P\d and P\d join end to end in a closed ring of 6 straight sides, corners \(\d+, \d+\)(, \(\d+, \d+\)){4} and \(\d+, \d+\)\.$/m);
    expect(text).toMatch(/^P\d, P\d, P\d and P\d join end to end in a closed ring of 4 straight sides/m);
  });

  it("finds a ring among lines drawn between labels, and lists it round from its label", () => {
    // Six lines round a hexagon, one corner a written "O" the lines stop short of; a label off two other corners.
    const c = { x: 250, y: 250 };
    const v = Array.from({ length: 6 }, (_, i) => ({ x: c.x + 90 * Math.cos((i * Math.PI) / 3 - Math.PI / 2), y: c.y + 90 * Math.sin((i * Math.PI) / 3 - Math.PI / 2) }));
    const toward = (a: { x: number; y: number }, b: { x: number; y: number }, d: number): [number, number] => {
      const l = Math.hypot(b.x - a.x, b.y - a.y);
      return [a.x + ((b.x - a.x) * d) / l, a.y + ((b.y - a.y) * d) / l];
    };
    const elements = [
      ...write("o", "O", v[0]!.x, v[0]!.y),
      ...v.map((p, i) => {
        const q = v[(i + 1) % 6]!;
        return line(`r${i}`, i === 0 ? toward(p, q, 18) : [p.x, p.y], i === 5 ? toward(q, p, 18) : [q.x, q.y]);
      }),
      line("s1", [v[2]!.x, v[2]!.y], [v[2]!.x + 40, v[2]!.y]), ...write("h", "H", v[2]!.x + 58, v[2]!.y),
      line("s2", [v[4]!.x, v[4]!.y], [v[4]!.x - 40, v[4]!.y]), ...write("n", "N", v[4]!.x - 58, v[4]!.y),
    ];
    const [d] = drawingsOf(elements);
    expect(d!.graph).not.toBeNull();
    expect(d!.rings.map((r) => r.parts.length)).toEqual([6]);
    expect(readCanvas([...elements, ...aside()]).text).toMatch(/^- Closed ring of 6, in order round it: "O", corner \d, corner \d, corner \d, corner \d and corner \d\.$/m);
  });

  it("reads an arrow drawn in one stroke, a small head on a long shaft, as an arrow, and says which way it points", () => {
    const elements = [
      ...arrowStrokes({ x: 100, y: 400 }, { x: 100, y: 120 }, "joined", undefined, 12).map((s, i) => drawn(`up${i}`, s)),
      line("base", [100, 400], [400, 400]),
    ];
    const [d] = drawingsOf(elements);
    expect(kinds(d!)).toEqual(["arrow", "segment"]);
    const text = readCanvas([...elements, ...aside()]).text;
    expect(text).toMatch(/arrow from \(\d+, 92\) to its head at \(\d+, 0\), pointing up\./);
    expect(text).toMatch(/at a right angle/);
  });

  it("finds a box with two circles crossing its bottom edge, a wire, a zigzag, and an arrow", () => {
    const [d] = drawingsOf([
      line("box", [100, 100], [300, 100], [300, 180], [100, 180], [100, 100]),
      ring("w1", 140, 185, 20), ring("w2", 260, 185, 20),
      line("wire", [300, 140], [340, 140]),
      line("zig", [340, 140], [350, 126], [360, 154], [370, 126], [380, 154], [390, 126], [400, 140]),
      ...arrowStrokes({ x: 120, y: 80 }, { x: 280, y: 80 }, "separate").map((s, i) => drawn(`arrow${i}`, s)),
      ...write("v", "v", 200, 60), ...write("r", "R", 370, 105),
    ]);
    expect(kinds(d!)).toEqual(["arrow", "circle", "circle", "rectangle(4)", "segment", "zigzag(5)"]);
    expect(d!.joins.filter((j) => j.how === "touch")).toHaveLength(2);
    expect(d!.joins.filter((j) => j.how === "meet")).toHaveLength(2);
    expect(d!.labels.map((l) => l.text).sort()).toEqual(["R", "v"]);
  });

  it("finds a row of short strokes, and a narrow wedge, as single parts", () => {
    const [d] = drawingsOf([
      line("long", [100, 200], [300, 200]),
      ...Array.from({ length: 5 }, (_, i) => line(`dash${i}`, [312 + i * 8, 198 - i / 2], [312 + i * 8, 202 + i / 2])),
      line("wedge", [100, 215], [250, 255], [240, 285], [100, 215]),
      ...write("p", "P", 80, 200),
    ]);
    expect(kinds(d!)).toEqual(["dashed(5)", "segment", "wedge"]);
  });
});

describe("sketch: labels and writing", () => {
  it("attaches a short label to what it was written by, and leaves a sentence as writing", () => {
    const elements = [
      line("base", [100, 260], [300, 260]),
      ...arrowStrokes({ x: 100, y: 200 }, { x: 300, y: 200 }, "separate").map((s, i) => drawn(`arrow${i}`, s)),
      line("left", [100, 200], [100, 260]),
      ...write("v", "v", 200, 180),
      ...write("f", "F = ma = 2 + 10", 400, 330),
    ];
    const { doc, text } = readCanvas(elements);
    const d = doc.drawings[0]!.drawing;
    expect(d.labels.map((l) => [l.text, l.place])).toEqual([["v", "middle"]]);
    expect(doc.items.map((i) => i.kind)).toEqual(["drawing", "writing"]);
    expect(text).toMatch(/Labels: "v" above the middle of P\d\./);
  });

  it("gives lines between labels as a graph, joining the drawing through the label between them", () => {
    const elements = [
      ...write("a", "O", 100, 200), line("b1", [118, 194], [208, 194]), line("b2", [118, 206], [208, 206]),
      ...write("c", "C", 230, 200), line("b3", [252, 194], [342, 194]), line("b4", [252, 206], [342, 206]),
      ...write("d", "O", 364, 200),
    ];
    const ds = drawingsOf(elements);
    expect(ds).toHaveLength(1);
    expect(ds[0]!.graph!.edges.map((e) => e.type)).toEqual(["double", "double"]);
    const text = readCanvas([...elements, ...aside()]).text;
    expect(text).toMatch(/"C" \(\d+, \d+\) joined to "O" \(\d+, \d+\) by two parallel lines\./);
    expect(text).not.toMatch(/molecule|bond|carbon|oxygen/i);
  });
});

describe("sketch: what isn't a drawing", () => {
  // Twice the height of the writing beside it; much bigger than that, alone, it is drawing (LONE in sketch.ts).
  it("leaves big writing — a zero, an S — as writing", () => {
    const big = (id: string, ch: string, x: number) => writeText(ch, x, 100, 48).glyphs.flatMap((g) => g.strokes).map((s, i) => drawn(`${id}${i}`, s));
    expect(drawingsOf([...big("z", "0", 100), ...big("s", "S", 300)])).toEqual([]);
  });

  it("is deterministic", () => {
    const board = () => [line("tri", [100, 300], [400, 300], [400, 100], [100, 300]), ...write("c", "c", 230, 180)];
    expect(readCanvas(board()).text).toBe(readCanvas(board()).text);
  });
});
