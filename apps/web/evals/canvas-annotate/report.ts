/**
 * Builds report.html for one canvas-annotate eval run: a single
 * self-contained page (inline CSS and SVG, no external requests), in the
 * other canvas evals' style. A leaderboard beside the first run's numbers,
 * what the tool sent back and refused, hits per board, then every reply:
 * the board with the planted errors outlined and each placed annotation
 * drawn in the accent colour, the annotations with their notes and what
 * they were scored as, and each model call with its tool calls and what the
 * tool told the model.
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
import type { CanvasAnnotationElement } from "@mola/shared";
import { readCanvas } from "@/lib/canvas/textSyntax";
import type { Box } from "@/lib/canvas/textSyntax/segment";
import { CSS as READER_CSS, elementSvg } from "../canvas-reader/report";
import { esc, pct, secs } from "../canvas-syntax/report";
import type { AnnotateBoard, BoardName } from "./fixtures";
import { scoreReply, type ModelCall, type PlacedScore, type ReplyScore } from "./score";

/** A board as sent: its elements and planted errors, and the user message. */
export type BoardFile = AnnotateBoard & { sent: string };

export type ReplyFile = {
  board: BoardName; repeat: number; model: string;
  latencyMs: number; timedOut: boolean; error: string | null;
  /** The visible reply, every call's text together, as the student sees it. */
  text: string;
  calls: ModelCall[];
  /** The annotations the reply sent to the page. */
  placed: CanvasAnnotationElement[];
};
type SummaryFile = {
  createdAt: string; finishedAt: string | null; model: string;
  options: { boards: BoardName[]; repeats: number; maxReplyMinutes: number | null };
  prompt: { system: string; message: string; maxTokens: number; tool: unknown; maxAnnotations: number; maxModelCalls: number };
};

const ERROR_NAMES = { matrix: "matrix slip", line: "2 + 2 = 5" };

/**
 * The first run, 2026-10-02T17-04-00, labels condition: gemma4:26b, thinking on, the same 3072-token cap and boards, 3 repeats —
 * but one call, the eval's own tool, no cap and no bounce. As its report.html gave them.
 */
const FIRST_RUN = {
  run: "2026-10-02T17-04-00", replies: 9,
  hits: [11, 18], matrix: [3, 9], line: [8, 9], pinpointed: [2, 18], rightValue: [3, 11],
  falseFlags: 16, falseFlagCalls: 6, unresolved: [0, 55], invalid: 3, latency: "55.4s <small>42.1s–61.9s</small>",
  byBoard: { clean: "matrix slip 2/3 · 2 + 2 = 5 3/3 · false flags 9", jitter1: "matrix slip 0/3 · 2 + 2 = 5 2/3 · false flags 1", jitter2: "matrix slip 1/3 · 2 + 2 = 5 3/3 · false flags 6" },
} as const;

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};
const frac = (n: number, of: number) => (of ? `${pct(n / of)} <small>${n}/${of}</small>` : "—");
const yes = (ok: boolean, text: string) => `<span class="${ok ? "ok" : "bad"}">${text} ${ok ? "✓" : "✗"}</span>`;

type Scored = { reply: ReplyFile; board: BoardFile; score: ReplyScore };

// ── leaderboard ─────────────────────────────────────────────────────────────

