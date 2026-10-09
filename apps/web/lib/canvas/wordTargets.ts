/**
 * Words in typed text, as the canvas chat addresses them: "X1 word 11",
 * "Q2 words 3–5". A text box's, a sticky note's or a math element's words
 * are its text — the LaTeX, for math — split at white space, counted from 1,
 * the same on the server (lib/canvas/textSyntax/targets.ts resolves them,
 * checks.ts names them) as on the canvas page.
 *
 * The server doesn't know where a word is drawn: an annotation on one is
 * placed on its whole element, and the page finds the word in what it drew
 * (ElementRenderer.tsx) — in a text box or note, the word's characters; in
 * math, the characters KaTeX drew for that piece of LaTeX (visibleLatex) —
 * and marks that, or the whole element when it can't.
 *
 * Pure, so the page and the server share it.
 */

/** Typed text's words, each with where it starts and ends in the text. */
export function typedWordSpans(text: string): { word: string; start: number; end: number }[] {
  return [...text.matchAll(/\S+/g)].map((m) => ({ word: m[0], start: m.index, end: m.index + m[0].length }));
}

export const typedWords = (text: string) => typedWordSpans(text).map((s) => s.word);

/** The words an annotation's place names, 1-based and in order — [11, 11] for "X1 word 11", [3, 5] for "Q2 words 3–5" — or null. */
export function targetWords(target: string): [number, number] | null {
  const m = /\bwords? (\d+)(?:\s*[–-]\s*(\d+))?$/.exec(target);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2] ?? m[1]);
  return a <= b ? [a, b] : [b, a];
}

/** What KaTeX draws for a command, when it is one character. */
const COMMANDS: Record<string, string> = {
  times: "×", cdot: "⋅", div: "÷", pm: "±", mp: "∓", ast: "∗", le: "≤", leq: "≤", ge: "≥", geq: "≥", ne: "≠", neq: "≠",
  approx: "≈", equiv: "≡", to: "→", rightarrow: "→", infty: "∞", pi: "π", theta: "θ", alpha: "α", beta: "β", lambda: "λ",
};
/** Characters KaTeX draws differently from how they are typed. */
const DRAWN: Record<string, string> = { "-": "−", "*": "∗" };

/**
 * The characters KaTeX draws for a piece of LaTeX, in the order it draws
 * them: "12" for "12", "÷" for "\div", "12" for "\frac{1}{2}". Null when
 * it can't say — a command it doesn't know — so the page marks the whole
 * element rather than the wrong characters.
 */
export function visibleLatex(latex: string): string | null {
  let out = "";
  for (let i = 0; i < latex.length; i++) {
    const c = latex[i]!;
    if (c === "\\") {
      const name = /^[a-zA-Z]+|^./.exec(latex.slice(i + 1))?.[0] ?? "";
      i += name.length;
      if (name === "frac" || name === "dfrac" || name === "tfrac" || name === "left" || name === "right") continue;
      if (name === "," || name === ";" || name === ":" || name === "!" || name === " " || name === "quad" || name === "qquad") continue;
      if (name === "{" || name === "}") { out += name; continue; }
      const drawn = COMMANDS[name];
      if (!drawn) return null;
      out += drawn;
    } else if (c === "{" || c === "}" || c === "^" || c === "_" || /\s/.test(c)) continue;
    else out += DRAWN[c] ?? c;
  }
  return out;
}

/**
 * Where words `from`–`to` (1-based) of `latex` are among the characters
 * KaTeX drew for all of it, `drawn` — the first character's index and how
 * many — or null when what was drawn isn't what the LaTeX says would be.
 */
export function latexWordRange(latex: string, drawn: string, from: number, to: number): { start: number; length: number } | null {
  const words = typedWords(latex).map(visibleLatex);
  if (to > words.length || words.some((w) => w === null) || words.join("") !== drawn) return null;
  const start = words.slice(0, from - 1).join("").length;
  const length = words.slice(from - 1, to).join("").length;
  return length > 0 ? { start, length } : null;
}
