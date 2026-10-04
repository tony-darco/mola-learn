/**
 * Canvas-understanding eval: what do our models make of the reader's text
 * (lib/canvas/textSyntax/read.ts) for one part of a whiteboard? Nothing is
 * scored — report.html puts each section as drawn beside every model's
 * answer, to be judged by eye.
 *
 * Loads the two saved boards (written by canvas-reader-board.spec.ts and
 * canvas-diagram-board.spec.ts), reads each section's rectangle the way the
 * canvas chat does (app/api/canvas/[canvasId]/chat/route.ts: normalized, its
 * system prompt, the board text then the student's message), and asks every
 * model the same open question about it. Calls run model by model — the
 * diagram board's neat sections, then its shaky ones, then the reader board —
 * and each one's JSON and a fresh report.html are written as soon as it ends,
 * so a run in progress can already be read.
 *
 *   pnpm --filter @mola/web eval:canvas-understanding
 *   pnpm --filter @mola/web eval:canvas-understanding --models gemma4:26b --sections co2-neat   # a single probe call
 *   pnpm --filter @mola/web eval:canvas-understanding --boards diagram
 *   pnpm --filter @mola/web eval:canvas-understanding --models gemma4:26b --sections car-shaky --no-think   # thinking off
 *   pnpm --filter @mola/web eval:canvas-understanding --max-call-minutes 10                     # abort a call that runs longer, and stop the run
 *   pnpm --filter @mola/web eval:canvas-understanding --resume evals/canvas-understanding/output/<timestamp>   # finish a stopped run
 */
// First: it loads .env.local before anything can import lib/llm/ollama.ts.
import { ask } from "../ollama";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { CanvasElement } from "@mola/shared";
import { readCanvas } from "@/lib/canvas/textSyntax";
import { DIAGRAM_BOARD_TITLE, planDiagramBoard } from "@/e2e/support/diagramBoard";
import { planReaderBoard, READER_BOARD_TITLE, type Rect } from "@/e2e/support/readerBoard";
import { loadSavedCanvas } from "../savedCanvas";
import { status, writeReport, type AnswerFile, type BoardFile, type BoardName, type SectionFile } from "./report";

const here = fileURLToPath(new URL(".", import.meta.url));
const BOARDS: BoardName[] = ["diagram", "reader"];

// The canvas chat's system prompt (app/api/canvas/[canvasId]/chat/route.ts), word for word.
const SYSTEM = [
  "You are Mola, a tutor looking at a student's whiteboard. You can't see the board itself: "
    + "each of the student's messages comes with the board converted to text — all of it, or only the part they selected.",
  "Refer to things on the board by their labels (M1, Q2, T3, …), and to parts of handwriting by place (\"M1 row 2 col 3\"), as the text explains. "
    + "If something you need is unreadable or missing from the text, say so rather than guessing.",
].join("\n\n");

const QUESTION = "This is part of my whiteboard, converted to text. Describe what is drawn or written, what you think it represents, "
  + "and if it contains a problem, work it out.";

/** What the model reads, as the canvas chat builds it: the board as text, then the student's message. */
const userMessage = (read: string) => `${read}\n\nTHE STUDENT'S MESSAGE\n${QUESTION}`;

function readOptions() {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  const value = (flag: string) => {
    const i = args.findIndex((a) => a === flag || a.startsWith(`${flag}=`));
    if (i < 0) return undefined;
    return args[i]!.includes("=") ? args[i]!.split("=").slice(1).join("=") : args[i + 1];
  };
  const list = (flag: string) => value(flag)?.split(",").map((s) => s.trim()).filter(Boolean);
  const boards = (list("--boards") ?? BOARDS) as BoardName[];
  for (const b of boards) if (!BOARDS.includes(b)) throw new Error(`unknown board "${b}" (have: ${BOARDS.join(", ")})`);
  const maxMinutes = value("--max-call-minutes");
  return {
    // The models the app offers.
    models: list("--models") ?? ["gemma4:26b", "gemma4:12b"],
    boards,
    /** Only these section ids (e.g. co2-neat), for a probe. */
    sections: list("--sections"),
    maxCallMs: maxMinutes === undefined ? undefined : Number(maxMinutes) * 60_000,
    /** An earlier run's directory: calls that finished there are reused; ones that errored or were cut off are made again. */
    resume: value("--resume"),
    /** Thinking is on unless --no-think (the app's default is on). */
    think: !args.includes("--no-think"),
  };
}

/** Whether an element's box touches the rectangle — what the report draws for a section. */
function touches(e: CanvasElement, r: Rect): boolean {
  const [x1, y1, x2, y2] = e.type === "line"
    ? [Math.min(e.x, e.x + e.props.endX), Math.min(e.y, e.y + e.props.endY), Math.max(e.x, e.x + e.props.endX), Math.max(e.y, e.y + e.props.endY)]
    : [e.x, e.y, e.x + e.width, e.y + e.height];
  return x2 >= r.minX && x1 <= r.maxX && y2 >= r.minY && y1 <= r.maxY;
}

const opts = readOptions();
const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
const outDir = opts.resume ? resolve(opts.resume) : join(here, "output", stamp);
mkdirSync(outDir, { recursive: true });
const write = (name: string, data: unknown) => writeFileSync(join(outDir, name), `${JSON.stringify(data, null, 2)}\n`);
const safe = (s: string) => s.replace(/[^a-zA-Z0-9._-]/g, "_");
console.log(`canvas-understanding eval → ${outDir}`);

