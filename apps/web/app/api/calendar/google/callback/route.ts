/**
 * Step two: consent comes back here as a top-level navigation.
 *
 * Everything this route does is idempotent on `(userId, googleCalendarId)`, so
 * a reconnect lands on the existing source row and keeps the events already
 * synced against it rather than creating a duplicate feed and re-downloading
 * the semester.
 */
import { and, eq } from "drizzle-orm";
import { calendarSources, db } from "@mola/db";
import { authzResponse, requireSession } from "@/lib/auth/ownership";
import { exchangeCodeForTokens, googleConfig, primaryCalendarId, saveGoogleCredential } from "@/lib/calendar/google";
import { backToCalendar, callbackUri, readStateCookie } from "@/lib/calendar/google-oauth";
import { ensureWatchChannel } from "@/lib/calendar/google-sync";
import { enqueueJob } from "@/lib/jobs/worker";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const session = await requireSession();
    const config = googleConfig();
    if (!config) return backToCalendar(req, "not-configured");

    const query = new URL(req.url).searchParams;
    // The student pressed Cancel, or Google refused the request outright.
    if (query.get("error")) return backToCalendar(req, "denied");

    const code = query.get("code");
    const state = query.get("state");
    const expected = readStateCookie(req);
    if (!expected || !state || state !== expected) return backToCalendar(req, "state-mismatch");
    if (!code) return backToCalendar(req, "denied");

    const tokens = await exchangeCodeForTokens({ code, redirectUri: callbackUri(req), config });
    if (!tokens.refreshToken) {
      // Google withholds the refresh token when this client already holds a
      // live grant for the account. `prompt=consent` normally prevents that;
      // when it happens anyway the student has to revoke the app's access at
      // myaccount.google.com and come back, because a source with no refresh
      // token cannot survive its first hour.
      return backToCalendar(req, "no-refresh-token");
    }

    const calendarId = await primaryCalendarId({ accessToken: tokens.accessToken });
    await saveGoogleCredential({
      userId: session.userId,
      accountEmail: calendarId,
      refreshToken: tokens.refreshToken,
      scope: tokens.scope,
    });

    const source = await upsertSource(session.userId, calendarId);

    // Forced, because this is exactly the moment a lapsed channel is meant to
    // come back: the credential behind it is brand new, and waiting for the
    // renewal sweep would leave the source reading "expired" for hours after
    // the student did the one thing that fixes it. A failure here is already
    // recorded on the source by ensureWatchChannel, and the scheduled sync
    // still runs regardless of whether push notifications work.
    await ensureWatchChannel({ source, force: true }).catch(() => {});
    await enqueueJob(session.userId, "calendar_sync_google");

    return backToCalendar(req, "connected");
  } catch (err) {
    const response = authzResponse(err);
    if (response) return response;
    console.error("google calendar callback failed:", err);
    return backToCalendar(req, "failed");
  }
}

async function upsertSource(userId: string, calendarId: string) {
  const [existing] = await db.select().from(calendarSources).where(and(
    eq(calendarSources.userId, userId),
    eq(calendarSources.kind, "google"),
    eq(calendarSources.googleCalendarId, calendarId),
  )).limit(1);

  if (existing) {
    // Back to "active" on the way in: whatever error or lapse put this source
    // into a bad state, a fresh consent is the student's answer to it, and
    // leaving the old message on screen would read as though nothing happened.
    const [refreshed] = await db.update(calendarSources)
      .set({ status: "active", lastSyncError: null, updatedAt: new Date() })
      .where(eq(calendarSources.id, existing.id))
      .returning();
    return refreshed!;
  }

  const [created] = await db.insert(calendarSources).values({
    userId,
    kind: "google",
    name: calendarId,
    googleCalendarId: calendarId,
  }).returning();
  return created!;
}
