# Agent J — Calendar, Schedule and Planning

Frozen interfaces for the five parallel J workstreams. **Read this; do not edit
it.** A contract change is escalated to the orchestrator, not made unilaterally
— that rule is what made the Phase 1 four-way merge clean, and it applies here.

Base branch: `feat/agent-j-calendar` (already contains everything below).

---

## What is being built, and why

The product already has courses, documents, retrieval, chat, flashcards,
quizzes and mind maps. What it does not have is any sense of *when*. Layer 2 of
the context assembler — "today / this week / semester" (§5) — has been a stub
since Phase 0, which means the tutor has never known that a quiz is Thursday or
that two deadlines collide tomorrow.

This workstream fills that in end to end:

1. **Ingest** real dates — Blackboard-style ICS feed (§10 Tier 1) and Google
   Calendar `events.watch` (Tier 2).
2. **Show** them — a real calendar surface with month / week / day views.
3. **Reason** over them — a planning loop that proposes a semester plan, a week
   plan and daily plans, each through a propose → amend → accept gate.
4. **Feed them back into context** — Layer 2 stops being a stub, and the tutor
   gets tools to read the schedule mid-conversation.

The end state Tony described: opening the app says "your OS project is due
Thursday and you have a quiz the same morning — want to work on it?", and the
plan tab can offer a practice quiz for an upcoming exam or surface the
flashcards made earlier in the semester.

---

## Ground rules (all agents)

- **Never** modify `CONTRACTS.md`, `packages/db/src/schema.ts`,
  `packages/shared/src/planning.ts`, or anything under `apps/web/lib/jobs/`
  except your own handler file. These are frozen for this workstream.
- **Every** resource route goes through `requireOwned` / `requireSession`
  (`apps/web/lib/auth/ownership.ts`). §9 is a hard requirement: a schedule item,
  plan or task loaded by id must be checked server-side against the session
  user. Ownership coverage is a required test, not an optional one.
- Match the existing code's voice. Comments explain *why*, never *what*; if a
  line is self-evident, leave it uncommented. Look at
  `apps/web/lib/agent/registry.ts` or `apps/ingest/ingest/pipeline.py` for the
  register.
- Tailwind, using the existing semantic tokens (`bg-surface`, `text-fg`,
  `text-fg-muted`, `border-border`, `bg-accent`, `text-accent-fg`). No raw hex,
  no emoji in UI copy. Light and dark both have to work.
- `data-testid` on anything a test would want to select.
- Run `pnpm --filter @mola/web typecheck` and `pnpm --filter @mola/web test`
  before you report done. Both must be clean. Report honestly if they are not.

## Your environment

Each agent has its own worktree and its own database — nothing you do can
disturb another agent.

```bash
# your worktree already has apps/web/.env.local pointing at your own DB
pnpm --filter @mola/db migrate     # already applied, safe to re-run
pnpm --filter @mola/db seed        # alice@umbc.edu / mola-dev-password
pnpm --filter @mola/db seed:calendar   # 35 mock events on the CURRENT week
```

`seed:calendar` builds the fixture semester relative to today: MWF CMSC 421
lectures, TTh MATH 221 lectures, a quiz Thursday, two deadlines colliding the
following Thursday, two midterms, work shifts, a study group, and two
already-completed assignments. Re-running reshuffles it onto the current week.

---

## Frozen contract A — database

Already migrated. Read `packages/db/src/schema.ts` for the authoritative
version; the shape you need to know:

**`schedule_items`** — the calendar row. Pre-existing columns
(`userId`, `courseId`, `kind`, `source`, `title`, `dueAt`, `rrule`,
`externalId`) plus, new for J: `calendarSourceId`, `startAt`, `endAt`,
`allDay` (0/1 integer), `location`, `description`, `completedAt`,
`externalUpdatedAt`.

- `kind`: `deadline | recurring_task | study_session | class | exam | assignment | event`
- `source`: `ics | google | student | chat | plan`
- A pure deadline sets only `dueAt`. A span sets `startAt`/`endAt`. **Render
  `startAt ?? dueAt`** — never branch on kind to find the time.
- `uniqueIndex(userId, source, externalId)` is the sync dedupe key.

**`calendar_sources`** — one row per feed. `kind` (`ics | google`), `name`,
`url`, `googleCalendarId`, `status` (`active | error | expired | disabled`),
`lastSyncedAt`, `lastSyncError`, `syncToken`, `channelId`,
`channelResourceId`, `channelExpiresAt`.

**`google_credentials`** — encrypted OAuth refresh token, same discipline as
`api_keys`: ciphertext only, never logged, never returned to the client. Use
the existing `encryptSecret`/`decryptSecret` in `apps/web/lib/auth/crypto.ts`.

