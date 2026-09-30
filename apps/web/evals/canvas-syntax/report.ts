/**
 * Builds report.html for one canvas-syntax eval run: a single self-contained
 * page (inline CSS, no external requests) to judge the run by eye — the
 * leaderboard with the raw and normalized conditions side by side, the
 * handwriting, its segmentation and recognition, and both syntaxes per
 * fixture, and every step of every model's answer against the truth.
 *
 * Reads only the run's JSON files, so it also works on a run that was
 * stopped part-way:
 *
 *   pnpm --filter @mola/web exec tsx evals/canvas-syntax/report.ts evals/canvas-syntax/output/<timestamp>
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PlannedStep } from "@/e2e/support/matrixPlan";
import {
  leaderboard, suggestedModel,
  type LeaderRow, type NormalizedMetrics, type Reply, type RunSummary, type StageAMetrics, type StepMapping, type StepResult, type summarizeDoc,
} from "./score";

type StageAFile = {
  fixture: string; jitterSeed: number | null;
  /** Runs from before the normalized condition stored only the raw syntax, as a string. */
  syntax: string | { raw: string; normalized: string };
  doc: ReturnType<typeof summarizeDoc>; metrics: StageAMetrics; normalized?: NormalizedMetrics; mapping: StepMapping;
  steps: PlannedStep[]; bounds: { minX: number; minY: number; maxX: number; maxY: number }; strokes: { x: number; y: number }[][];
};
type StageBFile = RunSummary & { think: boolean; firstTokenMs?: number | null; attempts: number; raw: string; parsed: Reply | null; steps: StepResult[] };
type SummaryFile = { createdAt: string; options: { models: string[]; fixtures: string[]; repeats: number; think: boolean } };

const CONDITIONS = ["raw", "normalized"];

/** Every Stage B result in a run directory. Results from before conditions existed were all raw. */
export function loadStageB(dir: string): StageBFile[] {
  return readdirSync(dir).filter((f) => /^stage-b\..+\.json$/.test(f)).sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as StageBFile)
    .map((b) => ({ ...b, condition: b.condition ?? "raw" }));
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
const frac = (a: number, b: number) => `<span class="${a === b ? "ok" : "bad"}">${a}/${b}</span>`;

// ── pieces ──────────────────────────────────────────────────────────────────

