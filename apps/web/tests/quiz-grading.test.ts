import { describe, expect, it } from "vitest";
import { gradeQuiz } from "../lib/quizzes/grading";

function mc(id: string, correctIndex: number) {
  return { type: "multiple_choice" as const, id, prompt: "q", options: ["a", "b", "c"], correctIndex, explanation: null };
}
function sa(id: string) {
  return { type: "short_answer" as const, id, prompt: "q", expectedAnswer: "answer", explanation: null };
}

describe("gradeQuiz — deterministic, no LLM call", () => {
  it("scores a fully correct attempt", () => {
    const questions = [mc("1", 0), mc("2", 1), mc("3", 2)];
    const result = gradeQuiz(questions, { "1": 0, "2": 1, "3": 2 });
    expect(result).toEqual({ score: 3, total: 3 });
  });

  it("scores a fully wrong attempt as zero, not negative or undefined", () => {
    const questions = [mc("1", 0), mc("2", 1)];
    const result = gradeQuiz(questions, { "1": 1, "2": 0 });
    expect(result).toEqual({ score: 0, total: 2 });
  });

  it("treats a missing answer as wrong, not a crash", () => {
    const questions = [mc("1", 0), mc("2", 1)];
    const result = gradeQuiz(questions, { "1": 0 });
    expect(result).toEqual({ score: 1, total: 2 });
  });

  it("counts short_answer toward total but never toward score", () => {
    const questions = [mc("1", 0), sa("2")];
    const result = gradeQuiz(questions, { "1": 0, "2": 0 });
    expect(result).toEqual({ score: 1, total: 2 });
  });

  it("ignores an answer keyed to a question id that isn't in this quiz", () => {
    const questions = [mc("1", 0)];
    const result = gradeQuiz(questions, { "1": 0, "unrelated-id": 0 });
    expect(result).toEqual({ score: 1, total: 1 });
  });

  it("handles an empty question set", () => {
    expect(gradeQuiz([], {})).toEqual({ score: 0, total: 0 });
  });

  it("is a pure function — same inputs, same output, no mutation", () => {
    const questions = [mc("1", 0)];
    const answers = { "1": 0 };
    const before = JSON.stringify(questions);
    gradeQuiz(questions, answers);
    expect(JSON.stringify(questions)).toBe(before);
    expect(gradeQuiz(questions, answers)).toEqual(gradeQuiz(questions, answers));
  });
});
