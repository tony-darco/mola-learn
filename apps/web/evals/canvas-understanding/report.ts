/**
 * Builds report.html for one canvas-understanding eval run: a single
 * self-contained page (inline CSS and SVG, no external requests), in the
 * other canvas evals' style, to judge the answers by eye — nothing is scored.
 * An index of every section by board, subject or diagram, and style; how long
 * the calls took; then per section, side by side: the section as drawn, what
 * was drawn there (never sent to a model), the exact text that was sent, and
 * every model's answer.
 *
 * Reads only the run's JSON files, so it also works on a run that is still
 * going or was stopped part-way:
 *
 *   pnpm --filter @mola/web exec tsx evals/canvas-understanding/report.ts evals/canvas-understanding/output/<timestamp>
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { CanvasElement } from "@mola/shared";
import type { Rect } from "@/e2e/support/readerBoard";
import { CSS as READER_CSS, elementSvg } from "../canvas-reader/report";
import { esc, secs } from "../canvas-syntax/report";

export type BoardName = "diagram" | "reader";

/** One section of a saved board, as read. */
export type SectionFile = {
  board: BoardName; id: string;
  /** The diagram, or the subject. */
  topic: string; style: string; rect: Rect;
  /** Diagram board: what the drawing depicts, in plain English. Never sent to a model. */
  depicts: string | null;
  /** What was written, line by line ("_" and "^" mark scripts); the LaTeX entered with the Math tool; a diagram's labels. */
  expected: string[]; latex: string[]; labels: string[];
  /** The user message sent, exactly: the read of the section's rectangle, then the question. */
  sent: string;
  /** The board's elements that touch the rectangle, to draw it. */
  elements: CanvasElement[];
};
export type BoardFile = { board: BoardName; title: string; canvasId: string; sections: SectionFile[] };

/** One model's answer about one section. */
export type AnswerFile = {
  board: BoardName; section: string; model: string; think: boolean;
  latencyMs: number; firstTokenMs: number | null; stopReason: string | null; errors: string[]; attempts: number; timedOut: boolean;
  prompt: { system: string; user: string }; raw: string;
};
type SummaryFile = {
  createdAt: string; finishedAt: string | null;
  options: { models: string[]; boards: BoardName[]; sections: string[] | null; think: boolean; maxCallMinutes: number | null };
  prompt: { system: string; question: string };
};

const BOARD_NAMES: Record<BoardName, string> = { diagram: "Diagram board", reader: "Reader board" };
const BOARDS: BoardName[] = ["diagram", "reader"];

/** Whether a call came back with a whole answer. */
export function status(a: AnswerFile): { ok: boolean; text: string } {
  if (a.timedOut) return { ok: false, text: "cut off" };
  if (a.errors.length) return { ok: false, text: "errored" };
  if (a.stopReason === "max_tokens") return { ok: false, text: "ran out of output budget" };
  if (!a.raw.trim()) return { ok: false, text: "empty reply" };
  return { ok: true, text: "finished" };
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};
const anchor = (board: string, id: string) => `${board}-${id}`;
const shortModel = (m: string) => m.split(":").pop()!;
/** "_" and "^" write the next character as a sub- or superscript. */
const scripted = (s: string) => esc(s).replace(/_(.)/gu, "<sub>$1</sub>").replace(/\^(.)/gu, "<sup>$1</sup>");

// ── pieces ──────────────────────────────────────────────────────────────────

function sectionSvg(s: SectionFile): string {
  const pad = 10;
  const { minX, minY, maxX, maxY } = s.rect;
  return `<svg class="board" viewBox="${minX - pad} ${minY - pad} ${maxX - minX + 2 * pad} ${maxY - minY + 2 * pad}" role="img" aria-label="${esc(s.id)} as drawn">
    ${s.elements.map(elementSvg).join("")}<g class="region"><rect x="${minX}" y="${minY}" width="${maxX - minX}" height="${maxY - minY}"/></g></svg>`;
}

function truthBox(s: SectionFile): string {
  const rows = [
    s.depicts ? `<p>${esc(s.depicts)}</p>` : "",
    s.labels.length ? `<p><span class="k">Labels written:</span> ${s.labels.map((l) => `<b>${scripted(l)}</b>`).join(", ")}</p>` : "",
    s.latex.length
      ? `<p><span class="k">Typed with the Math tool (LaTeX):</span></p>${s.latex.map((l) => `<div><code>${esc(l)}</code></div>`).join("")}`
      : s.expected.length ? `<p><span class="k">${s.board === "diagram" ? "Also written:" : "Handwritten:"}</span></p>${s.expected.map((l) => `<div class="line">${scripted(l)}</div>`).join("")}` : "",
  ].join("");
  return `<div class="truth"><div class="truth-head">What was drawn (not sent to the model)</div>${rows}</div>`;
}

