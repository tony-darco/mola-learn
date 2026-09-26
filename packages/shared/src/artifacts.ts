/**
 * CONTRACT 6 (part 1) — the artifact block schema.
 *
 * Agents E (flashcards), G (quizzes) and H (mind maps) PRODUCE artifacts;
 * agent A RENDERS them. This file is the frozen shape all four code against.
 * Read-only to agents — a needed change escalates to Tony.
 */
import { z } from "zod";

/** Every artifact traces back to the sources it was generated from (§6). */
export const sourceRefSchema = z.object({
  documentId: z.string().uuid(),
  /** Human-readable at render time without a join, e.g. "OSTEP ch.3". */
  documentTitle: z.string(),
  /** Free-form locator: "ch.3", "§2.1", "week 4", "pp. 40-52". */
  locator: z.string().nullable(),
  /** Chunk ordinals the generator actually consumed. Empty = whole document. */
  chunkOrdinals: z.array(z.number().int().nonnegative()).default([]),
});
export type SourceRef = z.infer<typeof sourceRefSchema>;

export const ARTIFACT_KINDS = ["flashcard_deck", "quiz", "mind_map", "canvas"] as const;
export const artifactKindSchema = z.enum(ARTIFACT_KINDS);
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

// ── Payloads, one per kind ───────────────────────────────────────────────────

export const flashcardSchema = z.object({
  id: z.string().uuid(),
  front: z.string().min(1),
  back: z.string().min(1),
  /** Metadata the per-course "cards by chapter" view depends on (§6). */
  chapter: z.string().nullable(),
  section: z.string().nullable(),
  week: z.number().int().positive().nullable(),
});

export const flashcardDeckPayloadSchema = z.object({
  kind: z.literal("flashcard_deck"),
  cards: z.array(flashcardSchema),
});

export const quizQuestionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("multiple_choice"),
    id: z.string().uuid(),
    prompt: z.string().min(1),
    options: z.array(z.string()).min(2),
    correctIndex: z.number().int().nonnegative(),
    explanation: z.string().nullable(),
  }),
  z.object({
    type: z.literal("short_answer"),
    id: z.string().uuid(),
    prompt: z.string().min(1),
    /** Rubric the evaluator grades against — not shown before an attempt. */
    expectedAnswer: z.string().min(1),
    explanation: z.string().nullable(),
  }),
]);

export const quizPayloadSchema = z.object({
  kind: z.literal("quiz"),
  questions: z.array(quizQuestionSchema),
  difficulty: z.enum(["intro", "standard", "hard"]),
});

export const mindMapNodeSchema = z.object({
  id: z.string(),
  label: z.string().min(1),
  parentId: z.string().nullable(),
  note: z.string().nullable(),
  /** Escalated to Tony directly (§ header) — per-node attribution, additive. */
  sources: z.array(sourceRefSchema).default([]),
});

export const mindMapPayloadSchema = z.object({
  kind: z.literal("mind_map"),
  rootId: z.string(),
  nodes: z.array(mindMapNodeSchema),
  /** Cross-links beyond the tree spine. Seeds the MVP+1 knowledge graph (§6). */
  edges: z
    .array(z.object({ from: z.string(), to: z.string(), label: z.string().nullable() }))
    .default([]),
});

// ── Canvas — an infinite whiteboard ──────────────────────────────────────────
//
// Elements sit at real (x, y) — deliberately no spatial grid/hex-tiling.
// "Addressable regions" (for a later phase where a model reads/annotates the
// canvas) are explicit `frame` elements other elements belong to via
// `parentId`, not a coordinate-derived index. `index` is a fractional-indexing
// key (see lib/canvas/order.ts) — sort with plain `<`, never localeCompare.

export const canvasDashStyleSchema = z.enum(["solid", "dashed", "dotted"]);
export const canvasFillStyleSchema = z.enum(["solid", "hachure", "crosshatch", "none"]);
export const canvasShapeKindSchema = z.enum(["rectangle", "ellipse", "triangle", "star"]);
export const canvasBackgroundPatternSchema = z.enum(["dots", "grid", "lines", "blank"]);

