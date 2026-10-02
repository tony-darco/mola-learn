/**
 * The "reader board": four pieces of work — matrix multiplication, supply
 * and demand, balanced chemical equations, F = ma — each written three ways:
 * neat handwriting, shaky handwriting, and typed with the Math tool. One
 * section per subject × style, laid out in a grid (columns are styles, rows
 * are subjects).
 *
 * Pure and deterministic, like matrixPlan.ts: the same plan comes out every
 * time. canvas-reader-board.spec.ts writes it into a saved canvas once, and
 * later tests read that canvas instead of redrawing it. `sections[].expected`
 * is what was written — the ground truth those tests assert against — and
 * `sections[].rect` is the area a selection test drags around.
 */
import {
  advance, distort, glyphWidth, penStroke, seededRandom, textGlyphs, textWidth,
  type Jitter, type Pt, type Stroke,
} from "./strokeFont";

/** Title of Alice's saved board canvas — how later tests find it. */
export const READER_BOARD_TITLE = "E2E Reader Board";

export type BoardStyle = "neat" | "shaky" | "math";
export type BoardSubject = "matrix-multiplication" | "economics" | "chemistry" | "physics";
export type Rect = { minX: number; minY: number; maxX: number; maxY: number };

export type BoardSection = {
  id: string;
  subject: BoardSubject;
  style: BoardStyle;
  /** World-coordinate area of the section — what a selection test drags around. */
  rect: Rect;
  /** What was written, one entry per line; "_" marks the next character as a subscript. */
  expected: string[];
};

export type BoardPlan = {
  sections: BoardSection[];
  /** Pen strokes for every handwritten section, in draw order. */
  strokes: Stroke[];
  /** Math-tool entries: where to click, and the LaTeX to enter there. */
  math: { section: string; at: Pt; latex: string }[];
  bounds: Rect;
};

const SIZE = 24; // cap height of handwriting
const LINE_PITCH = 40;
const SECTION_W = 560;
const SECTION_H = 230;
const COLUMN_PITCH = 600;
const ROW_PITCH = 260;
const INSET = { x: 24, y: 28 };
const MATH_PITCH = 52; // math elements are 40 tall
const ORIGIN = { x: 280, y: 110 };
const STYLES: BoardStyle[] = ["neat", "shaky", "math"];

// ── glyphs the digit font (strokeFont.ts) doesn't have ─────────────────────

type XY = [number, number];

