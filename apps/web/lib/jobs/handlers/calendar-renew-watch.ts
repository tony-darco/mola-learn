/**
 * STUB — owned by Agent J1.
 * Replace the body; keep the exported name and the `kind`.
 */
import type { JobHandler } from "../types";

export const renewWatchHandler: JobHandler = {
  kind: "calendar_renew_watch",
  async handle(job) {
    throw new Error(`calendar_renew_watch handler not implemented (job ${job.id})`);
  },
};
