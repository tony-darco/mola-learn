/**
 * The canvas chat's other write tools, beside annotate_canvas (annotate.ts):
 * write_on_canvas — new typed text and math put beside something on the
 * board, and changes to typed text and math already there — and
 * arrange_canvas — arrows drawn from one labelled thing to another, arrows
 * pointed somewhere else, shapes and arrows moved.
 *
 * Everything is named the way the board text names it — "T1", "X2", "M2
 * row 1" — and resolved here against a read of the whole board
 * (resolveTarget), never given as coordinates: something new goes into free
 * space on the side of its label the model names (placeBeside), an arrow's
 * ends just outside the boxes of the things it joins, so the reader reads
 * them as touching them. Whatever the model gets wrong goes back to it as the
 * tool's result, worded so it can fix it in the same reply: an unknown
 * label, handwriting it can't change, no free space on that side, ….
 *
 * What the AI makes is a plain element like the student's own — a text box,
 * math, a line with an arrowhead — in Mola's accent (AI_ACCENT) and
 * createdBy "ai", so the student edits it with a click. A change to an
 * element already there keeps it whoever's it was. Each comes out as an
 * AIChange (chat.ts) with the whole element as it was before, so it can be
 * taken back on its own. Nothing here can remove anything, nor leave typed
 * text or math empty; handwriting is never changed or moved.
 */
import katex from "katex";
import type { CanvasElement, CanvasLineElement } from "@mola/shared";
import type { ToolSpec } from "@/lib/llm/types";
import type { AnnotateBoard } from "./annotate";
import type { AIChange } from "./chat";
import { elementBounds, type Rect } from "./marquee";
import { nextIndexAfterAll } from "./order";
import { AI_ACCENT, FONT_SIZES } from "./styleConstants";
import { resolveTarget, type ReadItem } from "./textSyntax";
import type { ItemKind } from "./textSyntax/read";
import { blockWords } from "./textSyntax/relations";

/**
 * Six, across both tools: a line of working, its fix, an arrow or two and a
 * move fit in one reply, and the board stays the student's.
 */
export const MAX_CHANGES_PER_TURN = 6;

const KINDS = ["text", "math"] as const;
const PLACES = ["below", "above", "right", "left"] as const;
type Place = (typeof PLACES)[number];

export const WRITE_TOOL: ToolSpec = {
  name: "write_on_canvas",
  description: "Write on the student's whiteboard: new typed text or math, put into free space beside something on the board, "
    + "and changes to typed text or math already on it — the student's too, like a typo fixed. "
    + "It appears in your colour as soon as you send it, as text boxes and math the student can edit like their own. "
    + "Handwriting can't be changed: annotate it, or write the correction beside it. Nothing is ever erased, and a change can't leave anything empty. "
    + `At most ${MAX_CHANGES_PER_TURN} changes per reply, counting arrange_canvas's.`,
  parameters: {
    type: "object",
    properties: {
      add: {
        type: "array",
        description: "New text boxes and math.",
        items: {
          type: "object",
          properties: {
            kind: { type: "string", enum: [...KINDS], description: "text: a typed text box. math: LaTeX, shown as math." },
            content: { type: "string", description: "The text, or the LaTeX for math, like \"2 + 2 = 4\" or \"\\frac{1}{2}\"." },
            place: { type: "string", enum: [...PLACES], description: "Which side of `near` it goes on." },
            near: { type: "string", description: "What it goes beside, as the board text names it: \"T1\", \"M2\", \"X3\", or a part, like \"M2 row 1\"." },
          },
          required: ["kind", "content", "place", "near"],
        },
      },
      change: {
        type: "array",
        description: "Changes to text boxes (X), sticky notes (N) and math (Q) already on the board.",
        items: {
          type: "object",
          properties: {
            target: { type: "string", description: "The label of the text box, sticky note or math: \"X1\", \"N2\", \"Q3\"." },
            content: { type: "string", description: "All of its new text, or LaTeX for math: the whole of it, not just the part that changes." },
          },
          required: ["target", "content"],
        },
      },
    },
  },
};

