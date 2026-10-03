/**
 * The canvas chat's write tool, annotate_canvas: the model pins short notes
 * to the student's board — an icon for what the note is (an error, a hint,
 * a check, a note), a mark round the place it is on — and they show up on
 * the open canvas as the reply goes (chatTurn.ts sends each one out; the
 * canvas page adds it and saves it the way it saves anything).
 *
 * A place is named the way the board text names it — "M8 row 1 col 4",
 * "T2 word 5", "X1" — and resolved here against a read of the whole board
 * (resolveTarget), never given as coordinates. Whatever the model gets
 * wrong goes back to it as the tool's result, worded so it can fix it in
 * the same reply: an unknown label, a kind sent as the mark, …
 *
 * What the annotate eval (evals/canvas-annotate) saw gemma4:26b do, and
 * what this does about it:
 * - It marked whole matrices and lines rather than the entry or word that
 *   was wrong. An error on a whole handwritten block, or on a matrix row or
 *   column, of more than one entry is sent back once, asking for the entry;
 *   sent again unchanged, it is placed — sometimes all of it is wrong.
 * - It marked the same column of every step. A reply places at most
 *   MAX_ANNOTATIONS_PER_TURN, and a call asking for more than are left
 *   places none of them, so it has to choose rather than be cut off.
 * - It sent kind and mark mixed up (mark "check"): an error naming both.
 *
 * The AI only ever adds: nothing here can change or remove what is on the
 * board, its own annotations included.
 */
import {
  canvasAnnotationKindSchema, canvasAnnotationMarkSchema, type CanvasAnnotationElement, type CanvasElement,
} from "@mola/shared";
import type { ToolSpec } from "@/lib/llm/types";
import { nextIndexAfterAll } from "./order";
import { resolveTarget, type CanvasDoc, type ResolvedTarget } from "./textSyntax";
import { blockWords } from "./textSyntax/relations";

/**
 * Three: what a reply marks is what the student looks at first, and a few
 * marks say more than many. The eval boards hold one or two mistakes; in
 * worked steps the first mistake carries into every step after it, so it
 * is the one worth marking; and three leaves room for a mistake, a hint
 * and a check without covering the board.
 */
export const MAX_ANNOTATIONS_PER_TURN = 3;

type Kind = CanvasAnnotationElement["props"]["kind"];
type Mark = CanvasAnnotationElement["props"]["mark"];
const KINDS: readonly string[] = canvasAnnotationKindSchema.options;
const MARKS: readonly string[] = canvasAnnotationMarkSchema.options;

export const ANNOTATE_TOOL: ToolSpec = {
  name: "annotate_canvas",
  description: "Pin short notes to the student's whiteboard, right beside their work. Each annotation points at one place on the board, "
    + "draws a mark round it, and shows an icon for its kind; the student opens the note from the icon. "
    + `They appear on the board as soon as you send them. At most ${MAX_ANNOTATIONS_PER_TURN} per reply. `
    + "Annotations only add to the board: nothing on it can be changed or erased, your own annotations included.",
  parameters: {
    type: "object",
    properties: {
      annotations: {
        type: "array",
        items: {
          type: "object",
          properties: {
            target: {
              type: "string",
              description: "The place, as the board text names it: a matrix entry (\"M2 row 1 col 3\"), a word (\"T3 word 2\") or words (\"T3 words 2-4\"), "
                + "a row or column (\"M2 row 1\", \"M2 col 3\"), or a whole item (\"M2\", \"X1\"). "
                + "Point at the smallest place that holds what you mean: the one entry or word that is wrong, not the whole matrix or line.",
            },
            kind: {
              type: "string", enum: KINDS,
              description: "What the note says about the place. error: it is wrong. hint: a nudge to look at it again. check: it is right. note: anything else.",
            },
            mark: {
              type: "string", enum: MARKS,
              description: "How the place is drawn round: circle, underline, box, or none (the icon alone). Not the kind.",
            },
            note: { type: "string", description: "What the student reads, beside the mark: a sentence or two." },
          },
          required: ["target", "kind", "mark", "note"],
        },
      },
    },
    required: ["annotations"],
  },
};

