/**
 * Calendar-source records: reading them for the panel, and stamping sync state.
 *
 * `requireOwnedSource` exists because contract 2's `requireOwned` is frozen and
 * its `OwnedKind` union has no `calendar_source` member. Rather than widen a
 * frozen file, this reuses the same `AuthzError` and the same rule — 401 for a
 * logged-out caller, 404 for both "someone else's" and "does not exist", so the
 * endpoint cannot be used to probe which source ids are real (§9). Adding the
 * kind to `OwnedKind` is the tidier end state and is escalated, not assumed.
 */
import { and, count, eq, sql } from "drizzle-orm";
import { calendarSources, db, scheduleItems } from "@mola/db";
import { AuthzError } from "@/lib/auth/ownership";
import type { Session } from "@/lib/auth/session";
import type { CalendarSourceView } from "./types";

export type CalendarSourceRow = typeof calendarSources.$inferSelect;

export async function requireOwnedSource(id: string, session: Session | null): Promise<CalendarSourceRow> {
  if (!session) throw new AuthzError(401, "not authenticated");
  const rows = await db.select().from(calendarSources)
    .where(and(eq(calendarSources.id, id), eq(calendarSources.userId, session.userId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new AuthzError(404, "calendar source not found");
  return row;
}

/** Contract D's `GET /api/calendar/sources` body, ordered oldest first. */
export async function listSourceViews(userId: string): Promise<CalendarSourceView[]> {
  const rows = await db
    .select({
      source: calendarSources,
      eventCount: count(scheduleItems.id),
    })
    .from(calendarSources)
    .leftJoin(scheduleItems, eq(scheduleItems.calendarSourceId, calendarSources.id))
    .where(eq(calendarSources.userId, userId))
    .groupBy(calendarSources.id)
    .orderBy(calendarSources.createdAt);

  return rows.map(({ source, eventCount }) => toSourceView(source, eventCount));
}

export function toSourceView(row: CalendarSourceRow, eventCount = 0): CalendarSourceView {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    url: row.url,
    status: row.status,
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
    lastSyncError: row.lastSyncError,
    channelExpiresAt: row.channelExpiresAt?.toISOString() ?? null,
    eventCount: Number(eventCount),
  };
}

export async function markSourceSynced(id: string): Promise<void> {
  await db.update(calendarSources)
    .set({ status: "active", lastSyncedAt: new Date(), lastSyncError: null, updatedAt: new Date() })
    .where(eq(calendarSources.id, id));
}

/**
 * `status` is what the panel renders, so the distinction matters: "error" is a
 * feed that failed, "expired" is a Google channel that lapsed and is therefore
 * no longer delivering anything at all (§10). The second is invisible without
 * this — nothing errors, updates simply stop arriving.
 */
export async function markSourceStatus(
  id: string, status: "error" | "expired" | "disabled", message: string,
): Promise<void> {
  await db.update(calendarSources)
    .set({ status, lastSyncError: message.slice(0, 500), updatedAt: new Date() })
    .where(eq(calendarSources.id, id));
}

/** Google only — the watch channel fields, cleared together or set together. */
export async function setWatchChannel(id: string, channel: {
  channelId: string | null;
  channelResourceId: string | null;
  channelExpiresAt: Date | null;
}): Promise<void> {
  await db.update(calendarSources).set({ ...channel, updatedAt: new Date() }).where(eq(calendarSources.id, id));
}

export async function setSyncToken(id: string, syncToken: string | null): Promise<void> {
  await db.update(calendarSources).set({ syncToken, updatedAt: new Date() }).where(eq(calendarSources.id, id));
}

/** Every Google source whose channel lapses inside the window, plus any already lapsed. */
export async function sourcesNeedingRenewal(userId: string, within: Date): Promise<CalendarSourceRow[]> {
  return db.select().from(calendarSources).where(and(
    eq(calendarSources.userId, userId),
    eq(calendarSources.kind, "google"),
    sql`${calendarSources.status} <> 'disabled'`,
    sql`(${calendarSources.channelExpiresAt} IS NULL OR ${calendarSources.channelExpiresAt} <= ${within})`,
  ));
}
