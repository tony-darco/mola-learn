/**
 * The recognizer's alphabet fixture: every character it knows — capitals,
 * lowercase, digits, symbols, Greek — alone and in the formulas people write,
 * with subscripts and superscripts, drawn by the test font (e2e/support/
 * strokeFont.ts, whose geometry is separate from the recognizer's templates)
 * with a seeded hand. Each glyph carries its truth: the character, whether it
 * is a script, and the stroke ids it was drawn with.
 *
 * Scored character by character, still with no model involved: was it read
 * right, flagged as unsure, or misread without a flag (the one failure that
 * must stay near zero)? And of the flagged ones, is what was written among
 * the readings the read offers in its place ("«5|S|s»")?
 */
import { generateKeyBetween } from "fractional-indexing";
import type { CanvasElement } from "@mola/shared";
import { finalizeStroke } from "@/lib/canvas/stroke";
import { COLOR_PALETTE, STROKE_WIDTHS } from "@/lib/canvas/styleConstants";
import { scriptedText } from "@/lib/canvas/textSyntax/handwriting";
import { DEFAULT_MIN_CONFIDENCE, offered, recognizeDoc } from "@/lib/canvas/textSyntax/recognize";
import { inkFromElements, segmentHandwriting, type HandwritingDoc, type TextBlock } from "@/lib/canvas/textSyntax/segment";
import { makeJitter, parseScripted, writeText } from "@/e2e/support/strokeFont";

/** One line each; "_" and "^" mark scripts (see parseScripted). */
export const ALPHABET_LINES = [
  "ABCDEFGHIJKLM",
  "NOPQRSTUVWXYZ",
  "abcdefghijklm",
  "nopqrstuvwxyz",
  "0123456789",
  "+ - = × ÷ / ( ) . , → ← ↑ ↓",
  "θ ° \\^ * Ω Δ π",
  "Cc Oo Ss Xx Zz Vv Ww Pp Kk Uu",
  "l1I 0Oo s5S z2Z 9gq",
  "H_2O + CO_2 → H_2CO_3",
  "x^2 + y^2 = r^2",
  "Q_d = 100 - 2P",
  "E = mc^2, 10^{-3}",
  "a = g sin θ",
  "v = d/t = 20 m/s",
  "ΔG = ΔH - TΔS",
  "F = ma (90°)",
  "e^{kt} x_1 + x_{12}",
  "2πr × 3 ÷ 4 = y",
  "Big fox, Jumps quickly. Wave Hq",
];

const SIZE = 26;
const PITCH = 64;
const ORIGIN = { x: 100, y: 100 };

export type AlphabetGlyph = { char: string; script: "sub" | "sup" | null; line: number; ids: string[] };
export type AlphabetFixture = { seed?: number; elements: CanvasElement[]; glyphs: AlphabetGlyph[] };

export function makeAlphabet(seed?: number, lines = ALPHABET_LINES): AlphabetFixture {
  const jitter = seed === undefined ? undefined : makeJitter(seed);
  const elements: CanvasElement[] = [];
  const glyphs: AlphabetGlyph[] = [];
  let index: string | null = null;
  lines.forEach((text, line) => {
    for (const g of writeText(text, ORIGIN.x, ORIGIN.y + line * PITCH, SIZE, jitter).glyphs) {
      const ids = g.strokes.map((stroke) => {
        const f = finalizeStroke(stroke)!;
        const id = `s${elements.length}`;
        index = generateKeyBetween(index, null);
        elements.push({
          id, parentId: null, index, x: f.x, y: f.y, width: f.width, height: f.height,
          rotation: 0, opacity: 1, createdBy: "user", type: "draw",
          props: { points: f.points, color: COLOR_PALETTE[0]!, strokeWidth: STROKE_WIDTHS.S, variant: "pen", dash: "solid" },
        });
        return id;
      });
      glyphs.push({ char: g.char, script: g.script, line, ids });
    }
  });
  return { seed, elements, glyphs };
}

// ── scoring ─────────────────────────────────────────────────────────────────

export type AlphabetMetrics = {
  /** `segmented`: came out of segmentation as exactly the strokes it was drawn with. */
  /** `offered`: of the flagged, those whose character is among the readings offered in their place (recognize.ts's offered). */
  glyphs: { expected: number; segmented: number; correct: number; flagged: number; confidentWrong: number; offered: number };
  /** Of the correctly segmented glyphs: scripts read as the right kind, and plain glyphs taken for scripts. */
  scripts: { expected: number; correct: number; falsePositives: number };
  /** Lines whose top reading, scripts marked, is exactly what was written. */
  lines: { expected: number; correct: number };
  /** Written → read, most frequent first; "∅" = not segmented as written; a trailing "?" = flagged. */
  confusions: { expected: string; got: string; count: number }[];
  /** Every line as read, for the report. */
  reads: { expected: string; got: string }[];
};

