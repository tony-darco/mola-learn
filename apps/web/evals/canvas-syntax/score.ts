/**
 * Scoring for the canvas-syntax eval.
 *
 * Stage A — did segmentation recover the structure that was written? Scored
 * purely by stroke ids against the plan's `meta`, so it says nothing about
 * what any character is, only whether the right strokes ended up together.
 *
 * Stage A, normalized — did the recognizer read each character correctly?
 * Character by character against the plan, still with no model involved.
 *
 * Stage B — did a model read the syntax back correctly? Its JSON reply is
 * compared with the plan's true matrices and labels, step by step, through
 * the step → block-id mapping Stage A produced.
 */
import type { MatrixPlan } from "@/e2e/support/matrixPlan";
import { DEFAULT_MIN_CONFIDENCE, recognizeDoc } from "@/lib/canvas/textSyntax/recognize";
import type { Block, HandwritingDoc, MatrixBlock, TextBlock, Word } from "@/lib/canvas/textSyntax/segment";

// ── Stage A ─────────────────────────────────────────────────────────────────

export type Count = { expected: number; correct: number };
export type StageAMetrics = {
  matrices: { expected: number; found: number; matched: number };
  shapes: Count;
  glyphs: Count;
  cells: Count;
  texts: Count;
};
/** For each plan step, the id of the block it came out as (null if segmentation lost it). */
export type StepMapping = { matrix: (string | null)[]; text: (string | null)[] };

const setKey = (ids: string[]) => [...ids].sort().join(",");
const wordIds = (w: Word) => w.glyphs.flatMap((g) => g.strokes.map((s) => s.id));

export function scoreStageA(plan: MatrixPlan, doc: HandwritingDoc): { metrics: StageAMetrics; mapping: StepMapping } {
  // Stroke i is element `s${i}` (see fixtures.ts).
  const ids = plan.meta.map((_, i) => `s${i}`);
  const matrices = doc.blocks.filter((b): b is MatrixBlock => b.kind === "matrix");
  const texts = doc.blocks.filter((b): b is TextBlock => b.kind === "text");

  // Planned stroke sets.
  const glyphSets = new Map<number, string[]>();
  const cellSets = new Map<string, string[]>();
  const labelWords = plan.steps.map(() => [] as string[][]);
  plan.meta.forEach((m, i) => {
    if (m.role !== "glyph") return;
    glyphSets.set(m.glyph, [...(glyphSets.get(m.glyph) ?? []), ids[i]!]);
    if (m.place.kind === "cell") {
      const k = `${m.step}:${m.place.row}:${m.place.col}`;
      cellSets.set(k, [...(cellSets.get(k) ?? []), ids[i]!]);
    } else {
      (labelWords[m.step]![m.place.word] ??= []).push(ids[i]!);
    }
  });

  const detectedGlyphs = new Set(
    doc.blocks.flatMap((b) => (b.kind === "matrix" ? b.rows.flatMap((r) => r.cells) : b.words))
      .flatMap((w) => w?.glyphs ?? [])
      .map((g) => setKey(g.strokes.map((s) => s.id))),
  );

  const mapping: StepMapping = { matrix: [], text: [] };
  const metrics: StageAMetrics = {
    matrices: { expected: plan.steps.length, found: matrices.length, matched: 0 },
    shapes: { expected: plan.steps.length, correct: 0 },
    glyphs: { expected: glyphSets.size, correct: [...glyphSets.values()].filter((s) => detectedGlyphs.has(setKey(s))).length },
    cells: { expected: cellSets.size, correct: 0 },
    texts: { expected: plan.steps.filter((s) => s.label !== null).length, correct: 0 },
  };

  plan.steps.forEach((step, s) => {
    const delimiter = (side: "left" | "right") =>
      ids[plan.meta.findIndex((m) => m.role === "delimiter" && m.step === s && m.side === side)];
    const matrix = matrices.find((m) => m.delimiters.left.id === delimiter("left") && m.delimiters.right.id === delimiter("right"));
    mapping.matrix.push(matrix?.id ?? null);
    if (matrix) {
      metrics.matrices.matched++;
      const cols = step.matrix[0]!.length;
      if (matrix.rows.length === step.matrix.length && matrix.columns === cols
        && matrix.bars.length === 1 && matrix.bars[0]!.afterColumn === cols - 1) metrics.shapes.correct++;
      step.matrix.forEach((row, r) => row.forEach((_, c) => {
        const cell = matrix.rows[r]?.cells[c];
        if (cell && setKey(wordIds(cell)) === setKey(cellSets.get(`${s}:${r}:${c}`)!)) metrics.cells.correct++;
      }));
    }

    if (step.label === null) {
      mapping.text.push(null);
      return;
    }
    const words = labelWords[s]!;
    const label = new Set(words.flat());
    const overlap = (t: TextBlock) => t.words.flatMap(wordIds).filter((id) => label.has(id)).length;
    const best = texts.reduce<TextBlock | null>((a, t) => (overlap(t) > (a ? overlap(a) : 0) ? t : a), null);
    mapping.text.push(best?.id ?? null);
    if (best && best.words.length === words.length && best.words.every((w, i) => setKey(wordIds(w)) === setKey(words[i]!))) {
      metrics.texts.correct++;
    }
  });

  return { metrics, mapping };
}

