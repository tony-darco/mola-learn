/**
 * mathjs wrapper shared by the server-side validation in
 * lib/agent/tools/walkthroughs.ts and the client-side recompute loop in
 * WalkthroughView.tsx — one evaluation semantics for both.
 */
import * as mathjs from "mathjs";

/**
 * mathjs's own scope lookup falls back to its namespace for anything not in
 * the caller-supplied scope — so "cos", "pi", "sqrt", etc. all parse as
 * plain SymbolNodes, indistinguishable from a real variable by node type
 * alone. Anything mathjs exports at the top level is a builtin, not
 * something a walkthrough author declares. (A declared parameter named the
 * same as a builtin, e.g. "e", would be shadowed by the builtin here — an
 * acceptable edge case, same as it would be in mathjs itself.)
 */
const BUILTIN_NAMES = new Set(Object.keys(mathjs));

/** Free variable names referenced by a mathjs expression, e.g. "R * C" -> ["R", "C"]. */
export function extractSymbols(expression: string): string[] {
  const names = new Set<string>();
  const node = mathjs.parse(expression);
  node.traverse((n) => {
    if (n.type !== "SymbolNode") return;
    const name = (n as unknown as { name: string }).name;
    if (!BUILTIN_NAMES.has(name)) names.add(name);
  });
  return [...names];
}

/** Throws if `expression` references a symbol outside `allowedSymbols`. */
export function assertSymbolsAllowed(expression: string, allowedSymbols: ReadonlySet<string>): void {
  for (const name of extractSymbols(expression)) {
    if (!allowedSymbols.has(name)) {
      throw new Error(`expression "${expression}" references unknown symbol "${name}"`);
    }
  }
}

export function evaluateExpression(expression: string, scope: Record<string, number>): number {
  const result = mathjs.evaluate(expression, scope);
  if (typeof result !== "number" || !Number.isFinite(result)) {
    throw new Error(`expression "${expression}" did not evaluate to a finite number`);
  }
  return result;
}

/**
 * Client-side rendering is more permissive than server-side validation: a
 * slider can legally sit anywhere in [min, max], including a value that
 * makes some OTHER expression divide by zero even though it evaluated fine
 * at the parameters' defaults. Renderers skip a point rather than crash.
 */
export function tryEvaluateExpression(expression: string, scope: Record<string, number>): number | null {
  try {
    return evaluateExpression(expression, scope);
  } catch {
    return null;
  }
}
