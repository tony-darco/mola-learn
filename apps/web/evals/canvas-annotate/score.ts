/**
 * Deterministic scoring of one annotate_canvas call against a board's
 * planted errors. Targets are resolved the way the real tool will resolve
 * them (lib/canvas/textSyntax/targets.ts), against a read of the board.
 *
 * - valid: at least one tool call, every one of them annotate_canvas with an
 *   `annotations` array, and every annotation in the shape the tool asks for.
 * - hit: an annotation of kind "error" or "hint" whose resolved strokes
 *   overlap the planted error's, or (coordinate condition) whose point is
 *   inside the error's box as the read prints it. Pinpointed: it resolves to
 *   the error's strokes and nothing else (a cell or word, not a whole matrix
 *   or line).
 * - false flag: an "error" annotation that resolves, but to none of the
 *   planted errors.
 * - right value: a hitting annotation's note has the correct value in it,
 *   once addresses ("M8", "row 1", "col 4", "R1", …) are taken out.
 */
import { z } from "zod";
import { resolveTarget, type ResolvedTarget } from "@/lib/canvas/textSyntax";
import { outward } from "@/lib/canvas/textSyntax/handwriting";
import type { CanvasDoc } from "@/lib/canvas/textSyntax/read";
import type { PlantedError } from "./fixtures";

export type Condition = "label" | "coordinate";
export const CONDITIONS: Condition[] = ["label", "coordinate"];
export const KINDS = ["error", "hint", "check", "note"] as const;
export const MARKS = ["circle", "underline", "box", "none"] as const;
export const TOOL_NAME = "annotate_canvas";

const point = z.object({ x: z.number(), y: z.number() });
const annotationSchema = (condition: Condition) => z.object({
  target: condition === "label" ? z.string() : point,
  kind: z.enum(KINDS),
  mark: z.enum(MARKS),
  note: z.string(),
});
export type Annotation = { target: string | { x: number; y: number }; kind: (typeof KINDS)[number]; mark: (typeof MARKS)[number]; note: string };

export type ScoredAnnotation = {
  /** As the model sent it. */
  given: unknown;
  /** Null when it isn't in the tool's shape; `problem` says why. */
  annotation: Annotation | null;
  problem: string | null;
  resolved: ResolvedTarget | null;
  /** The planted errors its target is on. */
  on: PlantedError["id"][];
  pinpoints: PlantedError["id"][];
  falseFlag: boolean;
};

export type ErrorScore = {
  hit: boolean; pinpointed: boolean;
  /** A hitting annotation's note has the correct value. */
  rightValue: boolean;
  /** Kinds of every annotation on it, hitting or not (a "check" on it calls it right). */
  kinds: string[];
};

export type CallScore = {
  valid: boolean;
  /** Why the call is invalid. */
  problem: string | null;
  annotations: ScoredAnnotation[];
  errors: Record<PlantedError["id"], ErrorScore>;
  falseFlags: number;
  unresolved: number;
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

export function scoreCall(
  condition: Condition, toolCalls: { name: string; input: unknown }[], doc: CanvasDoc, planted: PlantedError[],
): CallScore {
  const problems: string[] = [];
  if (toolCalls.length === 0) problems.push("no tool call");
  const given = toolCalls.flatMap((call) => {
    if (call.name !== TOOL_NAME) {
      problems.push(`called ${call.name}`);
      return [];
    }
    const input = inputOf(call.input) as { annotations?: unknown } | null;
    if (!input || typeof input !== "object" || !Array.isArray(input.annotations)) {
      problems.push("no annotations array");
      return [];
    }
    return input.annotations as unknown[];
  });

  const schema = annotationSchema(condition);
  const annotations = given.map((g): ScoredAnnotation => {
    const parsed = schema.safeParse(g);
    if (!parsed.success) {
      const problem = parsed.error.issues.map((i) => `${i.path.join(".") || "annotation"}: ${i.message}`).join("; ");
      return { given: g, annotation: null, problem, resolved: null, on: [], pinpoints: [], falseFlag: false };
    }
    const a = parsed.data as Annotation;
    const resolved = resolveTarget(a.target, { doc });
    const ids = new Set(resolved.ok ? resolved.elementIds : []);
    const inBox = (e: PlantedError) => {
      if (typeof a.target === "string") return false;
      const b = outward(e.box);
      return a.target.x >= b.minX && a.target.x <= b.maxX && a.target.y >= b.minY && a.target.y <= b.maxY;
    };
    const on = planted.filter((e) => e.strokeIds.some((id) => ids.has(id)) || inBox(e)).map((e) => e.id);
    const pinpoints = planted.filter((e) => resolved.ok && ids.size > 0 && [...ids].every((id) => e.strokeIds.includes(id))).map((e) => e.id);
    return { given: g, annotation: a, problem: null, resolved, on, pinpoints, falseFlag: a.kind === "error" && resolved.ok && on.length === 0 };
  });
  const bad = annotations.filter((a) => a.problem).length;
  if (bad) problems.push(`${bad} of ${annotations.length} annotations not in the tool's shape`);

  const errors = Object.fromEntries(planted.map((e) => {
    const onIt = annotations.filter((a) => a.on.includes(e.id));
    const hitting = onIt.filter((a) => a.annotation!.kind === "error" || a.annotation!.kind === "hint");
    return [e.id, {
      hit: hitting.length > 0,
      pinpointed: hitting.some((a) => a.pinpoints.includes(e.id)),
      rightValue: hitting.some((a) => hasValue(a.annotation!.note, e.correct)),
      kinds: onIt.map((a) => a.annotation!.kind),
    }];
  })) as Record<PlantedError["id"], ErrorScore>;

  return {
    valid: problems.length === 0, problem: problems.length ? problems.join("; ") : null, annotations, errors,
    falseFlags: annotations.filter((a) => a.falseFlag).length,
    unresolved: annotations.filter((a) => a.resolved && !a.resolved.ok).length,
  };
}