/** True when every Stage A metric is perfect. */
export function stageAPerfect(m: StageAMetrics): boolean {
  return m.matrices.found === m.matrices.expected && m.matrices.matched === m.matrices.expected
    && [m.shapes, m.glyphs, m.cells, m.texts].every((c) => c.correct === c.expected);
}

// ── Stage A, normalized ─────────────────────────────────────────────────────

export type NormalizedMetrics = {
  /** `fallback`: shown as uncertain (a bitmap) instead of a character. `confidentWrong`: misread and not flagged. */
  glyphs: Count & { fallback: number; confidentWrong: number };
  /** Top readings, uncertain or not. */
  cells: Count;
  texts: Count;
  /** What was written → what was read, most frequent first. "∅" = the glyph wasn't segmented as written. */
  confusions: { expected: string; got: string; count: number }[];
};

export function scoreNormalized(
  plan: MatrixPlan, doc: HandwritingDoc, mapping: StepMapping, minConfidence = DEFAULT_MIN_CONFIDENCE,
): NormalizedMetrics {
  const reads = recognizeDoc(doc);
  const byStrokes = new Map([...reads].map(([g, r]) => [setKey(g.strokes.map((s) => s.id)), r]));
  const readWord = (w: Word) => w.glyphs.map((g) => reads.get(g)!.char).join("");

  const planned = new Map<number, { char: string; ids: string[] }>();
  plan.meta.forEach((m, i) => {
    if (m.role !== "glyph") return;
    const g = planned.get(m.glyph) ?? { char: m.char, ids: [] };
    g.ids.push(`s${i}`);
    planned.set(m.glyph, g);
  });
  const metrics: NormalizedMetrics = {
    glyphs: { expected: planned.size, correct: 0, fallback: 0, confidentWrong: 0 },
    cells: { expected: 0, correct: 0 },
    texts: { expected: 0, correct: 0 },
    confusions: [],
  };
  const confusions = new Map<string, NormalizedMetrics["confusions"][number]>();
  for (const { char, ids } of planned.values()) {
    const r = byStrokes.get(setKey(ids));
    const unsure = !!r && r.confidence < minConfidence;
    if (unsure) metrics.glyphs.fallback++;
    if (r?.char === char) {
      metrics.glyphs.correct++;
      continue;
    }
    if (r && !unsure) metrics.glyphs.confidentWrong++;
    const got = r?.char ?? "∅";
    const c = confusions.get(`${char}\u0000${got}`) ?? { expected: char, got, count: 0 };
    c.count++;
    confusions.set(`${char}\u0000${got}`, c);
  }
  metrics.confusions = [...confusions.values()].sort((a, b) => b.count - a.count || (a.expected + a.got < b.expected + b.got ? -1 : 1));

  plan.steps.forEach((step, s) => {
    const matrix = doc.blocks.find((b): b is MatrixBlock => b.kind === "matrix" && b.id === mapping.matrix[s]);
    step.matrix.forEach((row, r) => row.forEach((value, c) => {
      metrics.cells.expected++;
      const cell = matrix?.rows[r]?.cells[c];
      if (cell && readWord(cell) === String(value)) metrics.cells.correct++;
    }));
    if (step.label === null) return;
    metrics.texts.expected++;
    const text = doc.blocks.find((b): b is TextBlock => b.kind === "text" && b.id === mapping.text[s]);
    if (text && text.words.map(readWord).join(" ") === step.label) metrics.texts.correct++;
  });
  return metrics;
}

