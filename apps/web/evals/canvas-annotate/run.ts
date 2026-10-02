/**
 * Canvas-annotate eval: can a model find the mistakes on a whiteboard and
 * point at them with a tool call — and does it point better by the read's
 * labels ("M8 row 1 col 4") or by coordinates ({x, y})?
 *
 * Each board (fixtures.ts: the matrix reduction with one wrong entry, and
 * "2 + 2 = 5") is read whole, the way the canvas chat reads it
 * (app/api/canvas/[canvasId]/chat/route.ts: its system prompt, the board
 * text then the student's message, its 3072-token output cap, thinking on),
 * and sent with "Check my work." and one tool, annotate_canvas. In the label
 * condition a target is a label string; in the coordinate condition it is a
 * point, and the read also prints the box of every cell and word.
 * score.ts scores each call; report.html shows them.
 *
 *   pnpm --filter @mola/web eval:canvas-annotate --max-call-minutes 10
 *   pnpm --filter @mola/web eval:canvas-annotate --conditions label --boards clean --repeats 1   # a single probe call
 */
// First: it loads .env.local before anything can import lib/llm/ollama.ts.
import { ask } from "../ollama";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ToolSpec } from "@/lib/llm/types";
import { readCanvas } from "@/lib/canvas/textSyntax";
import { BOARDS, makeBoard, type BoardName } from "./fixtures";
import { writeReport, type BoardFile, type CallFile } from "./report";
import { CONDITIONS, KINDS, MARKS, scoreCall, TOOL_NAME, type Condition } from "./score";

const here = fileURLToPath(new URL(".", import.meta.url));
const MODEL = "gemma4:26b";

// The canvas chat's system prompt and output cap (app/api/canvas/[canvasId]/chat/route.ts), word for word.
const SYSTEM = [
  "You are Mola, a tutor looking at a student's whiteboard. You can't see the board itself: "
    + "each of the student's messages comes with the board converted to text — all of it, or only the part they selected.",
  "Refer to things on the board by their labels (M1, Q2, T3, …), and to parts of handwriting by place (\"M1 row 2 col 3\"), as the text explains. "
    + "If something you need is unreadable or missing from the text, say so rather than guessing.",
].join("\n\n");
const MAX_OUTPUT_TOKENS = 3072;

/** The canvas chat's canned "Check my work in this selection.", for a whole board. */
const MESSAGE = "Check my work.";
const userMessage = (read: string) => `${read}\n\nTHE STUDENT'S MESSAGE\n${MESSAGE}`;

/** The one tool, the same in both conditions but for its target. */
export function annotateTool(condition: Condition): ToolSpec {
  const target = condition === "label"
    ? {
      type: "string",
      description: "What to annotate, by its label or place in the board text: a whole item (\"M2\", \"T3\", \"N1\"), a matrix cell (\"M2 row 1 col 3\"), "
        + "a row or column (\"M2 row 1\", \"M2 col 3\"), a word (\"T3 word 2\") or words (\"T3 words 2-4\"). Point at the smallest part you mean.",
    }
    : {
      type: "object",
      properties: { x: { type: "number" }, y: { type: "number" } },
      required: ["x", "y"],
      description: "What to annotate, as a point on the board in canvas units, inside the box of the cell, word or item you mean. Point at the smallest part you mean.",
    };
  return {
    name: TOOL_NAME,
    description: "Mark things on the student's whiteboard, so they see your feedback right next to their work. "
      + "Each annotation points at one thing on the board, draws a mark on it, and shows a short note beside it.",
    parameters: {
      type: "object",
      properties: {
        annotations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              target,
              kind: { type: "string", enum: KINDS, description: "error: it is wrong. hint: a nudge to look at it again. check: it is right. note: anything else." },
              mark: { type: "string", enum: MARKS, description: "How to mark the target: circle it, underline it, draw a box round it, or no mark (the note alone)." },
              note: { type: "string", description: "What to tell the student about it, shown beside the mark. Short." },
            },
            required: ["target", "kind", "mark", "note"],
          },
        },
      },
      required: ["annotations"],
    },
  };
}

