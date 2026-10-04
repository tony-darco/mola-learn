/**
 * The canvas chat's edit log: every change to the board becomes an entry in
 * the chat, in the order it happened, told the way the model reads the board
 * — by label: "You added M9 (a 3×4 matrix)", "You changed M4 row 2 col 3
 * from 5 to 1", "You erased T2". The model sees the entries too, folded into
 * the student's next message (changesSection).
 *
 * Pure. One read of the board (readCanvas) makes a BoardSnapshot of it;
 * two snapshots read with the same labels give the changes between them
 * (diffSnapshots). Handwriting arrives over many saves, so a change that
 * carries on from the newest entry folds into it (mergeEdit) rather than
 * adding another. lib/canvas/chatServer.ts keeps each chat's snapshot and
 * writes the entries.
 *
 * An edit says who made it, so every entry in the log has the same shape:
 * the AI's annotations are logged as its own ("Mola marked M8 row 1 col 4
 * as an error (K1): …") by what they are made of — elements createdBy
 * "ai" — whichever save brings them, and everything else as the student's.
 */
import type { CanvasElement } from "@mola/shared";
import { readCanvas, type CanvasDoc, type LabelMap, type ReadItem } from "./textSyntax";
import { scriptedText } from "./textSyntax/handwriting";
import type { Word } from "./textSyntax/segment";

export type ItemKind = ReadItem["kind"];
export type EditActor = "user" | "ai";

/** What the log tells of one labelled thing on the board. */
export type ItemContent = {
  /** Handwriting, text boxes and notes: the text; math: the LaTeX; frames: the name. */
  text?: string;
  /** Matrices: every entry, row by row, "" for an empty one; and the columns a vertical bar follows. */
  cells?: string[][];
  bars?: number[];
  /** Arrows and lines: what the tail and the head (a line's two ends) touch, null for a free end. */
  ends?: [string | null, string | null];
  /** What a shape or a pen circle is around, an underline under, a highlight over, a frame holds, an annotation is on. */
  targets?: string[];
  /** Shapes: "rectangle", "ellipse", …; an arrow with two heads: "double"; annotations: their kind, "error", "hint", …. */
  form?: string;
  /** Pen drawings: the labels written by them, and how many strokes they are. */
  labels?: string[];
  strokes?: number;
};

/** One element: [x, y, width, height] rounded to whole canvas units, and a fingerprint of everything else about it. */
type Placement = [number, number, number, number, string];

export type SnapshotItem = {
  label: string;
  kind: ItemKind;
  /** Read from pen strokes, not placed with a tool. */
  pen: boolean;
  /** Made by the AI, all of it. */
  ai?: true;
  content: ItemContent;
  /** The elements it was read from (a pen drawing's include its written labels), by id. */
  elements: Record<string, Placement>;
};

/** Every labelled thing on the board, in reading order. */
export type BoardSnapshot = { items: SnapshotItem[] };

export type CanvasEdit = {
  actor: EditActor;
  action: "added" | "changed" | "moved" | "resized" | "erased";
  label: string;
  kind: ItemKind;
  pen: boolean;
  /** What it held before (all but added) and holds now (all but erased). */
  before?: ItemContent;
  after?: ItemContent;
  /** Labels that are gone because what they were read from is now part of this: writing that became a matrix, say. */
  took?: string[];
};

// ── snapshots ───────────────────────────────────────────────────────────────

/** JSON with object keys sorted, so the same element always prints the same. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** FNV-1a of everything about an element but its place, size, stacking order and frame. */
function fingerprint(e: CanvasElement): string {
  const rest: Record<string, unknown> = { ...e };
  for (const key of ["x", "y", "width", "height", "index", "parentId"]) delete rest[key];
  const s = stable(rest);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}

const placement = (e: CanvasElement): Placement => [Math.round(e.x), Math.round(e.y), Math.round(e.width), Math.round(e.height), fingerprint(e)];

