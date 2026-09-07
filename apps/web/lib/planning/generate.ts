/**
 * Plan generation — one LLM call per horizon, through the frozen provider
 * abstraction (contract 3), validated against the frozen zod payloads
 * (contract 7) before anything reaches the database.
 *
 * Two decisions worth stating, because both are load-bearing:
 *
 * 1. **Validation is a gate, not a formality.** A model will eventually emit a
 *    plan with a `kind` that is not in the enum or a date in the wrong format.
 *    It fails here, at the parse, with the issue list quoted back to the model
 *    for exactly one retry — not three screens later inside a renderer.
 *
 * 2. **Item ids are derived here, not asked for.** `PlannedItem.id` has to be
 *    stable across re-proposals so an amendment and a materialised task keep
 *    pointing at the same block, and a language model is the worst possible
 *    source of a stable identifier. So the id is a hash of what the item IS —
 *    horizon, day, course, title — which reproduces itself whenever the item
 *    genuinely reappears, and changes when the item genuinely changed. Any id
 *    the model volunteers is discarded.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  dayPlanPayloadSchema, semesterPlanPayloadSchema, weekPlanPayloadSchema,
  type DayPlanPayload, type SemesterPlanPayload, type WeekPlanPayload,
} from "@mola/shared";
import { getChatProvider } from "@/lib/llm";
import { addDays, dateKey, endOfDay, offsetSuffix, parseDateKey, weekDayKeys, weekdayName } from "./dates";
import {
  gatherInputs, renderCalendar, renderCompleted, renderCourses, renderPlanForPrompt,
  scheduleItemIds, type CourseRow, type PlanRow,
} from "./inputs";

export class PlanGenerationError extends Error {}

/**
 * The seam tests substitute for. Same shape as `Summarizer` in
 * lib/agent/compaction.ts, and for the same reason: a suite that needs a live
 * 27B model to be up is a suite nobody runs.
 */
export type PlanCompleter = (req: { system: string; prompt: string }) => Promise<string>;

export function makeLlmCompleter(userId: string): PlanCompleter {
  return async ({ system, prompt }) => {
    // think:false deliberately. Hidden reasoning is charged against the same
    // output budget as the answer (lib/llm/ollama.ts), and a plan truncated
    // mid-JSON is a plan that fails validation for no reason the model could
    // have avoided. Low temperature for the same reason — this is structured
    // extraction from a calendar, not prose.
    const provider = getChatProvider(userId, { think: false });
    let text = "";
    for await (const ev of provider.stream({
      system,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      maxTokens: 8192,
    })) {
      if (ev.type === "text_delta") text += ev.text;
      if (ev.type === "error") throw new PlanGenerationError(ev.message);
    }
    return text;
  };
}

const PLANNER_SYSTEM = `You are the planning engine inside a study companion. You read a student's real \
calendar and return a study plan as one JSON object.

Rules you do not break:
- Never place study time on top of a block tagged [BUSY]. A lecture, an exam, a \
work shift and a standing appointment are time that is already spent.
- Work backwards from the dates you were given. Preparation goes BEFORE a \
deadline or an exam, never after it.
- Never invent a course, a date, a deadline or an exam. Use only what is listed.
- Use a course id exactly as written in the COURSES list, or null when the work \
is not tied to a course.
- Give every item a one-line rationale naming the deadline, exam or gap it \
serves. "Because it is on the syllabus" is not a rationale.
- Be realistic about volume. A day with two lectures and a four-hour shift does \
not also hold five hours of study.

Return the JSON object and nothing else. No prose before or after it, no \
markdown fences, no commentary.`;

// ── Public API ───────────────────────────────────────────────────────────────

export async function generateSemesterPlan(
  args: { userId: string; from: Date; to: Date; review?: { basedOnWeekStart: string; pattern: string } },
  complete?: PlanCompleter,
): Promise<SemesterPlanPayload> {
  const inputs = await gatherInputs(args.userId, args.from, args.to);
  const prompt = [
    `Draft the semester plan for ${inputs.studentName}`
      + (inputs.termLabel ? `, ${inputs.termLabel}` : "") + `.`,
    `Today is ${weekdayName(inputs.today)} ${inputs.today}. The horizon runs `
      + `${dateKey(args.from)} to ${dateKey(args.to)}.`,
    "",
    renderCourses(inputs.courses),
    "",
    renderCalendar(inputs.events, inputs.courses, "CALENDAR — every dated item on record"),
    "",
    renderCompleted(inputs),
    ...(args.review ? ["", reviewSection(args.review)] : []),
    "",
    SEMESTER_SHAPE,
  ].join("\n");

  return generateValidated(
    complete ?? makeLlmCompleter(args.userId),
    prompt,
    semesterPlanPayloadSchema,
    (raw) => normaliseSemester(raw, {
      courses: inputs.courses,
      scheduleIds: scheduleItemIds(inputs.events),
      basedOnWeekStart: args.review?.basedOnWeekStart ?? null,
    }),
  );
}

