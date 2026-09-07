/**
 * The Plan tab's client against contract D. Every call in here is the frozen
 * HTTP shape J3 serves — nothing reads the database directly, so the two
 * halves stay swappable and the ownership check (§9) always runs server-side.
 *
 * A plan payload is LLM-written, so it goes through `planPayloadSchema` on
 * arrival (contract B): a malformed plan fails here, at the boundary, rather
 * than three screens later inside a renderer.
 */
import { planPayloadSchema, type CalendarEvent, type TaskView } from "@mola/shared";
import type { PlanAmendment, PlanHorizon, PlanRecord } from "./plan-logic";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.body ? { "content-type": "application/json", ...init.headers } : init?.headers,
  });
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${url} failed (${res.status})`);
  return (await res.json()) as T;
}

function toPlanRecord(raw: Omit<PlanRecord, "payload"> & { payload: unknown }): PlanRecord {
  return { ...raw, payload: planPayloadSchema.parse(raw.payload) };
}

export async function fetchPlan(horizon: PlanHorizon, date?: string): Promise<PlanRecord | null> {
  const query = new URLSearchParams({ horizon, ...(date ? { date } : {}) });
  const { plan } = await request<{ plan: (Omit<PlanRecord, "payload"> & { payload: unknown }) | null }>(
    `/api/plan?${query}`,
  );
  return plan ? toPlanRecord(plan) : null;
}

/** `202` when the proposal is queued for the planning worker, `200` when it came back inline. */
export async function proposePlan(horizon: PlanHorizon, date?: string): Promise<PlanRecord | null> {
  const body = await request<{ queued?: true; plan?: Omit<PlanRecord, "payload"> & { payload: unknown } }>(
    "/api/plan/propose",
    { method: "POST", body: JSON.stringify({ horizon, ...(date ? { date } : {}) }) },
  );
  return body.plan ? toPlanRecord(body.plan) : null;
}

export async function acceptPlan(planId: string): Promise<PlanRecord> {
  const { plan } = await request<{ plan: Omit<PlanRecord, "payload"> & { payload: unknown } }>(
    `/api/plan/${planId}/accept`, { method: "POST" },
  );
  return toPlanRecord(plan);
}

export async function amendPlan(planId: string, amendments: PlanAmendment[]): Promise<PlanRecord> {
  const { plan } = await request<{ plan: Omit<PlanRecord, "payload"> & { payload: unknown } }>(
    `/api/plan/${planId}/amend`, { method: "POST", body: JSON.stringify({ amendments }) },
  );
  return toPlanRecord(plan);
}

export async function fetchTasks(params: { date?: string; status?: TaskView["status"]; courseId?: string } = {}) {
  const query = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]);
  const { tasks } = await request<{ tasks: TaskView[] }>(`/api/tasks?${query}`);
  return tasks;
}

export type NewTask = {
  title: string;
  courseId?: string | null;
  scheduledFor?: string | null;
  estimatedMinutes?: number | null;
  notes?: string | null;
  scheduleItemId?: string | null;
};

export async function createTask(body: NewTask): Promise<TaskView> {
  const { task } = await request<{ task: TaskView }>("/api/tasks", { method: "POST", body: JSON.stringify(body) });
  return task;
}

export type TaskPatch = Partial<Pick<TaskView, "status" | "title" | "notes" | "scheduledFor" | "estimatedMinutes">>;

export async function patchTask(taskId: string, patch: TaskPatch): Promise<TaskView> {
  const { task } = await request<{ task: TaskView }>(`/api/tasks/${taskId}`, {
    method: "PATCH", body: JSON.stringify(patch),
  });
  return task;
}

export async function fetchEvents(from: Date, to: Date): Promise<CalendarEvent[]> {
  const query = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
  const { events } = await request<{ events: CalendarEvent[] }>(`/api/calendar/events?${query}`);
  return events;
}

/**
 * The same calls as one object, so the Plan tab takes its backend as a value.
 * Only `?fixtures=1` in development substitutes anything else (see
 * ./fixtures) — every other path through the app is `planApi`, hitting the
 * real routes, so nothing about the shipped behaviour depends on the stand-in.
 */
export type PlanApi = {
  fetchPlan: typeof fetchPlan;
  proposePlan: typeof proposePlan;
  acceptPlan: typeof acceptPlan;
  amendPlan: typeof amendPlan;
  fetchTasks: typeof fetchTasks;
  createTask: typeof createTask;
  patchTask: typeof patchTask;
  fetchEvents: typeof fetchEvents;
};

export const planApi: PlanApi = {
  fetchPlan, proposePlan, acceptPlan, amendPlan, fetchTasks, createTask, patchTask, fetchEvents,
};
