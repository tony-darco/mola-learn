/**
 * Contract D — removing a feed.
 *
 * `schedule_items.calendarSourceId` cascades, so deleting the row takes this
 * feed's events with it; that is the frozen schema's choice and it is the right
 * one — a feed the student removed should not leave orphaned deadlines behind
 * that nothing will ever update again.
 */
import { eq } from "drizzle-orm";
import { calendarSources, db } from "@mola/db";
import { authzResponse, requireSession } from "@/lib/auth/ownership";
import { releaseWatchChannel } from "@/lib/calendar/google-sync";
import { requireOwnedSource } from "@/lib/calendar/sources";

export const runtime = "nodejs";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireSession();
    const source = await requireOwnedSource(id, session);

    // Best effort, and deliberately before the delete: once the row is gone the
    // channel id is gone with it, and Google would keep pushing to a webhook
    // that can no longer resolve the notification to anything. A failure here
    // must not block the removal the student actually asked for — the channel
    // lapses on its own within the week either way.
    if (source.kind === "google") {
      await releaseWatchChannel(source).catch(() => {});
    }

    await db.delete(calendarSources).where(eq(calendarSources.id, source.id));
    return new Response(null, { status: 204 });
  } catch (err) {
    return authzResponse(err) ?? Response.json({ error: "internal" }, { status: 500 });
  }
}
