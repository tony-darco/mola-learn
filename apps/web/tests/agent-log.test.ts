/**
 * Pure-logic tests for the debug agent logger (lib/debug/agent-log.ts).
 * Per this repo's testing convention, nothing here touches getSession() or a
 * real session — gating is tested by passing explicit emails/allowlists in,
 * exactly as the module's own pure helpers are designed to take them.
 */
import { describe, expect, it } from "vitest";
import {
  buildLlmCallRecord,
  buildToolCallRecord,
  buildTurnSummaryRecord,
  charCount,
  computeAllowedEmails,
  estimateTokens,
  isEmailAllowed,
  promptText,
  responseText,
} from "../lib/debug/agent-log";

describe("computeAllowedEmails", () => {
  it("defaults to just alice@umbc.edu when unset", () => {
    expect(computeAllowedEmails(undefined)).toEqual(["alice@umbc.edu"]);
  });

  it("splits, trims, and lowercases a comma-separated list", () => {
    expect(computeAllowedEmails(" Alice@UMBC.edu, Bob@Example.com ,,")).toEqual([
      "alice@umbc.edu",
      "bob@example.com",
    ]);
  });
});

describe("isEmailAllowed", () => {
  const allowed = ["alice@umbc.edu"];

  it("allows an exact match", () => {
    expect(isEmailAllowed("alice@umbc.edu", allowed)).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isEmailAllowed("ALICE@UMBC.EDU", allowed)).toBe(true);
  });

  it("rejects an email not on the list", () => {
    expect(isEmailAllowed("bob@example.com", allowed)).toBe(false);
  });

  it("rejects null/undefined/empty", () => {
    expect(isEmailAllowed(null, allowed)).toBe(false);
    expect(isEmailAllowed(undefined, allowed)).toBe(false);
    expect(isEmailAllowed("", allowed)).toBe(false);
  });
});

describe("charCount / estimateTokens", () => {
  it("counts exact characters", () => {
    expect(charCount("hello")).toBe(5);
    expect(charCount("")).toBe(0);
  });

  it("estimates ~4 chars per token, rounded up", () => {
    expect(estimateTokens(0)).toBe(0);
    expect(estimateTokens(1)).toBe(1);
    expect(estimateTokens(4)).toBe(1);
    expect(estimateTokens(5)).toBe(2);
    expect(estimateTokens(400)).toBe(100);
  });
});

describe("promptText / responseText", () => {
  it("flattens system + messages into plain text, not JSON", () => {
    const text = promptText("You are helpful.", [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ]);
    expect(text).toBe("You are helpful.\n\nuser: hi\nassistant: hello");
  });

  it("appends tool calls as plain text when present", () => {
    const text = responseText("here you go", [{ name: "grep_search", input: { q: "foo" } }]);
    expect(text).toBe('here you go\ngrep_search({"q":"foo"})');
  });

  it("is just the text when there are no tool calls", () => {
    expect(responseText("hello", [])).toBe("hello");
  });
});

describe("buildLlmCallRecord", () => {
  it("produces a JSON-serializable record with correct derived fields", () => {
    const entry = {
      turnId: "t1", chatId: "c1", userId: "u1", model: "qwen3.6:27b",
      system: "sys", messages: [{ role: "user", content: "1234567890" }],
      responseText: "abcde", toolCalls: [], stopReason: "end_turn",
      startedAt: 1000, endedAt: 2500,
    };
    const record = buildLlmCallRecord(entry);
    const roundTripped = JSON.parse(JSON.stringify(record));
    expect(roundTripped).toEqual(record);

    expect(record.type).toBe("llm_call");
    const expectedCharsIn = "sys\n\nuser: 1234567890".length;
    expect(record.charsIn).toBe(expectedCharsIn);
    expect(record.charsOut).toBe("abcde".length);
    expect(record.tokensInEst).toBe(Math.ceil(expectedCharsIn / 4));
    expect(record.tokensOutEst).toBe(Math.ceil("abcde".length / 4));
    expect(record.durationSec).toBeCloseTo(1.5);
    expect(record.startedAt).toBe(new Date(1000).toISOString());
    expect(record.endedAt).toBe(new Date(2500).toISOString());
  });
});

describe("buildToolCallRecord", () => {
  it("produces a JSON-serializable record with correct char counts", () => {
    const entry = {
      turnId: "t1", chatId: "c1", userId: "u1", toolName: "grep_search",
      input: { query: "hello" }, output: { hits: [1, 2, 3] }, error: null,
      startedAt: 0, endedAt: 250,
    };
    const record = buildToolCallRecord(entry);
    const roundTripped = JSON.parse(JSON.stringify(record));
    expect(roundTripped).toEqual(record);

    expect(record.type).toBe("tool_call");
    expect(record.charsIn).toBe(JSON.stringify(entry.input).length);
    expect(record.charsOut).toBe(JSON.stringify(entry.output).length);
    expect(record.durationSec).toBeCloseTo(0.25);
  });

  it("uses the error string for output char counting when present", () => {
    const entry = {
      turnId: null, chatId: "c1", userId: "u1", toolName: "grep_search",
      input: {}, output: null, error: "boom",
      startedAt: 0, endedAt: 100,
    };
    const record = buildToolCallRecord(entry);
    expect(record.charsOut).toBe("boom".length);
    expect(record.error).toBe("boom");
  });
});

describe("buildTurnSummaryRecord", () => {
  it("computes wall time from first to last event", () => {
    const record = buildTurnSummaryRecord("t1", "c1", "u1", {
      llmCalls: 2, toolCalls: 3, charsIn: 100, charsOut: 200,
      tokensInEst: 25, tokensOutEst: 50,
      firstEventAt: 1000, lastEventAt: 4000,
    });
    expect(record.type).toBe("turn_summary");
    expect(record.llmCalls).toBe(2);
    expect(record.toolCalls).toBe(3);
    expect(record.wallTimeSec).toBeCloseTo(3);
    const roundTripped = JSON.parse(JSON.stringify(record));
    expect(roundTripped).toEqual(record);
  });
});
