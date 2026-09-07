/**
 * The claim/dispatch loop for calendar and planning jobs (contract 8).
 *
 * Claims with `FOR UPDATE SKIP LOCKED`, the same discipline the Python ingest
 * worker uses, so running several of these — or running one alongside an
 * on-demand `runDueJobs()` from a page load — cannot double-process a row.
 */
import { and, eq, inArray, lte, sql } from "drizzle-orm";
import { db, jobs } from "@mola/db";
import { CALENDAR_JOB_KINDS, type CalendarJobKind } from "@mola/shared";
import { HANDLERS } from "./handlers";
import { PermanentJobFailure, type JobRow } from "./types";

const MAX_ATTEMPTS = 5;
/** Exponential, capped — a Google outage should not spin. */
const BACKOFF_MS = (attempts: number) => Math.min(2 ** attempts * 30_000, 30 * 60_000);

async function claimOne(): Promise<JobRow | null> {
  const rows = await db.execute<{
    id: string; user_id: string; kind: string; payload: Record<string, unknown>; attempts: number;
  }>(sql`
    UPDATE jobs SET status = 'running', locked_at = now()
    WHERE id = (
      SELECT id FROM jobs
      WHERE status = 'pending'
        AND run_after <= now()
        AND kind = ANY(${sql.raw(`ARRAY[${CALENDAR_JOB_KINDS.map((k) => `'${k}'`).join(",")}]`)})
      ORDER BY run_after ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, user_id, kind, payload, attempts
  `);

  const row = rows[0];
  if (!row) return null;
  return { id: row.id, userId: row.user_id, kind: row.kind, payload: row.payload, attempts: row.attempts };
}

/** Processes one claimed job. Returns false when the queue had nothing due. */
export async function runOneJob(): Promise<boolean> {
  const job = await claimOne();
  if (!job) return false;

  const handler = HANDLERS.find((h) => h.kind === job.kind);
  if (!handler) {
    await db.update(jobs)
      .set({ status: "failed", lastError: `no handler registered for kind ${job.kind}` })
      .where(eq(jobs.id, job.id));
    return true;
  }

  try {
    await handler.handle(job);
    await db.update(jobs).set({ status: "done", lastError: null }).where(eq(jobs.id, job.id));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const attempts = job.attempts + 1;
    const permanent = err instanceof PermanentJobFailure || attempts >= MAX_ATTEMPTS;

    await db.update(jobs).set({
      status: permanent ? "failed" : "pending",
      attempts,
      lastError: message,
      runAfter: permanent ? undefined : new Date(Date.now() + BACKOFF_MS(attempts)),
      lockedAt: null,
    }).where(eq(jobs.id, job.id));

    if (permanent) console.error(`job ${job.id} (${job.kind}) failed permanently: ${message}`);
  }
  return true;
}

/**
 * Drains everything currently due, up to `limit`. Called both by the standalone
 * worker loop and opportunistically on app open, so a dev box with no worker
 * running still gets its Sunday plan proposal generated on first visit (§5).
 */
export async function runDueJobs(limit = 25): Promise<number> {
  let processed = 0;
  while (processed < limit) {
    if (!(await runOneJob())) break;
    processed++;
  }
  return processed;
}

/** Enqueue, skipping if an identical pending job is already queued. */
export async function enqueueJob(
  userId: string, kind: CalendarJobKind, payload: Record<string, unknown> = {}, runAfter?: Date,
): Promise<void> {
  const existing = await db.select({ id: jobs.id }).from(jobs).where(and(
    eq(jobs.userId, userId), eq(jobs.kind, kind), eq(jobs.status, "pending"),
  )).limit(1);
  if (existing.length > 0) return;

  await db.insert(jobs).values({ userId, kind, payload, runAfter: runAfter ?? new Date() });
}

/** True when anything of these kinds is due — cheap guard before a drain. */
export async function hasDueJobs(kinds: readonly CalendarJobKind[]): Promise<boolean> {
  const rows = await db.select({ id: jobs.id }).from(jobs).where(and(
    eq(jobs.status, "pending"),
    lte(jobs.runAfter, new Date()),
    inArray(jobs.kind, kinds as unknown as string[]),
  )).limit(1);
  return rows.length > 0;
}
