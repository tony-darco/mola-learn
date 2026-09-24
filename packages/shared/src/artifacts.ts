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

export const ARTIFACT_KINDS = ["flashcard_deck", "quiz", "mind_map", "walkthrough"] as const;
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

// ── Walkthroughs — parametrized, interactive step-by-step explanations ──────
//
// A step's numbers are never baked in as static text — every "quantity" is a
// mathjs expression over the walkthrough's global, slider-driven parameters,
// re-evaluated client-side on every change. A step MAY also carry a "scene":
// one general motion primitive (bodies whose position is a function of time
// and the parameters, optional trails/vectors/scale bar) rather than a
// per-topic hardcoded diagram — the same scene renderer draws an orbit, a
// collision, or anything else "a quantity that moves". Expressions elsewhere
// (quantities, chart curves outside their independent var) may only
// reference declared parameters; expressions inside a scene may additionally
// reference the reserved symbol "t" — enforced server-side in the producing
// tool, not just shape-checked here.

export const walkthroughParameterSchema = z.object({
  name: z.string().min(1),
  label: z.string().min(1),
  unit: z.string().nullable(),
  default: z.number(),
  min: z.number(),
  max: z.number(),
  step: z.number().positive(),
});

export const walkthroughQuantitySchema = z.object({
  label: z.string().min(1),
  /** LaTeX for display, e.g. "\\tau = RC". Not evaluated — display only. */
  latex: z.string().min(1),
  /** mathjs expression over parameter names only, e.g. "R * C". */
  expression: z.string().min(1),
  unit: z.string().nullable(),
  /** e.g. "fixed:2" — decimal places to round the evaluated value to. */
  format: z.string().nullable(),
});

export const walkthroughSceneBodySchema = z.object({
  id: z.string().min(1),
  label: z.string().nullable(),
  /** mathjs expression over parameters only — fixed radius, doesn't animate. */
  radius: z.string().min(1),
  /** mathjs expressions over parameters ∪ {t}. */
  x: z.string().min(1),
  y: z.string().min(1),
  trail: z.boolean().default(false),
});

export const walkthroughSceneVectorSchema = z.object({
  /** Must match a body's id in the same scene. */
  fromBodyId: z.string().min(1),
  label: z.string().nullable(),
  /** mathjs expressions over parameters ∪ {t}. */
  dx: z.string().min(1),
  dy: z.string().min(1),
});

export const walkthroughSceneSchema = z.object({
  bodies: z.array(walkthroughSceneBodySchema).min(1),
  vectors: z.array(walkthroughSceneVectorSchema).default([]),
  scaleBar: z
    .object({
      /** mathjs expression over parameters only. */
      lengthWorldUnits: z.string().min(1),
      label: z.string().min(1),
    })
    .nullable(),
  /** mathjs expression over parameters only — one playback loop's length, seconds. */
  duration: z.string().min(1),
});

export const walkthroughChartCurveSchema = z.object({
  label: z.string().min(1),
  /** mathjs expression over parameters ∪ {[independentVar]}. */
  expression: z.string().min(1),
  colorRole: z.enum(["primary", "secondary"]),
});

export const walkthroughChartSchema = z.object({
  independentVar: z.string().min(1),
  /** [start, end] mathjs expressions over parameters only. */
  domain: z.tuple([z.string().min(1), z.string().min(1)]),
  curves: z.array(walkthroughChartCurveSchema).min(1),
  /** mathjs expression (parameters only) marking a point of interest on "static" charts. */
  markerAt: z.string().nullable(),
  /** "static": sample once across domain. "timeseries": scrolling window driven by scene playback. */
  mode: z.enum(["static", "timeseries"]),
});

export const walkthroughStepSchema = z.object({
  title: z.string().min(1),
  /** Markdown/KaTeX prose, rendered through the same pipeline as chat text. */
  body: z.string().min(1),
  quantities: z.array(walkthroughQuantitySchema).default([]),
  scene: walkthroughSceneSchema.nullable(),
  chart: walkthroughChartSchema.nullable(),
  /**
   * false (default): "t" resets to 0 when this step becomes active — a
   * fresh, standalone scenario. true: this step continues the same event as
   * the previous step (e.g. "watch it launch" -> "watch it reach apogee"),
   * so playback time carries over instead of restarting.
   */
  continuesFromPreviousStep: z.boolean().default(false),
});

export const walkthroughPayloadSchema = z.object({
  kind: z.literal("walkthrough"),
  /** Breadcrumb, e.g. "Physics / Orbital Mechanics". */
  subject: z.string().min(1),
  title: z.string().min(1),
  parameters: z.array(walkthroughParameterSchema).min(1),
  steps: z.array(walkthroughStepSchema).min(1),
});

export const artifactPayloadSchema = z.discriminatedUnion("kind", [
  flashcardDeckPayloadSchema,
  quizPayloadSchema,
  mindMapPayloadSchema,
  walkthroughPayloadSchema,
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
