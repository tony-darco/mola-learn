/**
 * The planning engine's front door (§5).
 *
 * Routes, job handlers and the app shell import from here rather than reaching
 * for a specific module — with one deliberate exception: the job handlers
 * under `lib/jobs/handlers/` import `./lifecycle` and `./review` directly,
 * because `cadence.ts` imports the job worker and routing them back through
 * this file would close that loop into a cycle.
 */
export { ensurePlansForToday } from "./cadence";
export {
  acceptPlan, amendPlan, createTask, getApprovedPlanRow, getCurrentPlan, getCurrentPlanRow,
  listTasks, materialiseTasks, proposePlan, semesterPeriod, toPlanRecord, updateTask,
  TaskInputError,
  type PlanHorizon, type PlanRecord, type ProposeArgs, type TaskFilters, type TaskPatch,
} from "./lifecycle";
export { describeAmendmentPattern, gatherWeekAmendments } from "./review";
export { AmendmentError, AMENDMENT_ACTIONS, type AmendmentAction, type AmendmentInput } from "./payload";
export { PlanGenerationError, type PlanCompleter } from "./generate";
