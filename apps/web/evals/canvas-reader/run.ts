/**
 * Canvas-reader eval: can our models answer questions about a whole canvas
 * from its read (lib/canvas/textSyntax/read.ts)?
 *
 * Builds the composite board (fixtures.ts) — the clean hand, and a jittered
 * one whose pen arrow has its head drawn in the same stroke — reads it
 * (normalized), checks the read against the board's truth (no model
 * involved), then asks each model every question in questions.ts at once
 * and scores each answer.
 *
 * Everything lands in output/<timestamp>/ as JSON, plus report.html.
 *
 *   pnpm --filter @mola/web eval:canvas-reader
 *   pnpm --filter @mola/web eval:canvas-reader --models gemma4:26b --fixtures clean   # a single probe call
 *   pnpm --filter @mola/web eval:canvas-reader --reader-only                          # no model calls
 *   pnpm --filter @mola/web eval:canvas-reader --no-think                             # thinking off for every model
 *   pnpm --filter @mola/web eval:canvas-reader --max-call-minutes 10                  # abort a call that runs longer, and stop the run
 *   pnpm --filter @mola/web eval:canvas-reader --resume evals/canvas-reader/output/<timestamp>   # finish a stopped run
 */
// First: it loads .env.local before anything can import lib/llm/ollama.ts.
import { ask } from "../ollama";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readCanvas } from "@/lib/canvas/textSyntax";
import { makeBoard, REGIONS, type BoardFixture } from "./fixtures";
import { buildPrompt, parseAnswers, scoreAnswers, SYSTEM } from "./questions";
import { leaderboard, loadRuns, writeReport, type QaRun } from "./report";
import { checkBoard } from "./score";

const here = fileURLToPath(new URL(".", import.meta.url));

const FIXTURES: Record<string, () => BoardFixture> = {
  clean: () => makeBoard("clean"),
  jitter: () => makeBoard("jitter", { jitterSeed: 1, penArrowHead: "joined" }),
};

function readOptions() {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  const value = (flag: string) => {
    const i = args.findIndex((a) => a === flag || a.startsWith(`${flag}=`));
    if (i < 0) return undefined;
    return args[i]!.includes("=") ? args[i]!.split("=").slice(1).join("=") : args[i + 1];
  };
  const list = (flag: string) => value(flag)?.split(",").map((s) => s.trim()).filter(Boolean);
  const fixtures = list("--fixtures") ?? Object.keys(FIXTURES);
  for (const f of fixtures) if (!(f in FIXTURES)) throw new Error(`unknown fixture "${f}" (have: ${Object.keys(FIXTURES).join(", ")})`);
  const maxMinutes = value("--max-call-minutes");
  return {
    // The models the app offers.
    models: list("--models") ?? ["gemma4:26b", "gemma4:12b"],
    fixtures,
    repeats: Number(value("--repeats") ?? 1),
    readerOnly: args.includes("--reader-only"),
    think: !args.includes("--no-think"),
    maxCallMs: maxMinutes === undefined ? undefined : Number(maxMinutes) * 60_000,
    /** An earlier run's directory: calls whose result file is already there are reused, not repeated. */
    resume: value("--resume"),
  };
}

const opts = readOptions();
const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
const outDir = opts.resume ? resolve(opts.resume) : join(here, "output", stamp);
mkdirSync(outDir, { recursive: true });
const write = (name: string, data: unknown) => writeFileSync(join(outDir, name), `${JSON.stringify(data, null, 2)}\n`);
const safe = (s: string) => s.replace(/[^a-zA-Z0-9._-]/g, "_");
console.log(`canvas-reader eval → ${outDir}`);

const reads = new Map<string, string>();
for (const name of opts.fixtures) {
  const board = FIXTURES[name]!();
  const { text, doc } = readCanvas(board.elements);
  const checks = checkBoard(board, doc);
  // A couple of selections of the clean board, to see what a scoped read looks like.
  const regions = name === "clean"
    ? Object.entries(REGIONS).map(([title, region]) => ({ title, region, text: readCanvas(board.elements, { region }).text }))
    : [];
  reads.set(name, text);
  write(`board.${name}.json`, {
    fixture: name, jitterSeed: board.jitterSeed ?? null, penArrowHead: board.penArrowHead,
    read: text, readChars: text.length, items: doc.items, checks, regions, elements: board.elements,
  });
  const failed = checks.filter((c) => !c.pass);
  console.log(`reader ${name}: ${checks.length - failed.length}/${checks.length} checks right`
    + (failed.length ? `; wrong: ${failed.map((c) => `${c.name} (${c.got})`).join("; ")}` : ""));
}

if (!opts.readerOnly) {
  const total = opts.models.length * opts.fixtures.length * opts.repeats;
  let n = 0;
  // Grouped by model so each one loads once.
  models: for (const model of opts.models) {
    let warmedUp = false;
    for (const fixture of opts.fixtures) {
      const prompt = buildPrompt(reads.get(fixture)!);
      for (let run = 1; run <= opts.repeats; run++) {
        const file = `qa.${fixture}.${safe(model)}.run${run}.json`;
        const label = `[${++n}/${total}] ${model} ${fixture} run${run}`;
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
        const parsed = parseAnswers(call.raw);
        const results = scoreAnswers(parsed);
        const result: QaRun = {
          model, fixture, run, think: opts.think, validJson: parsed !== null,
          passed: results.filter((r) => r.pass).length, total: results.length, results,
          latencyMs: call.latencyMs, firstTokenMs: call.firstTokenMs, stopReason: call.stopReason, errors: call.errors, attempts: call.attempts,
          prompt: { system: SYSTEM, user: prompt }, raw: call.raw, parsed,
        };
        write(file, result);
        console.log(`${label}: ${(call.latencyMs / 1000).toFixed(1)}s `
          + `(first token ${call.firstTokenMs === null ? "never" : `${(call.firstTokenMs / 1000).toFixed(1)}s`}), `
          + `${result.passed}/${result.total} right, json ${parsed ? "ok" : "INVALID"}, stop ${call.stopReason}`
          + (results.some((r) => !r.pass) ? `; wrong: ${results.filter((r) => !r.pass).map((r) => `${r.id}=${r.got}`).join(", ")}` : "")
          + (call.errors.length ? `, errors: ${call.errors.join("; ")}` : ""));
        if (call.timedOut) {
          console.log(`stopping: that call ran past ${opts.maxCallMs! / 60_000} minutes`);
          break models;
        }
      }
    }
  }
}

// Every result in the directory counts — including ones reused from an earlier run.
const board = leaderboard(loadRuns(outDir));
write("summary.json", {
  createdAt: new Date().toISOString(),
  options: {
    models: opts.models, fixtures: opts.fixtures, repeats: opts.repeats, think: opts.think,
    maxCallMinutes: opts.maxCallMs === undefined ? null : opts.maxCallMs / 60_000,
  },
  leaderboard: board,
});
for (const row of board) console.log(`${row.model} ${row.fixture}: ${(row.accuracy * 100).toFixed(1)}% right, ${(row.meanLatencyMs / 1000).toFixed(1)}s per call`);
console.log(`report: ${writeReport(outDir)}`);