function readOptions() {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  const value = (flag: string) => {
    const i = args.findIndex((a) => a === flag || a.startsWith(`${flag}=`));
    if (i < 0) return undefined;
    return args[i]!.includes("=") ? args[i]!.split("=").slice(1).join("=") : args[i + 1];
  };
  const list = (flag: string) => value(flag)?.split(",").map((s) => s.trim()).filter(Boolean);
  const conditions = (list("--conditions") ?? CONDITIONS) as Condition[];
  const boards = (list("--boards") ?? BOARDS) as BoardName[];
  for (const c of conditions) if (!CONDITIONS.includes(c)) throw new Error(`unknown condition "${c}" (have: ${CONDITIONS.join(", ")})`);
  for (const b of boards) if (!BOARDS.includes(b)) throw new Error(`unknown board "${b}" (have: ${BOARDS.join(", ")})`);
  const maxMinutes = value("--max-call-minutes");
  return {
    conditions, boards,
    repeats: Number(value("--repeats") ?? 3),
    maxCallMs: maxMinutes === undefined ? undefined : Number(maxMinutes) * 60_000,
  };
}

const opts = readOptions();
const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
const outDir = join(here, "output", stamp);
mkdirSync(outDir, { recursive: true });
const write = (name: string, data: unknown) => writeFileSync(join(outDir, name), `${JSON.stringify(data, null, 2)}\n`);
console.log(`canvas-annotate eval → ${outDir}`);

// ── the boards, read both ways ──────────────────────────────────────────────

const boards = opts.boards.map((name): BoardFile => {
  const b = makeBoard(name);
  return {
    ...b,
    sent: {
      label: userMessage(readCanvas(b.elements).text),
      coordinate: userMessage(readCanvas(b.elements, { coordinates: true }).text),
    },
  };
});
for (const b of boards) {
  write(`board.${b.name}.json`, b);
  console.log(`${b.name}: ${b.errors.map((e) => e.address).join(", ")}; read ${b.sent.label.length} chars, with boxes ${b.sent.coordinate.length}`);
}

const createdAt = new Date().toISOString();
const writeSummary = (finishedAt: string | null) => write("summary.json", {
  createdAt, finishedAt, model: MODEL,
  options: { ...opts, maxCallMinutes: opts.maxCallMs === undefined ? null : opts.maxCallMs / 60_000 },
  prompt: { system: SYSTEM, message: MESSAGE, maxTokens: MAX_OUTPUT_TOKENS, tools: Object.fromEntries(opts.conditions.map((c) => [c, annotateTool(c)])) },
});
writeSummary(null);
writeReport(outDir);

// ── model calls ─────────────────────────────────────────────────────────────

// Load the model with the same options the timed calls use, so the first call isn't charged for it.
const warm = await ask(MODEL, false, SYSTEM, "Reply with OK", { maxTokens: 1 });
console.log(`${MODEL}: warmed up in ${(warm.latencyMs / 1000).toFixed(1)}s${warm.errors.length ? ` (${warm.errors.join("; ")})` : ""}`);

const total = opts.repeats * boards.length * opts.conditions.length;
let n = 0;
calls: for (let repeat = 1; repeat <= opts.repeats; repeat++) {
  for (const b of boards) {
    const doc = readCanvas(b.elements).doc;
    for (const condition of opts.conditions) {
      const call = await ask(MODEL, true, SYSTEM, b.sent[condition], { maxTokens: MAX_OUTPUT_TOKENS, timeoutMs: opts.maxCallMs, tools: [annotateTool(condition)] });
      const file: CallFile = {
        board: b.name, condition, repeat, model: MODEL,
        latencyMs: call.latencyMs, firstTokenMs: call.firstTokenMs, stopReason: call.stopReason, errors: call.errors,
        attempts: call.attempts, timedOut: call.timedOut, raw: call.raw, toolCalls: call.toolCalls,
      };
      write(`call.${b.name}.${condition}.${repeat}.json`, file);
      writeReport(outDir);
      const s = scoreCall(condition, call.toolCalls, doc, b.errors);
      console.log(`[${++n}/${total}] ${b.name} ${condition} #${repeat}: ${(call.latencyMs / 1000).toFixed(1)}s, `
        + `${s.valid ? "valid" : `INVALID (${s.problem})`}, ${s.annotations.length} annotations, `
        + `hits ${b.errors.map((e) => `${e.id} ${s.errors[e.id].hit ? "✓" : "✗"}`).join(" ")}, ${s.falseFlags} false flags, ${s.unresolved} unresolved`
        + `${call.errors.length ? `, errors: ${call.errors.join("; ")}` : ""}`);
      if (call.timedOut) {
        console.log(`stopping: that call ran past ${opts.maxCallMs! / 60_000} minutes`);
        break calls;
      }
    }
  }
}

writeSummary(new Date().toISOString());
console.log(`report: ${writeReport(outDir)}`);
