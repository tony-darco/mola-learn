/**
 * A pen drawing (sketch.ts) as text: what its parts are and where, which
 * join, and what is written beside them — never what it is a drawing of.
 *
 * Places are given on a grid laid over the drawing, so the reader can picture
 * its layout: the drawing's longer side runs from 0 to 100, the other on the
 * same scale, y downward. A drawing whose lines run between written labels
 * (at least GRAPH_LABELS of them, see sketch.ts) is given as a graph instead:
 * each label, and what it is joined to, by what kind of line.
 */
import { plural, topLeft } from "./handwriting";
import type { Box, Pt } from "./segment";
import type { Drawing, GraphNode, Part } from "./sketch";

const list = (items: string[]) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

/** Which way `p` lies from `q`: "above", "below", "left of", "right of", or a mix. */
function bearing(p: Pt, q: Pt): string {
  const dx = p.x - q.x;
  const dy = p.y - q.y;
  if (Math.hypot(dx, dy) < 1) return "on";
  const v = dy < -Math.abs(dx) / 2 ? "above" : dy > Math.abs(dx) / 2 ? "below" : "";
  const h = dx < -Math.abs(dy) / 2 ? "left of" : dx > Math.abs(dy) / 2 ? "right of" : "";
  return v && h ? `${v} and ${h}` : v || h;
}

