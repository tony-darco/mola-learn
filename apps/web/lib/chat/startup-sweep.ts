/**
 * Runs once, at server startup (imported by instrumentation.ts's nodejs-only
 * branch — never bundled for the edge runtime).
 *
 * Resumable-chat-state fix: a message row can be left with status
 * "streaming" only by a process that died before reaching a terminal state
 * (a real crash, or — in dev — killing/restarting `next dev`). No generation
 * can possibly still be in flight for such a row the moment THIS process is
 * only just starting, so any row already "streaming" at startup is provably
 * orphaned: nothing is left running that will ever write "done"/"error" to
 * it, or NOTIFY a reconnect stream waiting on it. Without this sweep a chat
 * reloaded after that kind of crash would show a spinner that can never
 * resolve — this turns it into an honest error state instead.
 *
 * Assumes a single server process talks to this database at a time — a
 * genuinely multi-instance deployment would need to tag each streaming row
 * with an owning instance id and sweep only its own. Not needed here.
 */
import { eq } from "drizzle-orm";
import { db, messages } from "@mola/db";

await db.update(messages)
  .set({ status: "error", errorMessage: "Generation was interrupted by a server restart." })
  .where(eq(messages.status, "streaming"));