**`plans`** — `horizon` (`day | week | semester`), `periodStart`, `periodEnd`,
`status` (`proposed | approved | amended | superseded`), `payload` (jsonb),
`parentPlanId`, `approvedAt`, `supersededByPlanId`.

**`plan_amendments`** — the amendment log. `planId`, `itemId`, `action`
(`added | removed | rescheduled | resized | completed | skipped | reordered`),
`before`, `after`, `reason`. **This table is the §5 feedback loop**: the
end-of-week review reads the *pattern* here, not a diff of overwritten
payloads.

**`tasks`** — the check-off unit. `courseId`, `planId`, `planItemId`,
`scheduleItemId`, `title`, `notes`, `status` (`todo | done | skipped`),
`source` (`plan | student | agent`), `scheduledFor`, `estimatedMinutes`,
`completedAt`. `uniqueIndex(planId, planItemId)` stops a re-propose from
duplicating tasks.

## Frozen contract B — payload types

`packages/shared/src/planning.ts`, exported from `@mola/shared`. Zod schemas
*and* inferred types for `PlannedItem`, `DayPlanPayload`, `WeekPlanPayload`,
`SemesterPlanPayload` (discriminated on `horizon`), plus the `CalendarEvent`
and `TaskView` read models and `CALENDAR_JOB_KINDS`.

Validate with the zod schemas at every boundary where an LLM produced the
payload. A model will eventually emit a malformed plan; it must fail at the
parse, not three screens later in a renderer.

## Frozen contract C — the job worker

`apps/web/lib/jobs/`. Shares the existing `jobs` table with the Python ingest
worker, which claims only `ingest_document`; this worker claims only
`CALENDAR_JOB_KINDS`. **Do not add a second queue.**

- `worker.ts` exports `runOneJob()`, `runDueJobs(limit)`, `enqueueJob(...)`,
  `hasDueJobs(kinds)`. Claim uses `FOR UPDATE SKIP LOCKED`; failures retry with
  capped exponential backoff; `PermanentJobFailure` fails without retry.
- `handlers/<kind>.ts` — one file per kind, already stubbed. **Fill in only the
  files assigned to you.** Do not touch `handlers.ts` (the index) — every kind
  is already wired.

`runDueJobs()` is deliberately callable from a page load, not just a daemon.
That is how §5's "if the app isn't opened Sunday, the proposal persists and is
presented on next open" works on a dev box with no worker running.

---

## Workstream split — file ownership

Ownership is exclusive. If you need something outside your list, it is either
already built for you or it is a contract change to escalate.

### J1 — Calendar ingestion (ICS + Google)
```
apps/web/lib/calendar/**            (ics parsing, sync, google client)
apps/web/app/api/calendar/sources/**
apps/web/app/api/calendar/google/**
apps/web/lib/jobs/handlers/calendar-sync-ics.ts
apps/web/lib/jobs/handlers/calendar-sync-google.ts
apps/web/lib/jobs/handlers/calendar-renew-watch.ts
apps/web/components/calendar/SourcesPanel.tsx   (feed management UI only)
apps/web/tests/calendar-ics.test.ts
```

### J2 — Calendar UI
```
apps/web/app/(shell)/calendar/**
apps/web/components/calendar/**     (EXCEPT SourcesPanel.tsx, which is J1's)
apps/web/app/api/calendar/events/route.ts
apps/web/tests/calendar-events.test.ts
```

### J3 — Planning engine
```
apps/web/lib/planning/**
apps/web/app/api/plan/**
apps/web/app/api/tasks/**
apps/web/lib/jobs/handlers/plan-week-propose.ts
apps/web/lib/jobs/handlers/plan-day-propose.ts
apps/web/lib/jobs/handlers/plan-week-review.ts
apps/web/tests/planning.test.ts
```

### J4 — Plan UI, tasks and home nudges
```
apps/web/app/(shell)/plan/**
apps/web/components/plan/**
apps/web/components/chat/NextUpPanel.tsx        (the home-screen nudge)
apps/web/tests/plan-ui.test.ts
```
J4 also makes the two small shared edits nobody else may touch:
`components/chat/Sidebar.tsx` (turn the "Plan"/"Schedule" placeholders into
links) and `app/(shell)/chat/page.tsx` (mount `NextUpPanel`).

### J5 — Context layer and agent tools
```
apps/web/lib/context/assemble.ts    (buildLayer2 ONLY — leave layers 1,3,4,5 alone)
apps/web/lib/agent/tools/calendar.ts
apps/web/lib/agent/tools/index.ts   (registration lines only)
apps/web/tests/calendar-tools.test.ts
```

---

## Frozen contract D — HTTP API

J2 and J4 render what J1 and J3 write, in parallel, so these shapes are fixed
in advance. Types come from `@mola/shared` where one exists.

