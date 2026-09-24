import { describe, expect, it } from "vitest";
import { assertSymbolsAllowed, evaluateExpression, extractSymbols, tryEvaluateExpression } from "../lib/walkthrough/eval";

describe("extractSymbols", () => {
  it("collects every free variable in an expression", () => {
    expect(new Set(extractSymbols("R * C"))).toEqual(new Set(["R", "C"]));
  });

  it("does not report function names as symbols", () => {
    expect(new Set(extractSymbols("orbitRadius * cos(2 * pi * t / period)"))).toEqual(
      new Set(["orbitRadius", "t", "period"]),
    );
  });
});

describe("assertSymbolsAllowed", () => {
  it("passes when every symbol is declared", () => {
    expect(() => assertSymbolsAllowed("R * C", new Set(["R", "C"]))).not.toThrow();
  });

  it("throws when an expression references an undeclared symbol", () => {
    expect(() => assertSymbolsAllowed("R * C * V", new Set(["R", "C"]))).toThrow(/V/);
  });

  it("allows t only when explicitly included, matching a scene's expanded scope", () => {
    expect(() => assertSymbolsAllowed("orbitRadius * cos(t)", new Set(["orbitRadius"]))).toThrow(/t/);
    expect(() => assertSymbolsAllowed("orbitRadius * cos(t)", new Set(["orbitRadius", "t"]))).not.toThrow();
  });
});

describe("evaluateExpression", () => {
  it("evaluates a valid expression against a scope", () => {
    expect(evaluateExpression("R * C", { R: 1000, C: 0.001 })).toBeCloseTo(1);
  });

  it("throws on a non-finite result (e.g. division by zero)", () => {
    expect(() => evaluateExpression("1 / R", { R: 0 })).toThrow();
  });
});

describe("tryEvaluateExpression", () => {
  it("returns null instead of throwing for an out-of-range parameter value", () => {
    expect(tryEvaluateExpression("1 / R", { R: 0 })).toBeNull();
  });

  it("returns the value for a valid expression", () => {
    expect(tryEvaluateExpression("2 * pi * orbitRadius / period", { orbitRadius: 60, period: 8 })).toBeCloseTo(
      (2 * Math.PI * 60) / 8,
    );
  });
});
