/**
 * Shared formatting for tool observations. Plain text, not JSON — this is
 * what goes back into the model's message array as a tool-role observation,
 * so it should read like something a ReAct agent can reason over directly.
 */
import type { ChunkHit } from "./queries";

export function formatHits(hits: ChunkHit[], describedAs: string): string {
  if (hits.length === 0) {
    return `No chunks found (${describedAs}).`;
  }
  const lines = hits.map((h, i) => {
    const loc = h.locator ? `, ${h.locator}` : "";
    // documentId included so a caller building a SourceRef (§6) — e.g. the
    // flashcard-creation sub-agent — has the real UUID in hand rather than
    // only a human-readable title it cannot turn into one.
    return `[${i + 1}] "${h.documentTitle}" (documentId: ${h.documentId}, chunk ${h.ordinal}${loc}):\n${h.text}`;
  });
  return `${hits.length} chunk(s) found (${describedAs}):\n\n${lines.join("\n\n")}`;
}
