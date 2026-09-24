/**
 * Walkthroughs — interactive, parametrized step-by-step explanations. Same
 * architecture as flashcards.ts/quizzes.ts/mindmaps.ts: create_walkthrough is
 * the only tool of this module registered on the main registry; it spins a
 * fresh sub-agent scoped to grep/bm25/vector_search plus a private
 * emit_walkthrough finishing tool that never reaches the top-level model's
 * own tool list.
 *
 * The model doesn't pick from a menu of diagram types — every step's
 * "scene" (if any) is the same one primitive: bodies whose position is a
 * mathjs expression of time and the walkthrough's global parameters,
 * optionally trailing a path or carrying a vector arrow. What IS enforced
 * server-side, beyond Zod shape validation: every expression's free symbols
 * must be a subset of the declared parameters (plus the reserved symbol "t"
 * for expressions inside a scene, plus a chart's own independent variable
 * for its curve expressions) — a model inventing a plausible-looking but
 * undefined variable is a real failure mode a shape check alone can't catch.
 */
import { z } from "zod";
import { type ArtifactToolResult, walkthroughPayloadSchema } from "@mola/shared";
import type { Tool, ToolContext } from "../registry";
import { ToolRegistry } from "../registry";
import { runSubagent } from "../subagent";
import { withCallLogging } from "@/lib/debug/tool-log";
import { grepSearchTool } from "./grep-search";
import { bm25SearchTool } from "./bm25-search";
import { vectorSearchTool } from "./vector-search";
import { assertSymbolsAllowed, evaluateExpression } from "@/lib/walkthrough/eval";

// See flashcards.ts's identical toolSourceRefSchema for why this exists.
const toolSourceRefSchema = z.object({
  documentId: z.string().uuid(),
  documentTitle: z.string(),
  locator: z.string().nullable(),
  chunkOrdinals: z.array(z.number().int().nonnegative()).optional(),
});

const emitParameterSchema = z.object({
  name: z.string().min(1).describe("Short identifier, e.g. \"R\" — referenced by expressions elsewhere"),
  label: z.string().min(1).describe("Display label, e.g. \"Resistance\""),
  unit: z.string().nullable().optional(),
  default: z.number(),
  min: z.number(),
  max: z.number(),
  step: z.number().describe("Slider increment, must be positive"),
});

const emitQuantitySchema = z.object({
  label: z.string().min(1),
  latex: z.string().min(1).describe("Display-only LaTeX, e.g. \"\\\\tau = RC\""),
  expression: z.string().min(1).describe("mathjs expression over parameter names ONLY, e.g. \"R * C\""),
  unit: z.string().nullable().optional(),
  format: z.string().nullable().optional().describe("e.g. \"fixed:2\" — decimal places"),
});

const emitBodySchema = z.object({
  id: z.string().min(1).describe("A short id you invent, e.g. \"planet\" — reused by vectors' fromBodyId"),
  label: z.string().nullable().optional(),
  radius: z.string().min(1).describe("mathjs expression over parameters ONLY — fixed size, does not depend on t"),
  x: z.string().min(1).describe("mathjs expression over parameters AND the reserved symbol t"),
  y: z.string().min(1).describe("mathjs expression over parameters AND the reserved symbol t"),
  trail: z.boolean().optional().describe("true to draw a fading path behind this body as t advances"),
});

const emitVectorSchema = z.object({
  fromBodyId: z.string().min(1).describe("Must equal the id of a body declared in the same scene"),
  label: z.string().nullable().optional(),
  dx: z.string().min(1).describe("mathjs expression over parameters AND t"),
  dy: z.string().min(1).describe("mathjs expression over parameters AND t"),
});

const emitSceneSchema = z.object({
  bodies: z.array(emitBodySchema).min(1),
  vectors: z.array(emitVectorSchema).optional(),
  scaleBar: z
    .object({
      lengthWorldUnits: z.string().min(1).describe("mathjs expression over parameters ONLY"),
      label: z.string().min(1),
    })
    .nullable()
    .optional(),
  duration: z.string().min(1).describe("mathjs expression over parameters ONLY — one playback loop's length in seconds"),
});

