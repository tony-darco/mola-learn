/**
 * Tier 1 — the Blackboard-style ICS feed (§10).
 *
 * Syncs every ICS source the job's user owns rather than one named in the
 * payload. That is deliberate: `enqueueJob` dedupes on `(userId, kind,
 * pending)`, so a per-source job requested while another was already queued
 * would be silently dropped and that feed would never sync. One job meaning
 * "bring this student's ICS feeds up to date" has no such hole.
 *
 * One failing feed does not abort the others — a student with two feeds and one
 * dead URL should still get the live one.
 */
import { and, eq } from "drizzle-orm";
import { calendarSources, db } from "@mola/db";
import { IcsFetchError, syncIcsFeed } from "@/lib/calendar/sync";
import { markSourceStatus, markSourceSynced } from "@/lib/calendar/sources";
import { PermanentJobFailure, type JobHandler } from "../types";

export const syncIcsHandler: JobHandler = {
  kind: "calendar_sync_ics",
  async handle(job) {
    const sources = await db.select().from(calendarSources).where(and(
      eq(calendarSources.userId, job.userId),
      eq(calendarSources.kind, "ics"),
    ));

    const failures: string[] = [];
    let permanent = true;

    for (const source of sources) {
      if (source.status === "disabled" || !source.url) continue;
      try {
        await syncIcsFeed({ userId: job.userId, calendarSourceId: source.id, url: source.url });
        await markSourceSynced(source.id);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await markSourceStatus(source.id, "error", message);
        failures.push(`${source.name}: ${message}`);
        // A bad URL or a 404 fails identically forever; a timeout or a 503 is
        // worth another attempt, so one transient failure keeps the retry.
        if (!(err instanceof IcsFetchError) || !err.permanent) permanent = false;
      }
    }

    if (failures.length === 0) return;
    const summary = `ics sync failed for ${failures.length}/${sources.length} feeds — ${failures.join("; ")}`;
    throw permanent ? new PermanentJobFailure(summary) : new Error(summary);
  },
};
