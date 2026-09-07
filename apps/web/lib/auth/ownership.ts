/**
 * CONTRACT 2 — the authorization boundary. FROZEN.
 *
 * §9: the security boundary is the server-side ownership check on every
 * request — not the unguessability of the URL, and never a hidden frontend
 * button. Unguessable IDs are defense in depth, nothing more.
 *
 * Every route that loads a resource by id goes through `requireOwned`.
 * No route hand-rolls this check.
 */
import { and, eq } from "drizzle-orm";
import { artifacts, chats, courses, db, documents, flashcards, messages, scheduleItems } from "@mola/db";
import { getSession, type Session } from "./session";

/** Every resource with a shareable id (§9). */
export type OwnedKind =
  | "chat" | "course" | "artifact" | "document" | "message" | "flashcard" | "scheduleItem";

const TABLES = {
  chat: chats,
  course: courses,
  artifact: artifacts,
  document: documents,
  message: messages,
  flashcard: flashcards,
  // Agent J: a calendar event is loaded by id from the events PATCH route
  // (homework check-off), so it needs the same one-predicate check as the rest.
  scheduleItem: scheduleItems,
} as const;

export class AuthzError extends Error {
  constructor(readonly status: 401 | 403 | 404, message: string) {
    super(message);
    this.name = "AuthzError";
  }
}

/**
 * Returns the row only if it exists AND belongs to the caller.
 *
 * A row that exists but belongs to someone else and a row that does not exist
 * both raise 404 — deliberately indistinguishable, so the endpoint cannot be
 * used to probe which ids are real. Logged-out callers get 401.
 */
export async function requireOwned<K extends OwnedKind>(
  kind: K,
  id: string,
  session?: Session | null,
): Promise<typeof TABLES[K]["$inferSelect"]> {
  const s = session === undefined ? await getSession() : session;
  if (!s) throw new AuthzError(401, "not authenticated");

  const table = TABLES[kind];
  const rows = await db
    .select()
    .from(table)
    .where(and(eq(table.id, id), eq(table.userId, s.userId)))
    .limit(1);

  const row = rows[0];
  if (!row) throw new AuthzError(404, `${kind} not found`);
  return row as typeof TABLES[K]["$inferSelect"];
}

/** Session-or-401, for routes that list a caller's own resources. */
export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (!s) throw new AuthzError(401, "not authenticated");
  return s;
}

export function authzResponse(err: unknown): Response | null {
  if (!(err instanceof AuthzError)) return null;
  return Response.json({ error: err.message }, { status: err.status });
}
