/**
 * Contract D — "sync this feed now".
 *
 * Queued rather than run inline: an ICS fetch can take twenty seconds against a
 * slow Blackboard host, and a Google sync can walk several pages. The panel
 * polls the source list for `lastSyncedAt` / `lastSyncError` afterwards, which
 * is the same state a scheduled sync writes — one path, not two.
 *
 * The job kinds are per-user sweeps, not per-source, because `enqueueJob`
 * dedupes on `(userId, kind, pending)`; see the handler files for why that is
 * the safe shape. Syncing one feed therefore refreshes the student's other
 * feeds of the same kind too, which is harmless and usually what they wanted.
 */
import { authzResponse, requireSession } from "@/lib/auth/ownership";
import { requireOwnedSource } from "@/lib/calendar/sources";
import { enqueueJob } from "@/lib/jobs/worker";

export const runtime = "nodejs";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireSession();
    const source = await requireOwnedSource(id, session);

    await enqueueJob(
      session.userId,
      source.kind === "google" ? "calendar_sync_google" : "calendar_sync_ics",
    );

    return Response.json({ queued: true }, { status: 202 });
  } catch (err) {
    return authzResponse(err) ?? Response.json({ error: "internal" }, { status: 500 });
  }
}