/** The board as the model was shown it: its elements, and a read of all of it with the chat's labels. */
export type AnnotateBoard = { elements: CanvasElement[]; doc: CanvasDoc };

/** What a reply has annotated so far, and the coarse places it has been asked once to narrow down. */
export type AnnotateTurn = { placed: CanvasAnnotationElement[]; askedToNarrow: Set<string> };
export const newAnnotateTurn = (): AnnotateTurn => ({ placed: [], askedToNarrow: new Set() });

type Place = { kind: Kind; mark: Mark; note: string; target: Extract<ResolvedTarget, { ok: true }> };

const MARKED: Record<Mark, string> = { circle: "circled", underline: "underlined", box: "boxed", none: "no mark" };
const KIND_OR_MARK = "kind is what the note says about the place (error, hint, check or note); mark is how the place is drawn round (circle, underline, box or none)";
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The annotations asked for: `{annotations: [...]}`, or the same as JSON text. */
function annotationsOf(input: unknown): unknown[] | null {
  let value = input;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  const list = value && typeof value === "object" ? (value as { annotations?: unknown }).annotations : undefined;
  return Array.isArray(list) && list.length > 0 ? list : null;
}

/** One annotation as asked for: where it goes, or everything wrong with it. */
function check(given: unknown, doc: CanvasDoc): { place: Place } | { problem: string } {
  const a = (given && typeof given === "object" ? given : {}) as Record<string, unknown>;
  const problems: string[] = [];
  const { kind, mark } = a;
  if (typeof kind !== "string" || !KINDS.includes(kind)) {
    problems.push(typeof kind === "string" && MARKS.includes(kind) ? `kind "${kind}" is a mark, not a kind: ${KIND_OR_MARK}` : `kind must be one of ${KINDS.join(", ")}`);
  }
  if (typeof mark !== "string" || !MARKS.includes(mark)) {
    problems.push(typeof mark === "string" && KINDS.includes(mark) ? `mark "${mark}" is a kind, not a mark: ${KIND_OR_MARK}` : `mark must be one of ${MARKS.join(", ")}`);
  }
  const note = typeof a.note === "string" ? a.note.trim() : "";
  if (!note) problems.push("the note is missing: say in a sentence what the student should see");

  let target: Place["target"] | null = null;
  if (typeof a.target !== "string" || !a.target.trim()) {
    problems.push(`the target is missing: name a place from the board text, like "M1 row 2 col 3" or "T1 word 2"`);
  } else {
    const resolved = resolveTarget(a.target, { doc });
    const label = resolved.ok ? resolved.address.split(" ")[0]! : "";
    if (!resolved.ok) problems.push(resolved.error);
    else if (doc.items.find((i) => i.label === label)?.kind === "annotation") problems.push(`${label} is one of your own annotations: point at the student's work`);
    else target = resolved;
  }
  return problems.length > 0 || !target ? { problem: problems.join("; ") } : { place: { kind: kind as Kind, mark: mark as Mark, note, target } };
}

/**
 * Why an error on this place is too coarse to place before asking: it is
 * a whole handwritten matrix or line, or a matrix row or column, of more
 * than one entry or word. Null when it isn't.
 */
function tooCoarse({ kind, target }: Place, doc: CanvasDoc): string | null {
  if (kind !== "error") return null;
  const [label, ...rest] = target.address.split(" ");
  const block = doc.handwriting.blocks.find((b) => b.id === label);
  if (!block) return null;
  const again = `— or, if all of ${target.address} is wrong, send this annotation again unchanged`;
  if (rest.length === 0) {
    const n = blockWords(block).length;
    if (n < 2) return null;
    return block.kind === "matrix"
      ? `${label} is a whole matrix of ${n} entries: point at the entry that is wrong, as "${label} row … col …" ${again}`
      : `${label} is a whole line of ${n} words: point at the word or words that are wrong, as "${label} word …" or "${label} words …–…" ${again}`;
  }
  const line = /^(row|col) (\d+)$/.exec(rest.join(" "));
  if (!line || block.kind !== "matrix") return null;
  const i = Number(line[2]) - 1;
  const n = (line[1] === "row" ? block.rows[i]!.cells : block.rows.map((r) => r.cells[i])).filter(Boolean).length;
  return n < 2 ? null : `${target.address} is ${n} entries: point at the one that is wrong, as "${label} row … col …" ${again}`;
}

