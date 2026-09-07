/**
 * Google's push endpoint. The one route here with no session.
 *
 * §9 still holds: this endpoint reads nothing back to the caller and writes
 * nothing but a job row for the source's own owner. Authorization is the
 * three unguessable values Google echoes — the channel id, the resource id,
 * and the channel token, which `ensureWatchChannel` sets to the source id.
 * All three have to match one row before anything is enqueued.
 *
 * Google discards the response body and only reads the status, so the answers
 * are deliberately bare. A notification is a bell, not a payload: it says the
 * calendar changed, and the incremental sync is what finds out how.
 */
import { and, eq } from "drizzle-orm";
import { calendarSources, db } from "@mola/db";
import { enqueueJob } from "@/lib/jobs/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const channelId = req.headers.get("x-goog-channel-id");
  const resourceId = req.headers.get("x-goog-resource-id");
  const token = req.headers.get("x-goog-channel-token");
  const state = req.headers.get("x-goog-resource-state");

  if (!channelId || !resourceId || !token) return new Response(null, { status: 400 });

  const [source] = await db.select().from(calendarSources).where(and(
    eq(calendarSources.id, token),
    eq(calendarSources.channelId, channelId),
    eq(calendarSources.channelResourceId, resourceId),
  )).limit(1);

  // 404 rather than a polite 200: an unknown channel is one this instance can
  // no longer act on — usually a source the student deleted — and repeated
  // failures are how Google is told to stop delivering to it.
  if (!source) return new Response(null, { status: 404 });

  // "sync" is the handshake Google sends the moment a channel is registered.
  // There is nothing new behind it, and syncing on it would mean every renewal
  // triggered a pointless full pass.
  if (state === "sync") return new Response(null, { status: 200 });

  await enqueueJob(source.userId, "calendar_sync_google");
  return new Response(null, { status: 200 });
}
