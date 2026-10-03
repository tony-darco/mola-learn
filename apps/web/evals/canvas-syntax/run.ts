/**
 * Canvas-syntax eval: can our models read handwriting that has been turned
 * into text (lib/canvas/textSyntax)?
 *
 *   Stage A — segment the handwritten matrix reduction and score the
 *             structure it recovers, then how well the recognizer reads each
 *             character; and read the full alphabet (alphabet.ts) the same
 *             way (no model involved).
 *   Stage B — hand each model the syntax text, ask for every matrix and
 *             label back as JSON, and score the answer against the truth.
 *             Under two conditions: "raw" (every character as a bitmap) and
 *             "normalized" (characters recognized; only unsure ones as bitmaps).
 *
 * Everything lands in output/<timestamp>/ as JSON, plus report.html.
 *
 *   pnpm --filter @mola/web eval:canvas
 *   pnpm --filter @mola/web eval:canvas --models gemma4:12b,mistral:latest --fixtures jitter --repeats 1
 *   pnpm --filter @mola/web eval:canvas --conditions raw,normalized
 *   pnpm --filter @mola/web eval:canvas --stage a                # no model calls
 *   pnpm --filter @mola/web eval:canvas --no-think               # thinking off for every model
 *   pnpm --filter @mola/web eval:canvas --max-call-minutes 10    # abort a call that runs longer, and stop the run
 *   pnpm --filter @mola/web eval:canvas --resume evals/canvas-syntax/output/<timestamp>   # finish a stopped run
 */
// First: it loads .env.local before anything can import lib/llm/ollama.ts.
import { ask } from "../ollama";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canvasHandwritingToText, type SyntaxRender } from "@/lib/canvas/textSyntax";
import { makeAlphabet, scoreAlphabet, sumAlphabet } from "./alphabet";
import { FIXTURES, makeFixture, type FixtureName } from "./fixtures";
import { leaderboard, parseReply, scoreNormalized, scoreStageA, scoreStageB, suggestedModel, summarizeDoc, type RunSummary, type StepMapping } from "./score";
import { loadStageB, writeReport } from "./report";

const here = fileURLToPath(new URL(".", import.meta.url));

// ── options ─────────────────────────────────────────────────────────────────

/** The candidates for canvas work. Any other Ollama tag can be passed with --models. */
const DEFAULT_MODELS = ["gemma4:26b", "gemma4:12b"];
const CONDITIONS: SyntaxRender[] = ["raw", "normalized"];

function readOptions() {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  const value = (flag: string) => {
    const i = args.findIndex((a) => a === flag || a.startsWith(`${flag}=`));
    if (i < 0) return undefined;
    return args[i]!.includes("=") ? args[i]!.split("=").slice(1).join("=") : args[i + 1];
  };
  const list = (flag: string) => value(flag)?.split(",").map((s) => s.trim()).filter(Boolean);
  const fixtures = (list("--fixtures") ?? ["clean", "jitter"]) as FixtureName[];
  for (const f of fixtures) if (!(f in FIXTURES)) throw new Error(`unknown fixture "${f}" (have: ${Object.keys(FIXTURES).join(", ")})`);
  // Raw bitmaps proved too slow and too hard for these models, so normalized is the default.
  const conditions = (list("--conditions") ?? ["normalized"]) as SyntaxRender[];
  for (const c of conditions) if (!CONDITIONS.includes(c)) throw new Error(`unknown condition "${c}" (have: ${CONDITIONS.join(", ")})`);
  const maxMinutes = value("--max-call-minutes");
  return {
    models: list("--models") ?? DEFAULT_MODELS,
    fixtures,
    conditions,
    repeats: Number(value("--repeats") ?? 2),
    stageAOnly: value("--stage") === "a",
    think: !args.includes("--no-think"),
    maxCallMs: maxMinutes === undefined ? undefined : Number(maxMinutes) * 60_000,
    /** An earlier run's directory: calls whose result file is already there are reused, not repeated. */
    resume: value("--resume"),
  };
}

// ── model call ──────────────────────────────────────────────────────────────

const SYSTEM = "You read handwriting from a whiteboard that has been converted to text. Answer with JSON only.";

