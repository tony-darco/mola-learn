/**
 * Testing-only input/output logger — OFF by default, and gated on two
 * independent switches so it can never accidentally log a real user's
 * chats: an env flag, AND an email allowlist (defaults to just Alice, the
 * seeded test account). Never wire this into anything that ships to prod.
 *
 * Appends one JSON object per line (JSONL) rather than rewriting a single
 * JSON array file — an array file would need a read-parse-append-rewrite
 * on every turn, which races under concurrent requests; a line append is
 * atomic enough for this and never needs to re-read what's already there.
 */
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

const ENABLED = process.env.MOLA_CHAT_DEBUG_LOG === "1";
const ALLOWED_EMAILS = (process.env.MOLA_CHAT_DEBUG_LOG_EMAILS ?? "alice@umbc.edu")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);
const LOG_PATH = process.env.MOLA_CHAT_DEBUG_LOG_PATH
  ?? path.join(process.cwd(), "debug-logs", "chat.jsonl");

export type ChatLogEntry = {
  direction: "input" | "output";
  chatId: string;
  userId: string;
  userEmail: string;
  model: string;
  pullHint?: boolean;
  text: string;
  error?: string | null;
};

export async function logChatTurn(entry: ChatLogEntry): Promise<void> {
  if (!ENABLED) return;
  if (!ALLOWED_EMAILS.includes(entry.userEmail.toLowerCase())) return;

  try {
    const line = JSON.stringify({ ...entry, at: new Date().toISOString() });
    await mkdir(path.dirname(LOG_PATH), { recursive: true });
    await appendFile(LOG_PATH, line + "\n", "utf8");
  } catch (err) {
    // Best-effort — a logging failure must never break the actual chat turn.
    console.error("chat debug log write failed:", err);
  }
}
