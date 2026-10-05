/**
 * Deterministic scoring of one canvas chat reply — the model's calls, run
 * through the tool as it ships (lib/canvas/annotate.ts) — against a board's
 * planted errors.
 *
 * The reply's tool calls are replayed through annotate(), in order, with a
 * fresh turn, on the read the run used: annotate() is deterministic but for
 * the new elements' ids, so the replay places, sends back and refuses just
 * what the reply did (run.ts checks it places the same).
 *
 * - hit: a placed annotation of kind error or hint on the planted error's
 *   strokes. Pinpointed: on those strokes and nothing else (a cell or word,
 *   not a whole row, matrix or line).
 * - false flag: a placed error annotation on none of the planted errors.
 * - right value: a hitting annotation's note has the correct value in it,
 *   once addresses ("M8", "row 1", "col 4", "R1", …) are taken out.
 * - invalid tool call: a call to another tool, or one with an annotation
 *   not in the tool's shape (kind, mark, note, target), or none at all.
 * - unresolved: an annotation in the tool's shape whose target the board
 *   doesn't have.
 * - asked to narrow: an error on a whole matrix, line, row or column, sent
 *   back once — then narrowed (to an entry or word of the same thing), sent
 *   again whole (and placed), or dropped.
 * - cap refusal: a call asking for more annotations than the reply had left.
 */
import { z } from "zod";
import { canvasAnnotationKindSchema, canvasAnnotationMarkSchema, type CanvasAnnotationElement } from "@mola/shared";
import { annotate, ANNOTATE_TOOL, newAnnotateTurn, type AnnotateBoard } from "@/lib/canvas/annotate";
import { resolveTarget } from "@/lib/canvas/textSyntax";
import type { PlantedError } from "./fixtures";

/** One model call in a reply, as run.ts records it. `offered`: the tool was offered — a call written without it isn't acted on. */
export type ModelCall = {
  offered: boolean; text: string; toolCalls: { name: string; input: unknown }[];
  latencyMs: number; stopReason: string | null; errors: string[];
};

const annotationSchema = z.object({ target: z.string(), kind: canvasAnnotationKindSchema, mark: canvasAnnotationMarkSchema, note: z.string() });

export type ToolCallScore = {
  call: number; name: string; input: unknown;
  /** What the model was told; null for a call that wasn't acted on. */
  result: string | null;
  placed: string[];
  refused: "shape" | "cap" | null;
  /** Why it is invalid, if it is. */
  invalid: string | null;
  narrowed: string[];
};

export type PlacedScore = { element: CanvasAnnotationElement; on: PlantedError["id"][]; pinpoints: PlantedError["id"][]; falseFlag: boolean };

export type ErrorScore = {
  hit: boolean; pinpointed: boolean;
  /** A hitting annotation's note has the correct value. */
  rightValue: boolean;
  /** Kinds of every placed annotation on it, hitting or not (a "check" on it calls it right). */
  kinds: string[];
};

export type ReplyScore = {
  toolCalls: ToolCallScore[];
  placed: PlacedScore[];
  errors: Record<PlantedError["id"], ErrorScore>;
  falseFlags: number;
  /** Annotations given across the reply, and those of them in the tool's shape whose target didn't resolve. */
  given: number;
  unresolved: number;
  invalidToolCalls: number;
  noToolCall: boolean;
  narrowed: { address: string; then: "narrowed" | "sent whole" | "dropped" }[];
  capRefusals: number;
};

/** The tool's input: an object, or (some models) its JSON as a string. */
function inputOf(input: unknown): unknown {
  if (typeof input !== "string") return input;
  try {
    return JSON.parse(input);
  } catch {
    return input;
  }
}

/** The note without addresses, which are full of small numbers. */
const withoutAddresses = (note: string) => note
  .replace(/\b(?:rows?|cols?|columns?|words?|steps?|entry|entries)\s*\d+(?:\s*(?:[-–—]|to|and)\s*\d+)?/gi, " ")
  .replace(/\b[A-Za-z]\d+\b/g, " ");
