/**
 * STUB — owned by Agent J3.
 * Replace the body; keep the exported name and the `kind`.
 */
import type { JobHandler } from "../types";

export const weekReviewHandler: JobHandler = {
  kind: "plan_week_review",
  async handle(job) {
    throw new Error(`plan_week_review handler not implemented (job ${job.id})`);
  },
};