function answerCard(model: string, a: AnswerFile | undefined): string {
  if (!a) return `<div class="answer pending"><h4>${esc(model)}</h4><p class="meta">Not run yet.</p></div>`;
  const st = status(a);
  const head = `${esc(model)} · ${secs(a.latencyMs)}${a.firstTokenMs === null ? "" : ` <small>(first token ${secs(a.firstTokenMs)})</small>`}
    · <span class="${st.ok ? "ok" : "bad"}">${st.text}</span>`;
  const errors = a.errors.length ? `<ul class="errors">${a.errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>` : "";
  return `<div class="answer"><h4>${head}</h4>${errors}<div class="reply">${esc(a.raw) || "<i>empty</i>"}</div>
    <p class="meta">stop ${esc(String(a.stopReason))} · ${a.raw.length} chars${a.attempts > 1 ? ` · ${a.attempts} attempts` : ""}</p></div>`;
}

function latencyTable(models: string[], answers: AnswerFile[], expected: number): string {
  const rows = models.map((m) => {
    const mine = answers.filter((a) => a.model === m);
    const done = mine.filter((a) => status(a).ok).map((a) => a.latencyMs);
    const failed = mine.filter((a) => !status(a).ok);
    return `<tr><td>${esc(m)}</td><td class="num">${done.length}</td>
      <td class="num">${failed.length ? `<span class="bad">${failed.length}</span> <small>${failed.map((a) => `${esc(a.section)}: ${status(a).text}`).join(", ")}</small>` : "0"}</td>
      <td class="num">${Math.max(0, expected - mine.length)}</td>
      ${done.length ? [Math.min(...done), median(done), Math.max(...done)].map((ms) => `<td class="num">${secs(ms)}</td>`).join("") : `<td class="none" colspan="3">—</td>`}</tr>`;
  }).join("");
  return `<table class="latency"><thead><tr><th>Model</th><th>Finished</th><th>Not finished</th><th>Not run yet</th><th>Min</th><th>Median</th><th>Max</th></tr></thead>
    <tbody>${rows}</tbody></table>`;
}

/** Per board, a table of its subjects or diagrams by style, each cell a link to the section and every model's state there. */
function index(boards: BoardFile[], models: string[], answerOf: (b: string, s: string, m: string) => AnswerFile | undefined): string {
  return boards.map((b) => {
    const topics = [...new Set(b.sections.map((s) => s.topic))];
    const styles = [...new Set(b.sections.map((s) => s.style))];
    const cell = (s: SectionFile | undefined) => {
      if (!s) return "<td></td>";
      const marks = models.map((m) => {
        const a = answerOf(b.board, s.id, m);
        const [cls, mark] = !a ? ["pending", "·"] : status(a).ok ? ["ok", "✓"] : ["bad", "✗"];
        return `<span class="mark ${cls}" title="${esc(m)}: ${a ? status(a).text : "not run yet"}">${esc(shortModel(m))} ${mark}</span>`;
      }).join(" ");
      return `<td><a href="#${anchor(b.board, s.id)}">${esc(s.style)}</a> ${marks}</td>`;
    };
    return `<h3>${BOARD_NAMES[b.board]} <small>“${esc(b.title)}”</small></h3>
      <table class="index"><thead><tr><th>${b.board === "diagram" ? "Diagram" : "Subject"}</th>${styles.map((st) => `<th>${esc(st)}</th>`).join("")}</tr></thead><tbody>
      ${topics.map((t) => `<tr><td>${esc(t)}</td>${styles.map((st) => cell(b.sections.find((s) => s.topic === t && s.style === st))).join("")}</tr>`).join("")}
      </tbody></table>`;
  }).join("");
}

// ── page ────────────────────────────────────────────────────────────────────