/** Same arc helper as strokeFont.ts: degrees, y-down, larger angle sweeps clockwise. */
function arc(cx: number, cy: number, rx: number, ry: number, fromDeg: number, toDeg: number, n: number): XY[] {
  const out: XY[] = [];
  for (let i = 0; i <= n; i++) {
    const a = ((fromDeg + ((toDeg - fromDeg) * i) / n) * Math.PI) / 180;
    out.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return out;
}

/** Unit-box glyphs (x across, y down; lowercase sits in the lower ~half). `width` scales the glyph box. */
const LETTERS: Record<string, { strokes: XY[][]; width?: number }> = {
  // The tail has to cross the loop and stick well out of it, or Q reads as O.
  Q: { strokes: [arc(0.5, 0.5, 0.46, 0.5, -90, 270, 20), [[0.52, 0.6], [1.05, 1.1]]] },
  P: { strokes: [[[0.12, 1], [0.12, 0], [0.58, 0], ...arc(0.58, 0.26, 0.32, 0.26, 270, 450, 8), [0.12, 0.52]]] },
  H: { strokes: [[[0.12, 0], [0.12, 1]], [[0.88, 0], [0.88, 1]], [[0.12, 0.5], [0.88, 0.5]]] },
  // Rounder than the digit "0" (rx 0.42) — the same ambiguity real handwriting has, just less of it.
  O: { strokes: [arc(0.5, 0.5, 0.48, 0.5, -90, 270, 20)] },
  C: { strokes: [arc(0.56, 0.5, 0.46, 0.5, -40, -320, 16)] },
  F: { strokes: [[[0.88, 0], [0.12, 0], [0.12, 1]], [[0.12, 0.48], [0.72, 0.48]]] },
  d: { strokes: [[[0.82, 0], [0.82, 1]], arc(0.5, 0.73, 0.32, 0.27, 0, 360, 16)] },
  a: { strokes: [arc(0.44, 0.73, 0.36, 0.27, 0, 360, 16), [[0.8, 0.44], [0.8, 0.96], [0.92, 1]]] },
  s: { strokes: [[[0.85, 0.52], [0.6, 0.45], [0.25, 0.48], [0.18, 0.6], [0.35, 0.7], [0.7, 0.76], [0.85, 0.88], [0.7, 0.99], [0.35, 1], [0.12, 0.93]]] },
  m: {
    width: 1.3,
    strokes: [
      [[0.06, 1], [0.06, 0.48], ...arc(0.28, 0.64, 0.22, 0.16, 180, 360, 6), [0.5, 1]],
      [[0.5, 0.64], ...arc(0.72, 0.64, 0.22, 0.16, 180, 360, 6), [0.94, 1]],
    ],
  },
  "×": { strokes: [[[0.15, 0.28], [0.85, 0.78]], [[0.85, 0.28], [0.15, 0.78]]] },
  "→": { width: 1.6, strokes: [[[0, 0.5], [1, 0.5]], [[0.72, 0.3], [1, 0.5], [0.72, 0.7]]] },
};

function glyphStrokes(ch: string, x: number, y: number, size: number, jitter: Jitter): { strokes: Stroke[]; width: number } {
  const letter = LETTERS[ch];
  if (!letter) return { strokes: textGlyphs(ch, x, y, size, jitter).flatMap((g) => g.strokes), width: glyphWidth(size) };
  const w = glyphWidth(size) * (letter.width ?? 1);
  const box = { x, y, w, h: size };
  const placed = letter.strokes.map((s) => s.map(([u, v]) => ({ x: x + u * w, y: y + v * size })));
  return { strokes: distort(placed, box, jitter).map((s) => penStroke(s, jitter)), width: w };
}

/**
 * One line of handwriting with its top-left at (x, y). "_" writes the next
 * character as a subscript: smaller, and dropped below the line.
 */
function writeLine(text: string, x: number, y: number, size: number, jitter: Jitter): { strokes: Stroke[]; width: number } {
  const strokes: Stroke[] = [];
  let cx = x;
  for (let i = 0; i < text.length; i++) {
    let ch = text[i]!;
    const sub = ch === "_";
    if (sub) ch = text[++i]!;
    if (ch === " ") {
      cx += advance(size);
      continue;
    }
    const s = sub ? size * 0.6 : size;
    const g = glyphStrokes(ch, cx, sub ? y + size * 0.55 : y, s, jitter);
    strokes.push(...g.strokes);
    cx += g.width + s * 0.3;
  }
  return { strokes, width: cx - x };
}

/** A bracketed matrix, entries right-aligned in their columns, top-left at (x, y). */
export function writeMatrix(m: number[][], x: number, y: number, size: number, jitter: Jitter): { strokes: Stroke[]; width: number; height: number } {
  const arm = size * 0.35;
  const pad = size * 0.35;
  const rowH = size * 1.5;
  const colW = Math.max(...m.flat().map((v) => textWidth(String(v), size))) + size * 0.7;
  const h = m.length * rowH;
  const innerLeft = x + arm + pad;
  const right = innerLeft + m[0]!.length * colW + pad;
  const bracket = (points: Pt[]) => {
    const [shaped] = distort([points], { x: Math.min(...points.map((p) => p.x)), y, w: arm, h }, jitter, 2);
    return penStroke(shaped!, jitter);
  };

  const strokes: Stroke[] = [
    bracket([{ x: x + arm, y }, { x, y }, { x, y: y + h }, { x: x + arm, y: y + h }]),
    bracket([{ x: right - arm, y }, { x: right, y }, { x: right, y: y + h }, { x: right - arm, y: y + h }]),
  ];
  m.forEach((row, r) => row.forEach((v, c) => {
    const text = String(v);
    const tx = innerLeft + (c + 1) * colW - textWidth(text, size) - size * 0.35;
    strokes.push(...writeLine(text, tx, y + r * rowH + (rowH - size) / 2, size, jitter).strokes);
  }));
  return { strokes, width: right - x, height: h };
}

// ── content ─────────────────────────────────────────────────────────────────

const A = [[1, 2], [3, 4]];
const B = [[5, 6], [7, 8]];
const AB = A.map((row) => B[0]!.map((_, c) => row.reduce((s, v, k) => s + v * B[k]![c]!, 0)));
const matrixText = (m: number[][]) => `[${m.map((row) => row.join(" ")).join("; ")}]`;

const SUBJECTS: { subject: BoardSubject; lines: string[]; latex: string[] }[] = [
  {
    subject: "matrix-multiplication",
    lines: [`${matrixText(A)} × ${matrixText(B)} = ${matrixText(AB)}`],
    latex: [
      String.raw`\begin{bmatrix}1&2\\3&4\end{bmatrix}\times\begin{bmatrix}5&6\\7&8\end{bmatrix}=\begin{bmatrix}19&22\\43&50\end{bmatrix}`,
    ],
  },
  {
    subject: "economics",
    // Qd = Qs → 100 - 2P = 20 + 3P → P = 16, Q = 68.
    lines: ["Q_d = 100 - 2P", "Q_s = 20 + 3P", "P = 16", "Q = 68"],
    latex: ["Q_d=100-2P", "Q_s=20+3P", "P=16", "Q=68"],
  },
  {
    subject: "chemistry",
    lines: ["2H_2 + O_2 → 2H_2O", "CH_4 + 2O_2 → CO_2 + 2H_2O"],
    latex: [String.raw`2H_2+O_2\rightarrow 2H_2O`, String.raw`CH_4+2O_2\rightarrow CO_2+2H_2O`],
  },
  {
    subject: "physics",
    lines: ["F = ma", "m = 2", "a = 10", "F = 20"],
    latex: ["F=ma", "m=2", "a=10", "F=20"],
  },
];

export function jitterFor(style: "neat" | "shaky", seed: number): Jitter {
  return style === "neat"
    ? { rng: seededRandom(seed), slantDeg: 5, scale: 0.05, offset: 1.2, strokeOffset: 0.6, wobble: 0.6 }
    : { rng: seededRandom(seed), slantDeg: 14, scale: 0.15, offset: 3, strokeOffset: 1.8, wobble: 2.2 };
}

/**
 * With no options, the board as saved. `seed` writes the same board in other
 * hands (a different one per section), for checks over many hands.
 */
export function planReaderBoard(opts: { seed?: number } = {}): BoardPlan {
  const sections: BoardSection[] = [];
  const strokes: Stroke[] = [];
  const math: BoardPlan["math"] = [];

  SUBJECTS.forEach((content, row) => {
    STYLES.forEach((style, col) => {
      const id = `${content.subject}-${style}`;
      const sx = ORIGIN.x + col * COLUMN_PITCH;
      const sy = ORIGIN.y + row * ROW_PITCH;
      const x = sx + INSET.x;
      const y = sy + INSET.y;
      sections.push({ id, subject: content.subject, style, rect: { minX: sx, minY: sy, maxX: sx + SECTION_W, maxY: sy + SECTION_H }, expected: content.lines });

      if (style === "math") {
        content.latex.forEach((latex, i) => math.push({ section: id, at: { x, y: y + i * MATH_PITCH }, latex }));
        return;
      }

      const base = opts.seed === undefined ? 0 : 100_000 + opts.seed * 1000;
      const jitter = jitterFor(style, base + (row + 1) * 100 + col);
      if (content.subject === "matrix-multiplication") {
        let cx = x;
        const top = y + 10;
        for (const part of [A, "×", B, "=", AB] as const) {
          if (typeof part === "string") {
            // Vertically centred on the matrices (each A.length rows of 1.5 × SIZE).
            const g = writeLine(part, cx, top + (A.length * SIZE * 1.5 - SIZE) / 2, SIZE, jitter);
            strokes.push(...g.strokes);
            cx += g.width + SIZE * 0.3;
          } else {
            const m = writeMatrix(part, cx, top, SIZE, jitter);
            strokes.push(...m.strokes);
            cx += m.width + SIZE * 0.6;
          }
        }
        return;
      }
      content.lines.forEach((line, i) => strokes.push(...writeLine(line, x, y + i * LINE_PITCH, SIZE, jitter).strokes));
    });
  });

  const bounds: Rect = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const s of sections) {
    bounds.minX = Math.min(bounds.minX, s.rect.minX); bounds.minY = Math.min(bounds.minY, s.rect.minY);
    bounds.maxX = Math.max(bounds.maxX, s.rect.maxX); bounds.maxY = Math.max(bounds.maxY, s.rect.maxY);
  }
  return { sections, strokes, math, bounds };
}