export const canvasElementBaseSchema = z.object({
  id: z.string().min(1),
  /** A frame element's id, or null — the only addressable-region mechanism. */
  parentId: z.string().nullable(),
  index: z.string().min(1),
  x: z.number(), y: z.number(),
  width: z.number().nonnegative(), height: z.number().nonnegative(),
  /** Always 0 in v1 — no rotate UI. Kept for forward compat. */
  rotation: z.number().default(0),
  opacity: z.number().min(0).max(1).default(1),
  /** Nothing writes "ai" yet — reserved for a later phase. */
  createdBy: z.enum(["user", "ai"]).default("user"),
});

export const canvasDrawElementSchema = canvasElementBaseSchema.extend({
  type: z.literal("draw"),
  props: z.object({
    /** Relative to the element's own (x, y) — moving it never rewrites these. */
    points: z.array(z.object({
      x: z.number(), y: z.number(),
      pressure: z.number().min(0).max(1).optional(),
    })).min(2),
    color: z.string().min(1),
    strokeWidth: z.number().positive(),
    /** Highlighter renders translucent, flat-capped, and wider — same points/color/strokeWidth fields, different rendering. */
    variant: z.enum(["pen", "highlighter"]).default("pen"),
    /** "solid" renders the tapered perfect-freehand ink; dashed/dotted fall
     * back to a plain stroked polyline (dashing a variable-width filled
     * outline doesn't read as a dashed line) — same visual language as the
     * line/shape tools' dash option. */
    dash: canvasDashStyleSchema.default("solid"),
  }),
});

export const canvasTextElementSchema = canvasElementBaseSchema.extend({
  type: z.literal("text"),
  props: z.object({
    text: z.string(),
    /** Font color. */
    color: z.string().min(1),
    fontSize: z.number().positive(),
    /** null = transparent (the original, paper-less look). */
    backgroundColor: z.string().nullable().default(null),
    bold: z.boolean().default(false),
    italic: z.boolean().default(false),
  }),
});

export const canvasFrameElementSchema = canvasElementBaseSchema.extend({
  type: z.literal("frame"),
  props: z.object({ name: z.string() }),
});

/** Line and arrow are the same element — start is (x,y), end is (x+endX, y+endY), relative like draw's points. */
export const canvasLineElementSchema = canvasElementBaseSchema.extend({
  type: z.literal("line"),
  props: z.object({
    endX: z.number(), endY: z.number(),
    color: z.string().min(1),
    strokeWidth: z.number().positive(),
    dash: canvasDashStyleSchema.default("solid"),
    startArrow: z.boolean().default(false),
    endArrow: z.boolean().default(false),
  }),
});

export const canvasShapeElementSchema = canvasElementBaseSchema.extend({
  type: z.literal("shape"),
  props: z.object({
    shapeKind: canvasShapeKindSchema,
    color: z.string().min(1),
    fillColor: z.string().nullable(),
    fillStyle: canvasFillStyleSchema.default("none"),
    strokeWidth: z.number().positive(),
    dash: canvasDashStyleSchema.default("solid"),
  }),
});

/** A sticky note — a distinct, filled-card element, not a text-tool style variant. */
export const canvasNoteElementSchema = canvasElementBaseSchema.extend({
  type: z.literal("note"),
  props: z.object({
    text: z.string(),
    /** Paper color. */
    color: z.string().min(1),
    textColor: z.string().default("#1c1b18"),
    fontSize: z.number().positive(),
    bold: z.boolean().default(false),
    italic: z.boolean().default(false),
  }),
});

/** LaTeX source, rendered via KaTeX and edited via the app's existing MathLive surface. */
export const canvasMathElementSchema = canvasElementBaseSchema.extend({
  type: z.literal("math"),
  props: z.object({
    latex: z.string(),
    color: z.string().min(1),
    fontSize: z.number().positive(),
  }),
});

