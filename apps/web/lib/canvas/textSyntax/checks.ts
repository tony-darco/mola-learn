/**
 * Arithmetic the server checks on the board, for the canvas chat to mark
 * by. In the annotate eval, gemma4:26b's own arithmetic on a worked matrix
 * reduction was unreliable — it flagged entries that were right and missed
 * the one slip — and it seldom marked a plain "2 + 2 = 5". So the server
 * works it out, from the board as the reader printed it (read.ts), and the
 * model reads what was found as a short section after the board
 * (withChecks):
 *
 * - steps: the row operations written between two matrices — "R3 = R3 - R1",
 *   the line under each step of a reduction — applied to the matrix before,
 *   and every entry of the matrix after compared with what they give. In a
 *   run of steps only the first that goes wrong is reported: the ones after
 *   it build on it.
 * - equations: numbers and operators on both sides of "=" — "2 + 2 = 5" — in
 *   handwriting, typed text, sticky notes and LaTeX, each side worked out.
 *
 * A character the recognizer is unsure of ("«5|S»") is tried every way it
 * may be read: an entry or equation right any way is right; otherwise it is
 * "can't check", never a confident "wrong" — what was written may be none of
 * the readings offered — and so is an entry worked out from an unsure one.
 * An operation that only one reading makes sense of — R«1|7» in a matrix of
 * three rows — is read that way, and the section says how it was read.
 *
 * Only what was checked is reported, and nothing about what drawings show.
 */
import type { CanvasElement } from "@mola/shared";
import { typedWords } from "../wordTargets";
import { printedWord, span } from "./handwriting";
import type { CanvasDoc } from "./read";
import { DEFAULT_MIN_CONFIDENCE } from "./recognize";

/** What the checks read: the board's matrices, and its lines of writing and typed text by their words, in reading order, as printed. */
export type Printed =
  | { kind: "matrix"; label: string; rows: (string | null)[][] }
  /** `math`: the words are LaTeX. */
  | { kind: "words"; label: string; words: string[]; math?: boolean }
  /** Something the read printed only part of, in a read of a selected region: not checked, and no step runs across it. */
  | { kind: "gap" };

export type StepCheck = {
  kind: "step"; from: string; to: string;
  /** The lines the row operations were written on. */
  by: string[];
  verdict: "right" | "wrong" | "unsure";
  /** The operations as read, written out; null when they couldn't be read one way. */
  op: string | null;
  /** Wrong entries: where, what the operations give there, and what is written. */
  wrong: { address: string; gives: number; written: string }[];
  /** What couldn't be checked, and why: entries of a step, or the whole step when it is unsure. */
  unsure: string[];
  /** After a wrong step, the matrices of the steps after it in the same run, not checked. */
  skipped: string[];
};

export type EquationCheck = {
  kind: "equation"; label: string;
  /** The words it is written in, 1-based, and as printed. */
  from: number; to: number; text: string;
  verdict: "right" | "wrong" | "unsure";
  /** Wrong: the place to mark (the side that disagrees with the one before it), and why. Unsure: why — and, when what the left side comes to is certain, the place to point at. */
  place?: string; why?: string;
};

export type Check = StepCheck | EquationCheck;

// ── printed characters ──────────────────────────────────────────────────────

/** A printed character: plain, or what an unsure one may be ("«5|S»"). */
type Char = string | string[];

function charsOf(printed: string): Char[] {
  const out: Char[] = [];
  for (let i = 0; i < printed.length; i++) {
    const end = printed[i] === "«" ? printed.indexOf("»", i) : -1;
    if (end > i) {
      out.push(printed.slice(i + 1, end).split("|"));
      i = end;
    } else out.push(printed[i]!);
  }
  return out;
}

const shownChar = (c: Char) => (typeof c === "string" ? c : `«${c.join("|")}»`);
const isUnsure = (cs: Char[]) => cs.some((c) => typeof c !== "string");

