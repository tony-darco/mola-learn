/**
 * Reading a week's amendment log as a *pattern*, which is the whole reason
 * `plan_amendments` is an append-only table rather than a payload that gets
 * overwritten (contract A).
 *
 * A diff of two payloads can say the plan changed. Only the log can say the
 * same reading block was pushed three times, that Tuesday evening was skipped
 * every week, or that ninety-minute estimates keep coming back as forty-five —
 * and those are the three things worth telling the semester plan about.
 *
 * Nothing here writes. The review job hands what this produces to the semester
 * generator as evidence; the student still has to accept the result (§5).
 */
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { db, planAmendments, plans } from "@mola/db";
import { addDays, endOfDay, parseDateKey } from "./dates";

export type AmendmentRow = typeof planAmendments.$inferSelect;

/**
 * Every amendment made against the day and week plans of one week.
 *
 * Semester plans are excluded on purpose: a semester amendment is an outcome
 * of a previous review, and feeding it back in would let the loop learn from
 * its own output instead of from the student's week.
 */
export async function gatherWeekAmendments(
  userId: string,
  weekStart: string,
): Promise<AmendmentRow[]> {
  const monday = parseDateKey(weekStart);
  const sunday = endOfDay(addDays(monday, 6));

  const rows = await db.select({ amendment: planAmendments })
    .from(planAmendments)
    .innerJoin(plans, eq(plans.id, planAmendments.planId))
    .where(and(
      eq(planAmendments.userId, userId),
      inArray(plans.horizon, ["day", "week"]),
      gte(plans.periodStart, monday),
      lte(plans.periodStart, sunday),
    ))
    .orderBy(asc(planAmendments.createdAt));

  return rows.map((r) => r.amendment);
}

/**
 * The log, rendered as the evidence paragraph the semester prompt reads.
 *
 * Counts lead, because repetition is the signal: one rescheduled block is a
 * bad Tuesday, the same block rescheduled four times is a plan that was wrong
 * about the student.
 */
export function describeAmendmentPattern(rows: AmendmentRow[]): string {
  if (rows.length === 0) return "No amendments were recorded — the week ran as planned.";

  const sections = [
    tally(rows, "completed", "Finished as planned"),
    tally(rows, "skipped", "Skipped"),
    tally(rows, "rescheduled", "Moved to another slot"),
    tally(rows, "removed", "Dropped from the plan outright"),
    tally(rows, "added", "Added by the student, so the plan had missed it"),
    resizes(rows),
    reasons(rows),
  ].filter((s): s is string => s !== null);

  return [
    `${rows.length} amendment${rows.length === 1 ? "" : "s"} were recorded.`,
    ...sections,
  ].join("\n");
}

function tally(rows: AmendmentRow[], action: string, heading: string): string | null {
  const hits = rows.filter((r) => r.action === action);
  if (hits.length === 0) return null;

  const counts = new Map<string, number>();
  for (const row of hits) {
    const label = titleOf(row);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  const listed = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, n]) => (n > 1 ? `"${label}" ×${n}` : `"${label}"`))
    .join(", ");

  return `${heading} (${hits.length}): ${listed}`;
}

/** Estimate drift, stated as before → after so the model can see the direction. */
function resizes(rows: AmendmentRow[]): string | null {
  const hits = rows.filter((r) => r.action === "resized");
  if (hits.length === 0) return null;

  const lines = hits.map((row) => {
    const from = minutesOf(row.before);
    const to = minutesOf(row.after);
    const shift = from !== null && to !== null ? `${from} → ${to} min` : "re-estimated";
    return `"${titleOf(row)}" ${shift}`;
  });
  return `Re-estimated (${hits.length}): ${lines.join(", ")}`;
}

/** The student's own words, when they gave any — worth more than any tally. */
function reasons(rows: AmendmentRow[]): string | null {
  const given = rows
    .filter((r) => typeof r.reason === "string" && r.reason.trim().length > 0)
    .map((r) => `- "${titleOf(r)}" (${r.action}): ${r.reason!.trim()}`);
  if (given.length === 0) return null;
  return `Reasons the student gave:\n${given.join("\n")}`;
}

function titleOf(row: AmendmentRow): string {
  return field(row.before, "title") ?? field(row.after, "title") ?? row.itemId ?? "an untitled block";
}

function field(value: unknown, key: string): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const v = (value as Record<string, unknown>)[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

function minutesOf(value: unknown): number | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const v = (value as Record<string, unknown>).estimatedMinutes;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
