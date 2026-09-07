/**
 * Tying the Google client to source rows: incremental sync, and the watch
 * channel whose lapse is the failure mode §10 calls out by name.
 *
 * Only the primary calendar is connected. `calendar_sources.googleCalendarId`
 * therefore holds the account's own address, which is both its calendar id and
 * the key `google_credentials` is stored under. Secondary calendars would need
 * the credential and the calendar to be addressed separately, and nothing in
 * the product asks for that yet.
 */
import { randomUUID } from "node:crypto";
import {
  GOOGLE_WEBHOOK_PATH, GoogleApiError, SyncTokenExpired, canRegisterWatch,
  getAccessToken, isGoogleConfigured, listEvents, mapGoogleEvent, publicOrigin,
  stopChannel, watchEvents,
} from "./google";
import { markSourceStatus, markSourceSynced, setSyncToken, setWatchChannel, type CalendarSourceRow } from "./sources";
import { syncFeedEvents } from "./sync";
import type { SyncResult } from "./types";

/** Renew this far ahead of the lapse — Google's own channels last about a week. */
export const RENEWAL_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function syncGoogleSource(
  source: CalendarSourceRow, fetchImpl?: typeof fetch,
): Promise<SyncResult> {
  if (!isGoogleConfigured()) throw new GoogleApiError("google calendar is not configured", 503);
  const calendarId = source.googleCalendarId;
  if (!calendarId) throw new GoogleApiError("google source has no calendar id", 400);

  const accessToken = await getAccessToken({ userId: source.userId, accountEmail: calendarId, fetchImpl });

  let page;
  try {
    page = await listEvents({ accessToken, calendarId, syncToken: source.syncToken, fetchImpl });
  } catch (err) {
    if (!(err instanceof SyncTokenExpired)) throw err;
    // A 410 means the delta is no longer available. Drop the token FIRST, so a
    // crash between here and the retry cannot leave a token that will 410
    // forever, then take the full list (§10).
    await setSyncToken(source.id, null);
    page = await listEvents({ accessToken, calendarId, syncToken: null, fetchImpl });
  }

  const result = await syncFeedEvents({
    userId: source.userId,
    source: "google",
    calendarSourceId: source.id,
    events: page.events.map(mapGoogleEvent),
    // An incremental page carries only what changed, so absence from it does
    // not mean the event is gone.
    removeMissing: page.full,
  });

  if (page.nextSyncToken) await setSyncToken(source.id, page.nextSyncToken);
  await markSourceSynced(source.id);
  return result;
}

export type RenewalOutcome =
  | { action: "renewed"; expiresAt: Date }
  | { action: "skipped"; reason: string }
  | { action: "expired"; reason: string };

/**
 * Register or re-register the push channel.
 *
 * The point of running this from `channelExpiresAt` rather than from a guess:
 * a lapsed channel does not error, it just stops delivering, so the only
 * evidence is a calendar that quietly stops updating. When renewal cannot
 * happen the source is flipped to `expired` so it is visible in the panel
 * instead of being inferred from staleness.
 */
export async function ensureWatchChannel(input: {
  source: CalendarSourceRow;
  now?: Date;
  force?: boolean;
  fetchImpl?: typeof fetch;
}): Promise<RenewalOutcome> {
  const { source, fetchImpl } = input;
  const now = input.now ?? new Date();
  const calendarId = source.googleCalendarId;

  if (!isGoogleConfigured()) return { action: "skipped", reason: "google calendar is not configured" };
  if (!calendarId) return { action: "skipped", reason: "source has no calendar id" };
  if (source.status === "disabled") return { action: "skipped", reason: "source is disabled" };

  const expiresAt = source.channelExpiresAt;
  const dueForRenewal = input.force || !expiresAt || expiresAt.getTime() - now.getTime() <= RENEWAL_WINDOW_MS;
  if (!dueForRenewal) {
    return { action: "skipped", reason: `channel valid until ${expiresAt!.toISOString()}` };
  }

  const origin = publicOrigin();
  if (!canRegisterWatch()) {
    // Google will only push to a verified HTTPS address, so a localhost dev box
    // cannot hold a channel at all. Say so plainly rather than marking the
    // source broken — the scheduled sync still runs, just not in near-real-time.
    return {
      action: "skipped",
      reason: origin
        ? `push notifications need an https public URL (have ${origin})`
        : "push notifications need MOLA_PUBLIC_URL set to an https origin",
    };
  }

  const lapsed = expiresAt !== null && expiresAt.getTime() <= now.getTime();
  try {
    const accessToken = await getAccessToken({ userId: source.userId, accountEmail: calendarId, fetchImpl });
    const channel = await watchEvents({
      accessToken,
      calendarId,
      channelId: randomUUID(),
      address: `${origin}${GOOGLE_WEBHOOK_PATH}`,
      // Echoed back as X-Goog-Channel-Token; a second unguessable factor the
      // webhook checks alongside the channel and resource ids.
      token: source.id,
      fetchImpl,
    });

    await setWatchChannel(source.id, {
      channelId: channel.channelId,
      channelResourceId: channel.resourceId,
      channelExpiresAt: channel.expiresAt,
    });
    if (source.status === "expired") await markSourceSynced(source.id);

    // Best effort: the old channel would lapse on its own, and failing to stop
    // it must not undo a renewal that already succeeded.
    if (source.channelId && source.channelResourceId) {
      await stopChannel({
        accessToken, channelId: source.channelId, resourceId: source.channelResourceId, fetchImpl,
      }).catch(() => {});
    }

    return { action: "renewed", expiresAt: channel.expiresAt };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (lapsed || !expiresAt) {
      await markSourceStatus(source.id, "expired", `watch channel renewal failed: ${message}`);
      return { action: "expired", reason: message };
    }
    // Still inside the window — leave the working channel alone and retry.
    throw err;
  }
}

/** Tear down a channel when a source is removed, so Google stops pushing to us. */
export async function releaseWatchChannel(source: CalendarSourceRow, fetchImpl?: typeof fetch): Promise<void> {
  if (!isGoogleConfigured() || !source.channelId || !source.channelResourceId || !source.googleCalendarId) return;
  const accessToken = await getAccessToken({
    userId: source.userId, accountEmail: source.googleCalendarId, fetchImpl,
  });
  await stopChannel({
    accessToken, channelId: source.channelId, resourceId: source.channelResourceId, fetchImpl,
  });
}