export async function generateWeekPlan(
  args: { userId: string; weekStart: string; semesterPlan: PlanRow | null },
  complete?: PlanCompleter,
): Promise<WeekPlanPayload> {
  const monday = parseDateKey(args.weekStart);
  const sunday = endOfDay(addDays(monday, 6));
  const inputs = await gatherInputs(args.userId, monday, sunday);
  // Two weeks past Sunday, so the planner can start preparing for the
  // collision that lands the following Thursday instead of discovering it on
  // the Monday it is already too late to spread the work.
  const lookahead = await gatherInputs(args.userId, addDays(sunday, 1), endOfDay(addDays(monday, 20)));

  const prompt = [
    `Plan the week of Monday ${args.weekStart} for ${inputs.studentName}. `
      + `Today is ${weekdayName(inputs.today)} ${inputs.today}.`,
    "",
    renderCourses(inputs.courses),
    "",
    renderCalendar(inputs.events, inputs.courses, "THIS WEEK'S CALENDAR"),
    "",
    renderCalendar(lookahead.events, inputs.courses, "WHAT IS COMING AFTER THIS WEEK (plan towards it, do not schedule into it)"),
    "",
    renderCompleted(inputs),
    "",
    renderPlanForPrompt(args.semesterPlan, "THE APPROVED SEMESTER PLAN THIS WEEK SERVES"),
    "",
    weekShape(args.weekStart, monday),
  ].join("\n");

  return generateValidated(
    complete ?? makeLlmCompleter(args.userId),
    prompt,
    weekPlanPayloadSchema,
    (raw) => normaliseWeek(raw, {
      weekStart: args.weekStart,
      monday,
      courses: inputs.courses,
      scheduleIds: scheduleItemIds([...inputs.events, ...lookahead.events]),
    }),
  );
}

export async function generateDayPlan(
  args: { userId: string; date: string; weekPlan: PlanRow | null },
  complete?: PlanCompleter,
): Promise<DayPlanPayload> {
  const day = parseDateKey(args.date);
  const inputs = await gatherInputs(args.userId, day, endOfDay(day));

  const prompt = [
    `Decompose the approved week plan into the plan for ${weekdayName(args.date)} ${args.date}, `
      + `for ${inputs.studentName}.`,
    "",
    renderCourses(inputs.courses),
    "",
    renderCalendar(inputs.events, inputs.courses, `THE CALENDAR FOR ${args.date}`),
    "",
    renderCompleted(inputs),
    "",
    renderPlanForPrompt(args.weekPlan, "THE APPROVED WEEK PLAN THIS DAY COMES FROM"),
    "",
    dayShape(args.date, day),
  ].join("\n");

  return generateValidated(
    complete ?? makeLlmCompleter(args.userId),
    prompt,
    dayPlanPayloadSchema,
    (raw) => normaliseDay(raw, {
      date: args.date,
      courses: inputs.courses,
      scheduleIds: scheduleItemIds(inputs.events),
    }),
  );
}

// ── Prompt shapes ────────────────────────────────────────────────────────────

const ITEM_SHAPE = `      {
        "title": "<what the student actually does>",
        "kind": "study|homework|review|reading|practice_quiz|flashcards|break",
        "courseId": "<a course id from COURSES, or null>",
        "estimatedMinutes": <whole number of minutes>,
        "startAt": "<ISO timestamp, or null if not pinned to a clock slot>",
        "relatedScheduleItemId": "<the scheduleItemId this serves, or null>",
        "rationale": "<one line: why this, now>"
      }`;

const SEMESTER_SHAPE = `Return this JSON object:
{
  "horizon": "semester",
  "summary": "<three to five sentences: the shape of the term and where the pressure sits>",
  "goals": [ { "courseId": "<course id or null>", "text": "<what competence in this course looks like by the end>" } ],
  "milestones": [
    {
      "title": "<...>",
      "courseId": "<course id or null>",
      "targetDate": "YYYY-MM-DD",
      "kind": "exam|project|unit|checkpoint",
      "relatedScheduleItemId": "<the scheduleItemId it corresponds to, or null>"
    }
  ]
}

Every exam and every graded deadline on the calendar becomes a milestone on its
real date, with relatedScheduleItemId set to that row's id. Then add "checkpoint"
milestones on the dates preparation has to START for each of them — those are
what make this a plan rather than a copy of the calendar.`;

