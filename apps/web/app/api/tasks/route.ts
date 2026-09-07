/**
 * GET /api/tasks and POST /api/tasks — contract D.
 *
 * Tasks are the check-off unit: a plan becomes real here or not at all. The
 * list is filtered in `listTasks` rather than in the caller, so the date rule
 * that keeps undated tasks visible lives in one place.
 */
import { z } from "zod";
import { requireSession } from "@/lib/auth/ownership";
import { createTask, listTasks } from "@/lib/planning";
import { isDateKey } from "@/lib/planning/dates";
import { planningErrorResponse } from "@/lib/planning/errors";
import type { TaskView } from "@mola/shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES: readonly TaskView["status"][] = ["todo", "done", "skipped"];

const createSchema = z.object({
  title: z.string().min(1),
  courseId: z.string().uuid().nullable().optional(),
  scheduledFor: z.string().datetime({ offset: true }).nullable().optional(),
  estimatedMinutes: z.number().int().positive().nullable().optional(),
  notes: z.string().nullable().optional(),
  scheduleItemId: z.string().uuid().nullable().optional(),
});

export async function GET(req: Request) {
  try {
    const session = await requireSession();
    const params = new URL(req.url).searchParams;

    const date = params.get("date");
    if (date !== null && !isDateKey(date)) {
      return Response.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
    }

    const status = params.get("status");
    if (status !== null && !STATUSES.includes(status as TaskView["status"])) {
      return Response.json({ error: "status must be todo, done or skipped" }, { status: 400 });
    }

    const tasks = await listTasks(session, {
      date,
      status: status as TaskView["status"] | null,
      courseId: params.get("courseId"),
    });
    return Response.json({ tasks });
  } catch (err) {
    return planningErrorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireSession();
    const parsed = createSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") },
        { status: 400 },
      );
    }

    return Response.json({ task: await createTask(session, parsed.data) }, { status: 201 });
  } catch (err) {
    return planningErrorResponse(err);
  }
}