const emitChartSchema = z.object({
  independentVar: z.string().min(1).describe("Name of the chart's own x-axis symbol, e.g. \"t\" or \"x\""),
  domain: z.array(z.string().min(1)).length(2).describe("[startExpr, endExpr] — mathjs expressions over parameters ONLY"),
  curves: z.array(z.object({
    label: z.string().min(1),
    expression: z.string().min(1).describe("mathjs expression over parameters AND the chart's own independentVar"),
    colorRole: z.enum(["primary", "secondary"]),
  })).min(1),
  markerAt: z.string().nullable().optional().describe("mathjs expression over parameters ONLY, marks a point of interest"),
  mode: z.enum(["static", "timeseries"]).describe(
    "\"static\": plot the curve once across domain. \"timeseries\": scrolling live window as a scene plays — only valid on a step that also has a scene",
  ),
});

const emitStepSchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1).describe("Markdown/KaTeX prose explaining this step"),
  quantities: z.array(emitQuantitySchema).optional(),
  scene: emitSceneSchema.nullable().optional().describe("Attach only when this step's concept moves or evolves"),
  chart: emitChartSchema.nullable().optional(),
  continuesFromPreviousStep: z.boolean().optional().describe(
    "true only if this step is a continuation of the exact same scene/event as the previous step (playback time carries over); false (default) for a fresh or distinct scenario",
  ),
});

const emitInputSchema = z.object({
  title: z.string().min(1),
  subject: z.string().min(1).describe("Breadcrumb, e.g. \"Physics / Orbital Mechanics\""),
  topics: z.array(z.string()).optional(),
  sources: z.array(toolSourceRefSchema).optional(),
  parameters: z.array(emitParameterSchema).min(1),
  steps: z.array(emitStepSchema).min(1),
});

