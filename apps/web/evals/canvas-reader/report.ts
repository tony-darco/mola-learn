/**
 * Builds report.html for one canvas-reader eval run: a single self-contained
 * page (inline CSS and SVG, no external requests), in the canvas-syntax
 * report's style — the leaderboard, then per board: the board as drawn with
 * every item's label, the reader's checks, the full read the models were
 * given (and, for the clean board, some reads of selected regions), then
 * every model's answer to every question against the expected one.
 *
 * Reads only the run's JSON files, so it also works on a run that was
 * stopped part-way:
 *
 *   pnpm --filter @mola/web exec tsx evals/canvas-reader/report.ts evals/canvas-reader/output/<timestamp>
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { CanvasElement } from "@mola/shared";
import type { ReadItem, Region } from "@/lib/canvas/textSyntax/read";
import { CSS as SYNTAX_CSS, esc, pct, secs } from "../canvas-syntax/report";
import type { AnswerResult } from "./questions";
import type { Check } from "./score";

/** One model's answers on one board. */
export type QaRun = {
  model: string; fixture: string; run: number; think: boolean; validJson: boolean;
  passed: number; total: number; results: AnswerResult[];
  latencyMs: number; firstTokenMs: number | null; stopReason: string | null; errors: string[]; attempts: number;
  prompt: { system: string; user: string }; raw: string; parsed: Record<string, unknown> | null;
};
type BoardFile = {
  fixture: string; jitterSeed: number | null; penArrowHead: string;
  read: string; items: ReadItem[]; checks: Check[];
  regions: { title: string; region: Region; text: string }[];
  elements: CanvasElement[];
};
type SummaryFile = { options: { models: string[]; fixtures: string[]; think: boolean } };

export type LeaderRow = {
  model: string; fixture: string; runs: number;
  /** Mean fraction of questions answered right. */
  accuracy: number; validJson: number; meanLatencyMs: number;
  /** Calls that ended in an error (cut off, unreachable host) — their scores are in the means as zeros. */
  failedCalls: number;
};

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function loadRuns(dir: string): QaRun[] {
  return readdirSync(dir).filter((f) => /^qa\..+\.json$/.test(f)).sort().map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as QaRun);
}

export function leaderboard(runs: QaRun[]): LeaderRow[] {
  const groups = new Map<string, QaRun[]>();
  for (const r of runs) groups.set(`${r.model}\u0000${r.fixture}`, [...(groups.get(`${r.model}\u0000${r.fixture}`) ?? []), r]);
  return [...groups.values()].map((rs) => ({
    model: rs[0]!.model, fixture: rs[0]!.fixture, runs: rs.length,
    accuracy: mean(rs.map((r) => r.passed / r.total)),
    validJson: mean(rs.map((r) => (r.validJson ? 1 : 0))),
    meanLatencyMs: mean(rs.map((r) => r.latencyMs)),
    failedCalls: rs.filter((r) => r.errors.length > 0).length,
  }));
}

// ── the board, drawn ────────────────────────────────────────────────────────

function arrowHead(tip: { x: number; y: number }, from: { x: number; y: number }): string {
  const a = Math.atan2(from.y - tip.y, from.x - tip.x);
  const p = (d: number) => `${tip.x + 14 * Math.cos(a + d)},${tip.y + 14 * Math.sin(a + d)}`;
  return `<polygon class="head" points="${tip.x},${tip.y} ${p(Math.PI / 6)} ${p(-Math.PI / 6)}"/>`;
}

function typedText(x: number, y: number, text: string, size: number, cls: string): string {
  return `<text class="${cls}" x="${x}" y="${y}" style="font-size:${size}px">${text.split("\n").map((l, i) => `<tspan x="${x}" dy="${i === 0 ? size : size * 1.25}">${esc(l)}</tspan>`).join("")}</text>`;
}

