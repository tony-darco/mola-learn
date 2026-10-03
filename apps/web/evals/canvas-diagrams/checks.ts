/**
 * Checks the sketch layer (lib/canvas/textSyntax/sketch.ts) against the
 * diagram board's truth (e2e/support/diagramTruth.ts): for each section, the
 * drawings read in its rectangle, and whether they have the parts
 * that were drawn, the labels that were written (read right, and attached to
 * the right part, in the right place), the joins, and — for molecules — the
 * bonds between the right labels, of the right kind. And the facts the read
 * states about them: which way each arrow points (one drawn in a single
 * stroke too), which corners and meeting lines are right angles (and that
 * none drawn clearly otherwise is called one), which lines close a ring, and
 * what sits across a corner. No model involved.
 *
 * Everything is matched by strokes: what was drawn with plan strokes i, j, …
 * is what the reader found among canvas elements s{i}, s{j}, ….
 */
import { generateKeyBetween } from "fractional-indexing";
import type { CanvasElement } from "@mola/shared";
import { finalizeStroke } from "@/lib/canvas/stroke";
import { COLOR_PALETTE, STROKE_WIDTHS } from "@/lib/canvas/styleConstants";
import { readCanvas } from "@/lib/canvas/textSyntax";
import type { Pt } from "@/lib/canvas/textSyntax/segment";
import type { Drawing, GraphNode } from "@/lib/canvas/textSyntax/sketch";
import type { DiagramBoardPlan } from "@/e2e/support/diagramBoard";
import type { DiagramSection, LabelPlace } from "@/e2e/support/diagramTruth";
import type { Stroke } from "@/e2e/support/strokeFont";

/** The plan's strokes as the canvas saves them: pen, thinnest width, ids s0, s1, … in drawing order. */
export function strokeElements(strokes: Stroke[]): CanvasElement[] {
  let index: string | null = null;
  return strokes.map((stroke, i) => {
    const f = finalizeStroke(stroke)!;
    index = generateKeyBetween(index, null);
    return {
      id: `s${i}`, parentId: null, index, x: f.x, y: f.y, width: f.width, height: f.height,
      rotation: 0, opacity: 1, createdBy: "user", type: "draw",
      props: { points: f.points, color: COLOR_PALETTE[0]!, strokeWidth: STROKE_WIDTHS.S, variant: "pen", dash: "solid" },
    };
  });
}

type Count = { expected: number; right: number };
/** Right angles drawn and read as such; angles drawn clearly not right (more than 15° off), and how many of those were called right. */
type RightCount = Count & { notRight: number; falselyRight: number };
export type SectionCheck = {
  section: string;
  /** Parts found with the strokes they were drawn with (`found`), and of those, of the right kind and count (`right`); parts found that weren't drawn as one. */
  parts: Count & { found: number; extra: number };
  /** Labels found as written; read right; attached to the right part, in the right place (of those the truth attaches). */
  labels: Count & { found: number; attached: Count };
  joins: Count;
  bonds: Count;
  /** How many drawings the section came out as (one is what was drawn). */
  drawings: number;
  misses: string[];
  /** Arrows read as arrows pointing the way they were drawn — within ARROW_DEG — of all, and of those drawn in one stroke. */
  arrows: Count & { oneStroke: Count };
  /** Corners of a part, and lines that meet, at a right angle. */
  rightCorners: RightCount;
  rightJoins: RightCount;
  rings: Count;
  cornerMarks: Count;
  /** What was missed of the facts above — apart from `misses`, so a section is `perfect` by the same measure as before they were checked. */
  factMisses: string[];
};

/** An arrow points the way it was drawn when its tail-to-head runs within this many degrees of the drawn one. */
const ARROW_DEG = 20;
/** A corner read within this many canvas units of where it was aimed is that corner. */
const CORNER_NEAR = 15;

const ids = (strokes: number[]) => new Set(strokes.map((n) => `s${n}`));
const jaccard = (a: Set<string>, b: Set<string>) => {
  const both = [...a].filter((x) => b.has(x)).length;
  return both / (a.size + b.size - both || 1);
};

/** What a truth place allows the reader to have said. */
function placeMatches(want: LabelPlace, got: string, wantIndex: number | undefined, gotIndex: number | undefined): boolean {
  if (want === "near") return true;
  if (want === "side" || want === "vertex") return got === want && wantIndex === gotIndex;
  return got === want;
}

