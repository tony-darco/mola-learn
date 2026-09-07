/**
 * Contract D — the feed list, and adding an ICS feed.
 *
 * Only `kind: "ics"` is creatable here. A Google source is not something a
 * student can type in: it only exists once an OAuth consent has produced a
 * refresh token, so `/api/calendar/google/callback` is the one place that
 * writes one. Accepting `kind: "google"` on this route would let the panel
 * create a row that can never sync.
 */
import { db, calendarSources } from "@mola/db";
import { authzResponse, requireSession } from "@/lib/auth/ownership";
import { listSourceViews, toSourceView } from "@/lib/calendar/sources";
import { normalizeFeedUrl } from "@/lib/calendar/sync";
import { enqueueJob } from "@/lib/jobs/worker";

export const runtime = "nodejs";

export async function GET() {
  try {
    const session = await requireSession();
    return Response.json({ sources: await listSourceViews(session.userId) });
  } catch (err) {
    return authzResponse(err) ?? Response.json({ error: "internal" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireSession();
    const body = (await req.json().catch(() => ({}))) as { kind?: string; name?: string; url?: string };

    if (body.kind !== "ics") {
      return Response.json({ error: "only ics sources can be added directly" }, { status: 400 });
    }

    const name = (body.name ?? "").trim();
    if (!name) return Response.json({ error: "name is required" }, { status: 400 });

    // Normalised on the way in, not on every sync: `webcal://` is the scheme
    // Blackboard's subscribe link hands out, and storing it verbatim means the
    // fetch has to re-derive https each time and the panel shows a URL the
    // student cannot paste into a browser.
    const url = normalizeFeedUrl(body.url ?? "");
    if (!url) return Response.json({ error: "not an http(s) or webcal calendar URL" }, { status: 400 });

    const [row] = await db.insert(calendarSources)
      .values({ userId: session.userId, kind: "ics", name, url })
      .returning();

    // A feed that sits empty until the student finds the sync button reads as
    // broken. The job is queued rather than awaited so a slow Blackboard host
    // cannot hold this response open.
    await enqueueJob(session.userId, "calendar_sync_ics");

    return Response.json({ source: toSourceView(row!) }, { status: 201 });
  } catch (err) {
    return authzResponse(err) ?? Response.json({ error: "internal" }, { status: 500 });
  }
}