### `GET /api/calendar/events?from=<ISO>&to=<ISO>&courseId=<uuid?>`
`200 → { events: CalendarEvent[] }` — `CalendarEvent` exactly as exported from
`@mola/shared`. Scoped to the session user. Owner: **J2**.

### `PATCH /api/calendar/events/:id`
Body `{ completedAt?: string | null }` → `200 { event: CalendarEvent }`.
Homework check-off from the calendar. Owner: **J2**.

### `GET /api/calendar/sources` → `200 { sources: CalendarSourceView[] }`
### `POST /api/calendar/sources` body `{ kind: "ics", name, url }` → `201 { source }`
### `DELETE /api/calendar/sources/:id` → `204`
### `POST /api/calendar/sources/:id/sync` → `202 { queued: true }`
`CalendarSourceView = { id, kind, name, url, status, lastSyncedAt, lastSyncError, channelExpiresAt, eventCount }`.
Owner: **J1** (define the type in `lib/calendar/types.ts` and export it).

### `GET /api/plan?horizon=day|week|semester&date=<YYYY-MM-DD?>`
`200 → { plan: PlanRecord | null }` where
`PlanRecord = { id, horizon, periodStart, periodEnd, status, payload, approvedAt, parentPlanId }`.
Returns the *current* plan for that horizon and date — proposed or approved.
Owner: **J3**.

### `POST /api/plan/propose` body `{ horizon, date? }` → `202 { queued: true }` or `200 { plan }`
Generates (or regenerates) a proposal. Owner: **J3**.

### `POST /api/plan/:id/accept` → `200 { plan }`
Sets `status: "approved"`, stamps `approvedAt`, materialises the payload's
items into `tasks` rows (idempotent on `(planId, planItemId)`). Owner: **J3**.

### `POST /api/plan/:id/amend`
Body `{ amendments: { itemId?, action, before?, after?, reason? }[] }` →
`200 { plan }`. Writes `plan_amendments` rows **and** applies the change to the
payload. Sets `status: "amended"`. Owner: **J3**.

### `GET /api/tasks?date=<YYYY-MM-DD>&status=<todo|done|skipped>&courseId=<uuid?>`
`200 → { tasks: TaskView[] }`. Owner: **J3**.

### `POST /api/tasks` body `{ title, courseId?, scheduledFor?, estimatedMinutes?, notes?, scheduleItemId? }` → `201 { task }`
### `PATCH /api/tasks/:id` body `{ status?, title?, notes?, scheduledFor?, estimatedMinutes? }` → `200 { task }`
Flipping `status` to `done` stamps `completedAt` server-side and, when the task
came from a plan, writes a `completed` amendment. Owner: **J3**.

---

## Frozen contract E — agent tools (J5)

Registered through the existing `ToolRegistry` (contract 4). Names and
one-line descriptions are what Layer 3 injects, so keep them short and true.

| Tool | Purpose |
|---|---|
| `read_schedule` | Upcoming classes, deadlines and exams in a date window. |
| `read_plan` | The current day or week plan, with its items. |
| `add_schedule_item` | Record a date the student mentions in conversation (`source: "chat"`). |
| `complete_task` | Check off a task the student says they finished. |

`add_schedule_item` and `complete_task` are **writes driven by conversation**.
They must go through `requireOwned`, and they must not invent dates: if the
student says "sometime next week", the tool asks rather than guessing a day.

## Frozen contract F — Layer 2 (J5)

`buildLayer2` currently returns a hardcoded stub. Replace it so it reads real
data, keeping the three-horizon shape (§5):

```
# Schedule
## Today        → today's approved day plan + anything due today
## This week    → this week's plan focus, deadlines, exams
## Semester     → milestones beyond the two-week horizon
```

Keep it *tight* — this is stamped into every single request. Summarise; do not
dump the whole calendar. If there is no plan yet, say so plainly rather than
inventing one, and never fabricate a date that is not in `schedule_items`.

---

## Google Calendar — the honest constraint

Tier 2 needs an OAuth client that only Tony can create in Google Cloud Console.
Build the whole path — authorize redirect, callback, token exchange, encrypted
refresh-token storage, `events.list` incremental sync with `syncToken`,
`events.watch` registration, the webhook receiver, and the renewal job driven
by `channelExpiresAt` — but gate it on `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.

When those are unset the UI must say Google Calendar is not configured and
point at the setup steps; it must not show a broken button. Document the exact
setup in `GOOGLE-CALENDAR-SETUP.md`. **Test the sync logic against recorded
fixtures, not the live API** — nobody can authorize an OAuth consent screen at
3am, and a test that needs a human is a test that never runs.

The renewal job is the part that actually matters: a lapsed channel stops
delivering **silently** (§10, §15.3). `status: "expired"` must become visible
in the UI, and the renewal must run from `channelExpiresAt`, not from a guess.