export function elementSvg(e: CanvasElement): string {
  switch (e.type) {
    case "draw": {
      const points = e.props.points.map((p) => `${e.x + p.x},${e.y + p.y}`).join(" ");
      return e.props.variant === "highlighter"
        ? `<polyline class="hl" points="${points}" style="stroke-width:${e.props.strokeWidth * 3}"/>`
        : `<polyline class="pen" points="${points}"/>`;
    }
    case "line": {
      const a = { x: e.x, y: e.y };
      const b = { x: e.x + e.props.endX, y: e.y + e.props.endY };
      return `<line class="tool" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>${e.props.endArrow ? arrowHead(b, a) : ""}${e.props.startArrow ? arrowHead(a, b) : ""}`;
    }
    case "shape": {
      const { x, y, width: w, height: h } = e;
      if (e.props.shapeKind === "rectangle") return `<rect class="tool" x="${x}" y="${y}" width="${w}" height="${h}"/>`;
      if (e.props.shapeKind === "ellipse") return `<ellipse class="tool" cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}"/>`;
      if (e.props.shapeKind === "triangle") return `<polygon class="tool" points="${x + w / 2},${y} ${x},${y + h} ${x + w},${y + h}"/>`;
      const star = Array.from({ length: 10 }, (_, i) => {
        const r = (i % 2 === 0 ? 1 / 2 : 1 / 4.5) * Math.min(w, h);
        const a = (Math.PI / 5) * i - Math.PI / 2;
        return `${x + w / 2 + r * Math.cos(a)},${y + h / 2 + r * Math.sin(a)}`;
      });
      return `<polygon class="tool" points="${star.join(" ")}"/>`;
    }
    case "text": return typedText(e.x, e.y, e.props.text, e.props.fontSize, e.createdBy === "ai" ? "typed ai" : "typed");
    case "note": return `<rect class="note" x="${e.x}" y="${e.y}" width="${e.width}" height="${e.height}"/>${typedText(e.x + 8, e.y + 6, e.props.text, e.props.fontSize, "typed")}`;
    case "math": return typedText(e.x, e.y, e.props.latex, e.props.fontSize, "latex");
    case "image": return `<rect class="img" x="${e.x}" y="${e.y}" width="${e.width}" height="${e.height}"/>`
      + `<path class="img" d="M${e.x} ${e.y}L${e.x + e.width} ${e.y + e.height}M${e.x + e.width} ${e.y}L${e.x} ${e.y + e.height}"/>`;
    case "frame": return `<rect class="frame" x="${e.x}" y="${e.y}" width="${e.width}" height="${e.height}"/><text class="frame-name" x="${e.x + 30}" y="${e.y + e.height + 17}">${esc(e.props.name)}</text>`;
  }
}

/** The board as drawn, each read item's label beside it, and any selected regions outlined. */
function boardSvg(b: BoardFile, regions: BoardFile["regions"] = []): string {
  const pad = 30;
  const xs: number[] = [];
  const ys: number[] = [];
  for (const e of b.elements) {
    if (e.type === "line") {
      xs.push(e.x, e.x + e.props.endX);
      ys.push(e.y, e.y + e.props.endY);
    } else {
      xs.push(e.x, e.x + e.width);
      ys.push(e.y, e.y + e.height);
    }
  }
  const [minX, minY, maxX, maxY] = [Math.min(...xs) - pad - 20, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad];
  // Lines of writing are labelled on their left, marks on their right, connectors at their middle, frames under their corner, the rest above it.
  const labels = b.items.map((i) => {
    const midY = (i.box.minY + i.box.maxY) / 2;
    const at = (x: number, y: number, anchor = "start") => `<text class="lbl" x="${x}" y="${y}" text-anchor="${anchor}">${i.label}</text>`;
    switch (i.kind) {
      case "writing": return at(i.box.minX - 6, midY + 5, "end");
      case "arrow": case "line": return at((i.box.minX + i.box.maxX) / 2 + 6, midY);
      case "circle": case "underline": case "highlight": case "shape": return at(i.box.maxX + 6, midY + 5);
      case "frame": return at(i.box.minX, i.box.maxY + 18);
      default: return at(i.box.minX, i.box.minY - 5);
    }
  }).join("");
  const outlines = regions.map((r, n) => `<g class="region"><rect x="${r.region.minX}" y="${r.region.minY}" width="${r.region.maxX - r.region.minX}" height="${r.region.maxY - r.region.minY}"/>`
    + `<text x="${r.region.maxX - 4}" y="${r.region.maxY - 6}" text-anchor="end">region ${n + 1}</text></g>`).join("");
  return `<svg class="board" viewBox="${minX} ${minY} ${maxX - minX} ${maxY - minY}" role="img" aria-label="The ${esc(b.fixture)} board">
    ${b.elements.map(elementSvg).join("")}<g>${labels}</g>${outlines}</svg>`;
}

// ── pieces ──────────────────────────────────────────────────────────────────

