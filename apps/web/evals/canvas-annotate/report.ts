/**
 * Builds report.html for one canvas-annotate eval run: a single
 * self-contained page (inline CSS and SVG, no external requests), in the
 * other canvas evals' style. A leaderboard per condition, hits per board,
 * then every call: the board with the planted errors outlined and each
 * annotation's resolved target drawn in the accent colour, the annotations
 * with their notes and what they were scored as, and the raw tool calls.
 *
 * Scores are worked out here from the run's JSON (score.ts), so a run that
 * is still going or was stopped part-way reports what it has, and a change to
 * the scoring needs no new model calls:
 *
 *   pnpm --filter @mola/web exec tsx evals/canvas-annotate/report.ts evals/canvas-annotate/output/<timestamp>
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readCanvas } from "@/lib/canvas/textSyntax";
import type { CanvasDoc } from "@/lib/canvas/textSyntax/read";
import type { Box } from "@/lib/canvas/textSyntax/segment";
import { CSS as READER_CSS, elementSvg } from "../canvas-reader/report";
import { esc, pct, secs } from "../canvas-syntax/report";
import type { AnnotateBoard, BoardName } from "./fixtures";
import { CONDITIONS, scoreCall, type CallScore, type Condition, type ScoredAnnotation } from "./score";

/** A board as sent: its elements and planted errors, and the user message for each condition. */
export type BoardFile = AnnotateBoard & { sent: Record<Condition, string> };

export type CallFile = {
  board: BoardName; condition: Condition; repeat: number; model: string;
  latencyMs: number; firstTokenMs: number | null; stopReason: string | null; errors: string[]; attempts: number; timedOut: boolean;
  /** The visible reply, if any, beside the tool calls. */
  raw: string;
  toolCalls: { name: string; input: unknown }[];
};
type SummaryFile = {
  createdAt: string; finishedAt: string | null; model: string;
  options: { conditions: Condition[]; boards: BoardName[]; repeats: number; maxCallMinutes: number | null };
  prompt: { system: string; message: string; maxTokens: number; tools: Partial<Record<Condition, unknown>> };
};

const CONDITION_NAMES: Record<Condition, string> = { label: "Labels", coordinate: "Coordinates" };
const ERROR_NAMES = { matrix: "matrix slip", line: "2 + 2 = 5" };

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};
const frac = (n: number, of: number) => (of ? `${pct(n / of)} <small>${n}/${of}</small>` : "—");
const yes = (ok: boolean, text: string) => `<span class="${ok ? "ok" : "bad"}">${text} ${ok ? "✓" : "✗"}</span>`;
const targetText = (t: unknown) => (typeof t === "string" ? t : JSON.stringify(t));

type Scored = { call: CallFile; board: BoardFile; score: CallScore };

// ── leaderboard ─────────────────────────────────────────────────────────────