/** The board as the log tells it, from a read of all of it (not of a region). */
export function snapshotBoard(elements: CanvasElement[], doc: CanvasDoc): BoardSnapshot {
  const byId = new Map(elements.map((e) => [e.id, e]));
  const blocks = new Map(doc.handwriting.blocks.map((b) => [b.id, b]));
  const drawings = new Map(doc.drawings.map((d) => [d.label, d.drawing]));
  const read = (w: Word) => scriptedText(w.glyphs.map((g) => doc.reads.get(g)!));

  const contentOf = (item: ReadItem): ItemContent => {
    const block = blocks.get(item.label);
    if (block?.kind === "matrix") {
      return { cells: block.rows.map((row) => row.cells.map((c) => (c ? read(c) : ""))), bars: block.bars.map((b) => b.afterColumn) };
    }
    if (block?.kind === "text") {
      const words = block.words.map(read);
      // Operators written between matrices read as the expression they make: "M1 × M2 = M3".
      const operands = block.operands?.map((left) => doc.handwriting.blocks.find((b) => b.kind === "matrix" && b.delimiters.left === left)?.id ?? "a matrix");
      return { text: operands ? operands.flatMap((m, i) => (i < words.length ? [m, words[i]!] : [m])).join(" ") : words.join(" ") };
    }
    const drawing = drawings.get(item.label);
    if (drawing) return { labels: drawing.labels.map((l) => l.text), strokes: drawing.strokes.length };
    const relations = { ...(item.ends ? { ends: item.ends } : {}), ...(item.targets ? { targets: item.targets } : {}) };
    const e = item.pen ? undefined : byId.get(item.elementIds[0]!);
    switch (e?.type) {
      case "text": case "note": return { text: e.props.text };
      case "math": return { text: e.props.latex };
      case "frame": return { text: e.props.name, ...relations };
      case "annotation": return { text: e.props.note, targets: [e.props.target], form: e.props.kind };
      case "shape": return { form: e.props.shapeKind, ...relations };
      case "line": return { ...relations, ...(e.props.startArrow && e.props.endArrow ? { form: "double" } : {}) };
      default: return relations;
    }
  };

  return {
    items: doc.items.map((item) => ({
      label: item.label, kind: item.kind, pen: item.pen, ...(item.madeByAI === true ? { ai: true as const } : {}), content: contentOf(item),
      elements: Object.fromEntries(item.elementIds.flatMap((id) => {
        const e = byId.get(id);
        return e ? [[id, placement(e)]] : [];
      })),
    })),
  };
}

// ── what changed ────────────────────────────────────────────────────────────

const sameContent = (a: ItemContent | undefined, b: ItemContent | undefined) => stable(a ?? {}) === stable(b ?? {});

/**
 * How an item's elements changed: not at all; all moved together; only
 * resized (a tool element dragged by a corner); or in any other way —
 * strokes added or erased, text typed, an arrow's end dragged.
 */
function howChanged(before: SnapshotItem, after: SnapshotItem): "same" | "moved" | "resized" | "other" {
  const ids = Object.keys(before.elements);
  if (ids.length !== Object.keys(after.elements).length || ids.some((id) => !after.elements[id])) return "other";
  let shift: [number, number] | null = null;
  let together = true;
  let resized = false;
  for (const id of ids) {
    const [x0, y0, w0, h0, f0] = before.elements[id]!;
    const [x1, y1, w1, h1, f1] = after.elements[id]!;
    if (f0 !== f1) return "other";
    if (w0 !== w1 || h0 !== h1) resized = true;
    shift ??= [x1 - x0, y1 - y0];
    // Rounding can put two elements moved together a unit apart.
    if (Math.abs(x1 - x0 - shift[0]) > 1 || Math.abs(y1 - y0 - shift[1]) > 1) together = false;
  }
  if (resized) return "resized";
  if (!together) return "other";
  return shift && (shift[0] !== 0 || shift[1] !== 0) ? "moved" : "same";
}

/**
 * The changes from one snapshot to the next, both read with the same labels:
 * first what was erased, then what was changed, moved or added, in reading
 * order. They are `actor`'s, but for something new the AI made, which is
 * the AI's. Something whose elements didn't change is left out even if it reads
 * differently now — the student didn't touch it. A label that is gone while
 * most of what it was read from is still on the board wasn't erased: it was
 * taken into the one thing that now holds most of it (`took`), or, spread
 * over several, taken apart.
 */
