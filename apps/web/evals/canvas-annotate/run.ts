/**
 * Canvas-annotate eval: does the canvas chat, as it ships, find the mistakes
 * on a whiteboard and mark them?
 *
 * Each board (fixtures.ts: the matrix reduction with one wrong entry, and
 * "2 + 2 = 5") is read whole and sent with "Check my work." through the
 * canvas chat's own reply loop (lib/canvas/chatTurn.ts runCanvasTurn): its
 * system prompt and message format, the annotate_canvas tool with its cap of
 * 3 a reply and its ask-once-for-the-entry bounce (lib/canvas/annotate.ts),
 * the 3072-token cap on each call, thinking on — imported, not copied, so
 * this measures what ships. score.ts scores each reply; report.html shows
 * them beside the first run's numbers.
 *
 * The first run (2026-10-02T17-04-00) sent one call with the eval's own
 * tool, and set targets by labels against coordinates; labels won, so this
 * runs labels only.
 *
 *   pnpm --filter @mola/web eval:canvas-annotate --max-reply-minutes 10
 *   pnpm --filter @mola/web eval:canvas-annotate --boards clean --repeats 1   # a single probe reply
 *   pnpm --filter @mola/web eval:canvas-annotate --model gemma4:12b            # another model
 */
// First: it loads .env.local before anything can import lib/llm/ollama.ts.
import { ask, OllamaProvider } from "../ollama";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CanvasAnnotationElement, ProviderStreamEvent } from "@mola/shared";
import type { CompletionRequest, LLMProvider } from "@/lib/llm/types";
import { ANNOTATE_TOOL, MAX_ANNOTATIONS_PER_TURN } from "@/lib/canvas/annotate";
import { CANVAS_CHAT_SYSTEM, forModel, MAX_MODEL_CALLS, MAX_OUTPUT_TOKENS, runCanvasTurn } from "@/lib/canvas/chatTurn";
import { readCanvas } from "@/lib/canvas/textSyntax";
import { BOARDS, makeBoard, type BoardName } from "./fixtures";
import { writeReport, type BoardFile, type ReplyFile } from "./report";
import { scoreReply, type ModelCall } from "./score";

const here = fileURLToPath(new URL(".", import.meta.url));
const DEFAULT_MODEL = "gemma4:26b";
const MESSAGE = "Check my work.";

function readOptions() {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  const value = (flag: string) => {
    const i = args.findIndex((a) => a === flag || a.startsWith(`${flag}=`));
    if (i < 0) return undefined;
    return args[i]!.includes("=") ? args[i]!.split("=").slice(1).join("=") : args[i + 1];
  };
  const boards = (value("--boards")?.split(",").map((s) => s.trim()).filter(Boolean) ?? BOARDS) as BoardName[];
  for (const b of boards) if (!BOARDS.includes(b)) throw new Error(`unknown board "${b}" (have: ${BOARDS.join(", ")})`);
  const maxMinutes = value("--max-reply-minutes");
  return { model: value("--model") ?? DEFAULT_MODEL, boards, repeats: Number(value("--repeats") ?? 3), maxReplyMs: maxMinutes === undefined ? undefined : Number(maxMinutes) * 60_000 };
}

const describeError = (err: unknown) => {
  if (!(err instanceof Error)) return String(err);
  const cause = err.cause as { code?: string; message?: string } | undefined;
  return cause ? `${err.message} (${cause.code ?? cause.message})` : err.message;
};

/** The provider, recording each call it makes, every call cut off once the reply has run `signal` out. */
function recorded(signal: AbortSignal | undefined): { provider: LLMProvider; calls: ModelCall[] } {
  const inner = new OllamaProvider(MODEL, true);
  const calls: ModelCall[] = [];
  const provider: LLMProvider = {
    id: "eval",
    async *stream(req: CompletionRequest): AsyncIterable<ProviderStreamEvent> {
      const call: ModelCall = { offered: !!req.tools?.length, text: "", toolCalls: [], latencyMs: 0, stopReason: null, errors: [] };
      calls.push(call);
      const started = performance.now();
      try {
        for await (const ev of inner.stream({ ...req, ...(signal ? { signal } : {}) })) {
          if (ev.type === "text_delta") call.text += ev.text;
          else if (ev.type === "tool_call") call.toolCalls.push({ name: ev.name, input: ev.input });
          else if (ev.type === "done") call.stopReason = ev.stopReason;
          else if (ev.type === "error") call.errors.push(ev.message);
          yield ev;
        }
      } finally {
        call.latencyMs = Math.round(performance.now() - started);
      }
    },
  };
  return { provider, calls };
}

