/**
 * Testing-only agent activity logger — OFF by default, and gated on two
 * independent switches, same discipline as chat-log.ts, so it can never
 * accidentally fire for a real user: an env flag (MOLA_AGENT_LOG=1) AND an
 * email allowlist (MOLA_AGENT_LOG_EMAILS, defaults to just Alice, the seeded
 * test account). Never wire this into anything that ships to prod.
 *
 * Two kinds of events, one JSONL file (one JSON object per line, appended):
 *   - "llm_call": one call to a model — prompt in, response out (text and/or
 *     tool-calls), character counts, a rough token estimate, start/end/duration.
 *   - "tool_call": one tool execution — name, input, result, start/end/duration.
 * Plus a nice-to-have rollup:
 *   - "turn_summary": one line per top-level chat turn with totals
 *     pre-computed (LLM calls, tool calls, chars in/out, wall time from the
 *     first event to the last), so a reader doesn't have to re-derive them.
 *
 * JSONL, not a single JSON array file — same reasoning as chat-log.ts: an
 * array file needs read-parse-append-rewrite on every write, which races
 * under concurrent activity (several LLM calls and tool calls firing in
 * quick succession within one turn, or two turns/sub-agents running at
 * once); a line append is atomic enough here and never needs to re-read
 * what's already there.
 *
 * Every event carries turnId + chatId + userId (+ a timestamp) so a reader
 * can reconstruct one chat turn's full sequence — including sub-agent LLM
 * and tool calls made underneath the frozen subagent.ts, which has no
 * parameter of its own for passing chatId/turnId through. That's threaded in
 * via AsyncLocalStorage instead (`beginTurn`/`currentTurn` below): the
 * top-level chat route enters a turn context once per request, and it stays
 * ambient across every `await` underneath — including through sub-agent
 * calls — without needing to touch any frozen file's signature.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

const ENABLED = process.env.MOLA_AGENT_LOG === "1";
const ALLOWED_EMAILS = computeAllowedEmails(process.env.MOLA_AGENT_LOG_EMAILS);
export const LOG_PATH = process.env.MOLA_AGENT_LOG_PATH
  ?? path.join(process.cwd(), "debug-logs", "agent.jsonl");

// ---------------------------------------------------------------------------
// Pure helpers — no env/file/session dependency, safe to unit-test directly.
// ---------------------------------------------------------------------------

/** Parses the allowlist env var into a lowercase email list. Pure — takes the
 * raw string in rather than reading `process.env` itself, so tests can pass
 * an explicit value instead of mutating env vars. */
