/**
 * STUB — owned by Agent J3.
 * Replace the body; keep the exported name and the `kind`.
 */
import type { JobHandler } from "../types";

export const proposeWeekHandler: JobHandler = {
  kind: "plan_week_propose",
  async handle(job) {
    throw new Error(`plan_week_propose handler not implemented (job ${job.id})`);
  },
};
