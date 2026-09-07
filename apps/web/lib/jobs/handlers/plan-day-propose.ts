/**
 * STUB — owned by Agent J3.
 * Replace the body; keep the exported name and the `kind`.
 */
import type { JobHandler } from "../types";

export const proposeDayHandler: JobHandler = {
  kind: "plan_day_propose",
  async handle(job) {
    throw new Error(`plan_day_propose handler not implemented (job ${job.id})`);
  },
};