export function computeAllowedEmails(raw: string | undefined): string[] {
  return (raw ?? "alice@umbc.edu")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/** Pure gating check given an explicit email + allowlist — the actual
 * decision logic, independent of env vars or a real session. */
export function isEmailAllowed(email: string | null | undefined, allowedEmails: string[]): boolean {
  if (!email) return false;
  return allowedEmails.includes(email.toLowerCase());
}

/** The real gate this module uses: both switches, env-backed. */
export function isLoggingEnabledFor(email: string | null | undefined): boolean {
  return ENABLED && isEmailAllowed(email, ALLOWED_EMAILS);
}

export function charCount(text: string): number {
  return text.length;
}

/** Rough English-text approximation (~4 chars/token) — labeled an estimate
 * everywhere it's surfaced, NOT a real provider-reported token count. Ollama's
 * raw response does carry prompt_eval_count/eval_count, but the provider
 * (lib/llm/ollama.ts) currently discards them and rewiring that is out of
 * scope here — character counts are the exact, always-available number. */
export function estimateTokens(chars: number): number {
  return Math.ceil(chars / 4);
}

type SimpleMessage = { role: string; content: string };
type SimpleToolCall = { id?: string; name: string; input: unknown };

/** Flattens system + message history into one plain-text blob for char
 * counting — deliberately plain text, not JSON.stringify, so the count
 * reflects the actual prompt text rather than incidental JSON punctuation. */
export function promptText(system: string, messages: SimpleMessage[]): string {
  return system + "\n\n" + messages.map((m) => `${m.role}: ${m.content}`).join("\n");
}

/** Same idea for the output side: response text plus a plain-text rendering
 * of any tool calls the model decided to make. */
export function responseText(text: string, toolCalls: SimpleToolCall[]): string {
  const toolText = toolCalls.map((t) => `${t.name}(${JSON.stringify(t.input)})`).join("\n");
  return toolText ? `${text}\n${toolText}` : text;
}

export type LlmCallInput = {
  turnId: string | null;
  chatId: string | null;
  userId: string;
  model: string;
  system: string;
  messages: SimpleMessage[];
  responseText: string;
  toolCalls: SimpleToolCall[];
  stopReason: string | null;
  startedAt: number;
  endedAt: number;
};

/** Pure — builds the exact JSON-serializable record for one LLM call, with
 * every derived field (char counts, token estimates, ISO timestamps,
 * duration) computed up front. */
export function buildLlmCallRecord(entry: LlmCallInput): Record<string, unknown> {
  const inText = promptText(entry.system, entry.messages);
  const outText = responseText(entry.responseText, entry.toolCalls);
  const charsIn = charCount(inText);
  const charsOut = charCount(outText);

  return {
    type: "llm_call",
    at: new Date(entry.endedAt).toISOString(),
    turnId: entry.turnId,
    chatId: entry.chatId,
    userId: entry.userId,
    model: entry.model,
    system: entry.system,
    messages: entry.messages,
    responseText: entry.responseText,
    toolCalls: entry.toolCalls,
    stopReason: entry.stopReason,
    charsIn,
    charsOut,
    tokensInEst: estimateTokens(charsIn),
    tokensOutEst: estimateTokens(charsOut),
    startedAt: new Date(entry.startedAt).toISOString(),
    endedAt: new Date(entry.endedAt).toISOString(),
    durationSec: (entry.endedAt - entry.startedAt) / 1000,
  };
}

export type ToolCallInput = {
  turnId: string | null;
  chatId: string;
  userId: string;
  toolName: string;
  input: unknown;
  output: unknown;
  error: string | null;
  startedAt: number;
  endedAt: number;
};

/** Pure — builds the exact JSON-serializable record for one tool call. */
export function buildToolCallRecord(entry: ToolCallInput): Record<string, unknown> {
  const inText = safeJsonString(entry.input);
  const outText = entry.error ?? safeJsonString(entry.output);
  const charsIn = charCount(inText);
  const charsOut = charCount(outText);

  return {
    type: "tool_call",
    at: new Date(entry.endedAt).toISOString(),
    turnId: entry.turnId,
    chatId: entry.chatId,
    userId: entry.userId,
    toolName: entry.toolName,
    input: entry.input,
    output: entry.output,
    error: entry.error,
    charsIn,
    charsOut,
    tokensInEst: estimateTokens(charsIn),
    tokensOutEst: estimateTokens(charsOut),
    startedAt: new Date(entry.startedAt).toISOString(),
    endedAt: new Date(entry.endedAt).toISOString(),
    durationSec: (entry.endedAt - entry.startedAt) / 1000,
  };
}

export type TurnTotals = {
  llmCalls: number;
  toolCalls: number;
  charsIn: number;
  charsOut: number;
  tokensInEst: number;
  tokensOutEst: number;
  firstEventAt: number;
  lastEventAt: number;
};

/** Pure — builds the per-turn rollup line. Totals here are LLM-call totals
 * only (the meaningful "cost" metric); toolCalls is a count, not a size,
 * since a tool's own input/output sizes are already on its own log line. */
export function buildTurnSummaryRecord(
  turnId: string,
  chatId: string,
  userId: string,
  t: TurnTotals,
): Record<string, unknown> {
  return {
    type: "turn_summary",
    at: new Date().toISOString(),
    turnId,
    chatId,
    userId,
    llmCalls: t.llmCalls,
    toolCalls: t.toolCalls,
    charsIn: t.charsIn,
    charsOut: t.charsOut,
    tokensInEst: t.tokensInEst,
    tokensOutEst: t.tokensOutEst,
    wallTimeSec: (t.lastEventAt - t.firstEventAt) / 1000,
  };
}

function safeJsonString(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return String(value);
  }
}