function leaderboard(scored: Scored[]): string {
  const planted = scored.flatMap((s) => s.board.errors.map((e) => ({ e, r: s.score.errors[e.id] })));
  const hits = planted.filter((p) => p.r.hit);
  const byError = (id: string) => planted.filter((p) => p.e.id === id);
  const toolCalls = scored.reduce((n, s) => n + s.score.toolCalls.filter((t) => t.result !== null).length, 0);
  const invalid = scored.reduce((n, s) => n + s.score.invalidToolCalls, 0);
  const silent = scored.filter((s) => s.score.noToolCall).length;
  const failed = scored.filter((s) => s.reply.error || s.reply.timedOut);
  const latency = scored.filter((s) => !s.reply.timedOut).map((s) => s.reply.latencyMs);
  const now = `<tr><th>This run <small>the shipped reply loop</small></th><td class="num">${scored.length}</td>
    <td class="num"><b>${frac(hits.length, planted.length)}</b></td>
    ${(["matrix", "line"] as const).map((id) => `<td class="num">${frac(byError(id).filter((p) => p.r.hit).length, byError(id).length)}</td>`).join("")}
    <td class="num">${frac(planted.filter((p) => p.r.pinpointed).length, planted.length)}</td>
    <td class="num">${frac(hits.filter((p) => p.r.rightValue).length, hits.length)}</td>
    <td class="num">${scored.reduce((n, s) => n + s.score.falseFlags, 0)} <small>in ${scored.filter((s) => s.score.falseFlags).length} replies</small></td>
    <td class="num">${scored.reduce((n, s) => n + s.score.unresolved, 0)} <small>of ${scored.reduce((n, s) => n + s.score.given, 0)} given</small></td>
    <td class="num">${invalid ? `<span class="bad">${invalid}</span>` : "0"} <small>of ${toolCalls} tool calls${silent ? `; ${silent} replies with none` : ""}${failed.length ? `; ${failed.length} failed: ${failed.map((s) => esc(s.reply.timedOut ? "cut off" : s.reply.error!)).join("; ")}` : ""}</small></td>
    <td class="num">${latency.length ? `${secs(median(latency))} <small>${secs(Math.min(...latency))}–${secs(Math.max(...latency))}</small>` : "—"}</td></tr>`;
  const f = FIRST_RUN;
  const before = `<tr class="before"><th>First run <small>${f.run}, one call, labels</small></th><td class="num">${f.replies}</td>
    <td class="num">${frac(f.hits[0], f.hits[1])}</td><td class="num">${frac(f.matrix[0], f.matrix[1])}</td><td class="num">${frac(f.line[0], f.line[1])}</td>
    <td class="num">${frac(f.pinpointed[0], f.pinpointed[1])}</td><td class="num">${frac(f.rightValue[0], f.rightValue[1])}</td>
    <td class="num">${f.falseFlags} <small>in ${f.falseFlagCalls} calls</small></td><td class="num">${f.unresolved[0]} <small>of ${f.unresolved[1]} given</small></td>
    <td class="num">${f.invalid} <small>of 9 calls</small></td><td class="num">${f.latency} <small>one call</small></td></tr>`;
  return `<table class="leader"><thead><tr><th></th><th>Replies</th><th>Hit rate</th><th>${ERROR_NAMES.matrix}</th><th>${ERROR_NAMES.line}</th>
    <th>Pinpointed</th><th>Right value in note</th><th>False flags</th><th>Unresolved targets</th><th>Invalid tool calls</th><th>Latency, median</th></tr></thead>
    <tbody>${now}${before}</tbody></table>`;
}

/** What the shipped tool sent back or refused, and how many calls a reply took. */
function toolTable(scored: Scored[]): string {
  const narrowed = scored.flatMap((s) => s.score.narrowed);
  const then = (t: string) => narrowed.filter((x) => x.then === t).length;
  const calls = scored.map((s) => s.reply.calls.length);
  const placed = scored.map((s) => s.score.placed.length);
  return `<table class="leader"><thead><tr><th>Asked to narrow</th><th>…then narrowed</th><th>…sent again whole</th><th>…dropped</th>
    <th>Cap refusals</th><th>Model calls a reply, median</th><th>Annotations placed a reply, median</th><th>Replies placing none</th></tr></thead><tbody><tr>
    <td class="num">${narrowed.length} <small>in ${scored.filter((s) => s.score.narrowed.length).length} replies</small></td>
    <td class="num">${then("narrowed")}</td><td class="num">${then("sent whole")}</td><td class="num">${then("dropped")}</td>
    <td class="num">${scored.reduce((n, s) => n + s.score.capRefusals, 0)}</td>
    <td class="num">${calls.length ? `${median(calls)} <small>${Math.min(...calls)}–${Math.max(...calls)}</small>` : "—"}</td>
    <td class="num">${placed.length ? `${median(placed)} <small>${Math.min(...placed)}–${Math.max(...placed)}</small>` : "—"}</td>
    <td class="num">${placed.filter((p) => p === 0).length}</td></tr></tbody></table>`;
}