/** A compact, JSON-friendly outline of what segmentation found — for the stage-a output file. */
export function summarizeDoc(doc: HandwritingDoc) {
  const round = (b: Block["box"]) => ({ x: Math.round(b.minX), y: Math.round(b.minY), w: Math.round(b.maxX - b.minX), h: Math.round(b.maxY - b.minY) });
  return doc.blocks.map((b) =>
    b.kind === "matrix"
      ? { id: b.id, kind: b.kind, box: round(b.box), rows: b.rows.length, columns: b.columns, bars: b.bars.map((x) => x.afterColumn),
          cells: b.rows.map((r) => r.cells.map((c) => (c ? c.glyphs.length : 0))) }
      : { id: b.id, kind: b.kind, box: round(b.box), words: b.words.map((w) => w.glyphs.length) },
  );
}

// ── Stage B ─────────────────────────────────────────────────────────────────

/** What a model's reply says, loosely shaped: every entry as a string, block ids upper-cased. */
export type Reply = { matrices: Record<string, string[][]>; text: Record<string, string> };

/**
 * Pulls the JSON object out of a model's reply — ignoring ``` fences and any
 * chatter around it — and coerces it to `Reply`. Null if there is no object
 * to parse at all.
 */
export function parseReply(raw: string): Reply | null {
  const unfenced = raw.replace(/```[a-zA-Z]*/g, "");
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let value: unknown;
  try {
    value = JSON.parse(unfenced.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  const reply: Reply = { matrices: {}, text: {} };

  const toRow = (row: unknown): string[] =>
    Array.isArray(row) ? row.map((v) => String(v)) : typeof row === "string" ? row.trim().split(/[\s,]+/) : [String(row)];
  if (obj.matrices && typeof obj.matrices === "object") {
    for (const [id, m] of Object.entries(obj.matrices as Record<string, unknown>)) {
      if (Array.isArray(m)) reply.matrices[id.toUpperCase()] = m.map(toRow);
    }
  }
  if (obj.text && typeof obj.text === "object") {
    for (const [id, t] of Object.entries(obj.text as Record<string, unknown>)) {
      reply.text[id.toUpperCase()] = Array.isArray(t) ? t.map(String).join(" ") : String(t);
    }
  }
  return reply;
}

const unifyMinus = (s: string) => s.replace(/[−‐-―﹣－]/g, "-");
export const normalizeCell = (v: unknown) => unifyMinus(String(v)).replace(/\s+/g, "");

/** Case, minus-sign style, spacing, and how the leading down-arrow was spelled don't count. */
export function normalizeText(s: string): string {
  const tokens = s.trim().split(/\s+/);
  if (["↓", "⇓", "v", "V", "|"].includes(tokens[0]!)) tokens[0] = "↓";
  return unifyMinus(tokens.join("")).toUpperCase();
}

function levenshtein(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[y.length]!;
}

/** 1 − edit distance / longer length, on normalized text. */
export function textSimilarity(a: string, b: string): number {
  const longest = Math.max([...a].length, [...b].length);
  return longest === 0 ? 1 : 1 - levenshtein(a, b) / longest;
}

export type StepResult = {
  step: number;
  matrixId: string | null;
  expected: string[][];
  got: string[][] | null;
  /** Per expected cell. */
  correct: boolean[][];
  matrixExact: boolean;
  textId: string | null;
  expectedText: string | null;
  gotText: string | null;
  textExact: boolean;
  textSimilarity: number;
};
export type StageBScores = {
  cells: { correct: number; total: number; accuracy: number };
  matrices: { exact: number; total: number };
  texts: { exact: number; total: number; similarity: number };
};

export function scoreStageB(
  steps: { matrix: number[][]; label: string | null }[], mapping: StepMapping, reply: Reply | null,
): { steps: StepResult[]; scores: StageBScores } {
  const results = steps.map((step, s): StepResult => {
    const matrixId = mapping.matrix[s] ?? null;
    const expected = step.matrix.map((row) => row.map(String));
    // A matrix segmentation lost, or the reply left out, is all wrong.
    const got = (matrixId && reply?.matrices[matrixId]) || null;
    const correct = expected.map((row, r) => row.map((v, c) => got?.[r]?.[c] !== undefined && normalizeCell(got[r]![c]) === v));
    const matrixExact = !!got && got.length === expected.length && got.every((row, r) => row.length === expected[r]!.length)
      && correct.every((row) => row.every(Boolean));

    const textId = mapping.text[s] ?? null;
    const gotText = (textId && reply?.text[textId]) ?? null;
    const similarity = step.label === null || gotText === null ? 0 : textSimilarity(normalizeText(gotText), normalizeText(step.label));
    return {
      step: s, matrixId, expected, got, correct, matrixExact,
      textId, expectedText: step.label, gotText, textExact: step.label !== null && similarity === 1, textSimilarity: similarity,
    };
  });

  const cellsCorrect = results.reduce((n, r) => n + r.correct.flat().filter(Boolean).length, 0);
  const cellsTotal = results.reduce((n, r) => n + r.correct.flat().length, 0);
  const labelled = results.filter((r) => r.expectedText !== null);
  return {
    steps: results,
    scores: {
      cells: { correct: cellsCorrect, total: cellsTotal, accuracy: cellsTotal ? cellsCorrect / cellsTotal : 0 },
      matrices: { exact: results.filter((r) => r.matrixExact).length, total: results.length },
      texts: {
        exact: labelled.filter((r) => r.textExact).length, total: labelled.length,
        similarity: labelled.length ? labelled.reduce((n, r) => n + r.textSimilarity, 0) / labelled.length : 0,
      },
    },
  };
}

// ── Leaderboard ─────────────────────────────────────────────────────────────

/** One Stage B call, as the leaderboard needs it. `condition` is the syntax render the model was given ("raw" or "normalized"). */
export type RunSummary = {
  model: string; fixture: string; condition: string; run: number;
  validJson: boolean; scores: StageBScores; latencyMs: number; stopReason: string | null; errors: string[];
};
export type LeaderRow = {
  model: string; fixture: string; condition: string; runs: number;
  cellAccuracy: { mean: number; min: number; max: number };
  /** Means over runs, as fractions of the total. */
  matricesExact: number; textExact: number; textSimilarity: number; validJson: number;
  meanLatencyMs: number;
  /** Calls that ended in an error (cut off, unreachable host) — their scores are in the means as zeros. */
  failedCalls: number;
};

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function leaderboard(runs: RunSummary[]): LeaderRow[] {
  const groups = new Map<string, RunSummary[]>();
  for (const r of runs) {
    const k = `${r.model}\u0000${r.fixture}\u0000${r.condition}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  return [...groups.values()].map((rs) => {
    const acc = rs.map((r) => r.scores.cells.accuracy);
    return {
      model: rs[0]!.model, fixture: rs[0]!.fixture, condition: rs[0]!.condition, runs: rs.length,
      cellAccuracy: { mean: mean(acc), min: Math.min(...acc), max: Math.max(...acc) },
      matricesExact: mean(rs.map((r) => r.scores.matrices.exact / r.scores.matrices.total)),
      textExact: mean(rs.map((r) => (r.scores.texts.total ? r.scores.texts.exact / r.scores.texts.total : 0))),
      textSimilarity: mean(rs.map((r) => r.scores.texts.similarity)),
      validJson: mean(rs.map((r) => (r.validJson ? 1 : 0))),
      meanLatencyMs: mean(rs.map((r) => r.latencyMs)),
      failedCalls: rs.filter((r) => r.errors.length > 0).length,
    };
  });
}

/** Best mean cell accuracy on `fixture` under `condition`; ties go to better text, then lower latency. */
export function suggestedModel(rows: LeaderRow[], condition: string, fixture = "jitter"): LeaderRow | null {
  return [...rows.filter((r) => r.fixture === fixture && r.condition === condition)].sort((a, b) =>
    b.cellAccuracy.mean - a.cellAccuracy.mean || b.textSimilarity - a.textSimilarity || a.meanLatencyMs - b.meanLatencyMs,
  )[0] ?? null;
}