function leaderTable(rows: LeaderRow[], fixtures: string[]): string {
  const models = [...new Set(rows.map((r) => r.model))]
    .sort((a, b) => mean(rows.filter((r) => r.model === b).map((r) => r.accuracy)) - mean(rows.filter((r) => r.model === a).map((r) => r.accuracy)) || (a < b ? -1 : 1));
  const cell = (r: LeaderRow | undefined) => (!r ? `<td class="none first" colspan="3">not run</td>`
    : `<td class="num first"><span class="bar"><span style="width:${(r.accuracy * 100).toFixed(1)}%"></span></span>${pct(r.accuracy)}
        ${r.failedCalls ? `<br><small class="bad">${r.failedCalls} call${r.failedCalls === 1 ? "" : "s"} failed</small>` : ""}</td>
      <td class="num">${pct(r.validJson)}</td><td class="num">${secs(r.meanLatencyMs)}</td>`);
  return `<table class="board-table"><thead>
    <tr><th rowspan="2">Model</th>${fixtures.map((f) => `<th colspan="3" class="cond first">${esc(f)}</th>`).join("")}</tr>
    <tr>${fixtures.map(() => `<th class="first">Questions right</th><th>Valid JSON</th><th>Latency</th>`).join("")}</tr></thead>
    <tbody>${models.map((m) => `<tr><td>${esc(m)}</td>${fixtures.map((f) => cell(rows.find((r) => r.model === m && r.fixture === f))).join("")}</tr>`).join("")}</tbody></table>`;
}

function checksTable(checks: Check[]): string {
  const right = checks.filter((c) => c.pass).length;
  return `<table class="checks"><caption>Reader checks — ${right === checks.length ? `<span class="ok">${right}/${checks.length} right</span>` : `<span class="bad">${right}/${checks.length} right</span>`} (no model involved)</caption>
    <thead><tr><th></th><th>What</th><th>Expected</th><th>Read</th></tr></thead><tbody>
    ${checks.map((c) => `<tr class="${c.pass ? "" : "off"}"><td>${c.pass ? `<span class="ok">✓</span>` : `<span class="bad">✗</span>`}</td><td>${esc(c.name)}</td><td>${esc(c.expected)}</td><td>${esc(c.got)}</td></tr>`).join("")}
  </tbody></table>`;
}

function runDetails(r: QaRun): string {
  const head = `${esc(r.model)} · <b>${r.passed}/${r.total}</b> right · JSON ${r.validJson ? "ok" : `<span class="bad">invalid</span>`}
    · ${secs(r.latencyMs)} (first token ${r.firstTokenMs === null ? "never" : secs(r.firstTokenMs)}) · stop ${esc(String(r.stopReason))}
    ${r.errors.length ? ` · <span class="bad">${r.errors.map(esc).join("; ")}</span>` : ""}`;
  return `<div class="qa"><h4>${head}</h4>
    <div class="scroll"><table class="answers"><thead><tr><th></th><th>Question</th><th>Expected</th><th>Got</th></tr></thead><tbody>
    ${r.results.map((a) => `<tr class="${a.pass ? "" : "off"}"><td>${a.pass ? `<span class="ok">✓</span>` : `<span class="bad">✗</span>`}</td>
      <td><code>${esc(a.id)}</code><br><small>${esc(a.question)}</small></td><td><code>${esc(a.expected)}</code></td>
      <td>${a.got === null ? `<i class="bad">no answer</i>` : `<code>${esc(a.got)}</code>`}</td></tr>`).join("")}
    </tbody></table></div>
    <details><summary>Raw reply (${r.raw.length} chars)</summary><pre>${esc(r.raw) || "<i>empty</i>"}</pre></details></div>`;
}

// ── page ────────────────────────────────────────────────────────────────────

export const CSS = `${SYNTAX_CSS}
:root { --note:#fde68a; --hl:rgba(234, 179, 8, .45); --region:#db2777; --ai:#7c3aed; }
@media (prefers-color-scheme: dark) { :root { --note:#5b4a12; --hl:rgba(250, 204, 21, .35); --region:#f472b6; --ai:#c4b5fd; } }
svg.board { width: 100%; height: auto; background: var(--card); border-radius: 6px; display: block; margin: 8px 0; }
svg.board .pen { fill: none; stroke: var(--ink); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
svg.board .hl { fill: none; stroke: var(--hl); stroke-linecap: butt; stroke-linejoin: round; }
svg.board .tool { fill: none; stroke: var(--ink); stroke-width: 2; }
svg.board .head { fill: var(--ink); }
svg.board .note { fill: var(--note); }
svg.board .img { fill: var(--line); stroke: var(--muted); stroke-width: 1.5; }
svg.board .frame { fill: none; stroke: var(--muted); stroke-width: 1.5; stroke-dasharray: 7 5; }
svg.board .frame-name { fill: var(--muted); font: 14px system-ui, sans-serif; }
svg.board text.typed { fill: var(--fg); font-family: system-ui, sans-serif; }
svg.board text.typed.ai { fill: var(--ai); }
svg.board text.latex { fill: var(--fg); font-family: ui-monospace, monospace; }
svg.board text.lbl { fill: var(--accent); font: bold 16px ui-monospace, monospace; }
svg.board .region rect { fill: none; stroke: var(--region); stroke-width: 2.5; stroke-dasharray: 10 6; }
svg.board .region text { fill: var(--region); font: bold 15px ui-monospace, monospace; }
.checks caption { text-align: left; font-weight: 600; padding: 4px 0; }
.checks td, .answers td { font-size: 13px; }
tr.off td { background: var(--bad-bg); }
code { font: 12px ui-monospace, "SF Mono", Menlo, monospace; }
.qa { margin: 12px 0 20px; } .qa h4 { font-weight: 500; }
`;