function byBoard(scored: Scored[], boards: BoardFile[]): string {
  const cell = (b: BoardFile) => {
    const mine = scored.filter((s) => s.board.name === b.name);
    if (!mine.length) return `<td class="none">not run yet</td>`;
    return `<td>${b.errors.map((e) => `${ERROR_NAMES[e.id]} ${mine.filter((s) => s.score.errors[e.id].hit).length}/${mine.length}`).join(" · ")}
      · false flags ${mine.reduce((n, s) => n + s.score.falseFlags, 0)}</td>`;
  };
  return `<table class="leader"><thead><tr><th>Board</th><th>This run</th><th>First run</th></tr></thead><tbody>
    ${boards.map((b) => `<tr><td><a href="#board-${b.name}">${esc(b.name)}</a></td>${cell(b)}<td class="before">${FIRST_RUN.byBoard[b.name]}</td></tr>`).join("")}</tbody></table>`;
}

// ── one reply ───────────────────────────────────────────────────────────────

function boardBox(b: BoardFile): Box {
  const xs = b.elements.flatMap((e) => [e.x, e.x + e.width]);
  const ys = b.elements.flatMap((e) => [e.y, e.y + e.height]);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

const pad = (b: Box, p: number): Box => ({ minX: b.minX - p, minY: b.minY - p, maxX: b.maxX + p, maxY: b.maxY + p });

function markSvg(p: PlacedScore, i: number): string {
  const e = p.element;
  const b = pad({ minX: e.x, minY: e.y, maxX: e.x + e.width, maxY: e.y + e.height }, 5);
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  const shape = e.props.mark === "circle" ? `<ellipse cx="${b.minX + w / 2}" cy="${b.minY + h / 2}" rx="${w / 2 + 6}" ry="${h / 2 + 4}"/>`
    : e.props.mark === "underline" ? `<line x1="${b.minX}" y1="${b.maxY}" x2="${b.maxX}" y2="${b.maxY}"/>`
    : `<rect x="${b.minX}" y="${b.minY}" width="${w}" height="${h}"${e.props.mark === "none" ? ` class="faint"` : ""}/>`;
  return `<g class="annot">${shape}<text x="${b.minX}" y="${b.minY - 8}">${i + 1}</text></g>`;
}

function replySvg(s: Scored): string {
  const v = pad(boardBox(s.board), 30);
  const planted = s.board.errors.map((e) => {
    const b = pad(e.box, 9);
    return `<rect x="${b.minX}" y="${b.minY}" width="${b.maxX - b.minX}" height="${b.maxY - b.minY}"/>`;
  }).join("");
  return `<svg class="board" viewBox="${v.minX} ${v.minY} ${v.maxX - v.minX} ${v.maxY - v.minY}" role="img" aria-label="${esc(s.board.name)} with the annotations placed">
    ${s.board.elements.map(elementSvg).join("")}<g class="planted">${planted}</g>${s.score.placed.map(markSvg).join("")}</svg>`;
}

function verdict(p: PlacedScore): string {
  const kind = p.element.props.kind;
  const parts = p.on.map((id) => (kind === "error" || kind === "hint"
    ? `<span class="ok">hit: ${ERROR_NAMES[id]}</span> <small>${p.pinpoints.includes(id) ? "pinpointed" : "overlaps"}</small>`
    : `<span class="bad">on ${ERROR_NAMES[id]}, as ${kind}</span>`));
  if (p.falseFlag) parts.push(`<span class="bad">false flag</span>`);
  return parts.join("<br>") || `<small>—</small>`;
}

function replyCard(s: Scored): string {
  const { reply, score } = s;
  const head = [
    `#${reply.repeat}`, secs(reply.latencyMs), `${reply.calls.length} call${reply.calls.length === 1 ? "" : "s"}`,
    reply.timedOut ? `<span class="bad">cut off</span>` : reply.error ? `<span class="bad">failed</span>` : "",
    ...s.board.errors.map((e) => yes(score.errors[e.id].hit, ERROR_NAMES[e.id])),
    score.falseFlags ? `<span class="bad">${score.falseFlags} false flag${score.falseFlags > 1 ? "s" : ""}</span>` : "no false flags",
  ].filter(Boolean).join(" · ");
  const rows = score.placed.map((p, i) => `<tr>
    <td class="num">${i + 1}</td><td><code>${esc(p.element.props.target)}</code></td>
    <td>${esc(p.element.props.kind)}</td><td>${esc(p.element.props.mark)}</td>
    <td class="note">${esc(p.element.props.note)}</td><td>${verdict(p)}</td></tr>`).join("");
  const calls = reply.calls.map((c, i) => {
    const tools = score.toolCalls.filter((t) => t.call === i + 1);
    return `<li><b>Call ${i + 1}</b> <small>${secs(c.latencyMs)} · tool ${c.offered ? "offered" : "not offered"} · stop ${esc(String(c.stopReason))}</small>
      ${c.errors.length ? `<span class="bad">${c.errors.map(esc).join("; ")}</span>` : ""}
      ${c.text.trim() ? `<details><summary>Said (${c.text.length} chars)</summary><div class="reply">${esc(c.text)}</div></details>` : ""}
      ${tools.map((t) => `<pre>${esc(JSON.stringify(t.input, null, 2))}</pre>
        ${t.result === null ? `<p class="meta">Not acted on: the tool wasn't offered.</p>` : `<pre class="result${t.invalid ? " bad" : ""}">${esc(t.result)}</pre>`}`).join("")}</li>`;
  }).join("");
  return `<div class="call">
    <h4>${head}</h4>
    ${reply.error ? `<p class="errors">${esc(reply.error)}</p>` : ""}
    ${replySvg(s)}
    ${rows ? `<div class="scroll"><table class="ann"><thead><tr><th>#</th><th>Placed on</th><th>Kind</th><th>Mark</th><th>Note</th><th>Scored as</th></tr></thead><tbody>${rows}</tbody></table></div>` : "<p class=\"meta\">Nothing placed.</p>"}
    ${s.board.errors.map((e) => `<p class="meta">${ERROR_NAMES[e.id]}: ${score.errors[e.id].hit ? `right value (${esc(e.correct)}) in the note ${score.errors[e.id].rightValue ? "✓" : "✗"}` : "missed"}${score.errors[e.id].kinds.length ? ` · annotated as ${score.errors[e.id].kinds.join(", ")}` : ""}</p>`).join("")}
    ${score.narrowed.length ? `<p class="meta">Asked to narrow: ${score.narrowed.map((x) => `${esc(x.address)} (${x.then})`).join(", ")}</p>` : ""}
    ${reply.text.trim() ? `<details><summary>The reply (${reply.text.length} chars)</summary><div class="reply">${esc(reply.text)}</div></details>` : `<p class="meta">No words in the reply.</p>`}
    <details><summary>Model calls and what the tool said</summary><ol class="calls">${calls}</ol></details>
  </div>`;
}

// ── page ────────────────────────────────────────────────────────────────────

const CSS = `${READER_CSS}
:root { --annot:#481715; --planted:#15803d; }
@media (prefers-color-scheme: dark) { :root { --annot:#e3958b; --planted:#4ade80; } }
body { max-width: 1680px; }
.leader td, .leader th { font-size: 13px; }
.leader td.none { color: var(--muted); font-style: italic; }
.leader tr.before, .leader td.before { color: var(--muted); }
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
.ann td, .ann th { font-size: 12px; } .ann td.note { min-width: 220px; }
.reply { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 13px; max-height: 480px; overflow-y: auto; }
ol.calls li { margin-bottom: 8px; } pre.result { white-space: pre-wrap; } pre.result.bad { border-left: 3px solid var(--bad, #b91c1c); }
.key span { display: inline-block; width: 22px; height: 0; border-top: 3px solid; vertical-align: middle; margin-right: 4px; }
`;

export function buildReport(dir: string): string {
  const read = <T>(f: string) => JSON.parse(readFileSync(join(dir, f), "utf8")) as T;
  const summary = existsSync(join(dir, "summary.json")) ? read<SummaryFile>("summary.json") : null;
  const files = readdirSync(dir);
  const boards = files.filter((f) => /^board\..+\.json$/.test(f)).map((f) => read<BoardFile>(f));
  const order = (b: BoardFile) => ["clean", "jitter1", "jitter2"].indexOf(b.name);
  boards.sort((a, b) => order(a) - order(b));
  const replies = files.filter((f) => /^reply\..+\.json$/.test(f)).map((f) => read<ReplyFile>(f));

  // Every reply is scored against a fresh read of its board: the same doc the run placed by (the read is deterministic).
  const docs = new Map(boards.map((b) => [b.name, readCanvas(b.elements).doc]));
  const scored: Scored[] = replies.flatMap((reply) => {
    const board = boards.find((b) => b.name === reply.board);
    return board ? [{ reply, board, score: scoreReply(reply.calls, { elements: board.elements, doc: docs.get(board.name)! }, board.errors) }] : [];
  }).sort((a, b) => a.reply.repeat - b.reply.repeat);
  const expected = (summary?.options.repeats ?? 0) * boards.length;

  const meta = [
    `run <b>${esc(dir.split("/").filter(Boolean).pop()!)}</b>`,
    summary ? `${esc(summary.model)}, thinking on, output cap ${summary.prompt.maxTokens} tokens a call, at most ${summary.prompt.maxModelCalls} calls and ${summary.prompt.maxAnnotations} annotations a reply` : "",
    `${replies.length} of ${expected || "?"} replies`,
    summary?.finishedAt ? `finished ${esc(summary.finishedAt.slice(0, 16).replace("T", " "))} UTC` : "<b>still running, or stopped</b> — reload for more",
    summary?.options.maxReplyMinutes ? `replies cut off after ${summary.options.maxReplyMinutes} minutes` : "",
  ].filter(Boolean).join(" · ");

  const boardSections = boards.map((b) => `
    <section class="board-sec" id="board-${b.name}">
      <h2>${esc(b.name)} <small>${b.jitterSeed === null ? "clean hand" : `jitter seed ${b.jitterSeed}`}</small></h2>
      <ul>${b.errors.map((e) => `<li><b>${ERROR_NAMES[e.id]}</b> — ${esc(e.what)} <small>strokes ${e.strokeIds.join(", ")}</small></li>`).join("")}</ul>
      <details><summary>Text sent (${b.sent.length} chars)</summary><pre>${esc(b.sent)}</pre></details>
      <div class="cols">${scored.filter((s) => s.board.name === b.name).map(replyCard).join("") || "<p class=\"meta\">Not run yet.</p>"}</div>
    </section>`).join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Canvas annotate eval</title><style>${CSS}</style></head>
<body>
<h1>Canvas annotate eval</h1>
<p class="meta">${meta}</p>
<div class="callout">
<p>Does the canvas chat, as it ships, find the mistakes on a whiteboard and mark them? Each board is the 8-step matrix reduction with one wrong entry
(M8 row 1 col 4: R1 = R1 - R2 gives 3 - 2 = 1, but 5 is written) and a handwritten “2 + 2 = 5”. The whole board is read as the canvas chat reads it and sent with
“${esc(summary?.prompt.message ?? "Check my work.")}” through the chat's own reply loop: its system prompt, the <code>annotate_canvas</code> tool, the cap on
annotations a reply and the ask-once-for-the-entry bounce (lib/canvas/chatTurn.ts, annotate.ts). Targets are labels from the read.</p>
<p><b>Hit</b>: a placed annotation of kind error or hint on the planted error's strokes. <b>Pinpointed</b>: on exactly the wrong cell or word, not a whole row,
matrix or line. <b>Right value</b>: a hitting note has the correct value in it, addresses aside. <b>False flag</b>: a placed error annotation on anything else.
<b>Invalid</b>: a tool call to another tool, or with an annotation not in the tool's shape. <b>Asked to narrow</b>: an error on a whole matrix, line, row or column,
sent back once by the tool. <b>Cap refusal</b>: a call asking for more annotations than the reply had left.</p>
<p>The first run sent one call with the eval's own tool — no cap, no bounce, and the result never went back to the model; its numbers are beside this run's.</p>
<p class="key"><span style="border-color:var(--planted);border-top-style:dashed"></span>planted error <span style="border-color:var(--annot);margin-left:12px"></span>a placed annotation's place, numbered as in its table, drawn as its mark (dashed: mark “none”)</p>
</div>
${summary ? `<details><summary>System prompt, message and tool (the same for every reply)</summary><pre>${esc(summary.prompt.system)}</pre><pre>${esc(summary.prompt.message)}</pre>
  <pre>${esc(JSON.stringify(summary.prompt.tool, null, 2))}</pre></details>` : ""}
<h2>Leaderboard</h2>
<div class="scroll">${leaderboard(scored)}</div>
<p class="meta">Rates are over every reply, two planted errors each; a failed or cut-off reply counts as missing both. Latency is the whole reply, every call and thinking included.</p>
<h3>What the tool sent back</h3>
<div class="scroll">${toolTable(scored)}</div>
<h3>By board</h3>
<div class="scroll">${byBoard(scored, boards)}</div>
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