export const canvasImageElementSchema = canvasElementBaseSchema.extend({
  type: z.literal("image"),
  props: z.object({
    url: z.string().min(1),
    naturalWidth: z.number().positive(),
    naturalHeight: z.number().positive(),
  }),
});

export const canvasElementSchema = z.discriminatedUnion("type", [
  canvasDrawElementSchema,
  canvasTextElementSchema,
  canvasFrameElementSchema,
  canvasLineElementSchema,
  canvasShapeElementSchema,
  canvasNoteElementSchema,
  canvasMathElementSchema,
  canvasImageElementSchema,
]);
export type CanvasElement = z.infer<typeof canvasElementSchema>;
export type CanvasDrawElement = z.infer<typeof canvasDrawElementSchema>;
export type CanvasLineElement = z.infer<typeof canvasLineElementSchema>;
export type CanvasShapeElement = z.infer<typeof canvasShapeElementSchema>;
export type CanvasNoteElement = z.infer<typeof canvasNoteElementSchema>;
export type CanvasMathElement = z.infer<typeof canvasMathElementSchema>;
export type CanvasImageElement = z.infer<typeof canvasImageElementSchema>;

export const canvasPayloadSchema = z.object({
  kind: z.literal("canvas"),
  elements: z.array(canvasElementSchema),
  viewport: z.object({ x: z.number(), y: z.number(), zoom: z.number().positive() }),
  background: z.object({
    pattern: canvasBackgroundPatternSchema,
    color: z.string().min(1),
  }).default({ pattern: "dots", color: "#ffffff" }),
});

export const artifactPayloadSchema = z.discriminatedUnion("kind", [
  flashcardDeckPayloadSchema,
  quizPayloadSchema,
  mindMapPayloadSchema,
  canvasPayloadSchema,
]);
export type ArtifactPayload = z.infer<typeof artifactPayloadSchema>;

// ── The persisted row ────────────────────────────────────────────────────────

/**
 * What the Artifacts page reads to reconstruct an artifact it never witnessed
 * being created. Self-contained by design: no replay of the originating chat.
 */
export const artifactRecordSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  courseId: z.string().uuid().nullable(),
  /** Chat it was born in, for "jump to conversation". Null once that chat is gone. */
  originChatId: z.string().uuid().nullable(),
  kind: artifactKindSchema,
  title: z.string().min(1),
  /** Powers topic search on the Artifacts page (§8) without parsing the payload. */
  topics: z.array(z.string()).default([]),
  sources: z.array(sourceRefSchema).default([]),
  payload: artifactPayloadSchema,
  version: z.number().int().positive(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type ArtifactRecord = z.infer<typeof artifactRecordSchema>;

// ── The tool-result envelope ─────────────────────────────────────────────────

/**
 * How a tool result signals "this is an artifact, render it as a block" rather
 * than "this is text, splice it into the reply".
 *
 * A sub-agent returns one of these as its final result; the parent loop persists
 * it and emits an `artifact` stream event. Producing agents never write to the
 * artifacts table directly — they return this envelope and let the loop persist,
 * so ownership stamping happens in exactly one place.
 */
export const artifactToolResultSchema = z.object({
  __artifact: z.literal(true),
  kind: artifactKindSchema,
  title: z.string().min(1),
  topics: z.array(z.string()).default([]),
  sources: z.array(sourceRefSchema).default([]),
  payload: artifactPayloadSchema,
  /** Set to amend an existing artifact; null creates a new one. */
  replacesArtifactId: z.string().uuid().nullable().default(null),
});
export type ArtifactToolResult = z.infer<typeof artifactToolResultSchema>;

export function isArtifactToolResult(v: unknown): v is ArtifactToolResult {
  return typeof v === "object" && v !== null && (v as { __artifact?: unknown }).__artifact === true;
}
