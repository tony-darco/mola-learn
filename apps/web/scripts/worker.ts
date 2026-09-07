/**
 * Standalone entrypoint for the calendar/planning worker: `pnpm worker`.
 *
 * The same handlers are also drained opportunistically on app open
 * (`runDueJobs` from a page load), so this process is an optimisation rather
 * than a hard dependency in dev — but it is what makes the two time-driven
 * behaviours actually time-driven in a deployment:
 *
 *   - a Google watch channel expires within days and then stops delivering
 *     notifications silently (§10), so renewal cannot wait for a page load;
 *   - Sunday's weekly proposal should exist on Sunday, not on next open.
 *
 * Mirrors apps/ingest/ingest/worker.py deliberately: same jobs table, same
 * claim discipline, disjoint `kind` filters.
 */
import { runDueJobs } from "../lib/jobs/worker";

const IDLE_POLL_MS = Number(process.env.WORKER_POLL_MS ?? 15_000);

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log(`${signal} — finishing the current job, then exiting`);
    stopping = true;
  });
}

console.log(`calendar/planning worker started (poll ${IDLE_POLL_MS}ms)`);

while (!stopping) {
  let processed = 0;
  try {
    processed = await runDueJobs();
  } catch (err) {
    // A handler that throws is already recorded against its own job row; this
    // catch is only for a failure in the claim loop itself (a dropped DB
    // connection). Log and keep polling rather than dying — a worker that
    // exits on a transient blip stops renewing watch channels, which fails
    // silently, which is the exact failure this worker exists to prevent.
    console.error("worker loop error:", err instanceof Error ? err.message : err);
  }

  if (processed > 0) console.log(`processed ${processed} job(s)`);
  if (processed === 0 && !stopping) {
    await new Promise((resolve) => setTimeout(resolve, IDLE_POLL_MS));
  }
}

console.log("worker stopped");
process.exit(0);
