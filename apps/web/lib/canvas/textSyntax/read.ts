/**
 * The whole canvas as plain text a language model can read: handwriting
 * (matrices and lines of text, via segment.ts and handwriting.ts), typed text
 * boxes, sticky notes, math, images, and every mark or connector drawn over
 * them — frames, shapes, lines, arrows, and the circles, arrows and
 * underlines people draw with the pen (marks.ts) — each with what it points
 * at, encloses, covers or contains (relations.ts) — and drawings made with
 * the pen, by their parts, joins and labels (sketch.ts).
 *
 * Every item gets a short label (M1, T3, X1, A2, …) that stays the same
 * across reads (labels.ts), so the model and later messages can refer to it.
 *
 * A read can be limited to a selected rectangle. The board is still read
 * and labelled whole, exactly as a full read would, so labels agree; only
 * what is mostly inside the rectangle is printed, and anything it refers to
 * outside it is marked so.
 *
 * Deterministic: the same elements and labels always give the identical
 * string.
 */
import type { CanvasElement, CanvasShapeElement } from "@mola/shared";
import { DEFAULT_BITMAP_ROWS } from "./bitmap";
import { blockRenderer, BOXES_GUIDE, COORDINATES, describeBoxes, HANDWRITING_GUIDE, plural, scriptedText, topLeft, type SyntaxRender } from "./handwriting";
import { assignLabels, EMPTY_LABELS, type Labelable, type LabelMap } from "./labels";
import { detectPenMarks, type PenMark } from "./marks";
import { DEFAULT_MIN_CONFIDENCE, recognizeDoc } from "./recognize";
import { blockGlyphs, blockWords, coveredBy, enclosedBy, touching, underlinedBy, type Board, type Target } from "./relations";
import {
  boxOf, centerX, centerY, height, inkFromElements, inReadingOrder, median, segmentHandwriting, strokeUnit, width,
  type Block, type Box, type Glyph, type HandwritingDoc, type Ink, type Pt, type TextBlock, type Word,
} from "./segment";
import { attachLabels, findDrawings, type Drawing } from "./sketch";
import { describeDrawing } from "./sketchText";

export type Region = Box;

export type ItemKind =
  | "matrix" | "writing" | "drawing" | "text" | "note" | "math" | "image"
  | "frame" | "shape" | "arrow" | "line" | "circle" | "underline" | "highlight";

/** One labelled thing on the canvas, as read. Relations are given as printed addresses ("M2 row 2 col 3", "N1"). */
export type ReadItem = {
  label: string;
  kind: ItemKind;
  box: Box;
  /** The canvas elements it was read from: one for a placed element; every stroke for handwriting and pen marks. */
  elementIds: string[];
  /** Drawn with the pen (an arrow can be either). */
  pen: boolean;
  madeByAI: boolean | "partly";
  /** Arrows: what the tail and the head touch; lines and double-headed arrows: the two ends. Null for a free end. */
  ends?: [string | null, string | null];
  /** Circles and shapes: what they are drawn around. Underlines and highlights: what they cover. Frames: what they contain. */
  targets?: string[];
  /** In a read of a region: only some of this block's cells or words are inside it. */
  partly?: true;
};

/**
 * `handwriting` is the whole board's, with blocks carrying their stable
 * labels (less the writing taken as drawings' labels); `items` are the ones
 * printed, in order; `drawings`, every pen drawing on the board, by label.
 */
export type CanvasDoc = { handwriting: HandwritingDoc; items: ReadItem[]; drawings: { label: string; drawing: Drawing }[] };

const PREFIX: Record<ItemKind, string> = {
  matrix: "M", writing: "T", drawing: "D", text: "X", note: "N", math: "Q", image: "I",
  frame: "F", shape: "S", arrow: "A", line: "L", circle: "C", underline: "U", highlight: "H",
};
const NAMES: Record<ItemKind, [string, string]> = {
  matrix: ["handwritten matrix", "handwritten matrices"], writing: ["line of handwriting", "lines of handwriting"], drawing: ["pen drawing", "pen drawings"],
  text: ["text box", "text boxes"], note: ["sticky note", "sticky notes"], math: ["math element", "math elements"], image: ["image", "images"],
  frame: ["frame", "frames"], shape: ["shape", "shapes"], arrow: ["arrow", "arrows"], line: ["line", "lines"],
  circle: ["pen circle", "pen circles"], underline: ["pen underline", "pen underlines"], highlight: ["highlighter stroke", "highlighter strokes"],
};
const CONTENT: ItemKind[] = ["matrix", "writing", "drawing", "text", "note", "math", "image"];
const MARKS: ItemKind[] = ["frame", "shape", "arrow", "line", "circle", "underline", "highlight"];