export function diffSnapshots(before: BoardSnapshot, after: BoardSnapshot, actor: EditActor = "user"): CanvasEdit[] {
  const now = new Set(after.items.map((i) => i.label));
  const was = new Map(before.items.map((i) => [i.label, i]));
  const ownerNow = new Map<string, string>();
  for (const item of after.items) for (const id of Object.keys(item.elements)) ownerNow.set(id, item.label);

  const took = new Map<string, string[]>();
  const erased: CanvasEdit[] = [];
  for (const item of before.items) {
    if (now.has(item.label)) continue;
    const ids = Object.keys(item.elements);
    const into = new Map<string, number>();
    for (const id of ids) {
      const owner = ownerNow.get(id);
      if (owner) into.set(owner, (into.get(owner) ?? 0) + 1);
    }
    const kept = [...into.values()].reduce((a, b) => a + b, 0);
    const [most] = [...into].sort((a, b) => b[1] - a[1]);
    if (most && 2 * most[1] > ids.length) {
      took.set(most[0], [...(took.get(most[0]) ?? []), item.label]);
    } else if (2 * kept > ids.length) {
      // Taken apart: what it was read from now reads as several things, each told on its own.
    } else {
      erased.push({ actor, action: "erased", label: item.label, kind: item.kind, pen: item.pen, before: item.content });
    }
  }

  const rest = after.items.flatMap((item): CanvasEdit[] => {
    const base = { actor, label: item.label, kind: item.kind, pen: item.pen, ...(took.has(item.label) ? { took: took.get(item.label)! } : {}) };
    const prev = was.get(item.label);
    if (!prev) return [{ ...base, ...(item.ai ? { actor: "ai" as const } : {}), action: "added", after: item.content }];
    const how = howChanged(prev, item);
    if (how === "same") return [];
    if (how === "other" && sameContent(prev.content, item.content) && !base.took) return [];
    const action = how === "other" ? "changed" : how;
    return [{ ...base, action, before: prev.content, after: item.content }];
  });
  return [...erased, ...rest];
}

/**
 * The changes between two boards, the first read with `labels` and the
 * second with what that read left — the labels a chat would have. The sync
 * (lib/canvas/chatServer.ts) keeps the first board's snapshot rather than
 * reading it again.
 */
export function describeCanvasChanges(
  before: CanvasElement[], after: CanvasElement[], labels?: LabelMap, actor: EditActor = "user",
): { edits: CanvasEdit[]; labels: LabelMap; snapshot: BoardSnapshot } {
  const was = readCanvas(before, { labels });
  const now = readCanvas(after, { labels: was.labels });
  const snapshot = snapshotBoard(after, now.doc);
  return { edits: diffSnapshots(snapshotBoard(before, was.doc), snapshot, actor), labels: now.labels, snapshot };
}

const union = (a: string[] = [], b: string[] = []) => [...new Set([...a, ...b])];
const withTook = (edit: CanvasEdit, took: string[]): CanvasEdit => {
  const { took: _, ...rest } = edit;
  return took.length ? { ...rest, took } : rest;
};

/**
 * `next` folded into `prev`, the newest entry in the log, when it carries
 * on from it; null when it is a change of its own. It carries on when it is
 * about the same thing — more written into what was just added or changed,
 * a move continued — or when what `prev` was about is now part of it
 * (writing that became a matrix as more of it was written).
 */
export function mergeEdit(prev: CanvasEdit, next: CanvasEdit): CanvasEdit | null {
  if (prev.actor !== next.actor) return null;
  const writing = (e: CanvasEdit) => e.action === "added" || e.action === "changed";
  if (prev.label === next.label) {
    if (writing(prev) && next.action === "changed") return withTook({ ...prev, after: next.after }, union(prev.took, next.took));
    if (prev.action === next.action && (next.action === "moved" || next.action === "resized")) return { ...next, before: prev.before };
    return null;
  }
  if (writing(prev) && writing(next) && next.took?.includes(prev.label)) {
    // A label only ever told in `prev` needn't be named: it never reached the model.
    return withTook(next, union(prev.took, next.took).filter((l) => !(prev.action === "added" && l === prev.label)));
  }
  return null;
}

