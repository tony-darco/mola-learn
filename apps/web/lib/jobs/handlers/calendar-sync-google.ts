/**
 * Tier 2 — Google Calendar incremental sync (§10).
 *
 * Sweeps the user's Google sources for the same reason the ICS handler does:
 * `enqueueJob` dedupes by kind, so a job scoped to one source could be dropped.
 * It is also what a push notification wants — the webhook knows a calendar
 * changed, and re-listing the delta is the cheapest correct response.
 */
import { and, eq } from "drizzle-orm";
import { calendarSources, db } from "@mola/db";
import { GoogleApiError, isGoogleConfigured } from "@/lib/calendar/google";
import { syncGoogleSource } from "@/lib/calendar/google-sync";
import { markSourceStatus } from "@/lib/calendar/sources";
import { PermanentJobFailure, type JobHandler } from "../types";

export const syncGoogleHandler: JobHandler = {
  kind: "calendar_sync_google",
  async handle(job) {
    const sources = await db.select().from(calendarSources).where(and(
      eq(calendarSources.userId, job.userId),
      eq(calendarSources.kind, "google"),
    ));
    if (sources.length === 0) return;

    if (!isGoogleConfigured()) {
      // Retrying cannot fix a missing OAuth client. Fail loudly once instead of
      // backing off for half an hour six times over.
      throw new PermanentJobFailure(
        "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set — see GOOGLE-CALENDAR-SETUP.md",
      );
    }

    const failures: string[] = [];
    let permanent = true;

    for (const source of sources) {
      if (source.status === "disabled") continue;
      try {
        await syncGoogleSource(source);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await markSourceStatus(source.id, "error", message);
        failures.push(`${source.name}: ${message}`);
        // 401/403 mean the student revoked access or the scope changed; only a
        // reconnect fixes those. Everything else deserves a retry.
        const status = err instanceof GoogleApiError ? err.status : 0;
        if (status !== 400 && status !== 401 && status !== 403) permanent = false;
      }
    }

    if (failures.length === 0) return;
    const summary = `google sync failed for ${failures.length}/${sources.length} calendars — ${failures.join("; ")}`;
    throw permanent ? new PermanentJobFailure(summary) : new Error(summary);
  },
};
