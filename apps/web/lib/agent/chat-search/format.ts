/**
 * Shared formatting for chat-search tool observations. Plain text, mirroring
 * lib/agent/retrieval/format.ts's formatHits — this goes back into the
 * model's message array as a tool-role observation.
 */
import type { ChatHit } from "./queries";

export function formatChatHits(hits: ChatHit[], describedAs: string): string {
  if (hits.length === 0) {
    return `No chat history found (${describedAs}).`;
  }
  const lines = hits.map((h, i) => {
    const when = h.createdAt.toISOString();
    if (h.source === "summary") {
      // A compaction summary — point back at the raw turns it condensed so the
      // model (or a caller building a source reference) can follow up on them.
      return (
        `[${i + 1}] Compacted summary from chat "${h.chatTitle}" (chatId: ${h.chatId}, ` +
        `summarized through messageId: ${h.messageId}, ${when}):\n${h.text}`
      );
    }
    return (
      `[${i + 1}] ${h.role} turn in chat "${h.chatTitle}" (chatId: ${h.chatId}, ` +
      `messageId: ${h.messageId}, ${when}):\n${h.text}`
    );
  });
  return `${hits.length} chat hit(s) found (${describedAs}):\n\n${lines.join("\n\n")}`;
}
