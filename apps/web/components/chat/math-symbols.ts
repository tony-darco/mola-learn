/**
 * Math input palette (§ math inputs feature) — the five categories match the
 * WolframAlpha math keyboard reference this was modeled on. Each snippet is
 * one LaTeX template; a blank uses MathLive's own `\placeholder{}` command,
 * not a bare empty `{}` — confirmed live that a bare `{}` doesn't work as a
 * landing target: MathLive's `insert()` with its default
 * `selectionMode: "placeholder"` only recognizes `\placeholder{}` nodes, so
 * a bare-`{}` sqrt selected the WHOLE inserted \sqrt{} structure instead of
 * just its argument, and typing replaced the radical entirely instead of
 * filling it in.
 */
export type MathSnippet = {
  label: string;
  latex: string;
  /** false for a pure symbol/prefix with no `\placeholder{}` to land in
   * (π, ∞, d/dx, Σ, …) — those land the cursor right after instead. */
  hasBlank?: boolean;
  /** "matrix": asks for rows then columns first, then builds a matrix of
   * exactly that shape (1 column = a column vector, 1 row = a row vector) —
   * rather than a fixed size the student edits by hand (row/column
   * navigation inside a matrix couldn't be confirmed reliable via arrow
   * keys, so this sidesteps needing it for any given size). */
  dynamic?: "matrix";
};

export type MathCategory = { id: string; label: string; icon: string; snippets: MathSnippet[] };

const P = "\\placeholder{}";

/** Builds an exactly rows×cols matrix, one \placeholder{} per cell. */
export function buildMatrixLatex(rows: number, cols: number): string {
  const row = Array.from({ length: cols }, () => P).join(" & ");
  const allRows = Array.from({ length: rows }, () => row);
  return `\\begin{bmatrix} ${allRows.join(" \\\\ ")} \\end{bmatrix}`;
}

