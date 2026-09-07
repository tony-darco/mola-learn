import { describe, expect, it } from "vitest";
import { shuffleOptions } from "../lib/agent/tools/quizzes";

describe("shuffleOptions — fixes the model's positional bias", () => {
  it("keeps the same set of options, just reordered", () => {
    const { options } = shuffleOptions(["a", "b", "c", "d"], 0, () => 0.5);
    expect([...options].sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("correctIndex still points at the actual correct option after shuffling", () => {
    const { options, correctIndex } = shuffleOptions(["wrong1", "right", "wrong2"], 1, () => 0.9);
    expect(options[correctIndex]).toBe("right");
  });

  it("a real Fisher-Yates pass can move the correct answer off its original slot", () => {
    // random() always returning 0 makes every swap target index 0 — a
    // concrete, deterministic permutation to assert against, not just
    // "it changed something".
    const { options, correctIndex } = shuffleOptions(["a", "b", "c", "d"], 0, () => 0);
    expect(correctIndex).not.toBe(0);
    expect(options[correctIndex]).toBe("a");
  });

  it("never loses or duplicates an option", () => {
    const original = ["only one way to do this", "another way", "third way"];
    const { options } = shuffleOptions(original, 2, () => 0.3);
    expect(options).toHaveLength(3);
    expect(new Set(options).size).toBe(3);
  });

  it("does not mutate the input array", () => {
    const original = ["a", "b", "c"];
    const copy = [...original];
    shuffleOptions(original, 0, () => 0.7);
    expect(original).toEqual(copy);
  });

  it("across many questions with the model's real bias (always correctIndex=1), the shuffled answer key is not all the same slot", () => {
    // Reproduces the actual live failure: 10 questions, every correctIndex=1.
    let random = 0.1;
    const results = Array.from({ length: 10 }, () => {
      random = (random + 0.37) % 1; // cheap deterministic pseudo-variety, no real RNG needed
      return shuffleOptions(["w1", "right", "w2", "w3"], 1, () => random).correctIndex;
    });
    const distinctSlots = new Set(results);
    expect(distinctSlots.size).toBeGreaterThan(1);
  });
});
