/**
 * A deterministic math tool (§ calculator feature) — the model calls this
 * instead of computing by hand, the same reason a human reaches for an
 * actual calculator rather than trusting mental arithmetic on anything that
 * matters. Covers the full ask: + - × ÷, sqrt, squares, modular arithmetic,
 * and "higher" functions (trig, log, powers, etc.) via mathjs's expression
 * evaluator — confirmed live: `17 % 5` → 2, `mod(17, 5)` → 2, and mathjs
 * uses the mathematical (floored) convention for a negative left operand
 * (`-17 % 5` → 3), not JS's own `%` truncated-remainder result (which would
 * be -2) — worth knowing since a student's modular-arithmetic homework
 * assumes the mathematical convention. `7^2` and `square(7)` both → 49.
 *
 * mathjs's `evaluate()` is a dedicated math-expression parser, NOT JS eval —
 * confirmed it has no access to the global scope (`process`, `import`, etc.
 * all correctly rejected as undefined symbols), so a model-supplied
 * expression string can't be turned into arbitrary code execution.
 */
import { z } from "zod";
import { evaluate } from "mathjs";
import type { Tool } from "../registry";

const inputSchema = z.object({
  expression: z.string().describe(
    "A math expression to evaluate exactly, e.g. \"12 * (3 + 4)\", \"sqrt(144)\", \"7^2\", "
    + "\"17 % 5\" (modular arithmetic — mathematical convention, so a negative left operand "
    + "still returns a non-negative remainder), \"sin(pi/4)\", \"log10(1000)\", \"2^10\". "
    + "Supports +, -, *, /, ^ (power/square), % or mod() (modulo), sqrt, cbrt, abs, trig "
    + "(sin/cos/tan and inverses), log/log10/log2/ln, exp, and standard constants (pi, e).",
  ),
});

export const calculatorTool: Tool<z.infer<typeof inputSchema>> = {
  name: "calculator",
  description: "Evaluates a math expression exactly — arithmetic, sqrt, squares, modular "
    + "arithmetic, trig, logs, powers. Use this for any calculation whose result matters, "
    + "rather than computing it yourself.",
  inputSchema,
  label: (input) => `Calculating ${input.expression}`,

  async execute(input) {
    try {
      const result = evaluate(input.expression);
      if (typeof result !== "number" || !Number.isFinite(result)) {
        return { error: `expression did not evaluate to a finite number: ${String(result)}` };
      }
      return { expression: input.expression, result };
    } catch (err) {
      return { error: `could not evaluate "${input.expression}": ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