function weekShape(weekStart: string, monday: Date): string {
  const keys = weekDayKeys(monday);
  const offset = offsetSuffix(monday);
  return `Return this JSON object:
{
  "horizon": "week",
  "weekStart": "${weekStart}",
  "summary": "<a short paragraph the student reads first: what this week is about>",
  "focus": [ { "courseId": "<course id or null>", "text": "<the one thing this course needs this week>" } ],
  "days": [
    { "date": "YYYY-MM-DD", "items": [
${ITEM_SHAPE}
    ] }
  ],
  "risks": [ "<a concrete thing that could go wrong, e.g. two deadlines landing on the same Thursday>" ]
}

- "days" contains all seven dates in order: ${keys.join(", ")}. A day with nothing
  planned still appears, with an empty "items" array.
- "startAt" carries the offset ${offset}, e.g. "${keys[1]}T19:00:00${offset}".
- "risks" is specific. "Might fall behind" is not a risk; "Quiz 3 and Project 1
  both land Thursday and Wednesday evening is the only free block before them" is.`;
}

function dayShape(date: string, day: Date): string {
  const offset = offsetSuffix(day);
  return `Return this JSON object:
{
  "horizon": "day",
  "date": "${date}",
  "summary": "<one or two sentences: what today is for>",
  "items": [
${ITEM_SHAPE}
  ]
}

- Take the items the week plan already placed on ${date}. Adjust them for what is
  actually on today's calendar and drop anything already finished.
- Add something new only when a deadline today has no preparation in the week
  plan at all.
- "startAt" carries the offset ${offset}, in the order the student should work.`;
}

function reviewSection(review: { basedOnWeekStart: string; pattern: string }): string {
  return `HOW LAST WEEK ACTUALLY WENT (week of ${review.basedOnWeekStart}) — this is the
reason you are re-proposing. Read it as evidence about this student's real
capacity, not as a list of failures to scold:

${review.pattern}

Also return a "review" key alongside the others:
  "review": {
    "observations": [ "<what the amendment pattern above actually shows>" ],
    "proposedChanges": [ "<what you are changing in the semester plan because of it>" ]
  }
Each proposedChange names a concrete edit to the goals or milestones above.`;
}

// ── Validation ───────────────────────────────────────────────────────────────

async function generateValidated<S extends z.ZodTypeAny>(
  complete: PlanCompleter,
  prompt: string,
  schema: S,
  normalise: (raw: unknown) => unknown,
): Promise<z.infer<S>> {
  let feedback = "";
  let lastError = "no attempt made";

  // Exactly one retry. A model that cannot produce the shape twice with the
  // issue list in front of it will not produce it on the fifth try either, and
  // a job that keeps retrying a 27B generation is a job that eats the box.
  for (let attempt = 0; attempt < 2; attempt++) {
    const text = await complete({ system: PLANNER_SYSTEM, prompt: prompt + feedback });
    try {
      const parsed = schema.safeParse(normalise(extractJsonObject(text)));
      if (parsed.success) return parsed.data as z.infer<S>;
      lastError = formatIssues(parsed.error);
    } catch (err) {
      if (!(err instanceof PlanGenerationError)) throw err;
      lastError = err.message;
    }
    feedback = `\n\nYour previous reply was rejected: ${lastError}\n`
      + `Return the corrected JSON object only — no prose, no fences.`;
  }

  throw new PlanGenerationError(`plan payload failed validation after one retry — ${lastError}`);
}

function formatIssues(err: z.ZodError): string {
  return err.issues
    .slice(0, 8)
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
}

/** Tolerates the fenced/prefixed replies models produce even when told not to. */
export function extractJsonObject(text: string): unknown {
  const stripped = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  const fenced = stripped.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced?.[1] ?? stripped;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end <= start) throw new PlanGenerationError("model returned no JSON object");
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch (err) {
    throw new PlanGenerationError(`model returned unparseable JSON: ${(err as Error).message}`);
  }
}

// ── Normalisation ────────────────────────────────────────────────────────────

type Json = Record<string, unknown>;

const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

type NormaliseCtx = { courses: CourseRow[]; scheduleIds: Set<string> };

/**
 * Fixes only what is mechanically fixable — an id we own, a naive timestamp, a
 * course named instead of referenced. Everything else is left exactly as the
 * model wrote it so zod still rejects it and the retry gets to see why.
 */