// The example row is deliberately not one that occurs in the fixture (its
// first row, 1 1 1 6, repeats in six of the eight matrices) so copying the
// example earns nothing.
function buildPrompt(syntax: string): string {
  return `${syntax}

TASK
Transcribe everything handwritten above.
- For every matrix (M1, M2, ...), give its entries row by row, each entry as a string exactly as written, for example "-1" or "11".
- For every line of text (T1, T2, ...), give the text with single spaces between words.
Reply with ONLY a JSON object of this shape (the values shown are placeholders):
{"matrices": {"M1": [["7", "-4", "12", "9"], ...], ...}, "text": {"T1": "...", ...}}`;
}

// ── main ────────────────────────────────────────────────────────────────────

const opts = readOptions();
const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
const outDir = opts.resume ? resolve(opts.resume) : join(here, "output", stamp);
mkdirSync(outDir, { recursive: true });
const write = (name: string, data: unknown) => writeFileSync(join(outDir, name), `${JSON.stringify(data, null, 2)}\n`);
const safe = (s: string) => s.replace(/[^a-zA-Z0-9._-]/g, "_");
console.log(`canvas-syntax eval → ${outDir}`);

const prepared = new Map<FixtureName, { syntax: Record<SyntaxRender, string>; mapping: StepMapping }>();
const stageA: Record<string, unknown> = {};
for (const name of opts.fixtures) {
  const fx = FIXTURES[name];
  const { text: raw, doc } = canvasHandwritingToText(fx.elements, { render: "raw" });
  const { text: normalizedText } = canvasHandwritingToText(fx.elements, { render: "normalized" });
  const { metrics, mapping } = scoreStageA(fx.plan, doc);
  const normalized = scoreNormalized(fx.plan, doc, mapping);
  prepared.set(name, { syntax: { raw, normalized: normalizedText }, mapping });
  stageA[name] = { metrics, normalized };
  write(`stage-a.${name}.json`, {
    fixture: name, jitterSeed: fx.jitterSeed ?? null,
    syntax: { raw, normalized: normalizedText }, syntaxChars: { raw: raw.length, normalized: normalizedText.length },
    doc: summarizeDoc(doc), metrics, normalized, mapping, steps: fx.plan.steps, bounds: fx.plan.bounds, strokes: fx.plan.strokes,
  });
  const m = metrics;
  const g = normalized.glyphs;
  console.log(`stage A ${name}: matrices ${m.matrices.matched}/${m.matrices.expected} (found ${m.matrices.found}), shapes ${m.shapes.correct}/${m.shapes.expected}, `
    + `glyphs ${m.glyphs.correct}/${m.glyphs.expected}, cells ${m.cells.correct}/${m.cells.expected}, texts ${m.texts.correct}/${m.texts.expected}`);
  console.log(`stage A ${name}, normalized: glyphs read ${g.correct}/${g.expected} (uncertain ${g.fallback}, confidently wrong ${g.confidentWrong}), `
    + `cells ${normalized.cells.correct}/${normalized.cells.expected}, texts ${normalized.texts.correct}/${normalized.texts.expected}`
    + (normalized.confusions.length ? `; misread ${normalized.confusions.map((c) => `${c.expected}→${c.got} ×${c.count}`).join(", ")}` : ""));
}

// The recognizer was tuned on jitter seeds 1–20 (the jitter fixture is seed 1); these hands are unseen.
const matrixRecognition = (seed: number) => {
  const fx = makeFixture(`seed ${seed}`, seed);
  const { doc } = canvasHandwritingToText(fx.elements);
  return { seed, ...scoreNormalized(fx.plan, doc, scoreStageA(fx.plan, doc).mapping) };
};
const seeds = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
write("recognition-held-out.json", seeds(100, 149).map(matrixRecognition));

// The full alphabet: tuned on seeds 1–20 (of both fixtures); seeds 300–349 were first scored once tuning was frozen.
const alphabet = {
  clean: scoreAlphabet(makeAlphabet()),
  tuning: sumAlphabet(seeds(1, 20).map((s) => scoreAlphabet(makeAlphabet(s)))),
  heldOut: sumAlphabet(seeds(300, 349).map((s) => scoreAlphabet(makeAlphabet(s)))),
  matrixHeldOut: seeds(300, 349).map(matrixRecognition),
};
write("recognition-alphabet.json", alphabet);
for (const [name, m] of [["clean", alphabet.clean], ["seeds 1–20", alphabet.tuning], ["held out, seeds 300–349", alphabet.heldOut]] as const) {
  const g = m.glyphs;
  console.log(`alphabet ${name}: read ${g.correct}/${g.expected} (segmented ${g.segmented}), flagged ${g.flagged} (written offered for ${g.offered}), misread unflagged ${g.confidentWrong}, `
    + `scripts ${m.scripts.correct}/${m.scripts.expected} (+${m.scripts.falsePositives} false), lines ${m.lines.correct}/${m.lines.expected}`);
}
const mh = alphabet.matrixHeldOut.reduce((t, m) => ({ n: t.n + m.glyphs.expected, ok: t.ok + m.glyphs.correct, flagged: t.flagged + m.glyphs.fallback, wrong: t.wrong + m.glyphs.confidentWrong }), { n: 0, ok: 0, flagged: 0, wrong: 0 });
console.log(`matrix held out, seeds 300–349: read ${mh.ok}/${mh.n}, flagged ${mh.flagged}, misread unflagged ${mh.wrong}`);

