/**
 * The shapes that cross out of calendar ingestion.
 *
 * `CalendarSourceView` is contract D's feed-management read model: J2 and J4
 * render it, so it is defined here once rather than re-declared per consumer.
 * `FeedEvent` is the internal normalisation point — ICS and Google both map
 * onto it, so `sync.ts` has exactly one input shape to reconcile against the
 * table regardless of which tier produced the row (§10).
 */

export type CalendarSourceStatus = "active" | "error" | "expired" | "disabled";

export type CalendarSourceView = {
  id: string;
  kind: "ics" | "google";
  name: string;
  url: string | null;
  status: CalendarSourceStatus;
  /** ISO 8601. */
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  /** Google only — the watch channel's lapse time (§10 operational catch). */
  channelExpiresAt: string | null;
  eventCount: number;
};

/**
 * One event as the feed described it, before it becomes a `schedule_items`
 * row. Deliberately source-agnostic: `mapIcsEvent` and `mapGoogleEvent` both
 * produce this, and `syncFeedEvents` is the only thing that writes.
 */
export type FeedEvent = {
  /** Stable across syncs. UID for ICS; `id` for Google. */
  externalId: string;
  title: string;
  description: string | null;
  location: string | null;
  /** Span start. Null on a pure deadline, which carries only `dueAt`. */
  startAt: Date | null;
  endAt: Date | null;
  dueAt: Date | null;
  allDay: boolean;
  /** Kept verbatim so a recurring series is never silently dropped. */
  rrule: string | null;
  /** LAST-MODIFIED / `updated` — lets a re-sync skip untouched rows. */
  externalUpdatedAt: Date | null;
  /** STATUS:CANCELLED, or Google's `status: "cancelled"`. The row is removed. */
  cancelled: boolean;
};

/** What a sync did, for the job log and the panel's error copy. */
export type SyncResult = {
  created: number;
  updated: number;
  /** Unchanged since the last sync — the idempotency guarantee, counted. */
  skipped: number;
  deleted: number;
};
