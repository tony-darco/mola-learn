/**
 * STUB — owned by Agent J1.
 * Replace the body; keep the exported name and the `kind`.
 */
import type { JobHandler } from "../types";

export const syncGoogleHandler: JobHandler = {
  kind: "calendar_sync_google",
  async handle(job) {
    throw new Error(`calendar_sync_google handler not implemented (job ${job.id})`);
  },
};