const sameAs = (p: Place) => (e: CanvasAnnotationElement) => e.props.kind === p.kind && e.props.target === p.target.address;
const told = (p: Place) => `${p.kind} on ${p.target.address}, ${MARKED[p.mark]}`;

/**
 * One annotate_canvas call: the annotations placed — each a new element, on
 * top of the board as the model saw it — and the tool's result for the
 * model, saying what was placed, what wasn't and why, and how many more
 * this reply can place. Records what it placed in `turn`.
 */
export function annotate(
  input: unknown, board: AnnotateBoard, turn: AnnotateTurn, makeId: () => string = () => crypto.randomUUID(),
): { placed: CanvasAnnotationElement[]; result: string } {
  const given = annotationsOf(input);
  if (!given) {
    return { placed: [], result: `error: send the annotations as {"annotations": [{"target": "…", "kind": "…", "mark": "…", "note": "…"}]}, one or more of them` };
  }

  const checked = given.map((a) => check(a, board.doc));
  const left = MAX_ANNOTATIONS_PER_TURN - turn.placed.length;
  const fresh = checked.filter((c) => !("place" in c && turn.placed.some(sameAs(c.place)))).length;
  if (fresh > left) {
    return {
      placed: [],
      result: `error: nothing was placed. A reply can place at most ${MAX_ANNOTATIONS_PER_TURN} annotations, and ${left === 0 ? "this one has placed them all" : `${plural(left, "is", "are")} left`}, `
        + `but this call asked for ${fresh}. ${left === 0 ? "Say anything else in your reply." : "Choose the ones that matter most — in worked steps, the first mistake — and send only those."}`,
    };
  }

  const placed: CanvasAnnotationElement[] = [];
  const already: string[] = [];
  const problems: string[] = [];
  checked.forEach((c, i) => {
    const which = `annotation ${i + 1}${typeof (given[i] as { target?: unknown })?.target === "string" ? ` ("${(given[i] as { target: string }).target}")` : ""}`;
    if ("problem" in c) return void problems.push(`${which}: ${c.problem}`);
    const p = c.place;
    if ([...turn.placed, ...placed].some(sameAs(p))) return void already.push(told(p));
    const narrow = tooCoarse(p, board.doc);
    if (narrow && !turn.askedToNarrow.has(p.target.address)) {
      turn.askedToNarrow.add(p.target.address);
      return void problems.push(`${which}: ${narrow}`);
    }
    const { box, address, elementIds } = p.target;
    placed.push({
      id: makeId(), parentId: null, index: nextIndexAfterAll([...board.elements, ...turn.placed, ...placed]),
      x: box.minX, y: box.minY, width: box.maxX - box.minX, height: box.maxY - box.minY,
      rotation: 0, opacity: 1, createdBy: "ai", type: "annotation",
      props: { kind: p.kind, mark: p.mark, note: p.note, target: address, targetIds: elementIds },
    });
  });
  turn.placed.push(...placed);

  const remaining = MAX_ANNOTATIONS_PER_TURN - turn.placed.length;
  const lines = [
    placed.length > 0
      ? `Placed ${plural(placed.length, "annotation", "annotations")} on the board, for the student to see now:`
      : "Nothing was placed.",
    ...placed.map((e) => `- ${e.props.kind} on ${e.props.target}, ${MARKED[e.props.mark]}`),
    ...(already.length > 0 ? ["Already on the board from earlier in this reply, so not placed again:", ...already.map((t) => `- ${t}`)] : []),
    ...(problems.length > 0 ? ["Not placed — fix these and send them again if they still matter:", ...problems.map((t) => `- ${t}`)] : []),
    remaining > 0
      ? `${plural(remaining, "more annotation", "more annotations")} can be placed in this reply.`
      : "That is all the annotations this reply can place; say anything else in your reply.",
  ];
  return { placed, result: lines.join("\n") };
}