// ── as sentences ────────────────────────────────────────────────────────────

const CLIP = 120;
/** Typed text or handwriting in double quotes, as the reader prints it, on one line and clipped. */
const quote = (s = "") => {
  const line = s.replace(/\n/g, " / ");
  return `"${line.length > CLIP ? `${line.slice(0, CLIP - 1)}…` : line}"`;
};
const article = (word: string) => `${/^[aeiou]/.test(word) ? "an" : "a"} ${word}`;
/** "A", "A and B", "A, B and C". */
const list = (items: string[]) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);
const dims = (c: ItemContent) => `${c.cells?.length ?? 0}×${c.cells?.[0]?.length ?? 0}`;
const end = (t: string | null | undefined) => t ?? "a free end";

/** Where an arrow or line runs, a shape or mark sits: "from M3 to M4", "around X1". Empty when there's nothing to say. */
function relation(kind: ItemKind, c: ItemContent): string {
  const [a, b] = c.ends ?? [null, null];
  if (kind === "arrow") return c.form === "double" ? `between ${end(a)} and ${end(b)}` : `from ${end(a)} to ${end(b)}`;
  if (kind === "line") return `between ${end(a)} and ${end(b)}`;
  if (!c.targets?.length) return "";
  const t = list(c.targets);
  return kind === "underline" ? `under ${t}` : kind === "highlight" ? `over ${t}` : kind === "frame" ? `holding ${t}` : `around ${t}`;
}
const RELATIONAL: ItemKind[] = ["arrow", "line", "shape", "circle", "underline", "highlight"];

function added(who: string, e: CanvasEdit): string {
  const c = e.after ?? {};
  const L = e.label;
  const rel = relation(e.kind, c);
  switch (e.kind) {
    case "matrix": return `${who} added ${L} (a ${dims(c)} matrix)`;
    case "writing": return `${who} wrote ${L}: ${quote(c.text)}`;
    case "drawing": return `${who} drew ${L} (a pen drawing${c.labels?.length ? `, labelled ${c.labels.map(quote).join(", ")}` : ""})`;
    case "text": return `${who} added a text box ${L}: ${quote(c.text)}`;
    case "note": return `${who} added a sticky note ${L}: ${quote(c.text)}`;
    case "math": return `${who} added math ${L}: ${quote(c.text)}`;
    case "image": return `${who} added an image ${L}`;
    case "frame": return `${who} added a frame ${L} ${quote(c.text)}`;
    case "shape": return `${who} drew ${article(c.form ?? "shape")} ${L}${rel ? ` ${rel}` : ""}`;
    case "arrow": return `${who} drew ${c.form === "double" ? "a double-headed arrow" : "an arrow"} ${L} ${rel}`;
    case "line": return `${who} drew a line ${L} ${rel}`;
    case "circle": return c.targets?.length ? `${who} circled ${list(c.targets)} (${L})` : `${who} drew a circle ${L}`;
    case "underline": return c.targets?.length ? `${who} underlined ${list(c.targets)} (${L})` : `${who} drew an underline ${L}`;
    case "highlight": return c.targets?.length ? `${who} highlighted ${list(c.targets)} (${L})` : `${who} drew a highlighter stroke ${L}`;
    case "annotation": {
      const on = c.targets?.[0] ?? "the board";
      const what = c.form === "error" ? `marked ${on} as an error` : c.form === "check" ? `marked ${on} as right`
        : c.form === "hint" ? `left a hint on ${on}` : `left a note on ${on}`;
      return `${who} ${what} (${L}): ${quote(c.text)}`;
    }
  }
}