const CSS = `${READER_CSS}
body { max-width: 1680px; }
.callout p { margin: 4px 0; }
.index td, .index th, .latency td, .latency th { font-size: 13px; }
.index a { font-weight: 600; margin-right: 4px; }
.mark { font: 11px ui-monospace, monospace; white-space: nowrap; }
.mark.pending { color: var(--muted); }
.latency td.none { color: var(--muted); text-align: center; }
section.sec { border-top: 1px solid var(--line); padding-top: 4px; margin-top: 18px; }
.cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 14px; align-items: start; }
svg.board .region rect { stroke-width: 1; stroke-dasharray: 4 4; opacity: .6; }
.truth { background: var(--card); border-left: 4px solid var(--region); border-radius: 4px; padding: 6px 10px; font-size: 13px; }
.truth-head { font-weight: 600; color: var(--region); margin-bottom: 2px; }
.truth p { margin: 4px 0; } .truth .line { font: 13px ui-monospace, monospace; }
.answer { background: var(--card); border-radius: 6px; padding: 8px 10px; }
.answer h4 { margin: 0 0 6px; font-weight: 600; }
.answer.pending { opacity: .7; }
.reply { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 13px; max-height: 720px; overflow-y: auto; }
`;

export function buildReport(dir: string): string {
  const read = <T>(f: string) => JSON.parse(readFileSync(join(dir, f), "utf8")) as T;
  const summary = existsSync(join(dir, "summary.json")) ? read<SummaryFile>("summary.json") : null;
  const files = readdirSync(dir);
  const boards = BOARDS.filter((b) => files.includes(`board.${b}.json`)).map((b) => read<BoardFile>(`board.${b}.json`));
  const answers = files.filter((f) => /^answer\..+\.json$/.test(f)).sort().map((f) => read<AnswerFile>(f));
  const models = [...new Set([...(summary?.options.models ?? []), ...answers.map((a) => a.model)])];
  const answerOf = (b: string, s: string, m: string) => answers.find((a) => a.board === b && a.section === s && a.model === m);
  const asked = (s: SectionFile) => !summary?.options.sections || summary.options.sections.includes(s.id);
  const expected = boards.flatMap((b) => b.sections).filter(asked).length;

  const meta = [
    `run <b>${esc(dir.split("/").filter(Boolean).pop()!)}</b>`,
    "thinking on",
    `${answers.length} of ${expected * models.length} call(s) made`,
    summary?.finishedAt ? `finished ${esc(summary.finishedAt.slice(0, 16).replace("T", " "))} UTC` : "<b>still running, or stopped</b> — reload for more",
    summary?.options.maxCallMinutes ? `calls cut off after ${summary.options.maxCallMinutes} minutes` : "",
  ].filter(Boolean).join(" · ");

  const sections = boards.map((b) => `<h2>${BOARD_NAMES[b.board]} <small>“${esc(b.title)}”</small></h2>${b.sections.map((s) => `
    <section class="sec" id="${anchor(b.board, s.id)}">
      <h3>${esc(s.topic)} · ${esc(s.style)} <small>${esc(s.id)} · from (${s.rect.minX}, ${s.rect.minY}) to (${s.rect.maxX}, ${s.rect.maxY})</small></h3>
      <div class="cols">
        <div>${sectionSvg(s)}${truthBox(s)}
          <details><summary>Text sent to the model (${s.sent.length} chars)</summary><pre>${esc(s.sent)}</pre></details></div>
        ${models.map((m) => answerCard(m, answerOf(b.board, s.id, m))).join("")}
      </div>
    </section>`).join("")}`).join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Canvas understanding eval</title><style>${CSS}</style></head>
<body>
<h1>Canvas understanding eval</h1>
<p class="meta">${meta}</p>
<div class="callout"><p>Each section of the two saved boards was read on its own — the rectangle around it, the way the canvas chat reads a selection — and sent to each model
with the same question. Nothing is scored: judge the answers by eye.</p>
<p>The drawing and the box “What was drawn” are for you only. The model got the canvas chat's system prompt and the text under “Text sent to the model”, nothing else.</p></div>
${summary ? `<details><summary>System prompt and question (the same for every call)</summary><pre>${esc(summary.prompt.system)}</pre><pre>${esc(summary.prompt.question)}</pre></details>` : ""}
<h2>Calls</h2>
<div class="scroll">${latencyTable(models, answers, expected)}</div>
<p class="meta">Latency includes thinking time; “first token” is when the visible answer began. Each model is loaded once before its first timed call. Min, median and max are over finished calls.</p>
<h2>Index</h2>
${index(boards, models, answerOf)}
${sections}
</body></html>
`;
}

export function writeReport(dir: string): string {
  const path = join(dir, "report.html");
  writeFileSync(path, buildReport(dir));
  return path;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2];
  if (!dir) {
    console.error("usage: tsx evals/canvas-understanding/report.ts <run directory>");
    process.exit(1);
  }
  console.log(writeReport(resolve(dir)));
}