export const ARRANGE_TOOL: ToolSpec = {
  name: "arrange_canvas",
  description: "Draw arrows on the student's whiteboard and move things on it: a new arrow from one labelled thing to another, "
    + "an arrow (A) or line (L) already there pointed at something else, and shapes (S), arrows and lines moved. "
    + "New arrows appear in your colour as soon as you send them. Arrows don't follow what they touch: point or move them too when you move a shape. "
    + "Handwriting and anything drawn with the pen can't be moved. Nothing is ever erased. "
    + `At most ${MAX_CHANGES_PER_TURN} changes per reply, counting write_on_canvas's.`,
  parameters: {
    type: "object",
    properties: {
      arrows: {
        type: "array",
        description: "New arrows.",
        items: {
          type: "object",
          properties: {
            from: { type: "string", description: "What the arrow starts at (its tail), as the board text names it: \"X1\", \"M2\", or a part, like \"M2 row 1\"." },
            to: { type: "string", description: "What it points at (its head)." },
          },
          required: ["from", "to"],
        },
      },
      point: {
        type: "array",
        description: "Arrows and lines already on the board, pointed somewhere else: a new head (to), a new tail (from), or both.",
        items: {
          type: "object",
          properties: {
            arrow: { type: "string", description: "The arrow's or line's label: \"A1\", \"L2\"." },
            to: { type: "string", description: "What its head points at now." },
            from: { type: "string", description: "What its tail starts at now." },
          },
          required: ["arrow"],
        },
      },
      move: {
        type: "array",
        description: "Shapes, arrows and lines moved: beside `near`, on the side `place` names, into free space there; "
          + "or `by` canvas units the way `place` names. Give near or by, not both.",
        items: {
          type: "object",
          properties: {
            target: { type: "string", description: "What to move: \"S1\", \"A2\", \"L1\"." },
            place: { type: "string", enum: [...PLACES], description: "The side of `near` it goes to, or the way it moves `by`." },
            near: { type: "string", description: "What to move it beside, as the board text names it." },
            by: { type: "number", description: "How far to move it, in canvas units." },
          },
          required: ["target", "place"],
        },
      },
    },
  },
};

/** What a reply has done with these tools: its changes, every element they touched as it stands now, and what was asked, so nothing is done twice. */
export type WriteTurn = { changes: AIChange[]; current: Map<string, CanvasElement>; done: Set<string> };
export const newWriteTurn = (): WriteTurn => ({ changes: [], current: new Map(), done: new Set() });

/**
 * One call's outcome: the changes made, the tool's result for the model,
 * `settled` — nothing is left for it to fix — and `refused`, why the whole
 * call did nothing, when it did: not in the tool's shape, or more than are left.
 */
export type WriteOutcome = { changes: AIChange[]; result: string; settled: boolean; refused?: "shape" | "cap" };

// ── geometry ────────────────────────────────────────────────────────────────

type Pt = { x: number; y: number };
type Size = { width: number; height: number };

/** Canvas units: the clear space kept round something new, how far from its label it may go looking for that, and the step it looks in. */
const GAP = 16;
const REACH = 480;
const STEP = 8;
/** How far outside the things it joins an arrow ends: well inside the reader's "touching" (relations.ts). */
const END_GAP = 6;
/** The farthest a move "by" goes. */
const MAX_SHIFT = 2000;
/** The width of the AI's arrows: its annotations' marks' (ElementRenderer.tsx). */
const ARROW_WIDTH = 2.5;

const DIRECTION: Record<Place, Pt> = { below: { x: 0, y: 1 }, above: { x: 0, y: -1 }, right: { x: 1, y: 0 }, left: { x: -1, y: 0 } };
const center = (b: Rect): Pt => ({ x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 });
const inside = (p: Pt, b: Rect) => p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY;
const overlap = (a: Rect, b: Rect, m = 0) => a.minX < b.maxX + m && a.maxX + m > b.minX && a.minY < b.maxY + m && a.maxY + m > b.minY;
const rounded = (p: Pt): Pt => ({ x: Math.round(p.x), y: Math.round(p.y) });

/** Something to keep clear of: its box, and for a line drawn with the tool, its two ends — a slanted arrow's box is mostly empty. */
type Obstacle = { box: Rect; ends?: [Pt, Pt] };

function obstacleOf(box: Rect, e: CanvasElement | undefined): Obstacle {
  return e?.type === "line" ? { box, ends: [{ x: e.x, y: e.y }, { x: e.x + e.props.endX, y: e.y + e.props.endY }] } : { box };
}

/** Whether the obstacle comes within GAP of `b`: a line by points along it, every GAP / 2. */
function hits(o: Obstacle, b: Rect): boolean {
  if (!o.ends) return overlap(o.box, b, GAP);
  const [p, q] = o.ends;
  const n = Math.max(1, Math.ceil(Math.hypot(q.x - p.x, q.y - p.y) / (GAP / 2)));
  return Array.from({ length: n + 1 }, (_, i) => ({ x: p.x + ((q.x - p.x) * i) / n, y: p.y + ((q.y - p.y) * i) / n }))
    .some((pt) => overlap({ minX: pt.x, minY: pt.y, maxX: pt.x, maxY: pt.y }, b, GAP));
}