const opts = readOptions();
const MODEL = opts.model;
const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
const outDir = join(here, "output", stamp);
mkdirSync(outDir, { recursive: true });
const write = (name: string, data: unknown) => writeFileSync(join(outDir, name), `${JSON.stringify(data, null, 2)}\n`);
console.log(`canvas-annotate eval → ${outDir}`);

// ── the boards, read as the canvas chat reads them ──────────────────────────

const boards = opts.boards.map((name): BoardFile => {
  const b = makeBoard(name);
  return { ...b, sent: forModel({ text: readCanvas(b.elements).text, region: null }, MESSAGE) };
});
for (const b of boards) {
  write(`board.${b.name}.json`, b);
  console.log(`${b.name}: ${b.errors.map((e) => e.address).join(", ")}; read ${b.sent.length} chars`);
}

const createdAt = new Date().toISOString();
const writeSummary = (finishedAt: string | null) => write("summary.json", {
  createdAt, finishedAt, model: MODEL,
  options: { ...opts, maxReplyMinutes: opts.maxReplyMs === undefined ? null : opts.maxReplyMs / 60_000 },
  prompt: {
    system: CANVAS_CHAT_SYSTEM, message: MESSAGE, maxTokens: MAX_OUTPUT_TOKENS, tool: ANNOTATE_TOOL,
    maxAnnotations: MAX_ANNOTATIONS_PER_TURN, maxModelCalls: MAX_MODEL_CALLS,
  },
});
writeSummary(null);
writeReport(outDir);

// ── replies ─────────────────────────────────────────────────────────────────

// Load the model with the same options the timed calls use, so the first reply isn't charged for it.
const warm = await ask(MODEL, false, CANVAS_CHAT_SYSTEM, "Reply with OK", { maxTokens: 1 });
console.log(`${MODEL}: warmed up in ${(warm.latencyMs / 1000).toFixed(1)}s${warm.errors.length ? ` (${warm.errors.join("; ")})` : ""}`);

const total = opts.repeats * boards.length;
let n = 0;
replies: for (let repeat = 1; repeat <= opts.repeats; repeat++) {
  for (const b of boards) {
    const doc = readCanvas(b.elements).doc;
    const signal = opts.maxReplyMs ? AbortSignal.timeout(opts.maxReplyMs) : undefined;
    const { provider, calls } = recorded(signal);
    const placed: CanvasAnnotationElement[] = [];
    let text = "";
    let error: string | null;
    const started = performance.now();
    try {
      error = await runCanvasTurn({
        provider, system: CANVAS_CHAT_SYSTEM, messages: [{ role: "user", content: b.sent }], maxTokens: MAX_OUTPUT_TOKENS,
        board: () => ({ elements: b.elements, doc }),
        record: async () => {},
        send: (ev) => {
          if (ev.type === "annotation") placed.push(ev.element);
          if (ev.type === "text_delta") text += ev.text;
        },
      });
    } catch (err) {
      error = describeError(err);
    }
    const file: ReplyFile = {
      board: b.name, repeat, model: MODEL, latencyMs: Math.round(performance.now() - started), timedOut: !!signal?.aborted,
      error, text, calls, placed,
    };
    write(`reply.${b.name}.${repeat}.json`, file);
    writeReport(outDir);

    const s = scoreReply(calls, { elements: b.elements, doc }, b.errors);
    const replayed = s.placed.map((p) => `${p.element.props.kind} ${p.element.props.target}`);
    const actual = placed.map((e) => `${e.props.kind} ${e.props.target}`);
    if (replayed.join("|") !== actual.join("|")) console.warn(`  the replay placed ${replayed.join(", ")}, the reply ${actual.join(", ")}`);
    console.log(`[${++n}/${total}] ${b.name} #${repeat}: ${(file.latencyMs / 1000).toFixed(1)}s, ${calls.length} calls, `
      + `placed ${actual.join(", ") || "nothing"}; hits ${b.errors.map((e) => `${e.id} ${s.errors[e.id].hit ? "✓" : "✗"}`).join(" ")}, `
      + `${s.falseFlags} false flags, ${s.narrowed.length} asked to narrow, ${s.capRefusals} cap refusals${error ? `, error: ${error}` : ""}`);
    if (file.timedOut) {
      console.log(`stopping: that reply ran past ${opts.maxReplyMs! / 60_000} minutes`);
      break replies;
    }
  }
}

writeSummary(new Date().toISOString());
console.log(`report: ${writeReport(outDir)}`);