// ── the boards, read section by section ─────────────────────────────────────

async function loadBoard(title: string) {
  const saved = await loadSavedCanvas(title);
  if (!saved) throw new Error(`no saved canvas "${title}" for Alice — write it with its e2e spec first`);
  return saved;
}

const sectionFile = (board: BoardName, elements: CanvasElement[], s: Omit<SectionFile, "board" | "sent" | "elements">): SectionFile => ({
  board, ...s, sent: userMessage(readCanvas(elements, { region: s.rect, render: "normalized" }).text),
  elements: elements.filter((e) => touches(e, s.rect)),
});

const boards = new Map<BoardName, BoardFile>();
if (opts.boards.includes("diagram")) {
  const saved = await loadBoard(DIAGRAM_BOARD_TITLE);
  const sections = planDiagramBoard().sections.map((s) => sectionFile("diagram", saved.elements, {
    id: s.id, topic: s.diagram, style: s.style, rect: s.rect,
    depicts: s.depicts, expected: s.expected, latex: [], labels: s.truth.labels.map((l) => l.text),
  }));
  boards.set("diagram", { board: "diagram", title: DIAGRAM_BOARD_TITLE, canvasId: saved.id, sections });
}
if (opts.boards.includes("reader")) {
  const saved = await loadBoard(READER_BOARD_TITLE);
  const plan = planReaderBoard();
  const sections = plan.sections.map((s) => sectionFile("reader", saved.elements, {
    id: s.id, topic: s.subject, style: s.style, rect: s.rect,
    depicts: null, expected: s.expected, latex: plan.math.filter((m) => m.section === s.id).map((m) => m.latex), labels: [],
  }));
  boards.set("reader", { board: "reader", title: READER_BOARD_TITLE, canvasId: saved.id, sections });
}
for (const b of boards.values()) {
  write(`board.${b.board}.json`, b);
  console.log(`${b.title}: ${b.sections.length} sections read (${b.sections.map((s) => `${s.id} ${s.sent.length}`).join(", ")} chars)`);
}

// The diagram board's neat sections, then its shaky ones, then the reader board.
const diagram = boards.get("diagram")?.sections ?? [];
const order = [...diagram.filter((s) => s.style === "neat"), ...diagram.filter((s) => s.style !== "neat"), ...(boards.get("reader")?.sections ?? [])]
  .filter((s) => !opts.sections || opts.sections.includes(s.id));
if (opts.sections) for (const id of opts.sections) if (!order.some((s) => s.id === id)) throw new Error(`unknown section "${id}"`);

const createdAt = new Date().toISOString();
const writeSummary = (finishedAt: string | null) => write("summary.json", {
  createdAt, finishedAt,
  options: {
    models: opts.models, boards: opts.boards, sections: opts.sections ?? null, think: opts.think,
    maxCallMinutes: opts.maxCallMs === undefined ? null : opts.maxCallMs / 60_000,
  },
  prompt: { system: SYSTEM, question: QUESTION },
});
writeSummary(null);
writeReport(outDir);

// ── model calls ─────────────────────────────────────────────────────────────

const total = opts.models.length * order.length;
let n = 0;
// Grouped by model so each one loads once.
models: for (const model of opts.models) {
  let warmedUp = false;
  for (const s of order) {
    const file = `answer.${s.board}.${s.id}.${safe(model)}.json`;
    const label = `[${++n}/${total}] ${model} ${s.board}/${s.id}`;
    if (existsSync(join(outDir, file)) && status(JSON.parse(readFileSync(join(outDir, file), "utf8")) as AnswerFile).ok) {
      console.log(`${label}: reused from the earlier run`);
      continue;
    }
    if (!warmedUp) {
      // Load the model with the same options the timed calls use, so its first call isn't charged for it.
      const warm = await ask(model, false, SYSTEM, "Reply with OK", { maxTokens: 1 });
      console.log(`${model}: warmed up in ${(warm.latencyMs / 1000).toFixed(1)}s${warm.errors.length ? ` (${warm.errors.join("; ")})` : ""}`);
      warmedUp = true;
    }
    const call = await ask(model, opts.think, SYSTEM, s.sent, { timeoutMs: opts.maxCallMs });
    const answer: AnswerFile = {
      board: s.board, section: s.id, model, think: opts.think,
      latencyMs: call.latencyMs, firstTokenMs: call.firstTokenMs, stopReason: call.stopReason, errors: call.errors,
      attempts: call.attempts, timedOut: call.timedOut, prompt: { system: SYSTEM, user: s.sent }, raw: call.raw,
    };
    write(file, answer);
    writeReport(outDir);
    console.log(`${label}: ${(call.latencyMs / 1000).toFixed(1)}s `
      + `(first token ${call.firstTokenMs === null ? "never" : `${(call.firstTokenMs / 1000).toFixed(1)}s`}), `
      + `${call.raw.length} chars, stop ${call.stopReason}${call.errors.length ? `, errors: ${call.errors.join("; ")}` : ""}`);
    if (call.timedOut) {
      console.log(`stopping: that call ran past ${opts.maxCallMs! / 60_000} minutes`);
      break models;
    }
  }
  console.log(`${model}: done`);
}

writeSummary(new Date().toISOString());
console.log(`report: ${writeReport(outDir)}`);