/**
 * Free space for something `size` big on the `place` side of `anchor`: GAP
 * away from it, lined up with its left edge (above or below it) or its middle
 * (beside it), and clear by GAP of every obstacle — going further that way, a
 * STEP at a time, while it isn't. Null when nothing within REACH is free.
 */
export function placeBeside(anchor: Rect, size: Size, place: Place, obstacles: Obstacle[]): Rect | null {
  const { width: w, height: h } = size;
  const midY = (anchor.minY + anchor.maxY) / 2 - h / 2;
  const start: Pt = place === "below" ? { x: anchor.minX, y: anchor.maxY + GAP }
    : place === "above" ? { x: anchor.minX, y: anchor.minY - GAP - h }
    : place === "right" ? { x: anchor.maxX + GAP, y: midY }
    : { x: anchor.minX - GAP - w, y: midY };
  const d = DIRECTION[place];
  for (let s = 0; s <= REACH; s += STEP) {
    const { x, y } = rounded({ x: start.x + d.x * s, y: start.y + d.y * s });
    const box = { minX: x, minY: y, maxX: x + w, maxY: y + h };
    if (!obstacles.some((o) => hits(o, box))) return box;
  }
  return null;
}

/** Where a ray from `box`'s centre, going `v`, leaves it — END_GAP beyond. */
function exitPoint(box: Rect, v: Pt): Pt {
  const c = center(box);
  const t = Math.min(v.x ? (box.maxX - box.minX) / 2 / Math.abs(v.x) : Infinity, v.y ? (box.maxY - box.minY) / 2 / Math.abs(v.y) : Infinity);
  const len = Math.hypot(v.x, v.y);
  return rounded({ x: c.x + v.x * t + (v.x / len) * END_GAP, y: c.y + v.y * t + (v.y / len) * END_GAP });
}

/** An arrow from `a` to `b`, as its tail and head: where the line between their centres leaves `a` and comes to `b`. Null when they overlap. */
export function arrowBetween(a: Rect, b: Rect): [Pt, Pt] | null {
  if (overlap(a, b, END_GAP)) return null;
  const [ca, cb] = [center(a), center(b)];
  const v = { x: cb.x - ca.x, y: cb.y - ca.y };
  return [exitPoint(a, v), exitPoint(b, { x: -v.x, y: -v.y })];
}

/** Where an arrow end goes to come to `box` from `other`, its other end: null when that end is on it already. */
function endAt(box: Rect, other: Pt): Pt | null {
  if (inside(other, box)) return null;
  const c = center(box);
  return exitPoint(box, { x: other.x - c.x, y: other.y - c.y });
}

/** A line's ends as tail and head, as the reader takes them (read.ts): an arrow with only a start head points from its end back to its start. */
function tailHead(e: CanvasLineElement): [Pt, Pt] {
  const start = { x: e.x, y: e.y };
  const end = { x: e.x + e.props.endX, y: e.y + e.props.endY };
  return e.props.startArrow && !e.props.endArrow ? [end, start] : [start, end];
}

function withEnds(e: CanvasLineElement, tail: Pt, head: Pt): CanvasLineElement {
  const [s, t] = e.props.startArrow && !e.props.endArrow ? [head, tail] : [tail, head];
  return { ...e, x: s.x, y: s.y, width: Math.abs(t.x - s.x), height: Math.abs(t.y - s.y), props: { ...e.props, endX: t.x - s.x, endY: t.y - s.y } };
}

// ── text and math sizes ─────────────────────────────────────────────────────
//
// The page draws text boxes at the size they are saved with, so a new one's
// is worked out here, generously: a character as 0.6 em wide, a line as a
// text box's line height (text-sm: 1.25rem over 0.875rem). Math the page
// measures once drawn (ElementRenderer.tsx MathShape); its size here only
// has to keep it clear of its neighbours.

const CHAR_EM = 0.6;
const LINE_EM = 1.45;
/** A text box's padding, both sides together (px-1.5 py-1) — across, with some to spare. */
const TEXT_PAD_X = 16;
const TEXT_PAD_Y = 8;
/** The most characters a new text box takes on one line before it wraps. */
const LINE_CHARS = 40;
/** A math element's padding, each side (ElementRenderer.tsx). */
const MATH_PAD = 6;
const MIN_FONT = FONT_SIZES.M;
const MAX_FONT = FONT_SIZES.XL * 1.5;

function textHeight(text: string, fontSize: number, width: number): number {
  const perLine = Math.max(1, Math.floor((width - TEXT_PAD_X) / (CHAR_EM * fontSize)));
  const lines = text.split("\n").reduce((n, line) => n + Math.max(1, Math.ceil(line.length / perLine)), 0);
  return Math.ceil(lines * LINE_EM * fontSize + TEXT_PAD_Y);
}

