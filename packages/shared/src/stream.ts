/**
 * CONTRACT 6 (part 2) — the SSE event taxonomy.
 *
 * `StreamEvent` in contract 3 covers only what a provider emits. This is the
 * server→client rendering contract: message parts, tool-call rendering, artifact
 * blocks, hint-ladder state. Agent A renders these; every producing agent emits
 * them. Frozen.
 */
import { z } from "zod";
import { artifactRecordSchema } from "./artifacts";

/** What an LLM provider yields (contract 3). Internal to the loop. */
export type ProviderStreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_call"; id: string; name: string; input: unknown }
  | { type: "done"; stopReason: "end_turn" | "tool_use" | "max_tokens" | "error" }
  | { type: "error"; message: string };

/** Rungs of the graduated hint ladder (§3). Ordered: index = escalation level. */
export const HINT_RUNGS = ["pointing", "teaching", "bottom_out"] as const;
export const hintRungSchema = z.enum(HINT_RUNGS);
export type HintRung = (typeof HINT_RUNGS)[number];

export const streamEventSchema = z.discriminatedUnion("type", [
  /** Assistant message row created; everything after attaches to this id. */
  z.object({ type: z.literal("message_start"), messageId: z.string().uuid() }),

  z.object({ type: z.literal("text_delta"), text: z.string() }),

  /** Emitted when the model decides to call a tool, before it runs. */
  z.object({
    type: z.literal("tool_call_start"),
    toolCallId: z.string(),
    name: z.string(),
    /** One-line human summary for the collapsed row, e.g. "Searching OSTEP ch.3". */
    label: z.string(),
  }),
  z.object({
    type: z.literal("tool_call_end"),
    toolCallId: z.string(),
    status: z.enum(["ok", "error"]),
    /** Short result summary. Never the full payload — that is what artifacts are for. */
    summary: z.string(),
  }),

  /** A sub-agent is running. Its internal turns never reach the client (§4). */
  z.object({
    type: z.literal("subagent_start"),
    subagentId: z.string(),
    label: z.string(),
  }),
  z.object({ type: z.literal("subagent_end"), subagentId: z.string() }),

  /** A persisted artifact, ready to render inline. */
  z.object({ type: z.literal("artifact"), artifact: artifactRecordSchema }),

  /**
   * The current rung of the hint ladder for this exchange. Drives the "next hint"
   * affordance. Hints are student-PULLED — this event reports state, it never
   * instructs the client to auto-advance (§3).
   */
  z.object({
    type: z.literal("hint_state"),
    rung: hintRungSchema,
    /** False once bottom_out has been served. */
    canEscalate: z.boolean(),
  }),

  /** Older turns collapsed into a summary mid-stream (§4). */
  z.object({ type: z.literal("compacted"), throughMessageId: z.string().uuid() }),

  z.object({
    type: z.literal("message_end"),
    messageId: z.string().uuid(),
    stopReason: z.enum(["end_turn", "tool_use", "max_tokens", "error"]),
  }),

  z.object({ type: z.literal("error"), message: z.string() }),
]);
export type StreamEvent = z.infer<typeof streamEventSchema>;

/** SSE wire format. One JSON object per `data:` line. */
export function encodeSSE(event: StreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export function decodeSSE(line: string): StreamEvent | null {
  if (!line.startsWith("data: ")) return null;
  const parsed = streamEventSchema.safeParse(JSON.parse(line.slice(6)));
  return parsed.success ? parsed.data : null;
}