export const MATH_CATEGORIES: MathCategory[] = [
  {
    id: "basic", label: "Basic Math", icon: "√",
    snippets: [
      { label: "a⁄b", latex: `\\frac{${P}}{${P}}`, hasBlank: true },
      { label: "x²", latex: "^{2}" },
      { label: "xⁿ", latex: `^{${P}}`, hasBlank: true },
      { label: "√x", latex: `\\sqrt{${P}}`, hasBlank: true },
      { label: "∛x", latex: `\\sqrt[3]{${P}}`, hasBlank: true },
      { label: "ⁿ√x", latex: `\\sqrt[n]{${P}}`, hasBlank: true },
      { label: "∞", latex: "\\infty" },
      { label: "-∞", latex: "-\\infty" },
      { label: "π", latex: "\\pi" },
      { label: "e", latex: "e" },
      { label: "eˣ", latex: `e^{${P}}`, hasBlank: true },
      { label: "ln", latex: `\\ln(${P})`, hasBlank: true },
      { label: "logₐ", latex: `\\log_{${P}}(${P})`, hasBlank: true },
      { label: "log₁₀", latex: `\\log_{10}(${P})`, hasBlank: true },
      { label: "|x|", latex: `\\left|${P}\\right|`, hasBlank: true },
      { label: "≤", latex: "\\leq" },
      { label: "≥", latex: "\\geq" },
      { label: "≠", latex: "\\neq" },
    ],
  },
  {
    id: "calculus", label: "Calculus & Sums", icon: "∫",
    snippets: [
      { label: "d⁄dx", latex: "\\frac{d}{dx}" },
      { label: "d²⁄dx²", latex: "\\frac{d^2}{dx^2}" },
      { label: "∂⁄∂x", latex: "\\frac{\\partial}{\\partial x}" },
      { label: "∫", latex: `\\int ${P}\\,dx`, hasBlank: true },
      { label: "∫ₐᵇ", latex: `\\int_{${P}}^{${P}} \\,dx`, hasBlank: true },
      { label: "∮", latex: `\\oint ${P}\\,dx`, hasBlank: true },
      { label: "Σ", latex: "\\sum_{n=1}^{\\infty}" },
      { label: "∏", latex: "\\prod_{n=1}^{\\infty}" },
      { label: "lim", latex: `\\lim_{x \\to ${P}}`, hasBlank: true },
      { label: "lim ∞", latex: "\\lim_{x \\to \\infty}" },
      { label: "∇", latex: "\\nabla" },
    ],
  },
  {
    id: "vectors", label: "Vectors & Matrices", icon: "⊞",
    snippets: [
      { label: "(a,b)", latex: `\\left(${P}\\right)`, hasBlank: true },
      // \overrightarrow rather than \vec — \vec's accent sits cramped right
      // on top of the content with almost no clearance, especially over a
      // single placeholder box; \overrightarrow is a longer arrow drawn with
      // real spacing above whatever it spans, which is exactly what's under
      // it here rather than a single italic letter it was really designed for.
      { label: "vec (→)", latex: `\\overrightarrow{${P}}`, hasBlank: true },
      { label: "[a b]", latex: `\\begin{bmatrix} ${P} \\end{bmatrix}`, hasBlank: true },
      // Asks for rows then columns, builds exactly that — see buildMatrixLatex.
      { label: "matrix (n×m)", latex: "", dynamic: "matrix" },
      { label: "2×2", latex: "\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}" },
      { label: "3×3", latex: "\\begin{bmatrix} a & b & c \\\\ d & e & f \\\\ g & h & i \\end{bmatrix}" },
      { label: "det", latex: `\\det\\begin{vmatrix} ${P} \\end{vmatrix}`, hasBlank: true },
      { label: "‖x‖", latex: `\\left\\|${P}\\right\\|`, hasBlank: true },
    ],
  },
  {
    id: "trig", label: "Trigonometry", icon: "∿",
    snippets: [
      { label: "sin", latex: `\\sin(${P})`, hasBlank: true },
      { label: "cos", latex: `\\cos(${P})`, hasBlank: true },
      { label: "tan", latex: `\\tan(${P})`, hasBlank: true },
      { label: "sin⁻¹", latex: `\\sin^{-1}(${P})`, hasBlank: true },
      { label: "cos⁻¹", latex: `\\cos^{-1}(${P})`, hasBlank: true },
      { label: "tan⁻¹", latex: `\\tan^{-1}(${P})`, hasBlank: true },
      { label: "sinh", latex: `\\sinh(${P})`, hasBlank: true },
      { label: "cosh", latex: `\\cosh(${P})`, hasBlank: true },
      { label: "tanh", latex: `\\tanh(${P})`, hasBlank: true },
      { label: "θ", latex: "\\theta" },
      { label: "°", latex: "^{\\circ}" },
      { label: "rad", latex: "\\text{rad}" },
    ],
  },
  {
    id: "symbols", label: "Symbols", icon: "αω",
    snippets: [
      { label: "α", latex: "\\alpha" },
      { label: "β", latex: "\\beta" },
      { label: "γ", latex: "\\gamma" },
      { label: "δ", latex: "\\delta" },
      { label: "ε", latex: "\\epsilon" },
      { label: "λ", latex: "\\lambda" },
      { label: "μ", latex: "\\mu" },
      { label: "σ", latex: "\\sigma" },
      { label: "φ", latex: "\\varphi" },
      { label: "ω", latex: "\\omega" },
      { label: "Δ", latex: "\\Delta" },
      { label: "Σ", latex: "\\Sigma" },
      { label: "Ω", latex: "\\Omega" },
      { label: "∈", latex: "\\in" },
      { label: "∉", latex: "\\notin" },
      { label: "∀", latex: "\\forall" },
      { label: "∃", latex: "\\exists" },
      { label: "∪", latex: "\\cup" },
      { label: "∩", latex: "\\cap" },
      { label: "→", latex: "\\to" },
      { label: "±", latex: "\\pm" },
    ],
  },
];

/** Wraps a completed LaTeX expression (built in the visual math-field editor)
 * for insertion into the plain chat textarea at its current selection —
 * unless already inside an open $...$ span there, mirroring the same
 * odd-dollar-count check used before. */
export function wrapMathForInsertion(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  latex: string,
): { value: string; cursor: number } {
  const beforeCursor = value.slice(0, selectionStart);
  const dollarCount = (beforeCursor.match(/\$/g) ?? []).length;
  const insideMath = dollarCount % 2 === 1;

  const insertText = insideMath ? latex : `$${latex}$`;
  const newValue = value.slice(0, selectionStart) + insertText + value.slice(selectionEnd);
  const cursor = selectionStart + insertText.length;
  return { value: newValue, cursor };
}