if (!opts.stageAOnly) {
  const total = opts.models.length * opts.conditions.length * opts.fixtures.length * opts.repeats;
  let n = 0;
  // Grouped by model so each one loads once.
  models: for (const model of opts.models) {
    let warmedUp = false;
    for (const condition of opts.conditions) {
      for (const fixture of opts.fixtures) {
        const { syntax, mapping } = prepared.get(fixture)!;
        const prompt = buildPrompt(syntax[condition]);
        for (let run = 1; run <= opts.repeats; run++) {
          const file = `stage-b.${condition}.${fixture}.${safe(model)}.run${run}.json`;
          const label = `[${++n}/${total}] ${model} ${condition} ${fixture} run${run}`;
          if (existsSync(join(outDir, file))) {
            console.log(`${label}: reused from the earlier run`);
            continue;
          }
          if (!warmedUp) {
            // Load the model with the same options the timed calls use, so its first call isn't charged for it.
            const warm = await ask(model, false, SYSTEM, "Reply with {}", { maxTokens: 1 });
            console.log(`${model}: warmed up in ${(warm.latencyMs / 1000).toFixed(1)}s${warm.errors.length ? ` (${warm.errors.join("; ")})` : ""}`);
            warmedUp = true;
          }
          const call = await ask(model, opts.think, SYSTEM, prompt, { timeoutMs: opts.maxCallMs });
          const parsed = parseReply(call.raw);
          const { steps, scores } = scoreStageB(FIXTURES[fixture].plan.steps, mapping, parsed);
          const summary: RunSummary = {
            model, fixture, condition, run, validJson: parsed !== null, scores,
            latencyMs: call.latencyMs, stopReason: call.stopReason, errors: call.errors,
          };
          write(file, {
            ...summary, think: opts.think, firstTokenMs: call.firstTokenMs, attempts: call.attempts,
            prompt: { system: SYSTEM, user: prompt }, raw: call.raw, parsed, steps,
          });
          console.log(`${label}: ${(call.latencyMs / 1000).toFixed(1)}s `
            + `(first token ${call.firstTokenMs === null ? "never" : `${(call.firstTokenMs / 1000).toFixed(1)}s`}), `
            + `cells ${scores.cells.correct}/${scores.cells.total}, matrices ${scores.matrices.exact}/${scores.matrices.total}, `
            + `text ${scores.texts.exact}/${scores.texts.total}, json ${parsed ? "ok" : "INVALID"}, stop ${call.stopReason}`
            + (call.errors.length ? `, errors: ${call.errors.join("; ")}` : ""));
          if (call.timedOut) {
            console.log(`stopping: that call ran past ${opts.maxCallMs! / 60_000} minutes`);
            break models;
          }
        }
      }
    }
  }
}

// Every result in the directory counts — including ones reused from, or copied in from, earlier runs.
const runs: RunSummary[] = loadStageB(outDir);
const board = leaderboard(runs);
const suggested = suggestedModel(board, "normalized");
write("summary.json", {
  createdAt: new Date().toISOString(),
  options: {
    models: opts.models, fixtures: opts.fixtures, conditions: opts.conditions, repeats: opts.repeats,
    think: opts.think, maxCallMinutes: opts.maxCallMs === undefined ? null : opts.maxCallMs / 60_000,
  },
  stageA,
  runs: runs.map(({ model, fixture, condition, run, validJson, scores, latencyMs, stopReason, errors }) =>
    ({ model, fixture, condition, run, validJson, scores, latencyMs, stopReason, errors })),
  leaderboard: board, suggested,
});
if (suggested) console.log(`suggested canvas model: ${suggested.model} (${(suggested.cellAccuracy.mean * 100).toFixed(1)}% cells on jitter, normalized)`);
console.log(`report: ${writeReport(outDir)}`);