function textSize(text: string, fontSize: number): Size {
  const longest = Math.max(...text.split("\n").map((l) => l.length));
  const width = Math.ceil(Math.min(LINE_CHARS, longest) * CHAR_EM * fontSize + TEXT_PAD_X);
  return { width, height: textHeight(text, fontSize, width) };
}

function mathSize(latex: string, fontSize: number): Size {
  const shown = latex.replace(/\\[a-zA-Z]+/g, "x").replace(/[{}^_]/g, "");
  const tall = /\\frac|\\\\|\\begin|\\sum|\\int/.test(latex);
  return { width: Math.ceil(shown.length * CHAR_EM * fontSize + 2 * MATH_PAD), height: Math.ceil(fontSize * (tall ? 2.6 : 1.5) + 2 * MATH_PAD) };
}

// ── what the model sent ─────────────────────────────────────────────────────

const NAMED: Record<ItemKind, string> = {
  matrix: "a handwritten matrix", writing: "a line of handwriting", drawing: "a pen drawing", text: "a text box", note: "a sticky note", math: "math",
  image: "an image", frame: "a frame", shape: "a shape", arrow: "an arrow", line: "a line", circle: "a circle drawn with the pen",
  underline: "an underline drawn with the pen", highlight: "a highlighter stroke", annotation: "one of your own annotations",
};
const HANDWRITING: ItemKind[] = ["matrix", "writing", "drawing"];

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const side = (place: Place) => (place === "right" || place === "left" ? `${place} of` : place);
const WAY: Record<Place, string> = { below: "down", above: "up", right: "right", left: "left" };
const CLIP = 60;
const quote = (s: string) => {
  const line = s.replace(/\n/g, " / ");
  return `"${line.length > CLIP ? `${line.slice(0, CLIP - 1)}…` : line}"`;
};