export function checkSection(section: DiagramSection, drawings: Drawing[]): SectionCheck {
  const { truth } = section;
  const misses: string[] = [];
  const parts = drawings.flatMap((d) => d.parts.map((part, i) => ({ d, i, part, ids: new Set(part.strokes.map((s) => s.id)) })));
  const labels = drawings.flatMap((d) => d.labels.map((label, i) => ({ d, i, label, ids: new Set(label.strokes.map((s) => s.id)) })));

  // Parts.
  const match = new Map<string, (typeof parts)[number]>();
  let right = 0;
  for (const t of truth.primitives) {
    const best = parts.map((p) => ({ p, j: jaccard(ids(t.strokes), p.ids) })).sort((a, b) => b.j - a.j)[0];
    if (!best || best.j < 0.5) {
      misses.push(`${t.id} (${t.kind}) not found`);
      continue;
    }
    match.set(t.id, best.p);
    const count = t.count ?? t.lines;
    const ok = best.p.part.kind === t.kind && (count === undefined || best.p.part.count === count);
    if (ok) right++;
    else misses.push(`${t.id}: ${t.kind}${count !== undefined ? `(${count})` : ""} read as ${best.p.part.kind}${best.p.part.count !== undefined ? `(${best.p.part.count})` : ""}`);
  }
  const matched = new Set(match.values());
  const extra = parts.filter((p) => !matched.has(p));
  for (const p of extra) misses.push(`extra ${p.part.kind}`);

  // Labels.
  const labelMatch = new Map<number, (typeof labels)[number]>();
  let read = 0;
  let attached = 0;
  let attachable = 0;
  truth.labels.forEach((t, n) => {
    if (t.of) attachable++;
    const best = labels.map((l) => ({ l, j: jaccard(ids(t.strokes), l.ids) })).sort((a, b) => b.j - a.j)[0];
    if (!best || best.j < 0.5) {
      misses.push(`label "${t.text}" not found`);
      return;
    }
    labelMatch.set(n, best.l);
    const text = best.l.label.text.replace(/\s+/g, "");
    if (text === t.text.replace(/\s+/g, "")) read++;
    else misses.push(`label "${t.text}" read as "${best.l.label.text}"`);
    if (!t.of) return;
    const target = match.get(t.of.primitive);
    const ok = !!target && target.d === best.l.d && target.i === best.l.label.part
      && placeMatches(t.of.at, best.l.label.place, t.of.side ?? t.of.vertex, best.l.label.index);
    if (ok) attached++;
    else misses.push(`label "${t.text}" should be at the ${t.of.at}${t.of.side ?? t.of.vertex ?? ""} of ${t.of.primitive}; is at the ${best.l.label.place}${best.l.label.index ?? ""} of ${best.l.label.part === null ? "nothing" : best.l.d.parts[best.l.label.part]!.kind}`);
  });

  // Joins.
  let joins = 0;
  for (const c of truth.connections ?? []) {
    const [a, b] = [match.get(c.a), match.get(c.b)];
    const ok = !!a && !!b && a.d === b.d && a.d.joins.some((j) => j.how === c.how && ((j.a === a.i && j.b === b.i) || (j.a === b.i && j.b === a.i)));
    if (ok) joins++;
    else misses.push(`${c.a} should ${c.how} ${c.b}`);
  }

  // Bonds: each between the right two atoms — a label, or an unlabelled corner — and of the right kind.
  let bonds = 0;
  const graph = truth.graph;
  for (const b of graph?.bonds ?? []) {
    const p = match.get(b.primitive);
    const edge = p?.d.graph?.edges.find((e) => e.part === p.i);
    const node = (id: string): string => {
      const label = graph!.nodes.find((x) => x.id === id)!.label;
      return label === null ? "corner" : `label ${label}`;
    };
    const found = (n: GraphNode | undefined, want: string) => {
      if (!n) return false;
      if (want === "corner") return "corner" in n;
      const l = labelMatch.get(Number(want.split(" ")[1]));
      return "label" in n && !!l && l.d === p!.d && l.i === n.label;
    };
    const ends = edge ? [p!.d.graph!.nodes[edge.from], p!.d.graph!.nodes[edge.to]] : [];
    const [x, y] = [node(b.from), node(b.to)];
    const ok = !!edge && edge.type === b.type && ((found(ends[0], x) && found(ends[1], y)) || (found(ends[0], y) && found(ends[1], x)));
    if (ok) bonds++;
    else misses.push(`bond ${b.from}–${b.to} (${b.type}) ${edge ? `read as ${edge.type} between other ends` : "not in a graph"}`);
  }

  // Arrows, and which way they point.
  const factMisses: string[] = [];
  const arrows = { expected: 0, right: 0, oneStroke: { expected: 0, right: 0 } };
  for (const t of truth.primitives) {
    if (!t.arrow) continue;
    const p = match.get(t.id);
    const oneStroke = t.strokes.length === 1;
    arrows.expected++;
    if (oneStroke) arrows.oneStroke.expected++;
    const [tail, head] = p?.part.kind === "arrow" ? p.part.points as [Pt, Pt] : [null, null];
    const off = tail && head ? degreesApart({ x: head.x - tail.x, y: head.y - tail.y }, { x: t.arrow.tip.x - t.arrow.tail.x, y: t.arrow.tip.y - t.arrow.tail.y }) : Infinity;
    if (off <= ARROW_DEG) {
      arrows.right++;
      if (oneStroke) arrows.oneStroke.right++;
    } else factMisses.push(`${t.id}: arrow${oneStroke ? " in one stroke" : ""} read as ${p ? (p.part.kind === "arrow" ? `an arrow ${Math.round(off)}° off` : p.part.kind) : "nothing"}`);
  }

  // Corners at a right angle.
  const rightCorners = { expected: 0, right: 0, notRight: 0, falselyRight: 0 };
  for (const t of truth.primitives) {
    const p = match.get(t.id);
    for (const c of t.corners ?? []) {
      if (c.right === null) continue;
      const read = !p ? [] : ["triangle", "rectangle", "polygon"].includes(p.part.kind) ? p.part.points.map((_, i) => i) : p.part.kind === "polyline" ? p.part.points.slice(1, -1).map((_, i) => i + 1) : [];
      const near = read.find((i) => Math.hypot(p!.part.points[i]!.x - c.x, p!.part.points[i]!.y - c.y) <= CORNER_NEAR);
      const called = near !== undefined && !!p!.part.right?.includes(near);
      if (c.right) {
        rightCorners.expected++;
        if (called) rightCorners.right++;
        else factMisses.push(`${t.id}: right angle at (${Math.round(c.x)}, ${Math.round(c.y)}) not called one`);
      } else {
        rightCorners.notRight++;
        if (called) {
          rightCorners.falselyRight++;
          factMisses.push(`${t.id}: corner at (${Math.round(c.x)}, ${Math.round(c.y)}) called a right angle`);
        }
      }
    }
  }

  // Lines that meet at a right angle.
  const rightJoins = { expected: 0, right: 0, notRight: 0, falselyRight: 0 };
  for (const c of truth.connections ?? []) {
    if (c.how !== "meet" || c.right === undefined || c.right === null) continue;
    const [a, b] = [match.get(c.a), match.get(c.b)];
    const join = a && b && a.d === b.d ? a.d.joins.find((j) => j.how === "meet" && ((j.a === a.i && j.b === b.i) || (j.a === b.i && j.b === a.i))) : undefined;
    if (c.right) {
      rightJoins.expected++;
      if (join?.right) rightJoins.right++;
      else factMisses.push(`${c.a} should meet ${c.b} at a right angle`);
    } else {
      rightJoins.notRight++;
      if (join?.right) {
        rightJoins.falselyRight++;
        factMisses.push(`${c.a} meets ${c.b} called a right angle`);
      }
    }
  }

  // Rings: the same parts, all in one of the drawing's rings.
  let rings = 0;
  for (const ring of truth.rings ?? []) {
    const ps = ring.map((id) => match.get(id));
    const d = ps[0]?.d;
    const want = ps.every((p) => p && p.d === d) ? new Set(ps.map((p) => p!.i)) : null;
    if (want && d!.rings.some((r) => r.parts.length === want.size && r.parts.every((i) => want.has(i)))) rings++;
    else factMisses.push(`ring of ${ring.join(", ")} not found`);
  }

  // Corner marks.
  let cornerMarks = 0;
  for (const m of truth.cornerMarks ?? []) {
    const [mark, of] = [match.get(m.mark), match.get(m.of)];
    if (mark && of && mark.d === of.d && mark.d.cornerMarks.some((c) => c.mark === mark.i && c.part === of.i)) cornerMarks++;
    else factMisses.push(`${m.mark} should sit across a corner of ${m.of}`);
  }

  return {
    section: section.id,
    parts: { expected: truth.primitives.length, found: match.size, right, extra: extra.length },
    labels: { expected: truth.labels.length, found: labelMatch.size, right: read, attached: { expected: attachable, right: attached } },
    joins: { expected: truth.connections?.length ?? 0, right: joins },
    bonds: { expected: graph?.bonds.length ?? 0, right: bonds },
    drawings: drawings.length,
    misses,
    arrows, rightCorners, rightJoins,
    rings: { expected: truth.rings?.length ?? 0, right: rings },
    cornerMarks: { expected: truth.cornerMarks?.length ?? 0, right: cornerMarks },
    factMisses,
  };
}