function checkExpr(expr: string, allowed: ReadonlySet<string>, scope: Record<string, number>): string | null {
  try {
    assertSymbolsAllowed(expr, allowed);
    evaluateExpression(expr, scope);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/**
 * Validates structural integrity beyond shape: every expression's symbols
 * are declared, and every expression actually evaluates. Returns the first
 * problem found, or null if the payload is sound.
 */
function findValidationError(input: z.infer<typeof emitInputSchema>): string | null {
  const paramNames = new Set(input.parameters.map((p) => p.name));
  const paramScope = Object.fromEntries(input.parameters.map((p) => [p.name, p.default]));

  for (const step of input.steps) {
    for (const q of step.quantities ?? []) {
      const err = checkExpr(q.expression, paramNames, paramScope);
      if (err) return `step "${step.title}", quantity "${q.label}": ${err}`;
    }

    if (step.scene) {
      const withT = new Set([...paramNames, "t"]);
      const scopeWithT = { ...paramScope, t: 0 };
      const bodyIds = new Set(step.scene.bodies.map((b) => b.id));

      for (const body of step.scene.bodies) {
        const radiusErr = checkExpr(body.radius, paramNames, paramScope);
        if (radiusErr) return `step "${step.title}", body "${body.id}" radius: ${radiusErr}`;
        const xErr = checkExpr(body.x, withT, scopeWithT);
        if (xErr) return `step "${step.title}", body "${body.id}" x: ${xErr}`;
        const yErr = checkExpr(body.y, withT, scopeWithT);
        if (yErr) return `step "${step.title}", body "${body.id}" y: ${yErr}`;
      }
      for (const v of step.scene.vectors ?? []) {
        if (!bodyIds.has(v.fromBodyId)) {
          return `step "${step.title}", vector fromBodyId "${v.fromBodyId}" does not match any body in this scene`;
        }
        const dxErr = checkExpr(v.dx, withT, scopeWithT);
        if (dxErr) return `step "${step.title}", vector from "${v.fromBodyId}" dx: ${dxErr}`;
        const dyErr = checkExpr(v.dy, withT, scopeWithT);
        if (dyErr) return `step "${step.title}", vector from "${v.fromBodyId}" dy: ${dyErr}`;
      }
      if (step.scene.scaleBar) {
        const err = checkExpr(step.scene.scaleBar.lengthWorldUnits, paramNames, paramScope);
        if (err) return `step "${step.title}", scaleBar: ${err}`;
      }
      const durationErr = checkExpr(step.scene.duration, paramNames, paramScope);
      if (durationErr) return `step "${step.title}", scene duration: ${durationErr}`;
    }

    if (step.chart) {
      const [startErr, endErr] = step.chart.domain.map((d) => checkExpr(d, paramNames, paramScope));
      if (startErr) return `step "${step.title}", chart domain start: ${startErr}`;
      if (endErr) return `step "${step.title}", chart domain end: ${endErr}`;
      if (step.chart.mode === "timeseries" && !step.scene) {
        return `step "${step.title}": a "timeseries" chart requires a scene on the same step`;
      }

      let domainStart: number;
      try {
        domainStart = evaluateExpression(step.chart.domain[0]!, paramScope);
      } catch {
        domainStart = 0;
      }
      const withIndep = new Set([...paramNames, step.chart.independentVar]);
      const scopeWithIndep = { ...paramScope, [step.chart.independentVar]: domainStart };
      for (const curve of step.chart.curves) {
        const err = checkExpr(curve.expression, withIndep, scopeWithIndep);
        if (err) return `step "${step.title}", chart curve "${curve.label}": ${err}`;
      }
      if (step.chart.markerAt) {
        const err = checkExpr(step.chart.markerAt, paramNames, paramScope);
        if (err) return `step "${step.title}", chart markerAt: ${err}`;
      }
    }
  }
  return null;
}

/**
 * Sub-agent-only — deliberately never passed to buildRegistry().
 */
const emitWalkthroughTool: Tool<z.infer<typeof emitInputSchema>> = {
  name: "emit_walkthrough",
  description: "Finalize the walkthrough. Call this exactly once, after research, with the complete step sequence.",
  inputSchema: emitInputSchema,
  label: () => "Writing walkthrough",

  async execute(input): Promise<ArtifactToolResult | { error: string }> {
    const validationError = findValidationError(input);
    if (validationError) {
      return { error: `${validationError} — call emit_walkthrough again with that fixed` };
    }

    const payload = walkthroughPayloadSchema.parse({
      kind: "walkthrough",
      subject: input.subject,
      title: input.title,
      parameters: input.parameters.map((p) => ({ ...p, unit: p.unit ?? null })),
      steps: input.steps.map((s) => ({
        title: s.title,
        body: s.body,
        quantities: (s.quantities ?? []).map((q) => ({ ...q, unit: q.unit ?? null, format: q.format ?? null })),
        scene: s.scene
          ? {
              bodies: s.scene.bodies.map((b) => ({ ...b, label: b.label ?? null, trail: b.trail ?? false })),
              vectors: (s.scene.vectors ?? []).map((v) => ({ ...v, label: v.label ?? null })),
              scaleBar: s.scene.scaleBar ?? null,
              duration: s.scene.duration,
            }
          : null,
        chart: s.chart
          ? {
              independentVar: s.chart.independentVar,
              domain: [s.chart.domain[0]!, s.chart.domain[1]!] as [string, string],
              curves: s.chart.curves,
              markerAt: s.chart.markerAt ?? null,
              mode: s.chart.mode,
            }
          : null,
        continuesFromPreviousStep: s.continuesFromPreviousStep ?? false,
      })),
    });

    return {
      __artifact: true,
      kind: "walkthrough",
      title: input.title,
      topics: input.topics ?? [],
      sources: (input.sources ?? []).map((s) => ({ ...s, chunkOrdinals: s.chunkOrdinals ?? [] })),
      payload,
      replacesArtifactId: null,
    };
  },
};

const createInputSchema = z.object({
  topic: z.string().min(1).describe("What the walkthrough should explain, e.g. \"two-body orbital motion\""),
});

const SYSTEM_PROMPT = `You are a walkthrough-writing agent for a university student's course materials.

A walkthrough is an interactive, parametrized step-by-step explanation — not
a static diagram, and not a wall of text. You have three search tools
(grep_search, bm25_search, vector_search) and one finishing tool
(emit_walkthrough).

When to attach a "scene" to a step vs. not:
- The concept moves or evolves over time (orbits, collisions, pendulums,
  projectile motion, growth/decay, anything with a natural time axis):
  attach a "scene" — bodies whose x/y are functions of time (the reserved
  symbol "t") and the walkthrough's parameters.
- The concept is a numeric relationship with no motion (a pure
  parameter-to-outcome formula): use "quantities" and optionally a "static"
  chart. No scene.
- Only use "chart" mode "timeseries" on a step that also has a scene — it's
  a live window of a curve value as the scene plays, not a standalone plot.

Rules:
- Budget your research: 3-5 search calls total is enough for a whole
  walkthrough. Research once, broadly, then build the whole thing from what
  you already have.
- Every step is grounded in something a tool actually returned — never
  invent a formula, constant, or relationship that didn't come from a
  retrieved chunk.
- 2-5 steps is usually right. Each step should earn its place — don't pad.
- Parameters are GLOBAL (shared by every step) and slider-driven — pick a
  default, min, max, and step size a student would actually want to drag.
- Every expression is a mathjs expression string. Outside a scene, it may
  reference ONLY the declared parameter names. Inside a scene's body x/y or
  vector dx/dy, it may ALSO reference "t". Never invent a variable that
  isn't a declared parameter (or "t" where allowed) — emit_walkthrough will
  reject it and tell you exactly what's wrong; fix that one thing and call
  it again.
- Bodies are circles; vectors and trails are lines. There is no box, icon,
  or other shape — don't describe one in "label" text as if it were drawn.
- Set continuesFromPreviousStep: true ONLY when a step is watching the same
  continuous event keep playing from where the last step left off (e.g.
  "watch it launch" -> "watch it reach apogee"). Leave it false (the
  default) for a fresh or logically distinct scenario, e.g. comparing two
  different orbital speeds side by side across steps.
- The moment you decide you have enough material, call emit_walkthrough IN
  THAT SAME TURN — do not send a text-only message announcing you're about
  to write it.
- If emit_walkthrough returns an error, fix exactly that problem and call it
  again — don't restart your research.
- Never use emoji, in any output, for any reason.

Example scene (a body orbiting the origin, params "orbitRadius" and "period"):
{"bodies": [{"id": "planet", "label": "Planet", "radius": "8", "x": "orbitRadius * cos(2 * pi * t / period)", "y": "orbitRadius * sin(2 * pi * t / period)", "trail": true}], "scaleBar": {"lengthWorldUnits": "orbitRadius", "label": "orbit radius"}, "duration": "period"}`;

export const createWalkthroughTool: Tool<z.infer<typeof createInputSchema>> = {
  name: "create_walkthrough",
  description:
    "Generate an interactive, parametrized walkthrough grounded in the student's course documents. Use when the " +
    "student's question has quantities or a system that evolves that they'd benefit from manipulating or watching " +
    "play out, rather than reading about — a formula with knobs to turn, an orbit, a collision, a growth curve, a " +
    "shift in a supply/demand relationship, and similar. Not for pure conceptual discussion.",
  inputSchema: createInputSchema,
  label: (input) => `Creating walkthrough: ${input.topic}`,

  async execute(input, ctx) {
    // This private sub-agent registry never passes through buildRegistry()
    // (tools/index.ts) — wrapped again here so its tool calls (research +
    // the final emit_walkthrough) still reach the debug logger.
    const subRegistry = new ToolRegistry()
      .register(withCallLogging(grepSearchTool))
      .register(withCallLogging(bm25SearchTool))
      .register(withCallLogging(vectorSearchTool))
      .register(withCallLogging(emitWalkthroughTool));

    // think:false — see mindmaps.ts's identical reasoning; building a
    // walkthrough from already-retrieved material doesn't need reasoning.
    const walkthroughCtx: ToolContext = { ...ctx, think: false };

    const { result } = await runSubagent(
      {
        label: `Building walkthrough "${input.topic}"`,
        systemPrompt: SYSTEM_PROMPT,
        briefing:
          `Create a walkthrough on: ${input.topic}\n\n` +
          `Research budget: 3-5 search calls total, then build the whole thing in a single emit_walkthrough call.`,
        toolAllowlist: ["grep_search", "bm25_search", "vector_search", "emit_walkthrough"],
        maxIterations: 30,
      },
      subRegistry,
      walkthroughCtx,
    );

    return result;
  },
};