const key = (ids: string[]) => [...ids].sort().join(",");

export function scoreAlphabet(fx: AlphabetFixture, lines = ALPHABET_LINES, minConfidence = DEFAULT_MIN_CONFIDENCE): AlphabetMetrics {
  const doc: HandwritingDoc = segmentHandwriting(inkFromElements(fx.elements));
  const reads = recognizeDoc(doc);
  const byIds = new Map([...reads].map(([g, r]) => [key(g.strokes.map((s) => s.id)), r]));
  // What each glyph would be offered as, in its word.
  const offeredFor = new Map<string, () => string[]>();
  for (const w of doc.blocks.flatMap((b) => (b.kind === "text" ? b.words : b.rows.flatMap((row) => row.cells.flatMap((c) => (c ? [c] : [])))))) {
    const rs = w.glyphs.map((gl) => reads.get(gl)!);
    w.glyphs.forEach((gl, i) => offeredFor.set(key(gl.strokes.map((s) => s.id)), () => offered(gl, rs, i)));
  }
  const m: AlphabetMetrics = {
    glyphs: { expected: fx.glyphs.length, segmented: 0, correct: 0, flagged: 0, confidentWrong: 0, offered: 0 },
    scripts: { expected: fx.glyphs.filter((g) => g.script).length, correct: 0, falsePositives: 0 },
    lines: { expected: lines.length, correct: 0 },
    confusions: [],
    reads: [],
  };
  const confusions = new Map<string, number>();
  for (const g of fx.glyphs) {
    const r = byIds.get(key(g.ids));
    if (r) m.glyphs.segmented++;
    const flagged = !!r && r.confidence < minConfidence;
    if (flagged) m.glyphs.flagged++;
    if (flagged && offeredFor.get(key(g.ids))!().includes(g.char)) m.glyphs.offered++;
    if (r && (r.script ?? null) === g.script && g.script) m.scripts.correct++;
    if (r && r.script && !g.script) m.scripts.falsePositives++;
    if (r?.char === g.char) {
      m.glyphs.correct++;
      continue;
    }
    if (r && !flagged) m.glyphs.confidentWrong++;
    const k = `${g.char}\u0000${r ? `${r.char}${flagged ? "?" : ""}` : "∅"}`;
    confusions.set(k, (confusions.get(k) ?? 0) + 1);
  }
  m.confusions = [...confusions].map(([k, count]) => ({ expected: k.split("\u0000")[0]!, got: k.split("\u0000")[1]!, count }))
    .sort((a, b) => b.count - a.count || (a.expected + a.got < b.expected + b.got ? -1 : 1));

  // Lines: the text block holding most of each line's strokes, read word by word.
  const texts = doc.blocks.filter((b): b is TextBlock => b.kind === "text");
  lines.forEach((text, line) => {
    const ids = new Set(fx.glyphs.filter((g) => g.line === line).flatMap((g) => g.ids));
    const owned = texts.filter((t) => t.words.some((w) => w.glyphs.some((gl) => gl.strokes.some((s) => ids.has(s.id)))));
    const got = owned.map((t) => t.words.map((w) => scriptedText(w.glyphs.map((gl) => reads.get(gl)!))).join(" ")).join(" | ");
    const words = [[]] as ReturnType<typeof parseScripted>[];
    for (const c of parseScripted(text)) {
      if (c.char !== " ") words[words.length - 1]!.push(c);
      else if (words[words.length - 1]!.length) words.push([]);
    }
    const expected = words.filter((w) => w.length).map(scriptedText).join(" ");
    m.reads.push({ expected, got });
    if (got === expected) m.lines.correct++;
  });
  return m;
}

/** Several hands added up; confusions merged. */
export function sumAlphabet(all: AlphabetMetrics[]): Omit<AlphabetMetrics, "reads"> {
  const sum = <K extends "glyphs" | "scripts" | "lines">(k: K) => Object.fromEntries(Object.keys(all[0]![k]).map((f) =>
    [f, all.reduce((n, m) => n + (m[k] as Record<string, number>)[f]!, 0)])) as AlphabetMetrics[K];
  const confusions = new Map<string, number>();
  for (const c of all.flatMap((m) => m.confusions)) confusions.set(`${c.expected}\u0000${c.got}`, (confusions.get(`${c.expected}\u0000${c.got}`) ?? 0) + c.count);
  return {
    glyphs: sum("glyphs"), scripts: sum("scripts"), lines: sum("lines"),
    confusions: [...confusions].map(([k, count]) => ({ expected: k.split("\u0000")[0]!, got: k.split("\u0000")[1]!, count })).sort((a, b) => b.count - a.count),
  };
}