/** The call's arguments: an object, or the same as JSON text. */
function argsOf(input: unknown): Record<string, unknown> | null {
  let value = input;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** A list the model sent — or one item of it, sent on its own. */
const listOf = (v: unknown): unknown[] => (Array.isArray(v) ? v : v && typeof v === "object" ? [v] : []);
const fieldsOf = (v: unknown) => (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
const given = (v: unknown) => v !== undefined && v !== null && v !== "";
const placeOf = (v: unknown): Place | null => (typeof v === "string" && (PLACES as readonly string[]).includes(v.trim().toLowerCase()) ? v.trim().toLowerCase() as Place : null);
const textOf = (v: unknown) => (typeof v === "string" ? v.trim() : "");
/** LaTeX without the $…$, $$…$$, \(…\) or \[…\] a model may wrap it in. */
const latexOf = (v: unknown) => textOf(v).replace(/^\$\$([\s\S]*)\$\$$|^\$([\s\S]*)\$$|^\\\(([\s\S]*)\\\)$|^\\\[([\s\S]*)\\\]$/, (...m: string[]) => m[1] ?? m[2] ?? m[3] ?? m[4] ?? "").trim();

/** Why KaTeX can't draw `latex`, or null when it can. */
function badLatex(latex: string): string | null {
  try {
    katex.renderToString(latex, { throwOnError: true });
    return null;
  } catch (err) {
    return `the LaTeX doesn't parse (${err instanceof Error ? err.message : String(err)}): send it fixed`;
  }
}

/** One thing a call asked for: how the result names it, and why it can't be done — or what tells it apart, how it is told once done, and doing it. */
type Asked =
  | { which: string; problem: string }
  | { which: string; key: string; told: string; make: (makeId: () => string) => { element: CanvasElement; before: CanvasElement | null } | string };

/** A place on the board as resolved — and, for one placed element, which. */
type Spot = { address: string; box: Rect; elementId: string | null };

/** The board as one call sees it: as read, with what this reply has changed so far on top. */
function view(board: AnnotateBoard, turn: WriteTurn) {
  const byId = new Map(board.elements.map((e) => [e.id, e]));
  const element = (id: string) => turn.current.get(id) ?? byId.get(id)!;
  const labelOf = (address: string) => address.split(" ")[0]!;
  const itemOf = (label: string) => board.doc.items.find((i) => i.label === label);

  /** A place, by its name in the board text, or why it can't be used. */
  const spot = (name: unknown, field: string): Spot | string => {
    if (typeof name !== "string" || !name.trim()) return `${field} is missing: name something on the board as the board text does, like "T1" or "X2"`;
    const resolved = resolveTarget(name, { doc: board.doc });
    if (!resolved.ok) return resolved.error;
    const label = labelOf(resolved.address);
    if (itemOf(label)?.kind === "annotation") return `${label} is one of your own annotations: name the student's work it is on`;
    const one = resolved.elementIds.length === 1 && byId.has(resolved.elementIds[0]!) ? resolved.elementIds[0]! : null;
    return { address: resolved.address, box: resolved.box, elementId: one };
  };

  return {
    element, labelOf, spot,
    /** Where a place is now: a placed element this reply has changed is where it left it. */
    boxOf: (s: Spot) => (s.elementId && turn.current.has(s.elementId) ? elementBounds(turn.current.get(s.elementId)!) : s.box),

    /** A whole item, by its label alone, and its one element as it stands now if it is a placed one — or why not. */
    whole: (name: unknown, field: string): { item: ReadItem; element: CanvasElement | null } | string => {
      const s = spot(name, field);
      if (typeof s === "string") return s;
      const item = itemOf(labelOf(s.address))!;
      if (s.address !== item.label && !HANDWRITING.includes(item.kind)) return `name all of ${item.label}, as "${item.label}"`;
      return { item, element: item.pen ? null : element(item.elementIds[0]!) };
    },

    /** Everything on the board as it stands now, but frames — they hold things — and `skip`. */
    obstacles: (skip?: string): Obstacle[] => [
      ...board.doc.items.filter((i) => i.kind !== "frame" && !i.elementIds.some((id) => id === skip || turn.current.has(id)))
        .map((i) => obstacleOf(i.box, i.pen ? undefined : byId.get(i.elementIds[0]!))),
      ...[...turn.current.values()].filter((e) => e.id !== skip && e.type !== "frame").map((e) => obstacleOf(elementBounds(e), e)),
    ],

    /** About the size of what it goes beside: a typed item's font; handwriting's letters, as tall as a capital; else the text tool's default. */
    fontSizeBeside: (s: Spot): number => {
      const block = board.doc.handwriting.blocks.find((b) => b.id === labelOf(s.address));
      if (block) {
        const heights = blockWords(block).map((w) => w.box.maxY - w.box.minY).sort((a, b) => a - b);
        return Math.min(MAX_FONT, Math.max(MIN_FONT, Math.round(heights[Math.floor(heights.length / 2)]! / 0.75)));
      }
      const e = s.elementId ? element(s.elementId) : null;
      return e?.type === "text" || e?.type === "note" || e?.type === "math" ? e.props.fontSize : MIN_FONT;
    },

    nextIndex: () => nextIndexAfterAll([...board.elements, ...turn.current.values()]),
  };
}
type View = ReturnType<typeof view>;

const AI = { parentId: null, rotation: 0, opacity: 1, createdBy: "ai" as const };

// ── write_on_canvas ─────────────────────────────────────────────────────────

function checkAdd(a: Record<string, unknown>, which: string, v: View): Asked {
  const problems: string[] = [];
  const kind = typeof a.kind === "string" ? a.kind.trim().toLowerCase() : "";
  if (kind !== "text" && kind !== "math") problems.push("kind must be text or math");
  const place = placeOf(a.place);
  if (!place) problems.push(`place must be one of ${PLACES.join(", ")}`);
  const content = kind === "math" ? latexOf(a.content) : textOf(a.content);
  const bad = content && kind === "math" ? badLatex(content) : null;
  if (!content) problems.push("the content is missing: give the text, or the LaTeX for math");
  else if (bad) problems.push(bad);
  const near = v.spot(a.near, "near");
  if (typeof near === "string") problems.push(near);
  if (problems.length > 0 || typeof near === "string" || !place) return { which, problem: problems.join("; ") };

  return {
    which,
    key: `add ${kind} ${place} ${near.address} ${content}`,
    told: `wrote ${kind === "math" ? "math" : "a text box"} ${quote(content)} ${side(place)} ${near.address}`,
    make: (makeId) => {
      const fontSize = v.fontSizeBeside(near);
      const size = kind === "math" ? mathSize(content, fontSize) : textSize(content, fontSize);
      const at = placeBeside(v.boxOf(near), size, place, v.obstacles());
      if (!at) return `there's no free space within ${REACH} canvas units ${side(place)} ${near.address}: write it on another side of it, or beside something else`;
      const base = { ...AI, id: makeId(), index: v.nextIndex(), x: at.minX, y: at.minY, ...size };
      const element: CanvasElement = kind === "math"
        ? { ...base, type: "math", props: { latex: content, color: AI_ACCENT, fontSize } }
        : { ...base, type: "text", props: { text: content, color: AI_ACCENT, fontSize, backgroundColor: null, bold: false, italic: false, textAlign: "left", autoFit: "grow" } };
      return { element, before: null };
    },
  };
}

function checkChange(a: Record<string, unknown>, which: string, v: View): Asked {
  const found = v.whole(a.target, "target");
  if (typeof found === "string") return { which, problem: found };
  const { item, element } = found;
  const label = item.label;
  if (HANDWRITING.includes(item.kind)) return { which, problem: `${label} is handwriting, which can't be changed: annotate it, or write the correction beside it with "add"` };
  if (element?.type !== "text" && element?.type !== "note" && element?.type !== "math") {
    return { which, problem: `${label} is ${NAMED[item.kind]}: only text boxes (X), sticky notes (N) and math (Q) can be changed` };
  }
  const math = element.type === "math";
  const content = math ? latexOf(a.content) : textOf(a.content);
  if (!content) return { which, problem: `a change can't leave ${label} empty: send all of its new ${math ? "LaTeX" : "text"}` };
  const bad = math ? badLatex(content) : null;
  if (bad) return { which, problem: bad };

  return {
    which,
    key: `change ${label} ${content}`,
    told: `changed ${label} to ${quote(content)}`,
    make: () => {
      const was = v.element(element.id);
      const same = `${label} already says exactly that, so nothing changed`;
      // Typed text grows to hold what it says now, as it does when the student types it (CanvasView.tsx applyAutoFit).
      const height = (e: { height: number; width: number; props: { autoFit: string; fontSize: number } }) =>
        (e.props.autoFit === "grow" ? Math.max(e.height, textHeight(content, e.props.fontSize, e.width)) : e.height);
      switch (was.type) {
        case "math": return was.props.latex === content ? same : { element: { ...was, props: { ...was.props, latex: content } }, before: was };
        case "text": return was.props.text === content ? same : { element: { ...was, height: height(was), props: { ...was.props, text: content } }, before: was };
        case "note": return was.props.text === content ? same : { element: { ...was, height: height(was), props: { ...was.props, text: content } }, before: was };
        default: return `${label} can't be changed`;
      }
    },
  };
}

/**
 * One write_on_canvas call: the changes made — new text and math on top of
 * the board as the model saw it, and the text of typed items rewritten —
 * and the result for the model. Records them in `turn`.
 */
export function write(input: unknown, board: AnnotateBoard, turn: WriteTurn, makeId: () => string = () => crypto.randomUUID()): WriteOutcome {
  const args = argsOf(input);
  const [add, change] = [listOf(args?.add), listOf(args?.change)];
  if (add.length + change.length === 0) {
    return {
      changes: [], settled: false, refused: "shape",
      result: `error: send {"add": [{"kind": "text" or "math", "content": "…", "place": "below", "near": "T1"}]} to write something new, `
        + `and/or {"change": [{"target": "X1", "content": "…"}]} to change text or math already on the board`,
    };
  }
  const v = view(board, turn);
  const named = (a: Record<string, unknown>, key: string) => (typeof a[key] === "string" ? ` ("${a[key]}")` : "");
  // Changes first, so what is added beside a changed item keeps clear of it as it is now.
  return run([
    ...change.map(fieldsOf).map((a, i) => checkChange(a, `change ${i + 1}${named(a, "target")}`, v)),
    ...add.map(fieldsOf).map((a, i) => checkAdd(a, `add ${i + 1}${named(a, "near")}`, v)),
  ], turn, makeId);
}

// ── arrange_canvas ──────────────────────────────────────────────────────────

function checkArrow(a: Record<string, unknown>, which: string, v: View): Asked {
  const from = v.spot(a.from, "from");
  const to = v.spot(a.to, "to");
  const problems = [from, to].filter((s): s is string => typeof s === "string");
  if (typeof from === "string" || typeof to === "string") return { which, problem: problems.join("; ") };
  if (from.address === to.address) return { which, problem: `an arrow needs two different ends, but both are ${from.address}` };
  return {
    which,
    key: `arrow ${from.address} ${to.address}`,
    told: `drew an arrow from ${from.address} to ${to.address}`,
    make: (makeId) => {
      const ends = arrowBetween(v.boxOf(from), v.boxOf(to));
      if (!ends) return `${from.address} and ${to.address} overlap, so there's no room for an arrow between them`;
      const [tail, head] = ends;
      return {
        element: {
          ...AI, id: makeId(), index: v.nextIndex(), x: tail.x, y: tail.y, width: Math.abs(head.x - tail.x), height: Math.abs(head.y - tail.y), type: "line",
          props: { endX: head.x - tail.x, endY: head.y - tail.y, color: AI_ACCENT, strokeWidth: ARROW_WIDTH, dash: "solid", startArrow: false, endArrow: true },
        },
        before: null,
      };
    },
  };
}

/** Why what is named can't be moved or pointed: handwriting, drawn with the pen, or not an arrow, line (or shape) at all. Null when it can. */
function notMovable(item: ReadItem, element: CanvasElement | null, kinds: ItemKind[], what: string): string | null {
  if (HANDWRITING.includes(item.kind)) return `${item.label} is handwriting, which can't be ${what}`;
  if (!kinds.includes(item.kind)) return `${item.label} is ${NAMED[item.kind]}: only ${kinds.includes("shape") ? "shapes (S), arrows (A) and lines (L)" : "arrows (A) and lines (L)"} can be ${what}`;
  if (!element) return `${item.label} is drawn with the pen, which can't be ${what}`;
  return null;
}

function checkPoint(a: Record<string, unknown>, which: string, v: View): Asked {
  const found = v.whole(a.arrow, "arrow");
  if (typeof found === "string") return { which, problem: found };
  const { item, element } = found;
  const label = item.label;
  const no = notMovable(item, element, ["arrow", "line"], "pointed somewhere else");
  if (no) return { which, problem: no };
  const to = given(a.to) ? v.spot(a.to, "to") : null;
  const from = given(a.from) ? v.spot(a.from, "from") : null;
  if (!to && !from) return { which, problem: `say where ${label} should point: a new head (to), a new tail (from), or both` };
  const problems = [from, to].filter((s): s is string => typeof s === "string");
  if (typeof from === "string" || typeof to === "string") return { which, problem: problems.join("; ") };
  if ([from, to].some((s) => s && v.labelOf(s.address) === label)) return { which, problem: `${label} can't point at itself` };

  const [tailNow, headNow] = item.ends ?? [null, null];
  return {
    which,
    key: `point ${label} ${from?.address ?? ""} ${to?.address ?? ""}`,
    told: `pointed ${label} from ${from?.address ?? tailNow ?? "a free end"} to ${to?.address ?? headNow ?? "a free end"}`,
    make: () => {
      const was = v.element(element!.id) as CanvasLineElement;
      let [tail, head] = tailHead(was);
      if (from && to) {
        const ends = arrowBetween(v.boxOf(from), v.boxOf(to));
        if (!ends) return `${from.address} and ${to.address} overlap, so there's no room for ${label} between them`;
        [tail, head] = ends;
      } else if (to) {
        const p = endAt(v.boxOf(to), tail);
        if (!p) return `${label} starts on ${to.address}, so it can't point at it: give it a new tail (from) too`;
        head = p;
      } else {
        const p = endAt(v.boxOf(from!), head);
        if (!p) return `${label} points at ${from!.address}, so it can't start there: give it a new head (to) too`;
        tail = p;
      }
      return { element: withEnds(was, tail, head), before: was };
    },
  };
}

function checkMove(a: Record<string, unknown>, which: string, v: View): Asked {
  const found = v.whole(a.target, "target");
  if (typeof found === "string") return { which, problem: found };
  const { item, element } = found;
  const label = item.label;
  const no = notMovable(item, element, ["shape", "arrow", "line"], "moved");
  if (no) return { which, problem: no };
  const problems: string[] = [];
  const place = placeOf(a.place);
  if (!place) problems.push(`place must be one of ${PLACES.join(", ")}`);
  const near = given(a.near) ? v.spot(a.near, "near") : null;
  const by = given(a.by) ? Number(a.by) : null;
  if (typeof near === "string") problems.push(near);
  if (near && by !== null) problems.push("give near or by, not both");
  else if (!near && by === null) problems.push(`say where to move ${label}: beside something (near), or how far (by)`);
  else if (by !== null && !(by > 0 && by <= MAX_SHIFT)) problems.push(`by must be how far to move it, in canvas units: more than 0 and at most ${MAX_SHIFT}`);
  if (near && typeof near !== "string" && v.labelOf(near.address) === label) problems.push(`${label} can't be moved beside itself`);
  if (problems.length > 0 || typeof near === "string" || !place) return { which, problem: problems.join("; ") };

  return {
    which,
    key: near ? `move ${label} ${place} ${near.address}` : `move ${label} ${place} by ${by}`,
    told: near ? `moved ${label} ${side(place)} ${near.address}` : `moved ${label} ${by} canvas units ${WAY[place]}`,
    make: () => {
      const was = v.element(element!.id);
      const box = elementBounds(was);
      let shift = { x: DIRECTION[place].x * (by ?? 0), y: DIRECTION[place].y * (by ?? 0) };
      if (near) {
        const at = placeBeside(v.boxOf(near), { width: box.maxX - box.minX, height: box.maxY - box.minY }, place, v.obstacles(was.id));
        if (!at) return `there's no free space within ${REACH} canvas units ${side(place)} ${near.address}: move ${label} to another side of it, or beside something else`;
        shift = { x: at.minX - box.minX, y: at.minY - box.minY };
      }
      return { element: { ...was, ...rounded({ x: was.x + shift.x, y: was.y + shift.y }) }, before: was };
    },
  };
}

/**
 * One arrange_canvas call: the changes made — new arrows on top of the board
 * as the model saw it, arrows pointed elsewhere, shapes and arrows moved —
 * and the result for the model. Records them in `turn`.
 */
export function arrange(input: unknown, board: AnnotateBoard, turn: WriteTurn, makeId: () => string = () => crypto.randomUUID()): WriteOutcome {
  const args = argsOf(input);
  const [arrows, point, move] = [listOf(args?.arrows), listOf(args?.point), listOf(args?.move)];
  if (arrows.length + point.length + move.length === 0) {
    return {
      changes: [], settled: false, refused: "shape",
      result: `error: send {"arrows": [{"from": "…", "to": "…"}]} to draw arrows, {"point": [{"arrow": "A1", "to": "…"}]} to point one somewhere else, `
        + `and/or {"move": [{"target": "S1", "place": "right", "near": "…"}]} to move something`,
    };
  }
  const v = view(board, turn);
  const named = (a: Record<string, unknown>, ...keys: string[]) => {
    const names = keys.flatMap((k) => (typeof a[k] === "string" ? [`"${a[k]}"`] : []));
    return names.length === keys.length ? ` (${names.join(" to ")})` : "";
  };
  // Moves first, then the arrows pointed at things, so they meet them where they are now.
  return run([
    ...move.map(fieldsOf).map((a, i) => checkMove(a, `move ${i + 1}${named(a, "target")}`, v)),
    ...point.map(fieldsOf).map((a, i) => checkPoint(a, `point ${i + 1}${named(a, "arrow")}`, v)),
    ...arrows.map(fieldsOf).map((a, i) => checkArrow(a, `arrow ${i + 1}${named(a, "from", "to")}`, v)),
  ], turn, makeId);
}

// ── both ────────────────────────────────────────────────────────────────────

/**
 * Does what was asked, in order, and tells the model how it went: what was
 * done, what this reply had done already, what to fix, and how many more
 * changes it can make. A call asking for more than are left does nothing,
 * so the model chooses rather than being cut off — as annotate_canvas does.
 */
function run(asked: Asked[], turn: WriteTurn, makeId: () => string): WriteOutcome {
  const left = MAX_CHANGES_PER_TURN - turn.changes.length;
  const fresh = new Set(asked.flatMap((a) => ("key" in a && !turn.done.has(a.key) ? [a.key] : []))).size;
  if (fresh > left) {
    return {
      changes: [], settled: false, refused: "cap",
      result: `error: nothing was done. A reply can make at most ${MAX_CHANGES_PER_TURN} changes with write_on_canvas and arrange_canvas, and `
        + `${left === 0 ? "this one has made them all" : `${plural(left, "is", "are")} left`}, but this call asked for ${fresh}. `
        + `${left === 0 ? "Say anything else in your reply." : "Send only the ones that matter most."}`,
    };
  }

  const changes: AIChange[] = [];
  const done: string[] = [];
  const already: string[] = [];
  const problems: string[] = [];
  for (const a of asked) {
    if ("problem" in a) {
      problems.push(`${a.which}: ${a.problem}`);
      continue;
    }
    if (turn.done.has(a.key)) {
      already.push(a.told);
      continue;
    }
    const made = a.make(makeId);
    if (typeof made === "string") {
      problems.push(`${a.which}: ${made}`);
      continue;
    }
    const change: AIChange = { id: made.before ? makeId() : made.element.id, ...made };
    turn.done.add(a.key);
    turn.changes.push(change);
    turn.current.set(change.element.id, change.element);
    changes.push(change);
    done.push(a.told);
  }

  const remaining = MAX_CHANGES_PER_TURN - turn.changes.length;
  const lines = [
    changes.length > 0 ? "Done, for the student to see now:" : "Nothing was done.",
    ...done.map((t) => `- ${t}`),
    ...(already.length > 0 ? ["Already done earlier in this reply, so not done again:", ...already.map((t) => `- ${t}`)] : []),
    ...(problems.length > 0 ? ["Not done — fix these and send them again if they still matter:", ...problems.map((t) => `- ${t}`)] : []),
    remaining > 0
      ? `${plural(remaining, "more change", "more changes")} can be made in this reply.`
      : "That is all the changes this reply can make; say anything else in your reply.",
  ];
  return { changes, result: lines.join("\n"), settled: problems.length === 0 };
}