function normaliseItems(raw: unknown, scope: string, ctx: NormaliseCtx): unknown {
  if (!Array.isArray(raw)) return raw;
  const seen = new Map<string, number>();

  return raw.map((item) => {
    if (!isObj(item)) return item;
    const courseId = resolveCourseId(item.courseId, ctx.courses);
    const title = typeof item.title === "string" ? item.title.trim().toLowerCase() : "";
    const basis = `${scope}|${courseId ?? "-"}|${title}`;
    const seq = seen.get(basis) ?? 0;
    seen.set(basis, seq + 1);

    return {
      ...item,
      id: stableItemId(basis, seq),
      courseId,
      startAt: normaliseTimestamp(item.startAt, scope),
      estimatedMinutes: normaliseMinutes(item.estimatedMinutes),
      // A pointer at a schedule item that does not exist is worse than no
      // pointer: the UI would render "in service of" nothing at all.
      relatedScheduleItemId:
        typeof item.relatedScheduleItemId === "string" && ctx.scheduleIds.has(item.relatedScheduleItemId)
          ? item.relatedScheduleItemId
          : null,
    };
  });
}

function normaliseDay(raw: unknown, ctx: NormaliseCtx & { date: string }): unknown {
  if (!isObj(raw)) return raw;
  return {
    ...raw,
    horizon: "day",
    date: ctx.date,
    items: normaliseItems(raw.items, `day:${ctx.date}`, ctx),
  };
}

function normaliseWeek(raw: unknown, ctx: NormaliseCtx & { weekStart: string; monday: Date }): unknown {
  if (!isObj(raw)) return raw;

  const keys = weekDayKeys(ctx.monday);
  const supplied = new Map<string, unknown>();
  if (Array.isArray(raw.days)) {
    for (const day of raw.days) {
      if (isObj(day) && typeof day.date === "string") supplied.set(day.date, day);
    }
  }

  // Seven days, in order, always. A model that skips Saturday leaves the week
  // grid with a hole in it, and the fix is cheaper here than in every renderer.
  const days = keys.map((date) => {
    const day = supplied.get(date);
    const items = isObj(day) ? day.items : [];
    return { date, items: normaliseItems(items, `week:${ctx.weekStart}:${date}`, ctx) };
  });

  return { ...raw, horizon: "week", weekStart: ctx.weekStart, days };
}

function normaliseSemester(
  raw: unknown,
  ctx: NormaliseCtx & { basedOnWeekStart: string | null },
): unknown {
  if (!isObj(raw)) return raw;

  const goals = Array.isArray(raw.goals)
    ? raw.goals.map((g) => (isObj(g) ? { ...g, courseId: resolveCourseId(g.courseId, ctx.courses) } : g))
    : raw.goals;

  const milestones = Array.isArray(raw.milestones)
    ? raw.milestones.map((m) => (isObj(m) ? {
        ...m,
        courseId: resolveCourseId(m.courseId, ctx.courses),
        relatedScheduleItemId:
          typeof m.relatedScheduleItemId === "string" && ctx.scheduleIds.has(m.relatedScheduleItemId)
            ? m.relatedScheduleItemId
            : null,
      } : m))
    : raw.milestones;

  const review = ctx.basedOnWeekStart && isObj(raw.review)
    ? { ...raw.review, basedOnWeekStart: ctx.basedOnWeekStart }
    : ctx.basedOnWeekStart
      ? { basedOnWeekStart: ctx.basedOnWeekStart, observations: [], proposedChanges: [] }
      : (raw.review ?? null);

  return { ...raw, horizon: "semester", goals, milestones, review };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Accepts the id, or the course number/name the model used instead of it. */
function resolveCourseId(value: unknown, rows: CourseRow[]): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  if (UUID_RE.test(value)) return rows.some((c) => c.id === value) ? value : null;
  const needle = value.trim().toLowerCase();
  const match = rows.find((c) =>
    c.number?.toLowerCase() === needle || c.name.toLowerCase() === needle);
  return match?.id ?? null;
}

const NAIVE_TS_RE = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(:\d{2})?$/;

/** A naive local timestamp gets the zone it was always meant to have. */
function normaliseTimestamp(value: unknown, scope: string): unknown {
  if (typeof value !== "string") return value ?? null;
  const naive = value.trim().match(NAIVE_TS_RE);
  if (!naive) return value;
  const anchor = scope.split(":").pop();
  const at = anchor && /^\d{4}-\d{2}-\d{2}$/.test(anchor) ? parseDateKey(anchor) : new Date();
  return `${naive[1]}T${naive[2]}${naive[3] ?? ":00"}${offsetSuffix(at)}`;
}

function normaliseMinutes(value: unknown): unknown {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) return value ?? null;
  return n > 0 ? Math.round(n) : null;
}

function stableItemId(basis: string, seq: number): string {
  return createHash("sha1").update(`${basis}|${seq}`).digest("hex").slice(0, 12);
}
