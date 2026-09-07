/**
 * CONTRACT 8 — the TypeScript job worker (Agent J). FROZEN.
 *
 * The `jobs` table already exists and is already polled by the Python ingest
 * worker, which claims ONLY `kind = 'ingest_document'`. This worker claims only
 * the kinds in `CALENDAR_JOB_KINDS`. Both filter by kind, so one queue serves
 * both without either seeing the other's rows — do not add a second queue.
 *
 * Why a worker at all, when a Next.js route could do this inline: a Google
 * watch channel expires within days and then stops delivering silently (§10),
 * so renewal has to happen on a clock rather than on a page load. The planning
 * loop has the same shape — Sunday's proposal must exist whether or not the
 * student opened the app on Sunday (§5).
 *
 * Everything here is nonetheless also reachable on demand (`runDueJobs`), so a
 * dev box with no worker process running still behaves correctly: opening the
 * app drains what is due. That is the "if the app isn't opened Sunday, the
 * proposal persists and is presented on next open" rule, implemented.
 */
import type { CalendarJobKind } from "@mola/shared";

export type JobRow = {
  id: string;
  userId: string;
  kind: string;
  payload: Record<string, unknown>;
  attempts: number;
};

/**
 * A handler returns normally on success. Throwing schedules a retry with
 * backoff; throwing `PermanentJobFailure` marks the job failed without retry —
 * the same split the Python worker uses (apps/ingest/ingest/pipeline.py).
 */
export type JobHandler = {
  kind: CalendarJobKind;
  handle(job: JobRow): Promise<void>;
};

export class PermanentJobFailure extends Error {}