export function buildReport(dir: string): string {
  const read = <T>(f: string) => JSON.parse(readFileSync(join(dir, f), "utf8")) as T;
  const summary = existsSync(join(dir, "summary.json")) ? read<SummaryFile>("summary.json") : null;
  const boards = readdirSync(dir).filter((f) => /^board\..+\.json$/.test(f)).map((f) => read<BoardFile>(f));
  const runs = loadRuns(dir);
  const fixtures = summary?.options.fixtures ?? boards.map((b) => b.fixture);
  const boardOf = (f: string) => boards.find((b) => b.fixture === f);
  const title = (f: string) => {
    const b = boardOf(f);
    return b ? `${f} — ${b.jitterSeed === null ? "clean hand" : `jitter seed ${b.jitterSeed}`}, pen arrowhead ${b.penArrowHead}` : f;
  };
  const board = leaderboard(runs);

  const meta = [
    `run <b>${esc(dir.split("/").filter(Boolean).pop()!)}</b>`,
    summary ? `thinking ${summary.options.think ? "on (where supported)" : "off"}` : "no summary.json — run incomplete?",
    `${runs.length} model call(s)`,
  ].join(" · ");

  const leaderSection = runs.length === 0 ? "<p>No models were asked.</p>" : `<div class="scroll">${leaderTable(board, fixtures)}</div>
    <p class="meta">Each call asks all ${runs[0]!.total} questions at once, about the read of that board; a question counts as right when its answer matches
    after ignoring case, spacing, dash and minus style, surrounding quotes and a trailing full stop (LaTeX: all spaces; lists: order). Latency includes thinking time;
    each model is loaded once before its first timed call.</p>`;

  const boardSections = fixtures.map((f) => {
    const b = boardOf(f);
    if (!b) return "";
    const regions = b.regions.map((r, n) => `<details${n === 0 ? " open" : ""}><summary>Region ${n + 1}: ${esc(r.title)} — from (${r.region.minX}, ${r.region.minY}) to (${r.region.maxX}, ${r.region.maxY})</summary><pre>${esc(r.text)}</pre></details>`).join("");
    return `<h3>${esc(title(f))}</h3>${boardSvg(b, b.regions)}${checksTable(b.checks)}
      <details><summary>The read given to the models (${b.read.length} chars)</summary><pre>${esc(b.read)}</pre></details>
      ${regions ? `<h4>Reads of selected regions</h4><p class="meta">The same board, read only inside a rectangle (outlined above). Labels are those of the full read.</p>${regions}` : ""}`;
  }).join("");

  const answerSections = fixtures.map((f) => {
    const rs = runs.filter((r) => r.fixture === f).sort((a, b) => (a.model < b.model ? -1 : a.model > b.model ? 1 : a.run - b.run));
    return rs.length ? `<h3>${esc(title(f))}</h3>${rs.map(runDetails).join("")}` : "";
  }).join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Canvas reader eval</title><style>${CSS}</style></head>
<body>
<h1>Canvas reader eval</h1>
<p class="meta">${meta}</p>
<h2>Leaderboard</h2>${leaderSection}
<h2>Boards and their reads</h2>
<p class="meta">Blue labels are the reader's. The reader's checks compare what it says about every pen mark, connector and frame with how the board was built.</p>
${boardSections}
${answerSections ? `<h2>Answers, question by question</h2>${answerSections}` : ""}
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
    console.error("usage: tsx evals/canvas-reader/report.ts <run directory>");
    process.exit(1);
  }
  console.log(writeReport(resolve(dir)));
}
