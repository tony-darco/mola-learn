/**
 * Google watch-channel renewal — the job that matters most in this workstream.
 *
 * A channel expires within days and then stops delivering notifications with
 * no error anywhere (§10, §15.3). Nothing breaks; the calendar simply stops
 * updating, and the student finds out by missing a deadline. So renewal runs
 * off `channelExpiresAt` rather than a guess about how long channels last, and
 * a channel that cannot be renewed flips its source to `status: "expired"` —
 * visible in the panel, rather than inferred from staleness by a person who
 * would have no reason to look.
 *
 * The job re-queues itself. There is no cron on a dev box, and `runDueJobs()`
 * on a page load is what drains the queue there (contract C), so a renewal
 * sweep that did not schedule the next one would run exactly once.
 */
import { eq } from "drizzle-orm";
import { calendarSources, db } from "@mola/db";
import { isGoogleConfigured } from "@/lib/calendar/google";
import { RENEWAL_WINDOW_MS, ensureWatchChannel } from "@/lib/calendar/google-sync";
import { sourcesNeedingRenewal } from "@/lib/calendar/sources";
import type { JobHandler } from "../types";

/** Comfortably inside the renewal window, so a missed sweep is not a lapse. */
const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;

export const renewWatchHandler: JobHandler = {
  kind: "calendar_renew_watch",
  async handle(job) {
    const hasGoogleSource = await db.select({ id: calendarSources.id })
      .from(calendarSources)
      .where(eq(calendarSources.userId, job.userId))
      .limit(1)
      .then((rows) => rows.length > 0);
    // Nothing to renew and nothing to schedule: a user with no Google calendar
    // should not keep a job on the queue forever.
    if (!hasGoogleSource || !isGoogleConfigured()) return;

    const deadline = new Date(Date.now() + RENEWAL_WINDOW_MS);
    const due = await sourcesNeedingRenewal(job.userId, deadline);

    const failures: string[] = [];
    for (const source of due) {
      try {
        await ensureWatchChannel({ source });
      } catch (err) {
        // `ensureWatchChannel` only rethrows while the existing channel is
        // still valid, so there is time for the worker's backoff to retry.
        failures.push(`${source.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    await scheduleNextSweep(job.userId);
    if (failures.length > 0) throw new Error(`watch renewal deferred — ${failures.join("; ")}`);
  },
};

/**
 * Imported lazily: `worker.ts` pulls in `handlers.ts`, which pulls in this
 * file, so a static import would close a module cycle. Deferring it to call
 * time keeps the cycle out of module evaluation entirely — the same reason
 * `lib/auth/session.ts` defers its own import.
 */
async function scheduleNextSweep(userId: string): Promise<void> {
  const { enqueueJob } = await import("../worker");
  await enqueueJob(userId, "calendar_renew_watch", {}, new Date(Date.now() + SWEEP_INTERVAL_MS));
}