export function describeDrawing(d: Drawing, label: string, tag = ""): string {
  const box: Box = d.box;
  const scale = 100 / Math.max(box.maxX - box.minX, box.maxY - box.minY, 1);
  const g = (p: Pt) => `(${Math.round((p.x - box.minX) * scale)}, ${Math.round((p.y - box.minY) * scale)})`;
  const span = (n: number) => Math.round(n * scale);
  const across = Math.round((box.maxX - box.minX) * scale);
  const down = Math.round((box.maxY - box.minY) * scale);
  const name = (i: number) => `P${i + 1}`;

  const partText = (p: Part): string => {
    const [a, z] = [p.points[0]!, p.points[p.points.length - 1]!];
    switch (p.kind) {
      case "segment": return `straight line from ${g(a)} to ${g(z)}`;
      case "polyline": return `line with ${plural(p.count!, "corner", "corners")}, through ${p.points.map(g).join(" → ")}`;
      case "arrow": return `arrow from ${g(a)} to its head at ${g(z)}`;
      case "circle": {
        const [w, h] = p.across!;
        return Math.min(w, h) >= 0.8 * Math.max(w, h) ? `circle, centre ${g(p.centre!)}, ${span((w + h) / 2)} across` : `oval, centre ${g(p.centre!)}, ${span(w)} across and ${span(h)} down`;
      }
      case "triangle": return `triangle, corners ${list(p.points.map(g))}`;
      case "rectangle": return `four-sided shape, corners ${list(p.points.map(g))}`;
      case "polygon": return `closed shape of ${p.count} straight sides, corners ${list(p.points.map(g))}`;
      case "arc": return `arc from ${g(a)} through ${g(p.points[1]!)} to ${g(z)}`;
      case "curve": return `curve from ${g(a)} through ${p.points.slice(1, -1).map(g).join(", ")} to ${g(z)}`;
      case "zigzag": return `zigzag line of ${p.count} sharp turns, from ${g(a)} to ${g(z)}`;
      case "coil": return `coil of ${plural(p.count!, "loop", "loops")}, from ${g(a)} to ${g(z)}`;
      case "wedge": return `narrow wedge — a long thin triangle — from its point at ${g(a)} to its wide end at ${g(z)}`;
      case "dashed": return `row of ${p.count} short strokes along a line from ${g(a)} to ${g(z)}`;
      case "parallel": return `${p.count === 3 ? "three" : "two"} parallel lines side by side, from ${g(a)} to ${g(z)}`;
      case "dot": return `dot at ${g(a)}`;
    }
  };

  const labelText = (l: Drawing["labels"][number]) => `"${l.text}"${l.doubt ? ` (read with doubt: ${l.doubt})` : ""}`;
  const where = (l: Drawing["labels"][number]): string => {
    if (l.part === null) return "";
    const p = d.parts[l.part]!;
    const c = { x: (l.box.minX + l.box.maxX) / 2, y: (l.box.minY + l.box.maxY) / 2 };
    const anchor = (q: Pt, what: string) => `${bearing(c, q)} ${what} of ${name(l.part!)}`;
    switch (l.place) {
      case "inside": return `inside ${name(l.part)}`;
      case "head": return anchor(p.points[p.points.length - 1]!, "the head");
      case "tail": return anchor(p.points[0]!, "the tail");
      case "start": return anchor(p.points[0]!, "the start");
      case "end": return anchor(p.points[p.points.length - 1]!, "the end");
      case "vertex": return anchor(p.points[l.index!]!, `corner ${g(p.points[l.index!]!)}`);
      case "side": {
        const [u, v] = [p.points[l.index!]!, p.points[(l.index! + 1) % p.points.length]!];
        return `${bearing(c, { x: (u.x + v.x) / 2, y: (u.y + v.y) / 2 })} the side ${g(u)}–${g(v)} of ${name(l.part)}`;
      }
      case "middle": {
        const m = p.kind === "arc" ? p.points[1]! : { x: (p.points[0]!.x + p.points[p.points.length - 1]!.x) / 2, y: (p.points[0]!.y + p.points[p.points.length - 1]!.y) / 2 };
        return anchor(m, "the middle");
      }
      case "near": return `next to ${name(l.part)}`;
    }
  };

  const head = `${label} — drawing made with the pen${tag}: ${plural(d.parts.length, "part", "parts")}${d.labels.length ? ` and ${plural(d.labels.length, "written label", "written labels")}` : ""}. `
    + `Top-left ${topLeft(box)}, size ${Math.round(box.maxX - box.minX)} x ${Math.round(box.maxY - box.minY)}. `
    + `Places in it are on a grid over it, ${across} across and ${down} down, y downward.`;

  if (d.graph) {
    const { nodes, edges } = d.graph;
    const corners = nodes.map((n, i) => ("corner" in n ? i : -1)).filter((i) => i >= 0);
    const nodeName = (i: number) => {
      const n: GraphNode = nodes[i]!;
      return "label" in n ? `"${d.labels[n.label]!.text}" ${g({ x: (d.labels[n.label]!.box.minX + d.labels[n.label]!.box.maxX) / 2, y: (d.labels[n.label]!.box.minY + d.labels[n.label]!.box.maxY) / 2 })}`
        : `corner ${corners.indexOf(i) + 1} ${g(n.corner)}`;
    };
    const how = (e: (typeof edges)[number], from: number): string => {
      const p = d.parts[e.part]!;
      switch (e.type) {
        case "single": return "a line";
        case "double": return "two parallel lines";
        case "triple": return "three parallel lines";
        case "wedge": return `a wedge (a long thin triangle), its narrow point at ${dist(p.points[0]!, nodePoint(from)) < dist(p.points[1]!, nodePoint(from)) ? "this end" : "the other end"}`;
        case "dashed": return `a row of ${p.count} short strokes`;
      }
    };
    const nodePoint = (i: number): Pt => {
      const n = nodes[i]!;
      return "label" in n ? { x: (d.labels[n.label]!.box.minX + d.labels[n.label]!.box.maxX) / 2, y: (d.labels[n.label]!.box.minY + d.labels[n.label]!.box.maxY) / 2 } : n.corner;
    };
    // Each node once, with what it is joined to that hasn't been said yet.
    const said = new Set<number>();
    const lines: string[] = [];
    nodes.forEach((_, i) => {
      const mine = edges.filter((e) => !said.has(e.part) && (e.from === i || e.to === i));
      if (!mine.length) return;
      mine.forEach((e) => said.add(e.part));
      lines.push(`- ${nodeName(i)} joined to ${list(mine.map((e) => `${nodeName(e.from === i ? e.to : e.from)} by ${how(e, i)}`))}.`);
    });
    const loose = d.parts.map((p, i) => ({ p, i })).filter(({ i }) => !edges.some((e) => e.part === i));
    const unattached = d.labels.filter((_, n) => !edges.some((e) => e.from === n || e.to === n));
    return [
      head,
      "Written labels and the lines between them:",
      ...lines,
      ...loose.map(({ p, i }) => `- Also ${name(i)}: ${partText(p)}.`),
      ...(unattached.length ? [`Also written: ${list(unattached.map((l) => `${labelText(l)} at ${g({ x: (l.box.minX + l.box.maxX) / 2, y: (l.box.minY + l.box.maxY) / 2 })}`))}.`] : []),
      ...d.labels.filter((l) => l.doubt && !unattached.includes(l)).map((l) => `"${l.text}" was read with doubt: ${l.doubt}.`),
    ].join("\n");
  }

  const joins = d.joins.map((j) => {
    switch (j.how) {
      case "meet": return `${name(j.a)} meets ${name(j.b)} at ${g(j.at!)}`;
      case "touch": return `${name(j.a)} touches ${name(j.b)}`;
      case "inside": return j.at ? `${name(j.a)} has an end inside ${name(j.b)}, at ${g(j.at)}` : `${name(j.a)} lies inside ${name(j.b)}`;
    }
  });
  return [
    head,
    "Parts:",
    ...d.parts.map((p, i) => `- ${name(i)}: ${partText(p)}.`),
    ...(joins.length ? [`Joins: ${joins.join("; ")}.`] : []),
    ...(d.labels.length ? [`Labels: ${d.labels.map((l) => `${labelText(l)} ${where(l)}`.trim()).join("; ")}.`] : []),
  ].join("\n");
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