/** One fixture's leaderboard: a row per model, the conditions side by side. Models ordered by their normalized cell accuracy. */
function leaderTable(rows: LeaderRow[], suggested: LeaderRow | null): string {
  const conditions = CONDITIONS.filter((c) => rows.some((r) => r.condition === c));
  const rank = (m: string) => Math.max(-1, ...rows.filter((r) => r.model === m).map((r) => r.cellAccuracy.mean + (r.condition === "normalized" ? 1 : 0)));
  const models = [...new Set(rows.map((r) => r.model))].sort((a, b) => rank(b) - rank(a) || (a < b ? -1 : 1));
  const cells = (r: LeaderRow | undefined) => {
    if (!r) return `<td class="none" colspan="5">not run</td>`;
    const pick = suggested && r.model === suggested.model && r.fixture === suggested.fixture && r.condition === suggested.condition ? " pick" : "";
    return `<td class="num first${pick}"><span class="bar"><span style="width:${(r.cellAccuracy.mean * 100).toFixed(1)}%"></span></span>${pct(r.cellAccuracy.mean)}
        <small>${r.runs > 1 ? `${pct(r.cellAccuracy.min)}–${pct(r.cellAccuracy.max)}, ` : ""}${r.runs} run${r.runs === 1 ? "" : "s"}</small>
        ${r.failedCalls ? `<br><small class="bad">${r.failedCalls} call${r.failedCalls === 1 ? "" : "s"} failed — see below</small>` : ""}</td>
      <td class="num${pick}">${pct(r.matricesExact)}</td><td class="num${pick}">${pct(r.textExact)} <small>(${pct(r.textSimilarity)})</small></td>
      <td class="num${pick}">${pct(r.validJson)}</td><td class="num${pick}">${secs(r.meanLatencyMs)}</td>`;
  };
  const head = `<tr><th rowspan="2">Model</th>${conditions.map((c) => `<th colspan="5" class="cond first">${esc(c)}</th>`).join("")}</tr>
    <tr>${conditions.map(() => `<th class="first">Cell accuracy <small>mean</small></th><th>Matrices exact</th><th>Text exact <small>(similarity)</small></th><th>Valid JSON</th><th>Mean latency</th>`).join("")}</tr>`;
  const body = models.map((m) => `<tr><td>${esc(m)}</td>${conditions.map((c) => cells(rows.find((r) => r.model === m && r.condition === c))).join("")}</tr>`).join("");
  return `<table class="board"><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

function stageAMetrics(m: StageAMetrics): string {
  return `<table class="metrics"><caption>Segmentation — strokes into structure</caption><tbody>
    <tr><th>Matrices matched</th><td>${frac(m.matrices.matched, m.matrices.expected)} <small>(found ${m.matrices.found})</small></td></tr>
    <tr><th>Shapes (rows × cols, bar)</th><td>${frac(m.shapes.correct, m.shapes.expected)}</td></tr>
    <tr><th>Glyphs exact</th><td>${frac(m.glyphs.correct, m.glyphs.expected)}</td></tr>
    <tr><th>Cells exact</th><td>${frac(m.cells.correct, m.cells.expected)}</td></tr>
    <tr><th>Text lines exact</th><td>${frac(m.texts.correct, m.texts.expected)}</td></tr>
  </tbody></table>`;
}

const misreadList = (m: NormalizedMetrics) => m.confusions.map((c) => `${esc(c.expected)} → ${esc(c.got)} <small>×${c.count}</small>`).join(", ");

/** Recognition on jittered hands it was not tuned on — one row per seed, then the total. */
function heldOutTable(rows: (NormalizedMetrics & { seed: number })[]): string {
  const sum = (f: (m: NormalizedMetrics) => number) => rows.reduce((n, m) => n + f(m), 0);
  const line = (label: string, g: [number, number], fallback: number, wrong: number, cells: [number, number], texts: [number, number], misreads: string) =>
    `<tr><th>${label}</th><td>${frac(...g)}</td><td class="num">${fallback}</td><td class="num ${wrong ? "bad" : "ok"}">${wrong}</td><td>${frac(...cells)}</td><td>${frac(...texts)}</td><td>${misreads}</td></tr>`;
  return `<table class="metrics"><caption>Recognition on held-out hands (jitter seeds 3–5)</caption>
    <thead><tr><th></th><th>Characters</th><th>Uncertain</th><th>Misread, not flagged</th><th>Cells</th><th>Text lines</th><th>Misreads</th></tr></thead><tbody>
    ${rows.map((m) => line(`seed ${m.seed}`, [m.glyphs.correct, m.glyphs.expected], m.glyphs.fallback, m.glyphs.confidentWrong,
      [m.cells.correct, m.cells.expected], [m.texts.correct, m.texts.expected], misreadList(m) || "none")).join("")}
    ${line("total", [sum((m) => m.glyphs.correct), sum((m) => m.glyphs.expected)], sum((m) => m.glyphs.fallback), sum((m) => m.glyphs.confidentWrong),
      [sum((m) => m.cells.correct), sum((m) => m.cells.expected)], [sum((m) => m.texts.correct), sum((m) => m.texts.expected)], "")}
  </tbody></table>`;
}

function normalizedMetrics(m: NormalizedMetrics): string {
  const misreads = misreadList(m);
  return `<table class="metrics"><caption>Recognition — what we wrote vs what was read</caption><tbody>
    <tr><th>Characters read correctly</th><td>${frac(m.glyphs.correct, m.glyphs.expected)}</td></tr>
    <tr><th>Left uncertain (shown as bitmaps)</th><td>${m.glyphs.fallback}</td></tr>
    <tr><th>Misread and not flagged</th><td class="${m.glyphs.confidentWrong ? "bad" : "ok"}">${m.glyphs.confidentWrong}</td></tr>
    <tr><th>Cells exact</th><td>${frac(m.cells.correct, m.cells.expected)}</td></tr>
    <tr><th>Text lines exact</th><td>${frac(m.texts.correct, m.texts.expected)}</td></tr>
    <tr><th>Misreads</th><td>${misreads || `<span class="ok">none</span>`}</td></tr>
  </tbody></table>`;
}

/** The handwriting itself, with the blocks segmentation found outlined and labelled. */
function handwritingSvg(a: StageAFile): string {
  const pad = 24;
  const { minX, minY, maxX, maxY } = a.bounds;
  const lines = a.strokes.map((s) => `<polyline points="${s.map((p) => `${p.x},${p.y}`).join(" ")}"/>`).join("");
  const blocks = a.doc.map((b) => {
    const label = b.kind === "matrix"
      ? `<text x="${b.box.x}" y="${b.box.y - 5}">${b.id}</text>`
      : `<text x="${b.box.x - 6}" y="${b.box.y + b.box.h / 2 + 5}" text-anchor="end">${b.id}</text>`;
    return `<rect x="${b.box.x - 3}" y="${b.box.y - 3}" width="${b.box.w + 6}" height="${b.box.h + 6}"/>${label}`;
  }).join("");
  return `<svg class="ink" viewBox="${minX - pad - 20} ${minY - pad} ${maxX - minX + 2 * pad + 20} ${maxY - minY + 2 * pad}" role="img" aria-label="Handwriting for ${esc(a.fixture)}">
    <g class="strokes">${lines}</g><g class="blocks">${blocks}</g></svg>`;
}

function matrixTable(rows: string[][], cls: string): string {
  return `<table class="mx ${cls}">${rows.map((r) => `<tr>${r.map((v) => `<td>${esc(v)}</td>`).join("")}</tr>`).join("")}</table>`;
}

function gotTable(s: StepResult): string {
  if (!s.got) return `<div class="missing">${s.matrixId ? `no ${esc(s.matrixId)} in reply` : "matrix not segmented"}</div>`;
  const rows = Math.max(s.got.length, s.expected.length);
  const body = Array.from({ length: rows }, (_, r) => {
    const cols = Math.max(s.got![r]?.length ?? 0, s.expected[r]?.length ?? 0);
    return `<tr>${Array.from({ length: cols }, (_, c) => {
      const got = s.got![r]?.[c];
      const exp = s.expected[r]?.[c];
      if (exp === undefined) return `<td class="extra">${esc(got ?? "")}</td>`;
      if (s.correct[r]![c]) return `<td>${esc(got!)}</td>`;
      return `<td class="wrong">${got === undefined ? "∅" : esc(got)}<small>${esc(exp)}</small></td>`;
    }).join("")}</tr>`;
  }).join("");
  return `<table class="mx got">${body}</table>`;
}

function stepCard(s: StepResult): string {
  const label = s.expectedText === null ? "" : `<div class="label ${s.textExact ? "" : "off"}">
      <div><span class="k">exp</span> ${esc(s.expectedText)}</div>
      <div><span class="k">got</span> ${s.gotText === null ? `<i>${s.textId ? `no ${esc(s.textId)} in reply` : "not segmented"}</i>` : esc(s.gotText)}
        ${s.textExact ? "" : `<small>(${pct(s.textSimilarity)})</small>`}</div></div>`;
  return `<div class="step ${s.matrixExact ? "" : "off"}"><h5>Step ${s.step + 1} <small>${esc(s.matrixId ?? "–")}${s.textId ? ` / ${esc(s.textId)}` : ""}</small></h5>
    <div class="pair"><div><div class="k">expected</div>${matrixTable(s.expected, "exp")}</div><div><div class="k">got</div>${gotTable(s)}</div></div>${label}</div>`;
}

function runDetails(b: StageBFile): string {
  const s = b.scores;
  const head = `run ${b.run} · cells ${frac(s.cells.correct, s.cells.total)} (${pct(s.cells.accuracy)}) · matrices ${frac(s.matrices.exact, s.matrices.total)}
    · text ${frac(s.texts.exact, s.texts.total)} (sim ${pct(s.texts.similarity)}) · JSON ${b.validJson ? "ok" : `<span class="bad">invalid</span>`}
    · ${secs(b.latencyMs)}${b.firstTokenMs === undefined ? "" : ` (first token ${b.firstTokenMs === null ? "never" : secs(b.firstTokenMs)})`} · stop ${esc(String(b.stopReason))}${b.errors.length ? ` · <span class="bad">${b.errors.length} error(s)</span>` : ""}`;
  const errors = b.errors.length ? `<ul class="errors">${b.errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>` : "";
  return `<details class="run"><summary>${head}</summary>${errors}
    <div class="steps">${b.steps.map(stepCard).join("")}</div>
    <details><summary>Raw reply (${b.raw.length} chars)</summary><pre>${esc(b.raw) || "<i>empty</i>"}</pre></details></details>`;
}

// ── page ────────────────────────────────────────────────────────────────────

const CSS = `
:root { color-scheme: light dark; --bg:#ffffff; --fg:#1c1b18; --muted:#6b6860; --line:#ddd9cf; --card:#f7f5ee;
  --ok:#15803d; --bad:#b91c1c; --bad-bg:#fde2e2; --pick:#fff7d6; --accent:#2563eb; --ink:#1c1b18; }
@media (prefers-color-scheme: dark) { :root { --bg:#161513; --fg:#ece9e1; --muted:#a19d93; --line:#3a3833; --card:#211f1c;
  --ok:#4ade80; --bad:#f87171; --bad-bg:#4a1f1f; --pick:#3a3214; --accent:#60a5fa; --ink:#ece9e1; } }
* { box-sizing: border-box; }
body { margin: 0 auto; max-width: 1200px; padding: 16px 16px 64px; background: var(--bg); color: var(--fg);
  font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
h1 { font-size: 22px; margin: 8px 0 4px; } h2 { font-size: 18px; margin: 32px 0 8px; border-bottom: 1px solid var(--line); padding-bottom: 4px; }
h3 { font-size: 15px; margin: 20px 0 6px; } h4 { font-size: 14px; margin: 14px 0 4px; } h5 { font-size: 13px; margin: 0 0 6px; }
small, .meta, .k { color: var(--muted); } small { font-size: 11px; margin-left: 4px; }
.ok { color: var(--ok); font-weight: 600; } .bad { color: var(--bad); font-weight: 600; }
table { border-collapse: collapse; } th, td { padding: 4px 8px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
.num { text-align: right; white-space: nowrap; }
.scroll { overflow-x: auto; }
.board td.pick { background: var(--pick); }
.board .first { border-left: 2px solid var(--line); }
.board th.cond { text-align: center; text-transform: uppercase; letter-spacing: .04em; font-size: 12px; }
.board td.none { color: var(--muted); font-style: italic; text-align: center; border-left: 2px solid var(--line); }
.bar { display: inline-block; width: 60px; height: 8px; margin-right: 6px; background: var(--line); border-radius: 4px; overflow: hidden; vertical-align: middle; }
.bar span { display: block; height: 100%; background: var(--accent); }
.callout { background: var(--card); border-left: 4px solid var(--accent); padding: 8px 12px; }
.metrics th { font-weight: 500; }
.metrics caption { text-align: left; font-weight: 600; padding: 4px 0; }
.stage-a { display: flex; gap: 24px; flex-wrap: wrap; align-items: flex-start; }
svg.ink { width: 100%; max-width: 900px; height: auto; background: var(--card); border-radius: 6px; display: block; margin: 8px 0; }
svg.ink .strokes polyline { fill: none; stroke: var(--ink); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
svg.ink .blocks rect { fill: none; stroke: var(--accent); stroke-width: 1; stroke-dasharray: 4 3; opacity: .7; }
svg.ink .blocks text { fill: var(--accent); font: 16px ui-monospace, monospace; }
pre { background: var(--card); padding: 8px; overflow-x: auto; font: 12px/1.25 ui-monospace, "SF Mono", Menlo, monospace; max-height: 480px; }
details { margin: 6px 0; } summary { cursor: pointer; }
details.run > summary { padding: 4px 0; }
.steps { display: grid; grid-template-columns: repeat(auto-fill, minmax(270px, 1fr)); gap: 8px; margin: 8px 0; }
.step { background: var(--card); border-radius: 6px; padding: 8px; border: 1px solid transparent; }
.step.off { border-color: var(--bad); }
.pair { display: flex; gap: 12px; flex-wrap: wrap; }
.mx td { border: 1px solid var(--line); padding: 1px 6px; text-align: right; font: 12px ui-monospace, monospace; min-width: 26px; }
.mx td.wrong { background: var(--bad-bg); color: var(--bad); font-weight: 600; }
.mx td.wrong small { display: block; font-weight: 400; margin: 0; }
.mx td.extra { color: var(--muted); font-style: italic; }
.missing { color: var(--bad); font-style: italic; padding: 4px 0; }
.label { margin-top: 6px; font: 12px ui-monospace, monospace; } .label.off { color: var(--bad); }
.label .k { display: inline-block; width: 28px; }
.errors { color: var(--bad); }
`;

export function buildReport(dir: string): string {
  const read = <T>(f: string) => JSON.parse(readFileSync(join(dir, f), "utf8")) as T;
  const summary = existsSync(join(dir, "summary.json")) ? read<SummaryFile>("summary.json") : null;
  const stageA = readdirSync(dir).filter((f) => /^stage-a\..+\.json$/.test(f)).sort().map((f) => read<StageAFile>(f));
  const stageB = loadStageB(dir);
  const heldOut = existsSync(join(dir, "recognition-held-out.json")) ? read<(NormalizedMetrics & { seed: number })[]>("recognition-held-out.json") : null;

  const fixtures = summary?.options.fixtures ?? stageA.map((a) => a.fixture);
  const models = [...new Set([...(summary?.options.models ?? []), ...stageB.map((b) => b.model)])];
  const board = leaderboard(stageB);
  const suggested = suggestedModel(board, "normalized");
  const bestRaw = suggestedModel(board, "raw");
  const byFixture = (f: string) => stageA.find((a) => a.fixture === f);
  const fixtureTitle = (f: string) => {
    const seed = byFixture(f)?.jitterSeed;
    return seed === null || seed === undefined ? f : `${f} (seed ${seed})`;
  };

  const meta = [
    `run <b>${esc(dir.split("/").filter(Boolean).pop()!)}</b>`,
    summary ? `thinking ${summary.options.think ? "on (where supported)" : "off"}` : "no summary.json — run incomplete?",
    CONDITIONS.map((c) => `${stageB.filter((b) => b.condition === c).length} ${c} call(s)`).join(", "),
  ].join(" · ");

  const leaderSection = stageB.length === 0 ? `<p>Stage B was not run.</p>` : `
    <p class="callout">${suggested
      ? `Suggested canvas model: <b>${esc(suggested.model)}</b> — best mean cell accuracy on the jitter fixture with the normalized syntax (${pct(suggested.cellAccuracy.mean)}, ${secs(suggested.meanLatencyMs)} per call); ties go to text accuracy, then latency.`
      : "No normalized runs on the jitter fixture, so no suggestion."}
      ${bestRaw ? `<br><small>With raw bitmaps the best on jitter was ${esc(bestRaw.model)} at ${pct(bestRaw.cellAccuracy.mean)} (${secs(bestRaw.meanLatencyMs)} per call).</small>` : ""}</p>
    ${fixtures.map((f) => `<h3>${esc(fixtureTitle(f))}</h3><div class="scroll">${leaderTable(board.filter((r) => r.fixture === f), suggested)}</div>`).join("")}
    <p class="meta">Cell accuracy counts every entry of every step's matrix (a matrix that is missing from the reply counts as all wrong).
    Text exact/similarity compare each row-operation label after ignoring case, spacing, and minus/arrow spelling.
    Latency includes thinking time; each model is loaded once before its first timed call. "not run": no finished call for that model and condition.</p>`;

  const fixtureSections = fixtures.map((f) => {
    const a = byFixture(f);
    if (!a) return "";
    const syntax = typeof a.syntax === "string" ? { raw: a.syntax } : a.syntax;
    return `<h3>${esc(fixtureTitle(f))}</h3>
      <div class="stage-a">${stageAMetrics(a.metrics)}${a.normalized ? normalizedMetrics(a.normalized) : ""}</div>${handwritingSvg(a)}
      ${Object.entries(syntax).map(([c, text]) => `<details><summary>${esc(c)} syntax given to the models (${text.length} chars)</summary><pre>${esc(text)}</pre></details>`).join("")}`;
  }).join("");

  const runSections = fixtures.flatMap((f) => CONDITIONS.map((c) => {
    const blocks = models.map((m) => {
      const runs = stageB.filter((b) => b.fixture === f && b.condition === c && b.model === m).sort((x, y) => x.run - y.run);
      return runs.length ? `<h4>${esc(m)}</h4>${runs.map(runDetails).join("")}` : "";
    }).join("");
    return blocks ? `<h3>${esc(fixtureTitle(f))} — ${esc(c)}</h3>${blocks}` : "";
  })).join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Canvas syntax eval</title><style>${CSS}</style></head>
<body>
<h1>Canvas syntax eval</h1>
<p class="meta">${meta}</p>
<h2>Leaderboard</h2>${leaderSection}
<h2>Stage A — segmentation and recognition</h2>
${heldOut ? `<p class="meta">The recognizer's cut-offs and confidence threshold were tuned on jitter seeds 1–2 only — so the jitter fixture (seed 1) is tuning data, while the clean hand and seeds 3–5 are held out.</p><div class="scroll">${heldOutTable(heldOut)}</div>` : ""}
${fixtureSections}
${runSections ? `<h2>Stage B — answers, step by step</h2><p class="meta">Red cells are wrong: what the model wrote, with the true entry underneath.</p>${runSections}` : ""}
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
    console.error("usage: tsx evals/canvas-syntax/report.ts <run directory>");
    process.exit(1);
  }
  console.log(writeReport(resolve(dir)));
}