/** A highlighter renders three times its stroke width wide (strokePath.ts). */
const HIGHLIGHTER_WIDTH = 3;

/** One thing before labelling: a placed element, a handwritten block, a pen drawing, or a pen mark. */
type Entry = { kind: ItemKind; box: Box; element?: CanvasElement; block?: Block; drawing?: Drawing; mark?: PenMark };

// ── geometry of elements ────────────────────────────────────────────────────

const pt = (p: Pt) => `(${Math.round(p.x)}, ${Math.round(p.y)})`;
const size = (b: Box) => `${Math.round(width(b))} x ${Math.round(height(b))}`;
const elementBox = (e: CanvasElement): Box => ({ minX: e.x, minY: e.y, maxX: e.x + e.width, maxY: e.y + e.height });

function lineEnds(e: Extract<CanvasElement, { type: "line" }>): [Pt, Pt] {
  return [{ x: e.x, y: e.y }, { x: e.x + e.props.endX, y: e.y + e.props.endY }];
}

const drawPoints = (e: Extract<CanvasElement, { type: "draw" }>): Pt[] => e.props.points.map((p) => ({ x: e.x + p.x, y: e.y + p.y }));

/** The outline as the canvas draws it (ElementRenderer.tsx). */
function shapeOutline(e: CanvasShapeElement): Pt[] {
  const { x, y, width: w, height: h } = e;
  const cx = x + w / 2;
  const cy = y + h / 2;
  switch (e.props.shapeKind) {
    case "rectangle": return [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
    case "triangle": return [{ x: cx, y }, { x, y: y + h }, { x: x + w, y: y + h }];
    case "ellipse": return Array.from({ length: 48 }, (_, i) => ({ x: cx + (w / 2) * Math.cos((i * Math.PI) / 24), y: cy + (h / 2) * Math.sin((i * Math.PI) / 24) }));
    case "star": return Array.from({ length: 10 }, (_, i) => {
      const r = (i % 2 === 0 ? 1 / 2 : 1 / 4.5) * Math.min(w, h);
      const a = (Math.PI / 5) * i - Math.PI / 2;
      return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
    });
  }
}

/** The pen's typical stroke size when there is handwriting; otherwise typed text's font size; otherwise a quarter of a typical element. */
function typicalSize(inks: Ink[], elements: CanvasElement[]): number {
  if (inks.length > 0) return strokeUnit(inks);
  const fonts = elements.flatMap((e) => (e.type === "text" || e.type === "note" || e.type === "math" ? [e.props.fontSize] : []));
  if (fonts.length > 0) return median(fonts);
  return Math.max(1, median(elements.map((e) => Math.max(e.width, e.height))) / 4);
}

// ── the selected region ─────────────────────────────────────────────────────

type Selection = {
  /** Printed items: the whole thing, or only these cells or words of a block. */
  includes: (entry: Entry) => "all" | Set<Word> | null;
  glyphs: Set<Glyph>;
  labels: Set<string>;
};

/** Mostly inside: most of an element's box area, most of a stroke's points, most of a cell's or word's ink. */
function select(region: Region, entries: Entry[], labelOf: Map<Entry, string>): Selection {
  const inside = (p: Pt) => p.x >= region.minX && p.x <= region.maxX && p.y >= region.minY && p.y <= region.maxY;
  const mostly = (points: Pt[]) => 2 * points.filter(inside).length > points.length;
  const boxMostly = (b: Box) => {
    const a = width(b) * height(b);
    if (a === 0) return inside({ x: centerX(b), y: centerY(b) });
    const overlap = Math.max(0, Math.min(b.maxX, region.maxX) - Math.max(b.minX, region.minX)) * Math.max(0, Math.min(b.maxY, region.maxY) - Math.max(b.minY, region.minY));
    return 2 * overlap > a;
  };
  const inkOf = (w: Word) => w.glyphs.flatMap((g) => g.strokes.flatMap((s) => s.points));

  const picked = new Map<Entry, "all" | Set<Word>>();
  for (const entry of entries) {
    const { element: e, block, mark } = entry;
    if (block) {
      const words = blockWords(block);
      const chosen = words.filter((w) => mostly(inkOf(w)));
      if (chosen.length > 0) picked.set(entry, chosen.length === words.length ? "all" : new Set(chosen));
      continue;
    }
    const isIn = mark ? mostly(mark.strokes.flatMap((s) => s.points))
      : entry.drawing ? mostly(entry.drawing.strokes.flatMap((s) => s.points))
      : e!.type === "draw" ? mostly(drawPoints(e!))
      : e!.type === "line" ? mostly(Array.from({ length: 17 }, (_, i) => {
        const [a, b] = lineEnds(e!);
        return { x: a.x + ((b.x - a.x) * i) / 16, y: a.y + ((b.y - a.y) * i) / 16 };
      }))
      : boxMostly(elementBox(e!));
    if (isIn) picked.set(entry, "all");
  }
  const glyphs = new Set([...picked].flatMap(([entry, part]) => (entry.block ? (part === "all" ? blockGlyphs(entry.block) : [...part].flatMap((w) => w.glyphs)) : [])));
  return { includes: (entry) => picked.get(entry) ?? null, glyphs, labels: new Set([...picked.keys()].map((entry) => labelOf.get(entry)!)) };
}

// ── text ────────────────────────────────────────────────────────────────────

/** "A", "A and B", "A, B and C". */
const list = (items: string[]) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

/** Typed text exactly as entered: in double quotes on one line, or one "| " row per line. */
function typed(text: string): string {
  const lines = text.split("\n");
  return lines.length === 1 ? `: "${text}"` : `, ${plural(lines.length, "line", "lines")}:\n${lines.map((l) => `| ${l}`).join("\n")}`;
}

function counts(entries: Entry[], kinds: ItemKind[]): string {
  const parts = kinds.flatMap((k) => {
    const n = entries.filter((e) => e.kind === k).length;
    return n ? [plural(n, ...NAMES[k])] : [];
  });
  return `${list(parts)}.`;
}

const LABEL_KEY = "Every item has a label: M a handwritten matrix, T a handwritten line of text, D a drawing made with the pen, X a text box, N a sticky note, Q math (LaTeX), I an image, "
  + "F a frame, S a shape, A an arrow, L a line, C a circle drawn with the pen, U an underline drawn with the pen, H a highlighter stroke. "
  + "A label keeps naming the same thing for as long as it is on the board and is never reused for anything else, so numbers can have gaps.";

const GUIDE = [
  `- Parts of handwriting are named by place, counting from 1: "M1 row 2 col 3", "M1 row 2" or "M1 col 4" in a matrix; "T1 word 5" or "T1 words 2–3" in a line of text.`,
  `- Typed text and LaTeX are shown exactly as entered, between double quotes, with nothing escaped. Text of several lines is shown one line per row instead, each row starting with "| ".`,
  `- An arrow runs from its tail to its head. Each end of an arrow or line names what it touches, or "a free end" if it touches nothing.`,
  `- "(made by the AI)" marks what the AI assistant put on the board; everything else was made by the user.`,
];
const DRAWING_GUIDE = `- A drawing made with the pen is described by its parts, P1, P2, … — straight lines, corners, closed shapes, arcs, curves, arrows, and so on — `
  + "with places given on a grid laid over the drawing; which parts join; and the short labels written beside them. Lines drawn between written labels are given as which label is joined to which, and by what kind of line. "
  + "What the drawing shows is not said: work it out from its parts.";

// ── read ────────────────────────────────────────────────────────────────────

export function readCanvas(
  elements: CanvasElement[],
  opts: {
    labels?: LabelMap; render?: SyntaxRender; region?: Region;
    /** Also print the box of every matrix cell and handwritten word, for a model that points by coordinates. Off by default. */
    coordinates?: boolean;
  } = {},
): { text: string; doc: CanvasDoc; labels: LabelMap } {
  const render = opts.render ?? "normalized";
  const rows = DEFAULT_BITMAP_ROWS;
  const byId = new Map(elements.map((e) => [e.id, e]));

  // Pen marks come off first, then drawings, so segmentation only ever sees writing.
  const inks = inkFromElements(elements);
  const unit = typicalSize(inks, elements);
  const placed = elements.filter((e) => e.type === "text" || e.type === "note" || e.type === "math" || e.type === "image" || e.type === "shape");
  const pen = detectPenMarks(inks, unit, placed.map(elementBox));
  // A matrix is writing, however big its brackets.
  const matrixInk = new Set(segmentHandwriting(pen.rest).blocks.flatMap((b) => (b.kind === "matrix"
    ? [b.delimiters.left, b.delimiters.right, ...b.bars.map((x) => x.ink), ...blockGlyphs(b).flatMap((g) => g.strokes)].map((s) => s.id)
    : [])));
  const sketch = findDrawings(pen.rest, pen.marks, unit, matrixInk);
  const marks = sketch.marks;
  const handwriting = segmentHandwriting(sketch.writing);
  const reads = recognizeDoc(handwriting);
  // Short writing by a drawing is its label, and is printed with it.
  const labelText = (words: Word[]) => {
    const unsure = words.flatMap((w) => w.glyphs).map((g) => reads.get(g)!).filter((r) => r.confidence < DEFAULT_MIN_CONFIDENCE);
    return {
      text: words.map((w) => scriptedText(w.glyphs.map((g) => reads.get(g)!))).join(" "),
      ...(unsure.length ? { doubt: unsure.map((r) => `"${r.char}" may be ${r.candidates.slice(1, 3).map((c) => `"${c.char}"`).join(" or ")}`).join("; ") } : {}),
    };
  };
  const { drawings, labels: labelBlocks } = attachLabels(sketch.drawings, handwriting.blocks.filter((b): b is TextBlock => b.kind === "text"), labelText, unit);

  const content: Entry[] = [
    ...handwriting.blocks.filter((block) => !labelBlocks.has(block as TextBlock))
      .map((block): Entry => ({ kind: block.kind === "matrix" ? "matrix" : "writing", box: block.box, block })),
    ...drawings.map((drawing): Entry => ({ kind: "drawing", box: drawing.box, drawing })),
    ...elements.flatMap((e): Entry[] => (e.type === "text" || e.type === "note" || e.type === "math" || e.type === "image" ? [{ kind: e.type, box: elementBox(e), element: e }] : [])),
  ];
  const drawn: Entry[] = [
    ...elements.flatMap((e): Entry[] => {
      if (e.type === "frame" || e.type === "shape") return [{ kind: e.type, box: elementBox(e), element: e }];
      if (e.type === "line") return [{ kind: e.props.startArrow || e.props.endArrow ? "arrow" : "line", box: boxOf(lineEnds(e)), element: e }];
      if (e.type === "draw" && e.props.variant === "highlighter") return [{ kind: "highlight", box: boxOf(drawPoints(e)), element: e }];
      return [];
    }),
    ...marks.map((mark): Entry => ({ kind: mark.kind, box: mark.box, mark })),
  ];
  const entries = [...inReadingOrder(content), ...inReadingOrder(drawn)];

  /** The pen strokes a handwritten block or pen mark was read from. */
  const strokesOf = (entry: Entry): Ink[] => {
    if (entry.mark) return entry.mark.strokes;
    if (entry.drawing) return entry.drawing.strokes;
    const b = entry.block!;
    const structure = b.kind === "matrix" ? [b.delimiters.left, b.delimiters.right, ...b.bars.map((x) => x.ink)] : [];
    return [...structure, ...blockGlyphs(b).flatMap((g) => g.strokes)];
  };
  const strokeIds = (entry: Entry) => strokesOf(entry).map((s) => s.id);
  const { labels: assigned, map } = assignLabels(entries.map((entry): Labelable => (entry.element
    ? { prefix: PREFIX[entry.kind], elementId: entry.element.id }
    : { prefix: PREFIX[entry.kind], strokeIds: strokeIds(entry) })), opts.labels ?? EMPTY_LABELS);
  const labelOf = new Map(entries.map((entry, i) => [entry, assigned[i]!]));
  // Blocks carry their stable labels from here on.
  for (const entry of entries) if (entry.block) entry.block = { ...entry.block, id: labelOf.get(entry)! };
  const blocks = entries.flatMap((entry) => (entry.block ? [entry.block] : []));

  const board: Board = {
    unit,
    blocks,
    things: entries.flatMap((entry) => {
      if (entry.drawing) return [{ label: labelOf.get(entry)!, box: entry.box }];
      const e = entry.element;
      if (!e || !["text", "note", "math", "image", "shape"].includes(e.type)) return [];
      return [{ label: labelOf.get(entry)!, box: entry.box, ...(e.type === "shape" ? { outline: shapeOutline(e) } : {}) }];
    }),
    frames: entries.flatMap((entry) => (entry.kind === "frame" ? [{ label: labelOf.get(entry)!, box: entry.box }] : [])),
  };

  // What each entry refers to.
  const relations = new Map<Entry, { ends?: [Target | null, Target | null]; targets?: Target[] }>();
  for (const entry of entries) {
    const { element: e, mark } = entry;
    if (mark?.kind === "arrow") relations.set(entry, { ends: [touching(mark.tail, board), touching(mark.tip, board)] });
    else if (mark?.kind === "circle") relations.set(entry, { targets: enclosedBy(mark.outline, mark.box, board) });
    else if (mark?.kind === "underline") relations.set(entry, { targets: underlinedBy(mark.box, board) });
    else if (e?.type === "line") {
      const [a, b] = lineEnds(e);
      // An arrow with only a start head points from its end back to its start.
      const [tail, head] = e.props.startArrow && !e.props.endArrow ? [b, a] : [a, b];
      relations.set(entry, { ends: [touching(tail, board), touching(head, board)] });
    } else if (e?.type === "shape") relations.set(entry, { targets: enclosedBy(shapeOutline(e), entry.box, board, labelOf.get(entry)) });
    else if (e?.type === "draw") relations.set(entry, { targets: coveredBy(drawPoints(e), (e.props.strokeWidth * HIGHLIGHTER_WIDTH) / 2, board) });
    else if (e?.type === "frame") {
      // Its children by parentId, plus handwriting and pen marks most of whose strokes are inside it.
      const within = (s: Ink) => centerX(s.box) >= e.x && centerX(s.box) <= e.x + e.width && centerY(s.box) >= e.y && centerY(s.box) <= e.y + e.height;
      const targets = entries.filter((other) => {
        if (other.element) return other.element.parentId === e.id;
        const strokes = strokesOf(other);
        return 2 * strokes.filter(within).length > strokes.length;
      }).map((other): Target => (other.block
        ? { text: other.block.id, label: other.block.id, glyphs: blockGlyphs(other.block) }
        : { text: labelOf.get(other)!, label: labelOf.get(other)! }));
      relations.set(entry, { targets });
    }
  }

  const selection = opts.region ? select(opts.region, entries, labelOf) : null;
  const shown = selection ? entries.filter((entry) => selection.includes(entry)) : entries;
  const outside = (t: Target) => !!selection && (t.glyphs ? !t.glyphs.some((g) => selection.glyphs.has(g)) : !selection.labels.has(t.label));
  const refer = (t: Target) => `${t.text}${outside(t) ? " (outside the selection)" : ""}`;
  const end = (t: Target | null) => (t ? refer(t) : "a free end");
  const targetList = (ts: Target[] | undefined, none: string) => (ts && ts.length > 0 ? list(ts.map(refer)) : none);

  const madeByAI = (entry: Entry): boolean | "partly" => {
    if (entry.element) return entry.element.createdBy === "ai";
    const ai = strokeIds(entry).filter((id) => byId.get(id)?.createdBy === "ai").length;
    return ai === 0 ? false : ai === strokeIds(entry).length ? true : "partly";
  };
  const tagOf = (entry: Entry) => {
    const ai = madeByAI(entry);
    return ai === true ? " (made by the AI)" : ai === "partly" ? " (partly made by the AI)" : "";
  };

  const renderBlock = blockRenderer({ blocks }, { render, rows, minConfidence: DEFAULT_MIN_CONFIDENCE, reads });
  const itemText = (entry: Entry): string => {
    const label = labelOf.get(entry)!;
    const tag = tagOf(entry);
    const rel = relations.get(entry);
    if (entry.block) {
      const part = selection?.includes(entry);
      const only = part instanceof Set ? part : undefined;
      const text = renderBlock(entry.block, { tag, only });
      return opts.coordinates ? `${text}\n\n${describeBoxes(entry.block, only)}` : text;
    }
    if (entry.drawing) return describeDrawing(entry.drawing, label, tag);
    const mark = entry.mark;
    if (mark) {
      switch (mark.kind) {
        case "arrow": return `${label} — arrow drawn with the pen${tag}, from ${end(rel!.ends![0])} to ${end(rel!.ends![1])}. Tail ${pt(mark.tail)}, head ${pt(mark.tip)}.`;
        case "circle": return `${label} — circle drawn with the pen${tag}, around ${targetList(rel!.targets, "nothing")}.`;
        case "underline": return `${label} — underline drawn with the pen${tag}, under ${targetList(rel!.targets, "nothing")}.`;
      }
    }
    const e = entry.element!;
    const place = `top-left ${topLeft(entry.box)}`;
    const extent = `Top-left ${topLeft(entry.box)}, size ${size(entry.box)}.`;
    switch (e.type) {
      case "text": return `${label} — text box${tag} at ${place}${typed(e.props.text)}`;
      case "note": return `${label} — sticky note${tag} at ${place}${typed(e.props.text)}`;
      case "math": return `${label} — math${tag} at ${place}, LaTeX${typed(e.props.latex)}`;
      case "image": return `${label} — image${tag} at ${place}, size ${size(entry.box)} (its contents are not described).`;
      case "frame": return `${label} — frame "${e.props.name}"${tag} containing ${targetList(rel!.targets, "nothing")}. ${extent}`;
      case "shape": return `${label} — ${e.props.shapeKind}${tag} around ${targetList(rel!.targets, "nothing")}. ${extent}`;
      case "draw": return `${label} — highlighter stroke${tag} over ${targetList(rel!.targets, "nothing")}.`;
      case "line": {
        const [a, b] = rel!.ends!;
        const [p, q] = lineEnds(e);
        const { startArrow, endArrow } = e.props;
        if (startArrow && endArrow) return `${label} — double-headed arrow${tag} between ${end(a)} and ${end(b)}. Ends ${pt(p)} and ${pt(q)}.`;
        if (!startArrow && !endArrow) return `${label} — line${tag} between ${end(a)} and ${end(b)}. Ends ${pt(p)} and ${pt(q)}.`;
        const [tail, head] = startArrow ? [q, p] : [p, q];
        return `${label} — arrow${tag} from ${end(a)} to ${end(b)}. Tail ${pt(tail)}, head ${pt(head)}.`;
      }
    }
  };

  const header = selection
    ? ["CANVAS SELECTION, AS TEXT",
      `Only what is inside a selected rectangle of this whiteboard, from ${pt({ x: opts.region!.minX, y: opts.region!.minY })} to ${pt({ x: opts.region!.maxX, y: opts.region!.maxY })}: `
        + "the things mostly inside it, and of a matrix or line of text the rectangle cuts through, only the cells or words mostly inside it. "
        + "Labels are the same as in a read of the whole board, and anything referred to that lies outside the rectangle is marked \"(outside the selection)\"."]
    : ["CANVAS CONTENTS, AS TEXT",
      "Everything on this whiteboard: first what is written or placed on it, then the marks and connections drawn over it, "
        + "each part in reading order (top to bottom within each column of the board, columns left to right)."];
  const parts = [
    { title: "WRITTEN AND PLACED", entries: shown.filter((entry) => CONTENT.includes(entry.kind)), kinds: CONTENT },
    { title: "MARKS AND CONNECTIONS", entries: shown.filter((entry) => MARKS.includes(entry.kind)), kinds: MARKS },
  ].filter((p) => p.entries.length > 0);
  const text = parts.length === 0
    ? [header.join("\n"), selection ? "Nothing is inside the selection." : "Nothing is on this canvas."].join("\n\n")
    : [
      header.join("\n"),
      LABEL_KEY,
      [
        "How to read it:", ...(shown.some((entry) => entry.block) ? HANDWRITING_GUIDE[render](rows) : []), ...(shown.some((entry) => entry.drawing) ? [DRAWING_GUIDE] : []),
        ...GUIDE, ...(opts.coordinates && shown.some((entry) => entry.block) ? [BOXES_GUIDE] : []), COORDINATES,
      ].join("\n"),
      ...parts.flatMap((p) => [`${p.title}\n${counts(p.entries, p.kinds)}`, ...p.entries.map(itemText)]),
    ].join("\n\n");

  const items = shown.map((entry): ReadItem => {
    const rel = relations.get(entry);
    const ids = entry.element ? [entry.element.id] : strokeIds(entry);
    return {
      label: labelOf.get(entry)!, kind: entry.kind, box: entry.box, elementIds: ids,
      pen: !entry.element, madeByAI: madeByAI(entry),
      ...(rel?.ends ? { ends: rel.ends.map((t) => t?.text ?? null) as [string | null, string | null] } : {}),
      ...(rel?.targets ? { targets: rel.targets.map((t) => t.text) } : {}),
      ...(selection?.includes(entry) instanceof Set ? { partly: true as const } : {}),
    };
  });
  const pictures = entries.flatMap((entry) => (entry.drawing ? [{ label: labelOf.get(entry)!, drawing: entry.drawing }] : []));
  return { text, doc: { handwriting: { blocks }, items, drawings: pictures }, labels: map };
}