function leaderboard(scored: Scored[], conditions: Condition[]): string {
  const rows = conditions.map((c) => {
    const mine = scored.filter((s) => s.call.condition === c);
    const planted = mine.flatMap((s) => s.board.errors.map((e) => ({ s, e, r: s.score.errors[e.id] })));
    const hits = planted.filter((p) => p.r.hit);
    const byError = (id: string) => planted.filter((p) => p.e.id === id);
    const invalid = mine.filter((s) => !s.score.valid || s.call.timedOut || s.call.errors.length);
    const latency = mine.filter((s) => !s.call.timedOut).map((s) => s.call.latencyMs);
    const annotations = mine.reduce((n, s) => n + s.score.annotations.length, 0);
    return `<tr><th>${CONDITION_NAMES[c]}</th><td class="num">${mine.length}</td>
      <td class="num"><b>${frac(hits.length, planted.length)}</b></td>
      ${(["matrix", "line"] as const).map((id) => `<td class="num">${frac(byError(id).filter((p) => p.r.hit).length, byError(id).length)}</td>`).join("")}
      <td class="num">${frac(planted.filter((p) => p.r.pinpointed).length, planted.length)}</td>
      <td class="num">${frac(hits.filter((p) => p.r.rightValue).length, hits.length)}</td>
      <td class="num">${mine.reduce((n, s) => n + s.score.falseFlags, 0)} <small>in ${mine.filter((s) => s.score.falseFlags).length} calls</small></td>
      <td class="num">${mine.reduce((n, s) => n + s.score.unresolved, 0)} <small>of ${annotations}</small></td>
      <td class="num">${invalid.length ? `<span class="bad">${invalid.length}</span>` : "0"}${invalid.length ? ` <small>${invalid.map((s) => esc(s.call.timedOut ? "cut off" : s.score.problem ?? s.call.errors.join("; "))).join("; ")}</small>` : ""}</td>
      <td class="num">${latency.length ? `${secs(median(latency))} <small>${secs(Math.min(...latency))}–${secs(Math.max(...latency))}</small>` : "—"}</td></tr>`;
  }).join("");
  return `<table class="leader"><thead><tr><th>Targets by</th><th>Calls</th><th>Hit rate</th><th>${ERROR_NAMES.matrix}</th><th>${ERROR_NAMES.line}</th>
    <th>Pinpointed</th><th>Right value in note</th><th>False flags</th><th>Unresolved targets</th><th>Invalid calls</th><th>Latency, median</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function byBoard(scored: Scored[], boards: BoardFile[], conditions: Condition[]): string {
  const cell = (b: BoardFile, c: Condition) => {
    const mine = scored.filter((s) => s.board.name === b.name && s.call.condition === c);
    if (!mine.length) return `<td class="none">not run yet</td>`;
    return `<td>${b.errors.map((e) => `${ERROR_NAMES[e.id]} ${mine.filter((s) => s.score.errors[e.id].hit).length}/${mine.length}`).join(" · ")}
      · false flags ${mine.reduce((n, s) => n + s.score.falseFlags, 0)}</td>`;
  };
  return `<table class="leader"><thead><tr><th>Board</th>${conditions.map((c) => `<th>${CONDITION_NAMES[c]}</th>`).join("")}</tr></thead><tbody>
    ${boards.map((b) => `<tr><td><a href="#board-${b.name}">${esc(b.name)}</a></td>${conditions.map((c) => cell(b, c)).join("")}</tr>`).join("")}</tbody></table>`;
}

// ── one call ────────────────────────────────────────────────────────────────

function boardBox(b: BoardFile): Box {
  const xs = b.elements.flatMap((e) => [e.x, e.x + e.width]);
  const ys = b.elements.flatMap((e) => [e.y, e.y + e.height]);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

const pad = (b: Box, p: number): Box => ({ minX: b.minX - p, minY: b.minY - p, maxX: b.maxX + p, maxY: b.maxY + p });

function markSvg(a: ScoredAnnotation, i: number): string {
  const t = a.annotation!.target;
  const point = typeof t === "string" ? "" : `<g class="pt"><circle cx="${t.x}" cy="${t.y}" r="4"/><path d="M${t.x - 10} ${t.y}h20M${t.x} ${t.y - 10}v20"/></g>`;
  if (!a.resolved?.ok) return point;
  const b = pad(a.resolved.box, 5);
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  const shape = a.annotation!.mark === "circle" ? `<ellipse cx="${b.minX + w / 2}" cy="${b.minY + h / 2}" rx="${w / 2 + 6}" ry="${h / 2 + 4}"/>`
    : a.annotation!.mark === "underline" ? `<line x1="${b.minX}" y1="${b.maxY}" x2="${b.maxX}" y2="${b.maxY}"/>`
    : `<rect x="${b.minX}" y="${b.minY}" width="${w}" height="${h}"${a.annotation!.mark === "none" ? ` class="faint"` : ""}/>`;
  return `<g class="annot">${shape}<text x="${b.minX}" y="${b.minY - 8}">${i + 1}</text></g>${point}`;
}

function callSvg(s: Scored): string {
  const v = pad(boardBox(s.board), 30);
  const planted = s.board.errors.map((e) => {
    const b = pad(e.box, 9);
    return `<rect x="${b.minX}" y="${b.minY}" width="${b.maxX - b.minX}" height="${b.maxY - b.minY}"/>`;
  }).join("");
  const marks = s.score.annotations.map((a, i) => (a.annotation ? markSvg(a, i) : "")).join("");
  return `<svg class="board" viewBox="${v.minX} ${v.minY} ${v.maxX - v.minX} ${v.maxY - v.minY}" role="img" aria-label="${esc(s.board.name)} with the annotations">
    ${s.board.elements.map(elementSvg).join("")}<g class="planted">${planted}</g>${marks}</svg>`;
}

function verdict(a: ScoredAnnotation): string {
  if (a.problem) return `<span class="bad">not in the tool's shape</span><br><small>${esc(a.problem)}</small>`;
  if (!a.resolved?.ok) return `<span class="bad">unresolved</span>`;
  const kind = a.annotation!.kind;
  const parts = a.on.map((id) => (kind === "error" || kind === "hint"
    ? `<span class="ok">hit: ${ERROR_NAMES[id]}</span> <small>${a.pinpoints.includes(id) ? "pinpointed" : "overlaps"}</small>`
    : `<span class="bad">on ${ERROR_NAMES[id]}, as ${kind}</span>`));
  if (a.falseFlag) parts.push(`<span class="bad">false flag</span>`);
  return parts.join("<br>") || `<small>—</small>`;
}