// ---------------------------------------------------------------------------
// Ambient turn context (AsyncLocalStorage) — lets a turnId/chatId/userEmail
// set once at the top of a chat request reach every LLM/tool call made
// underneath it, including inside a sub-agent spawned via the frozen
// subagent.ts, without modifying that file's signature.
// ---------------------------------------------------------------------------

export type TurnMeta = {
  turnId: string;
  chatId: string;
  userId: string;
  userEmail: string;
};

const turnStorage = new AsyncLocalStorage<TurnMeta>();

/** Call once, synchronously, at the top of a chat turn's request handling.
 * Mints a fresh turnId and makes it (plus chatId/userId/userEmail) ambient
 * for the rest of this execution and everything awaited underneath it. */
export function beginTurn(meta: Omit<TurnMeta, "turnId">): TurnMeta {
  const full: TurnMeta = { ...meta, turnId: randomUUID() };
  turnStorage.enterWith(full);
  return full;
}

export function currentTurn(): TurnMeta | undefined {
  return turnStorage.getStore();
}

// ---------------------------------------------------------------------------
// File I/O + the impure logging entry points.
// ---------------------------------------------------------------------------

const totalsByTurn = new Map<string, TurnTotals>();

function bumpTotals(turnId: string, at: number, delta: Partial<Omit<TurnTotals, "firstEventAt" | "lastEventAt">>) {
  const existing = totalsByTurn.get(turnId);
  const t: TurnTotals = existing ?? {
    llmCalls: 0, toolCalls: 0, charsIn: 0, charsOut: 0, tokensInEst: 0, tokensOutEst: 0,
    firstEventAt: at, lastEventAt: at,
  };
  t.llmCalls += delta.llmCalls ?? 0;
  t.toolCalls += delta.toolCalls ?? 0;
  t.charsIn += delta.charsIn ?? 0;
  t.charsOut += delta.charsOut ?? 0;
  t.tokensInEst += delta.tokensInEst ?? 0;
  t.tokensOutEst += delta.tokensOutEst ?? 0;
  t.firstEventAt = Math.min(t.firstEventAt, at);
  t.lastEventAt = Math.max(t.lastEventAt, at);
  totalsByTurn.set(turnId, t);
}

async function appendLine(obj: unknown): Promise<void> {
  try {
    await mkdir(path.dirname(LOG_PATH), { recursive: true });
    await appendFile(LOG_PATH, JSON.stringify(obj) + "\n", "utf8");
  } catch (err) {
    // Best-effort — a logging failure must never break the actual chat turn.
    console.error("agent debug log write failed:", err);
  }
}

export async function logLlmCall(entry: LlmCallInput, userEmail: string | null | undefined): Promise<void> {
  if (!isLoggingEnabledFor(userEmail)) return;

  const record = buildLlmCallRecord(entry);
  if (entry.turnId) {
    bumpTotals(entry.turnId, entry.endedAt, {
      llmCalls: 1,
      charsIn: record.charsIn as number,
      charsOut: record.charsOut as number,
      tokensInEst: record.tokensInEst as number,
      tokensOutEst: record.tokensOutEst as number,
    });
  }
  await appendLine(record);
}

export async function logToolCall(entry: ToolCallInput, userEmail: string | null | undefined): Promise<void> {
  if (!isLoggingEnabledFor(userEmail)) return;

  const record = buildToolCallRecord(entry);
  if (entry.turnId) {
    bumpTotals(entry.turnId, entry.endedAt, { toolCalls: 1 });
  }
  await appendLine(record);
}

/** Emits the per-turn rollup line and clears its accumulator. Call once, from
 * the top-level chat route's `finally`, after the turn is fully done.
 * In-memory accumulator — fine for this single-process dev/test setup; this
 * whole logger is testing-only and off by default, so it never needs to
 * aggregate across multiple deployed instances. */
export async function finalizeTurn(
  turnId: string,
  chatId: string,
  userId: string,
  userEmail: string | null | undefined,
): Promise<void> {
  if (!isLoggingEnabledFor(userEmail)) return;
  const t = totalsByTurn.get(turnId);
  totalsByTurn.delete(turnId);
  if (!t) return; // nothing was logged for this turn (e.g. it errored before any call)

  await appendLine(buildTurnSummaryRecord(turnId, chatId, userId, t));
}