/** More ways of reading something than this, and it isn't checked. */
const MAX_READINGS = 64;

/** Every way `cs` may be read; null when there are too many. */
function readingsOf(cs: Char[]): string[] | null {
  let out = [""];
  for (const c of cs) {
    const options = typeof c === "string" ? [c] : c;
    out = out.flatMap((s) => options.map((o) => s + o));
    if (out.length > MAX_READINGS) return null;
  }
  return out;
}

// ── numbers ─────────────────────────────────────────────────────────────────

const DASHES = /[−–—]/g;
const TINY = 1e-9;

/** A number as written, and how many decimal places it was written to (0: exact). */
type Num = { value: number; places: number };

function numberOf(text: string): Num | null {
  const t = text.replace(DASHES, "-").replace(/\s+/g, "");
  const frac = /^([+-]?)(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/.exec(t);
  if (frac) return Number(frac[3]) === 0 ? null : { value: (frac[1] === "-" ? -1 : 1) * (Number(frac[2]) / Number(frac[3])), places: 0 };
  const dec = /^[+-]?(?:\d+(?:\.(\d+))?|\.(\d+))$/.exec(t);
  return dec ? { value: Number(t), places: (dec[1] ?? dec[2] ?? "").length } : null;
}

/** An exact value agrees with a written number to as many places as it was written to. */
function agrees(exact: number, written: Num): boolean {
  const tolerance = written.places > 0 ? 0.5 * 10 ** -written.places : 0;
  return Math.abs(exact - written.value) <= tolerance + TINY * Math.max(1, Math.abs(exact));
}

/** 4, -1/2, 0.3333. */
export function formatNumber(n: number): string {
  if (Math.abs(n - Math.round(n)) < TINY) return String(Math.round(n) + 0);
  for (let d = 2; d <= 100; d++) {
    const k = Math.round(n * d);
    if (Math.abs(n * d - k) < 1e-7) return `${k}/${d}`;
  }
  return String(Number(n.toFixed(4)));
}

/** + - × ÷ and powers, with brackets; null for anything else, or a division by zero. */
function evaluate(text: string): number | null {
  const src = text.replace(DASHES, "-").replace(/[×·∗⋅]/g, "*").replace(/÷/g, "/").replace(/\s+/g, "");
  const tokens = src.match(/\d+(?:\.\d+)?|\.\d+|./g) ?? [];
  let i = 0;
  const atom = (): number | null => {
    const t = tokens[i];
    if (t === "(") {
      i++;
      const v = sum();
      if (tokens[i] !== ")") return null;
      i++;
      return v;
    }
    if (t !== undefined && /^[\d.]/.test(t)) {
      i++;
      return Number(t);
    }
    return null;
  };
  const power = (): number | null => {
    const base = atom();
    if (base === null || tokens[i] !== "^") return base;
    i++;
    const e = signed();
    return e === null ? null : base ** e;
  };
  const signed = (): number | null => {
    if (tokens[i] === "-" || tokens[i] === "+") {
      const minus = tokens[i++] === "-";
      const v = signed();
      return v === null ? null : minus ? -v : v;
    }
    return power();
  };
  const product = (): number | null => {
    let v = signed();
    while (v !== null && (tokens[i] === "*" || tokens[i] === "/")) {
      const op = tokens[i++];
      const r = signed();
      v = r === null || (op === "/" && r === 0) ? null : op === "*" ? v * r : v / r;
    }
    return v;
  };
  const sum = (): number | null => {
    let v = product();
    while (v !== null && (tokens[i] === "+" || tokens[i] === "-")) {
      const op = tokens[i++];
      const r = product();
      v = r === null ? null : op === "+" ? v + r : v - r;
    }
    return v;
  };
  const v = sum();
  return v !== null && i === tokens.length && Number.isFinite(v) ? v : null;
}

/** An operator past any leading sign: "2 + 2" has one, "-3" doesn't. */
const hasOperator = (side: string) => /[+\-*/^×÷·∗⋅]/.test(side.replace(DASHES, "-").trim().replace(/^[+-]\s*/, ""));

/** One piece of LaTeX as arithmetic: "\frac{12}{4}" as "((12)/(4))", "\times" as "*". What isn't arithmetic is left, and isn't checked. */
function latexPlain(latex: string): string {
  const frac = /\\[dt]?frac\{([^{}]*)\}\{([^{}]*)\}/;
  let s = latex;
  while (frac.test(s)) s = s.replace(frac, "(($1)/($2))");
  return s.replace(/\\(?:times|cdot|ast)(?![a-zA-Z])/g, "*").replace(/\\div(?![a-zA-Z])/g, "/")
    .replace(/\\(?:left|right)(?![a-zA-Z])/g, "").replace(/\\q?quad(?![a-zA-Z])|\\[,;:! ]/g, "")
    .replace(/\{/g, "(").replace(/\}/g, ")");
}

// ── equations ───────────────────────────────────────────────────────────────

/** What a numeric equation is written with; a character an unsure one may be counts when any of its readings is. */
const MATHY = /^[\d.+\-*/^()=×÷·∗⋅−– ]$/;
const mathy = (c: Char) => (typeof c === "string" ? MATHY.test(c) : c.some((o) => o !== " " && MATHY.test(o)));
const letter = (c: Char | undefined) => c !== undefined && (typeof c === "string" ? [c] : c).some((o) => /[\p{L}_]/u.test(o));
const digit = (c: Char | undefined) => typeof c === "string" && /\d/.test(c);
/** An operator or "=" — a run may start with "-", a sign, but with none of the others, and end with none. */
const OPERATOR = /^[+\-*/^=×÷·∗⋅−–]$/;

/**
 * The numeric equations in a line of words: each run of numbers, operators
 * and "=" that isn't part of something bigger — a letter or a digit-grouping
 * comma up against it ("x2 + 2 = 4", "1,000 + 1 = 1,001"), or an operator
 * joining it to letters ("x + 2 + 3 = 5", "y = 2 + 3") — has numbers on
 * both sides of every "=", and an operator in one of them.
 */
function equationsIn(p: Extract<Printed, { kind: "words" }>): EquationCheck[] {
  const seq: { c: Char; word: number }[] = [];
  p.words.forEach((w, i) => {
    if (i > 0) seq.push({ c: " ", word: -1 });
    for (const c of charsOf(p.math ? latexPlain(w) : w.replace(/\{/g, "(").replace(/\}/g, ")"))) seq.push({ c, word: i });
  });
  const out: EquationCheck[] = [];
  for (let i = 0; i < seq.length;) {
    if (!mathy(seq[i]!.c)) {
      i++;
      continue;
    }
    let j = i;
    while (j < seq.length && mathy(seq[j]!.c)) j++;
    let [s, e] = [i, j];
    i = j;
    while (s < e && seq[s]!.c === " ") s++;
    while (e > s && (seq[e - 1]!.c === " " || (seq[e - 1]!.c === "." && !digit(seq[e]?.c)))) e--;
    const [before, after] = [seq[s - 1]?.c, seq[e]?.c];
    if (s === e || letter(before) || letter(after) || (before === "," && digit(seq[s - 2]?.c)) || (after === "," && digit(seq[e + 1]?.c))) continue;
    // Starting with an operator or "=", or ending with one, it carries on something that isn't a number.
    if (OPERATOR.test(shownChar(seq[s]!.c)) || OPERATOR.test(shownChar(seq[e - 1]!.c))) {
      let k = s - 1;
      while (k >= 0 && seq[k]!.c === " ") k--;
      if (shownChar(seq[s]!.c) !== "-" || letter(seq[k]?.c) || OPERATOR.test(shownChar(seq[e - 1]!.c))) continue;
    }
    const found = equation(p, seq.slice(s, e));
    if (found) out.push(found);
  }
  return out;
}

function equation(p: Extract<Printed, { kind: "words" }>, run: { c: Char; word: number }[]): EquationCheck | null {
  const equals = run.flatMap((x, k) => (x.c === "=" ? [k] : []));
  if (equals.length === 0) return null;
  const wordsOf = (part: typeof run) => {
    const ws = part.map((x) => x.word).filter((w) => w >= 0);
    return ws.length ? [Math.min(...ws), Math.max(...ws)] as const : null;
  };
  const [from, to] = wordsOf(run)!;
  const base = { kind: "equation" as const, label: p.label, from: from + 1, to: to + 1, text: p.words.slice(from, to + 1).join(" ") };

  const readings = readingsOf(run.map((x) => x.c));
  if (!readings) return isUnsure(run.map((x) => x.c)) ? { ...base, verdict: "unsure", why: "too much of it is unclear" } : null;
  const results = readings.map((r) => {
    const sides = r.split("=");
    if (sides.length !== equals.length + 1 || sides.some((side) => !side.trim()) || !sides.some(hasOperator)) return null;
    const values = sides.map(evaluate);
    if (values.some((v) => v === null)) return null;
    // A side written as a plain decimal stands for what rounds to it: "1/3 = 0.33" holds.
    const same = (k: number) => {
      const [x, y] = [values[k]!, values[k + 1]!];
      const [nx, ny] = [numberOf(sides[k]!), numberOf(sides[k + 1]!)];
      if (ny && ny.places > 0) return agrees(x, ny);
      if (nx && nx.places > 0) return agrees(y, nx);
      return Math.abs(x - y) <= TINY * Math.max(1, Math.abs(x));
    };
    const bad = values.slice(0, -1).findIndex((_, k) => !same(k));
    return { sides, values: values as number[], bad };
  });
  const parsed = results.filter((r): r is NonNullable<typeof r> => r !== null);
  if (parsed.length === 0) return null;
  if (parsed.some((r) => r.bad < 0)) return { ...base, verdict: "right" };
  const [first] = parsed;
  const k = first!.bad;
  // Wrong every way it may be read, with a character unsure: still not said for sure — what was written may be none of them.
  // When the unsure character is on the right of the first "=", though, what the left side comes to is certain, and none of the
  // readings that are numbers is it: that much it says, and the rest is the model's to judge.
  if (results.length > 1) {
    const left = !isUnsure(run.slice(0, equals[0]).map((x) => x.c)) && parsed.every((r) => r.bad === 0 && Math.abs(r.values[0]! - first!.values[0]!) <= TINY);
    if (!left) return { ...base, verdict: "unsure", why: "a character in it is unclear" };
    const [a, b] = wordsOf(run.slice(equals[0]! + 1, equals[1] ?? run.length)) ?? [from, to];
    return {
      ...base, verdict: "unsure", place: `${p.label} ${span("word", a + 1, b + 1)}`,
      why: `a character in it is unclear; the left side is ${formatNumber(first!.values[0]!)}, which no reading of the right side gives`,
    };
  }
  const [a, b] = wordsOf(run.slice(equals[k]! + 1, equals[k + 1] ?? run.length)) ?? [from, to];
  const right = first!.sides[k + 1]!.trim();
  const said = numberOf(right) ? `not ${right}` : `but ${right} is ${formatNumber(first!.values[k + 1]!)}`;
  return {
    ...base, verdict: "wrong", place: `${p.label} ${span("word", a + 1, b + 1)}`,
    why: k === 0 ? `the left side is ${formatNumber(first!.values[0]!)}, ${said}` : `${first!.sides[k]!.trim()} is ${formatNumber(first!.values[k]!)}, ${said}`,
  };
}

// ── row operations ──────────────────────────────────────────────────────────

/** One row operation, rows 0-based: a row set to a combination of rows, or two rows swapped. */
type Op = { target: number; terms: { row: number; coef: number }[] } | { swap: [number, number] };

/** "R1 = R1 - R2", "R1 → R1 - R2", "R1 - R2 → R1", "R1 ↔ R2", several separated by "," or ";" — with `rows` rows; null when it doesn't read as that. */
function parseOps(reading: string, rows: number): Op[] | null {
  const s = reading.replace(DASHES, "-").replace(/[↓⇓]/g, " ").replace(/R_\(?(\d+)\)?/gi, "R$1").replace(/\s+/g, " ").trim().replace(/^(?:→|⟶|->) ?/, "");
  const ops: Op[] = [];
  for (const part of s.split(/[,;]/).map((x) => x.trim())) {
    if (!part) return null;
    const swap = /^R(\d+) ?(?:↔|⟷|⇄|<->|<=>) ?R(\d+)$/i.exec(part);
    const set = /^R(\d+) ?(?:=|:=|←|<-) ?(.+)$/i.exec(part);
    const into = /^(.+?) ?(?:→|⟶|->) ?R(\d+)$/i.exec(part);
    const becomes = /^R(\d+) ?(?:→|⟶|->) ?(.+)$/i.exec(part);
    if (swap) ops.push({ swap: [Number(swap[1]) - 1, Number(swap[2]) - 1] });
    else if (set || becomes || into) {
      const [target, text] = set ? [set[1]!, set[2]!] : into && !becomes ? [into[2]!, into[1]!] : [becomes![1]!, becomes![2]!];
      const terms = combination(text);
      if (!terms) return null;
      ops.push({ target: Number(target) - 1, terms });
    } else return null;
  }
  const used = ops.flatMap((o) => ("swap" in o ? o.swap : [o.target, ...o.terms.map((t) => t.row)]));
  return ops.length > 0 && used.every((r) => r >= 0 && r < rows) ? ops : null;
}

/** "R2 - 2R1", "3R2 + (1/2)R1", "-R3", "R1/2": each row with its coefficient; null when it isn't one. */
function combination(text: string): { row: number; coef: number }[] | null {
  const parts: string[] = [];
  let cur = "";
  let depth = 0;
  for (const ch of text.replace(/[×·∗⋅*]/g, "").replace(/\s+/g, "")) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if ((ch === "+" || ch === "-") && depth === 0 && cur !== "" && !cur.endsWith("(")) {
      parts.push(cur);
      cur = ch;
    } else cur += ch;
  }
  parts.push(cur);
  const terms: { row: number; coef: number }[] = [];
  for (const part of parts) {
    const m = /^([+-]?)(?:\(([^()]+)\)|(\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)?))?R(\d+)(?:\/(\d+(?:\.\d+)?))?$/i.exec(part);
    if (!m) return null;
    const coef = m[2] ?? m[3] ? numberOf(m[2] ?? m[3]!) : { value: 1, places: 0 };
    const by = m[5] ? Number(m[5]) : 1;
    if (!coef || by === 0) return null;
    const row = Number(m[4]) - 1;
    const value = (m[1] === "-" ? -1 : 1) * (coef.value / by);
    const same = terms.find((t) => t.row === row);
    if (same) same.coef += value;
    else terms.push({ row, coef: value });
  }
  return terms;
}