function callCard(s: Scored): string {
  const { call, score } = s;
  const head = [
    `#${call.repeat}`, secs(call.latencyMs),
    call.timedOut ? `<span class="bad">cut off</span>` : score.valid ? `<span class="ok">valid</span>` : `<span class="bad">invalid</span>`,
    ...s.board.errors.map((e) => yes(score.errors[e.id].hit, ERROR_NAMES[e.id])),
    score.falseFlags ? `<span class="bad">${score.falseFlags} false flag${score.falseFlags > 1 ? "s" : ""}</span>` : "no false flags",
  ].join(" · ");
  const rows = score.annotations.map((a, i) => `<tr>
    <td class="num">${i + 1}</td>
    <td><code>${esc(targetText(a.annotation?.target ?? (a.given as { target?: unknown })?.target))}</code></td>
    <td>${a.resolved ? (a.resolved.ok ? `<code>${esc(a.resolved.address)}</code>` : `<span class="bad">${esc(a.resolved.error)}</span>`) : "—"}</td>
    <td>${esc(a.annotation?.kind ?? "")}</td><td>${esc(a.annotation?.mark ?? "")}</td>
    <td class="note">${esc(a.annotation?.note ?? JSON.stringify(a.given))}</td>
    <td>${verdict(a)}</td></tr>`).join("");
  return `<div class="call">
    <h4>${head}</h4>
    ${score.problem ? `<p class="errors">${esc(score.problem)}</p>` : ""}
    ${call.errors.length ? `<ul class="errors">${call.errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>` : ""}
    ${callSvg(s)}
    ${rows ? `<div class="scroll"><table class="ann"><thead><tr><th>#</th><th>Target given</th><th>Resolved to</th><th>Kind</th><th>Mark</th><th>Note</th><th>Scored as</th></tr></thead><tbody>${rows}</tbody></table></div>` : "<p class=\"meta\">No annotations.</p>"}
    ${s.board.errors.map((e) => `<p class="meta">${ERROR_NAMES[e.id]}: ${score.errors[e.id].hit ? `right value (${esc(e.correct)}) in the note ${score.errors[e.id].rightValue ? "✓" : "✗"}` : "missed"}${score.errors[e.id].kinds.length ? ` · annotated as ${score.errors[e.id].kinds.join(", ")}` : ""}</p>`).join("")}
    ${call.raw.trim() ? `<details><summary>Visible reply (${call.raw.length} chars)</summary><div class="reply">${esc(call.raw)}</div></details>` : `<p class="meta">No visible reply beside the tool call.</p>`}
    <details><summary>Raw tool call JSON (${call.toolCalls.length} call${call.toolCalls.length === 1 ? "" : "s"})</summary><pre>${esc(JSON.stringify(call.toolCalls, null, 2))}</pre></details>
    <p class="meta">stop ${esc(String(call.stopReason))}${call.firstTokenMs === null ? "" : ` · first output ${secs(call.firstTokenMs)}`}${call.attempts > 1 ? ` · ${call.attempts} attempts` : ""}</p>
  </div>`;
}

// ── page ────────────────────────────────────────────────────────────────────

const CSS = `${READER_CSS}
:root { --annot:#481715; --planted:#15803d; }
@media (prefers-color-scheme: dark) { :root { --annot:#e3958b; --planted:#4ade80; } }
body { max-width: 1680px; }
.leader td, .leader th { font-size: 13px; }
.leader td.none { color: var(--muted); font-style: italic; }
.callout p { margin: 4px 0; }
section.board-sec { border-top: 1px solid var(--line); margin-top: 24px; }
.cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(520px, 1fr)); gap: 16px; align-items: start; }
@media (max-width: 600px) { .cols { grid-template-columns: 1fr; } }
.call { background: var(--card); border-radius: 6px; padding: 8px 10px; margin: 0 0 14px; }
.call h4 { margin: 0 0 4px; font-weight: 500; }
.call svg.board { background: var(--bg); }
svg.board .planted rect { fill: none; stroke: var(--planted); stroke-width: 2; stroke-dasharray: 6 4; }
svg.board .annot ellipse, svg.board .annot rect, svg.board .annot line { fill: none; stroke: var(--annot); stroke-width: 4; }
svg.board .annot rect.faint { stroke-dasharray: 8 6; stroke-width: 2.5; }
svg.board .annot text { fill: var(--annot); font: bold 22px ui-monospace, monospace; }
svg.board .pt circle { fill: var(--annot); } svg.board .pt path { stroke: var(--annot); stroke-width: 2; }
.ann td, .ann th { font-size: 12px; } .ann td.note { min-width: 220px; }
.reply { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 13px; max-height: 480px; overflow-y: auto; }
.key span { display: inline-block; width: 22px; height: 0; border-top: 3px solid; vertical-align: middle; margin-right: 4px; }
`;

export function buildReport(dir: string): string {
  const read = <T>(f: string) => JSON.parse(readFileSync(join(dir, f), "utf8")) as T;
  const summary = existsSync(join(dir, "summary.json")) ? read<SummaryFile>("summary.json") : null;
  const files = readdirSync(dir);
  const boards = files.filter((f) => /^board\..+\.json$/.test(f)).map((f) => read<BoardFile>(f));
  const order = (b: BoardFile) => ["clean", "jitter1", "jitter2"].indexOf(b.name);
  boards.sort((a, b) => order(a) - order(b));
  const calls = files.filter((f) => /^call\..+\.json$/.test(f)).map((f) => read<CallFile>(f));
  const conditions = summary?.options.conditions ?? CONDITIONS;

  // Every call is scored against a fresh read of its board: the same doc the run resolved against (the read is deterministic).
  const docs = new Map<string, CanvasDoc>(boards.map((b) => [b.name, readCanvas(b.elements).doc]));
  const scored: Scored[] = calls.flatMap((call) => {
    const board = boards.find((b) => b.name === call.board);
    return board ? [{ call, board, score: scoreCall(call.condition, call.toolCalls, docs.get(board.name)!, board.errors) }] : [];
  }).sort((a, b) => a.call.repeat - b.call.repeat);
  const expected = (summary?.options.repeats ?? 0) * boards.length * conditions.length;

  const meta = [
    `run <b>${esc(dir.split("/").filter(Boolean).pop()!)}</b>`,
    summary ? `${esc(summary.model)}, thinking on, output cap ${summary.prompt.maxTokens} tokens` : "",
    `${calls.length} of ${expected || "?"} call(s) made`,
    summary?.finishedAt ? `finished ${esc(summary.finishedAt.slice(0, 16).replace("T", " "))} UTC` : "<b>still running, or stopped</b> — reload for more",
    summary?.options.maxCallMinutes ? `calls cut off after ${summary.options.maxCallMinutes} minutes` : "",
  ].filter(Boolean).join(" · ");

  const boardSections = boards.map((b) => `
    <section class="board-sec" id="board-${b.name}">
      <h2>${esc(b.name)} <small>${b.jitterSeed === null ? "clean hand" : `jitter seed ${b.jitterSeed}`}</small></h2>
      <ul>${b.errors.map((e) => `<li><b>${ERROR_NAMES[e.id]}</b> — ${esc(e.what)} <small>strokes ${e.strokeIds.join(", ")}</small></li>`).join("")}</ul>
      ${conditions.map((c) => `<details><summary>Text sent in the ${CONDITION_NAMES[c].toLowerCase()} condition (${b.sent[c].length} chars)</summary><pre>${esc(b.sent[c])}</pre></details>`).join("")}
      <div class="cols">${conditions.map((c) => `<div><h3>${CONDITION_NAMES[c]}</h3>
        ${scored.filter((s) => s.board.name === b.name && s.call.condition === c).map(callCard).join("") || "<p class=\"meta\">Not run yet.</p>"}</div>`).join("")}</div>
    </section>`).join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Canvas annotate eval</title><style>${CSS}</style></head>
<body>
<h1>Canvas annotate eval</h1>
<p class="meta">${meta}</p>
<div class="callout">
<p>Can the model find the mistakes on a whiteboard and point at them with a tool call? Each board is the 8-step matrix reduction with one wrong entry
(M8 row 1 col 4: R1 = R1 - R2 gives 3 - 2 = 1, but 5 is written) and a handwritten “2 + 2 = 5”. The whole board is read as the canvas chat reads it and sent with
“${esc(summary?.prompt.message ?? "Check my work.")}” and one tool, <code>annotate_canvas</code>.</p>
<p><b>Labels:</b> a target is a label from the read (“M8 row 1 col 4”, “T8 word 5”). <b>Coordinates:</b> a target is a point {x, y}, and the read also lists the box of every cell and word.
Targets are resolved as the real tool will resolve them (lib/canvas/textSyntax/targets.ts).</p>
<p><b>Hit</b>: an annotation of kind error or hint whose target overlaps the planted error's strokes (or whose point is inside its box). <b>Pinpointed</b>: it resolves to exactly the wrong
cell or word, not a whole row, matrix or line. <b>Right value</b>: a hitting note has the correct value in it, addresses aside. <b>False flag</b>: an error annotation on anything else.
<b>Invalid</b>: no tool call, or a call not in the tool's shape.</p>
<p class="key"><span style="border-color:var(--planted);border-top-style:dashed"></span>planted error <span style="border-color:var(--annot);margin-left:12px"></span>an annotation's resolved target, numbered as in its table, drawn as its mark (dashed: mark “none”); ⊕ the point given</p>
</div>
${summary ? `<details><summary>System prompt, message and tool (the same for every call)</summary><pre>${esc(summary.prompt.system)}</pre><pre>${esc(summary.prompt.message)}</pre>
  ${Object.entries(summary.prompt.tools).map(([c, t]) => `<h5>${esc(c)}</h5><pre>${esc(JSON.stringify(t, null, 2))}</pre>`).join("")}</details>` : ""}
<h2>Leaderboard</h2>
<div class="scroll">${leaderboard(scored, conditions)}</div>
<p class="meta">Rates are over every call made in the condition, two planted errors each; an invalid or cut-off call counts as missing both. Latency includes thinking.</p>
<h3>By board</h3>
<div class="scroll">${byBoard(scored, boards, conditions)}</div>
${boardSections}
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
    console.error("usage: tsx evals/canvas-annotate/report.ts <run directory>");
    process.exit(1);
  }
  console.log(writeReport(resolve(dir)));
}
