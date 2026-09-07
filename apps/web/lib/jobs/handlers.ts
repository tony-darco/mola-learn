/**
 * The one place job kinds bind to implementations.
 *
 * Each handler lives in its OWN file under `handlers/` so the calendar and
 * planning workstreams never edit the same module; this file just lists them.
 * Adding a kind means adding a file and one line here.
 */
import type { JobHandler } from "./types";
import { syncIcsHandler } from "./handlers/calendar-sync-ics";
import { syncGoogleHandler } from "./handlers/calendar-sync-google";
import { renewWatchHandler } from "./handlers/calendar-renew-watch";
import { proposeWeekHandler } from "./handlers/plan-week-propose";
import { proposeDayHandler } from "./handlers/plan-day-propose";
import { weekReviewHandler } from "./handlers/plan-week-review";

export const HANDLERS: readonly JobHandler[] = [
  syncIcsHandler,
  syncGoogleHandler,
  renewWatchHandler,
  proposeWeekHandler,
  proposeDayHandler,
  weekReviewHandler,
];