function formatOp(op: Op): string {
  if ("swap" in op) return `R${op.swap[0] + 1} ↔ R${op.swap[1] + 1}`;
  const terms = op.terms.map((t, k) => {
    const size = Math.abs(t.coef) === 1 ? "" : formatNumber(Math.abs(t.coef));
    return `${t.coef < 0 ? (k === 0 ? "-" : " - ") : k === 0 ? "" : " + "}${size}R${t.row + 1}`;
  });
  return `R${op.target + 1} = ${terms.join("")}`;
}

/**
 * What an entry may be: every value its readings give, and whether it was
 * read for sure — worked out from entries that all were — or null when it
 * can't be worked out.
 */
type Value = { values: number[]; sure: boolean } | null;
const MAX_VALUES = 8;

const dedupe = (xs: number[]) => xs.filter((x, i) => xs.findIndex((y) => Math.abs(x - y) <= TINY * Math.max(1, Math.abs(x))) === i);

/**
 * The matrix the operations make of `m`: all together, each reading the
 * matrix before (a row set twice can't be), or in turn.
 */
function applyOps(m: Value[][], ops: Op[], together: boolean): Value[][] | null {
  const one = (from: Value[][], into: Value[][], op: Op) => {
    if ("swap" in op) {
      into[op.swap[0]] = from[op.swap[1]]!;
      into[op.swap[1]] = from[op.swap[0]]!;
      return;
    }
    into[op.target] = from[op.target]!.map((_, c) => {
      let acc: number[] = [0];
      let sure = true;
      for (const t of op.terms) {
        const v = from[t.row]![c];
        if (!v) return null;
        acc = dedupe(acc.flatMap((a) => v.values.map((x) => a + t.coef * x)));
        sure &&= v.sure;
        if (acc.length > MAX_VALUES) return null;
      }
      return { values: acc, sure };
    });
  };
  if (together) {
    const set = ops.flatMap((o) => ("swap" in o ? o.swap : [o.target]));
    if (new Set(set).size !== set.length) return null;
    const next = [...m];
    for (const op of ops) one(m, next, op);
    return next;
  }
  let cur = m;
  for (const op of ops) {
    const next = [...cur];
    one(cur, next, op);
    cur = next;
  }
  return cur;
}