/** Degrees between two directions. */
function degreesApart(u: Pt, v: Pt): number {
  const n = Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y);
  return n === 0 ? 180 : (Math.acos(Math.max(-1, Math.min(1, (u.x * v.x + u.y * v.y) / n))) * 180) / Math.PI;
}

/**
 * Every section of a diagram board plan: the drawings in each one's rectangle,
 * checked against its truth. The board is read once — a read of a region is
 * the same read, cut down to what is in it — and nothing strays from its
 * section (planDiagramBoard), so a drawing is in the section its middle is.
 */
export function checkBoard(plan: DiagramBoardPlan, elements = strokeElements(plan.strokes)): SectionCheck[] {
  const { drawings } = readCanvas(elements).doc;
  return plan.sections.map((section) => {
    const { minX, minY, maxX, maxY } = section.rect;
    const mine = drawings.map((d) => d.drawing).filter(({ box }) => {
      const [x, y] = [(box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2];
      return x >= minX && x <= maxX && y >= minY && y <= maxY;
    });
    return checkSection(section, mine);
  });
}

const rightSum = (rs: RightCount[]): RightCount => ({
  expected: rs.reduce((n, r) => n + r.expected, 0), right: rs.reduce((n, r) => n + r.right, 0),
  notRight: rs.reduce((n, r) => n + r.notRight, 0), falselyRight: rs.reduce((n, r) => n + r.falselyRight, 0),
});

/** Checks added up. */
export function sumChecks(all: SectionCheck[]) {
  const add = (f: (c: SectionCheck) => number) => all.reduce((n, c) => n + f(c), 0);
  return {
    sections: all.length,
    perfect: all.filter((c) => c.misses.length === 0).length,
    parts: { expected: add((c) => c.parts.expected), found: add((c) => c.parts.found), right: add((c) => c.parts.right), extra: add((c) => c.parts.extra) },
    labels: { expected: add((c) => c.labels.expected), found: add((c) => c.labels.found), right: add((c) => c.labels.right), attached: { expected: add((c) => c.labels.attached.expected), right: add((c) => c.labels.attached.right) } },
    joins: { expected: add((c) => c.joins.expected), right: add((c) => c.joins.right) },
    bonds: { expected: add((c) => c.bonds.expected), right: add((c) => c.bonds.right) },
    oneDrawing: all.filter((c) => c.drawings === 1).length,
    arrows: {
      expected: add((c) => c.arrows.expected), right: add((c) => c.arrows.right),
      oneStroke: { expected: add((c) => c.arrows.oneStroke.expected), right: add((c) => c.arrows.oneStroke.right) },
    },
    rightCorners: rightSum(all.map((c) => c.rightCorners)),
    rightJoins: rightSum(all.map((c) => c.rightJoins)),
    rings: { expected: add((c) => c.rings.expected), right: add((c) => c.rings.right) },
    cornerMarks: { expected: add((c) => c.cornerMarks.expected), right: add((c) => c.cornerMarks.right) },
    factsPerfect: all.filter((c) => c.factMisses.length === 0).length,
  };
}
