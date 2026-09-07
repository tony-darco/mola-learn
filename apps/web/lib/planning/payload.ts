/**
 * Reading and editing a `plans.payload` without letting an edit smuggle in a
 * shape the frozen schema would have rejected.
 *
 * Every mutation here ends at `planPayloadSchema.parse`, for the same reason
 * generation does: the payload is read back by the Plan UI, by task
 * materialisation and by Layer 2 of the context assembler, and none of those
 * three should be the place a bad amendment is discovered.
 */
import { randomBytes } from "node:crypto";
import {
  planPayloadSchema, plannedItemSchema,
  type PlanPayload, type PlannedItem,
} from "@mola/shared";
import { dateKey } from "./dates";

export const AMENDMENT_ACTIONS = [
  "added", "removed", "rescheduled", "resized", "completed", "skipped", "reordered",
] as const;
export type AmendmentAction = (typeof AMENDMENT_ACTIONS)[number];

export type AmendmentInput = {
  itemId?: string | null;
  action: AmendmentAction;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
};

/** One day's worth of items, with the date they sit on. Day plans have one. */
export type ItemBucket = { date: string | null; items: PlannedItem[] };

export function bucketsOf(payload: PlanPayload): ItemBucket[] {
  if (payload.horizon === "day") return [{ date: payload.date, items: payload.items }];
  if (payload.horizon === "week") return payload.days.map((d) => ({ date: d.date, items: d.items }));
  return [];
}

/** Flat item list with the date each sits on — what materialisation walks. */
export function itemsOfPayload(payload: PlanPayload): { date: string | null; item: PlannedItem }[] {
  return bucketsOf(payload).flatMap((b) => b.items.map((item) => ({ date: b.date, item })));
}

export function findItem(payload: PlanPayload, itemId: string): PlannedItem | null {
  for (const bucket of bucketsOf(payload)) {
    const hit = bucket.items.find((i) => i.id === itemId);
    if (hit) return hit;
  }
  return null;
}

/**
 * Applies one amendment and revalidates. Returns a new payload; the input is
 * never mutated, so a rejected amendment leaves the stored plan untouched.
 *
 * `removed` and `skipped` both drop the item from the payload — a plan that
 * still lists work the student said they are not doing is a lie. The
 * distinction between them survives in `plan_amendments`, which is the only
 * place the end-of-week review reads anyway.
 */
export function applyAmendment(payload: PlanPayload, amendment: AmendmentInput): PlanPayload {
  const next = structuredClone(payload) as PlanPayload;
  const after = asObject(amendment.after);
  const itemId = amendment.itemId ?? null;

  switch (amendment.action) {
    case "completed":
      // Check-off is task state, not plan shape. The log entry is the record.
      break;

    case "added": {
      const item = plannedItemSchema.parse({
        ...after,
        id: typeof after?.id === "string" && after.id.length > 0 ? after.id : manualItemId(),
      });
      targetBucket(next, dateHint(after, item)).items.push(item);
      break;
    }

    case "removed":
    case "skipped": {
      if (!itemId) throw new AmendmentError(`${amendment.action} needs an itemId`);
      for (const bucket of bucketsOf(next)) {
        const at = bucket.items.findIndex((i) => i.id === itemId);
        if (at >= 0) bucket.items.splice(at, 1);
      }
      break;
    }

    case "rescheduled": {
      const found = locate(next, itemId, amendment.action);
      if (after && "startAt" in after) found.item.startAt = after.startAt as string | null;
      const moveTo = dateHint(after, found.item);
      if (moveTo && moveTo !== found.bucket.date) {
        found.bucket.items.splice(found.index, 1);
        targetBucket(next, moveTo).items.push(found.item);
      }
      break;
    }

    case "resized": {
      const found = locate(next, itemId, amendment.action);
      found.item.estimatedMinutes = normalisePositiveInt(after?.estimatedMinutes);
      break;
    }

    case "reordered": {
      const found = locate(next, itemId, amendment.action);
      const to = Number(after?.index);
      if (!Number.isInteger(to)) throw new AmendmentError("reordered needs after.index");
      found.bucket.items.splice(found.index, 1);
      found.bucket.items.splice(Math.max(0, Math.min(to, found.bucket.items.length)), 0, found.item);
      break;
    }
  }

  return planPayloadSchema.parse(next);
}

export class AmendmentError extends Error {}

// ── Internals ────────────────────────────────────────────────────────────────

function locate(
  payload: PlanPayload,
  itemId: string | null,
  action: string,
): { bucket: ItemBucket; item: PlannedItem; index: number } {
  if (!itemId) throw new AmendmentError(`${action} needs an itemId`);
  for (const bucket of bucketsOf(payload)) {
    const index = bucket.items.findIndex((i) => i.id === itemId);
    if (index >= 0) return { bucket, item: bucket.items[index]!, index };
  }
  throw new AmendmentError(`no item ${itemId} in this plan`);
}

/**
 * Where an added or moved item lands. A week plan needs a day; a day plan has
 * only the one bucket, so the hint is ignored there.
 */
function targetBucket(payload: PlanPayload, date: string | null): ItemBucket {
  const buckets = bucketsOf(payload);
  if (buckets.length === 0) throw new AmendmentError("this plan holds no items to amend");
  return buckets.find((b) => b.date === date) ?? buckets[0]!;
}

function dateHint(after: Record<string, unknown> | null, item: PlannedItem): string | null {
  if (after && typeof after.date === "string") return after.date;
  const startAt = item.startAt ?? (after?.startAt as string | undefined);
  if (typeof startAt === "string") {
    const at = new Date(startAt);
    if (!Number.isNaN(at.getTime())) return dateKey(at);
  }
  return null;
}

function asObject(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function normalisePositiveInt(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/** Student-added blocks need an id too; stability across re-proposals is moot
 * for one the model never wrote. */
function manualItemId(): string {
  return `m${randomBytes(6).toString("hex")}`;
}