// ── steps ───────────────────────────────────────────────────────────────────

type MatrixPrinted = Extract<Printed, { kind: "matrix" }>;
type Cell = { values: Num[]; certain: boolean; shown: string } | null;

function cellOf(printed: string | null): Cell {
  if (printed === null) return null;
  const cs = charsOf(printed);
  const values = (readingsOf(cs) ?? []).map(numberOf).filter((n): n is Num => n !== null);
  return { values, certain: !isUnsure(cs) && values.length === 1, shown: printed };
}

const sizeOf = (m: MatrixPrinted) => [m.rows.length, Math.max(0, ...m.rows.map((r) => r.length))] as const;

/** Whether a line looks written as row operations: a row named, and "=" or an arrow — however its unsure characters are read. */
function looksLikeOps(p: Extract<Printed, { kind: "words" }>): boolean {
  const text = p.words.join(" ");
  const readings = readingsOf(charsOf(text)) ?? [text.replace(/«[^»]*»/g, "")];
  return readings.some((r) => /R_?\(?\d/i.test(r) && /[=→↔←⟶⇄⟷]|->|<-/.test(r));
}

function checkStep(prev: MatrixPrinted, lines: Extract<Printed, { kind: "words" }>[], next: MatrixPrinted): StepCheck {
  const by = lines.map((l) => l.label);
  const base = { kind: "step" as const, from: prev.label, to: next.label, by, op: null, wrong: [], skipped: [] };
  const unsure = (why: string): StepCheck => ({ ...base, verdict: "unsure", unsure: [why] });
  const [rows, cols] = sizeOf(prev);
  const [rows2, cols2] = sizeOf(next);
  if (rows !== rows2 || cols !== cols2) return unsure(`${prev.label} is ${rows} x ${cols} but ${next.label} is ${rows2} x ${cols2}`);

  const readings = readingsOf(lines.flatMap((l, k) => [...(k > 0 ? [";"] : []), ...charsOf(l.words.join(" "))]));
  if (!readings) return unsure(`${by.join(" and ")} is too unclear to read`);
  // Every way of reading the operations that makes sense, once each — several on one line done together, and in turn when that differs.
  const ways = new Map<string, { ops: Op[]; together: boolean }>();
  for (const r of readings) {
    const ops = parseOps(r, rows);
    if (!ops) continue;
    const text = ops.map(formatOp).join(", ");
    ways.set(`${text} together`, { ops, together: true });
    const reads = (o: Op) => ("swap" in o ? o.swap : o.terms.map((t) => t.row));
    const sets = (o: Op) => ("swap" in o ? o.swap : [o.target]);
    if (ops.some((o, i) => ops.slice(0, i).some((before) => sets(before).some((row) => reads(o).includes(row))))) ways.set(`${text} in turn`, { ops, together: false });
  }
  if (ways.size === 0) return unsure(`${by.join(" and ")} can't be read as row operations`);

  const source: Value[][] = prev.rows.map((r) => Array.from({ length: cols }, (_, c) => {
    const cell = cellOf(r[c] ?? null);
    return cell?.values.length ? { values: dedupe(cell.values.map((n) => n.value)), sure: cell.certain } : null;
  }));
  const written = next.rows.map((r) => Array.from({ length: cols }, (_, c) => cellOf(r[c] ?? null)));
  const results = [...ways.values()].map(({ ops, together }) => {
    const op = ops.map(formatOp).join(", ");
    const made = applyOps(source, ops, together);
    const wrong: StepCheck["wrong"] = [];
    const unclear: string[] = [];
    if (!made) return { op, wrong, unsure: unclear, ok: false };
    made.forEach((row, r) => row.forEach((expected, c) => {
      const address = `${next.label} row ${r + 1} col ${c + 1}`;
      const w = written[r]![c];
      if (!w) {
        if (expected) unclear.push(`${address} is empty`);
      } else if (!expected) unclear.push(`${address} can't be worked out: an entry of ${prev.label} it comes from is unclear`);
      else if (expected.values.some((e) => w.values.some((n) => agrees(e, n)))) return;
      else if (w.certain && expected.sure && expected.values.length === 1) wrong.push({ address, gives: expected.values[0]!, written: w.shown });
      else unclear.push(w.certain ? `${address} can't be worked out: an entry of ${prev.label} it comes from is unclear` : `${address} is unclear (${w.shown})`);
    }));
    return { op, wrong, unsure: unclear, ok: true };
  }).filter((x) => x.ok);

  const right = results.filter((x) => x.wrong.length === 0).sort((a, b) => a.unsure.length - b.unsure.length)[0];
  if (right) return { ...base, verdict: "right", op: right.op, unsure: right.unsure };
  if (results.length === 1) return { ...base, verdict: "wrong", op: results[0]!.op, wrong: results[0]!.wrong, unsure: results[0]!.unsure };
  return unsure(results.length === 0 ? `${by.join(" and ")} set a row twice` : `${by.join(" and ")} can be read more than one way (${results.map((x) => x.op).join("; ")}), and no way gives ${next.label}`);
}

// ── the board ───────────────────────────────────────────────────────────────

/** Every check on a board: steps between matrices first come first, as do equations, in reading order. */
export function checkPrinted(printed: Printed[]): Check[] {
  const checks: Check[] = [];
  let prev: MatrixPrinted | null = null;
  let lines: Extract<Printed, { kind: "words" }>[] = [];
  /** The wrong step the run of steps is past, if it is. */
  let wrongStep: StepCheck | null = null;
  for (const p of printed) {
    if (p.kind === "gap") [prev, lines, wrongStep] = [null, [], null];
    else if (p.kind === "matrix") {
      if (prev && lines.length > 0) {
        if (wrongStep) wrongStep.skipped.push(p.label);
        else {
          const step = checkStep(prev, lines, p);
          checks.push(step);
          if (step.verdict === "wrong") wrongStep = step;
        }
      } else wrongStep = null;
      [prev, lines] = [p, []];
    } else if (looksLikeOps(p)) lines.push(p);
    else checks.push(...equationsIn(p));
  }
  return checks;
}

/** The board's matrices, lines of writing and typed text as the read printed them — those of it the read printed, in its order. */
export function printedBoard(elements: CanvasElement[], doc: CanvasDoc): Printed[] {
  const print = (w: Parameters<typeof printedWord>[0]) => printedWord(w, doc.reads, DEFAULT_MIN_CONFIDENCE);
  return doc.items.flatMap((item): Printed[] => {
    if (item.partly) return [{ kind: "gap" }];
    if (item.kind === "matrix" || item.kind === "writing") {
      const block = doc.handwriting.blocks.find((b) => b.id === item.label);
      if (block?.kind === "matrix") return [{ kind: "matrix", label: item.label, rows: block.rows.map((r) => r.cells.map((c) => (c ? print(c) : null))) }];
      // Operators written between matrices are part of an expression of matrices, not a line to check.
      return block?.kind === "text" && !block.operands ? [{ kind: "words", label: item.label, words: block.words.map(print) }] : [];
    }
    if (item.kind !== "text" && item.kind !== "note" && item.kind !== "math") return [];
    const e = elements.find((x) => x.id === item.elementIds[0]);
    if (e?.type === "math") return [{ kind: "words", label: item.label, words: typedWords(e.props.latex), math: true }];
    return e?.type === "text" || e?.type === "note" ? [{ kind: "words", label: item.label, words: typedWords(e.props.text) }] : [];
  });
}

export const checkBoard = (elements: CanvasElement[], doc: CanvasDoc) => checkPrinted(printedBoard(elements, doc));

const MAX_WRONG_ENTRIES = 4;

/** The checks as the model reads them, after the board; null when nothing was checked. */
export function checksSection(checks: Check[]): string | null {
  if (checks.length === 0) return null;
  const wrong: string[] = [];
  const right: string[] = [];
  const unsure: string[] = [];
  for (const c of checks) {
    if (c.kind === "equation") {
      const where = `${c.label} ${span("word", c.from, c.to)}`;
      const at = `${c.place ?? where}: ${c.text}${c.place && c.place !== where ? ` (${where})` : ""} — ${c.why}.`;
      if (c.verdict === "wrong") wrong.push(`- ${at}`);
      else if (c.verdict === "right") right.push(`- ${where}: ${c.text} holds.`);
      else unsure.push(`- ${at}`);
      continue;
    }
    const how = `${c.op} (${c.by.join(", ")}) from ${c.from}`;
    if (c.verdict === "wrong") {
      const shown = c.wrong.slice(0, MAX_WRONG_ENTRIES).map((w) => `- ${w.address}: ${how} gives ${formatNumber(w.gives)}; written ${w.written}.`);
      if (c.wrong.length > MAX_WRONG_ENTRIES) shown.push(`- ${c.wrong.length - MAX_WRONG_ENTRIES} more entries of ${c.to} don't follow either.`);
      if (c.skipped.length > 0) shown[shown.length - 1] += ` The steps after it (${c.skipped.join(", ")}) build on ${c.to} and weren't checked.`;
      wrong.push(...shown);
    } else if (c.verdict === "right") right.push(`- ${c.to}: ${c.unsure.length ? "every entry checked" : "every entry"} follows from ${c.from} by ${c.op} (${c.by.join(", ")}).`);
    if (c.verdict === "unsure") unsure.push(`- ${c.to} from ${c.from}: ${c.unsure[0]}.`);
    else unsure.push(...c.unsure.map((u) => `- ${u}.`));
  }
  return [
    "ARITHMETIC CHECKED",
    "Worked out exactly from the board as read above: every matrix with row operations written between it and the matrix before it, "
      + "and every equation with numbers on both sides. Nothing else was checked.",
    ...(wrong.length ? ["Mistakes:", ...wrong] : ["Mistakes: none found."]),
    ...(right.length ? ["Right:", ...right] : []),
    ...(unsure.length ? ["Can't check:", ...unsure] : []),
  ].join("\n");
}

/** The board's text as the model reads it: the read, then what was checked on it. */
export function withChecks(read: { text: string; doc: CanvasDoc }, elements: CanvasElement[]): string {
  const section = checksSection(checkBoard(elements, read.doc));
  return section ? `${read.text}\n\n${section}` : read.text;
}