/** `value` is a whole number, as a string; "-1" doesn't count as 1, nor "12" or "1.5" as 1 — but "= 1." does. */
export const hasValue = (note: string, value: string) =>
  new RegExp(`(?<![\\d.\\-−])${value.replace("-", "\\-")}(?![\\d]|[.,]\\d)`).test(withoutAddresses(note));

export function scoreReply(calls: ModelCall[], board: AnnotateBoard, planted: PlantedError[]): ReplyScore {
  const turn = newAnnotateTurn();
  let n = 0;
  const makeId = () => `replayed-${++n}`;
  let given = 0;
  let unresolved = 0;

  const toolCalls = calls.flatMap((c, i) => c.toolCalls.map((t): ToolCallScore => {
    const base = { call: i + 1, name: t.name, input: t.input };
    if (!c.offered) return { ...base, result: null, placed: [], refused: null, invalid: null, narrowed: [] };
    if (t.name !== ANNOTATE_TOOL.name) return { ...base, result: "(another tool)", placed: [], refused: null, invalid: `called ${t.name}`, narrowed: [] };

    const list = (inputOf(t.input) as { annotations?: unknown } | null)?.annotations;
    const annotations = Array.isArray(list) ? list : [];
    given += annotations.length;
    const bad = annotations.filter((a) => !annotationSchema.safeParse(a).success).length;
    unresolved += annotations.filter((a) => {
      const p = annotationSchema.safeParse(a);
      return p.success && !resolveTarget(p.data.target, board).ok;
    }).length;

    const before = new Set(turn.askedToNarrow);
    const done = annotate(t.input, board, turn, makeId);
    const invalid = done.refused === "shape" ? "not in the tool's shape" : bad ? `${bad} of ${annotations.length} annotations not in the tool's shape` : null;
    return {
      ...base, result: done.result, placed: done.placed.map((e) => e.props.target), refused: done.refused ?? null, invalid,
      narrowed: [...turn.askedToNarrow].filter((a) => !before.has(a)),
    };
  }));

  const placed = turn.placed.map((element): PlacedScore => {
    const ids = new Set(element.props.targetIds);
    const on = planted.filter((e) => e.strokeIds.some((id) => ids.has(id))).map((e) => e.id);
    const pinpoints = planted.filter((e) => ids.size > 0 && [...ids].every((id) => e.strokeIds.includes(id))).map((e) => e.id);
    return { element, on, pinpoints, falseFlag: element.props.kind === "error" && on.length === 0 };
  });

  const errors = Object.fromEntries(planted.map((e) => {
    const onIt = placed.filter((p) => p.on.includes(e.id));
    const hitting = onIt.filter((p) => p.element.props.kind === "error" || p.element.props.kind === "hint");
    return [e.id, {
      hit: hitting.length > 0,
      pinpointed: hitting.some((p) => p.pinpoints.includes(e.id)),
      rightValue: hitting.some((p) => hasValue(p.element.props.note, e.correct)),
      kinds: onIt.map((p) => p.element.props.kind),
    }];
  })) as Record<PlantedError["id"], ErrorScore>;

  const narrowed = toolCalls.flatMap((t) => t.narrowed).map((address) => {
    const label = address.split(" ")[0]!;
    const targets = turn.placed.map((e) => e.props.target);
    const then = targets.includes(address) ? "sent whole" as const
      : targets.some((t) => t.startsWith(`${label} `)) ? "narrowed" as const : "dropped" as const;
    return { address, then };
  });

  const offered = toolCalls.filter((t) => t.result !== null);
  return {
    toolCalls, placed, errors,
    falseFlags: placed.filter((p) => p.falseFlag).length,
    given, unresolved,
    invalidToolCalls: offered.filter((t) => t.invalid).length,
    noToolCall: offered.length === 0,
    narrowed,
    capRefusals: offered.filter((t) => t.refused === "cap").length,
  };
}