function changed(who: string, e: CanvasEdit): string {
  const [b, a] = [e.before ?? {}, e.after ?? {}];
  const L = e.label;
  if (sameContent(b, a)) return `${who} changed ${L}, then changed it back`;
  switch (e.kind) {
    case "matrix": {
      if (dims(b) !== dims(a)) return `${who} changed ${L}, now a ${dims(a)} matrix (was ${dims(b)})`;
      const cells = a.cells!.flatMap((row, r) => row.flatMap((v, c) => {
        const was = b.cells![r]![c]!;
        return v === was ? [] : [{ r: r + 1, c: c + 1, was: was || "empty", now: v || "empty" }];
      }));
      if (cells.length === 0) return `${who} changed the vertical bar${(a.bars?.length ?? 0) > 1 ? "s" : ""} in ${L}`;
      if (cells.length > 3) return `${who} changed ${cells.length} entries of ${L}`;
      return `${who} changed ${list(cells.map((x, i) => `${i === 0 ? `${L} ` : ""}row ${x.r} col ${x.c} from ${x.was} to ${x.now}`))}`;
    }
    case "drawing": {
      const how = (a.strokes ?? 0) > (b.strokes ?? 0) ? `drew more on ${L}` : (a.strokes ?? 0) < (b.strokes ?? 0) ? `erased part of ${L}` : `changed ${L}`;
      const labels = stable(a.labels) !== stable(b.labels) ? `, now labelled ${a.labels?.length ? a.labels.map(quote).join(", ") : "nothing"}` : "";
      return `${who} ${how}${labels}`;
    }
    case "frame": return a.text !== b.text ? `${who} renamed ${L} from ${quote(b.text)} to ${quote(a.text)}` : `${who} changed ${L}`;
    case "shape": if (a.form !== b.form) return `${who} changed ${L} into ${article(a.form ?? "shape")}`;
  }
  if (RELATIONAL.includes(e.kind)) {
    const rel = relation(e.kind, a);
    return `${who} changed ${L}${rel ? `, now ${rel}` : ""}`;
  }
  if (e.kind === "image") return `${who} changed ${L}`;
  return `${who} changed ${L} from ${quote(b.text)} to ${quote(a.text)}`;
}

function erased(who: string, e: CanvasEdit): string {
  const c = e.before ?? {};
  const what = e.kind === "matrix" ? ` (a ${dims(c)} matrix)` : c.text !== undefined && e.kind !== "frame" ? `: ${quote(c.text)}` : "";
  return `${who} ${e.pen ? "erased" : "deleted"} ${e.label}${what}`;
}

/**
 * One edit as a sentence: for the student's own log ("You added M9 (a 3×4
 * matrix)"), or for the model ("The student added M9 …"), which reads the
 * student's message as theirs, so "you" would be itself.
 */
export function describeEdit(edit: CanvasEdit, reader: "student" | "model" = "student"): string {
  const who = edit.actor === "ai" ? "Mola" : reader === "student" ? "You" : "The student";
  let text: string;
  switch (edit.action) {
    case "added": text = added(who, edit); break;
    case "changed": text = changed(who, edit); break;
    case "erased": text = erased(who, edit); break;
    case "moved": case "resized": {
      const rel = RELATIONAL.includes(edit.kind) && !sameContent(edit.before, edit.after) ? relation(edit.kind, edit.after ?? {}) : "";
      text = `${who} ${edit.action === "moved" ? "moved" : "resized"} ${edit.label}${rel ? `, now ${rel}` : ""}`;
      break;
    }
  }
  const took = edit.took ?? [];
  if (took.length === 0) return text;
  // A placed element read as something else now — a line given an arrowhead — keeps its element, so it "was" the old label.
  return edit.pen ? `${text}; ${list(took)} ${took.length === 1 ? "is" : "are"} now part of it` : `${text} (was ${list(took)})`;
}

/** The entries since the student's last message, as the section that goes before the board in what the model reads. */
export function changesSection(edits: CanvasEdit[]): string {
  return [
    "WHAT CHANGED ON THE BOARD (in order)",
    "What was done to the board since the student's last message, oldest first, by the labels the board text below uses:",
    ...edits.map((e) => `- ${describeEdit(e, "model")}`),
  ].join("\n");
}
