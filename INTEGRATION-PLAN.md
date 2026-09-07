# Agent J — integration plan (orchestrator notes)

Written before the five agents reported, so the merge doesn't get improvised at
4am. Update as results land.

## State at fan-out

- Base branch `feat/agent-j-calendar` @ `c0917fa` (foundation + worker entrypoint).
- Five worktrees, each its own branch and its own database:

| Agent | Branch | Worktree | DB | Scope |
|---|---|---|---|---|
| J1 | `feat/agent-j1` | `agent-j1` | `mola_j1` | ICS + Google ingestion, source CRUD, 3 job handlers |
| J2 | `feat/agent-j2` | `agent-j2` | `mola_j2` | `/calendar`, month/week/day, events API |
| J3 | `feat/agent-j3` | `agent-j3` | `mola_j3` | planning engine, plan/task API, 3 job handlers |
| J4 | `feat/agent-j4` | `agent-j4` | `mola_j4` | `/plan`, tasks UI, `NextUpPanel`, sidebar links |
| J5 | `feat/agent-j5` | `agent-j5` | `mola_j5` | Layer 2, 4 agent tools |

## Merge order

`J1 → J3 → J5 → J2 → J4`

Producers before consumers, so each merge is verifiable on its own:
J2 imports J1's `SourcesPanel`; J4 renders J3's API; J5 calls J3's amendment
helper. Merge into `feat/agent-j-calendar`, verify, then one merge into `dev`.

## Known reconnection points (deliberate TODOs left at fan-out)

1. **J2 → J1**: `components/calendar/SourcesPanel.tsx` is J1's file, imported by
   J2's `/calendar` page. J2 was told to write the import and leave a TODO if
   the file isn't in its worktree. Confirm the import resolves post-merge.
2. **J5 → J3**: `complete_task` must go through J3's amendment-writing helper in
   `lib/planning/`. J5 was told to isolate that behind one function with a TODO.
   Reconnect it — a completion that skips the amendment log silently breaks the
   end-of-week review, which is the §5 feedback loop.
3. **J4 → J3**: J4 built its UI against contract D's shapes without J3's routes
   present. Verify every route/field lines up; fix on J3's side if they diverge,
   since the contract is the spec.

## Orchestrator-owned work still to do at integration

- [ ] **Wire `runDueJobs` on app open.** Nobody owns this. Add to
      `app/(shell)/layout.tsx` (or a small server helper it calls): drain due
      calendar/planning jobs, then `ensurePlansForToday(userId)` from J3. This
      is what makes "if the app isn't opened Sunday, the proposal persists and
      is presented on next open" (§5) true without a daemon. Must be
      fire-and-forget — never block first paint on an LLM plan generation.
- [ ] **Migration renumbering.** The J foundation added
      `0007_heavy_william_stryker.sql`. Another session has an *uncommitted*
      `0007_yummy_harry_osborn.sql` (textbook chapters) in the main checkout.
      Whichever lands second must be renumbered and its snapshot regenerated,
      and `meta/_journal.json` merged by hand. Check `dev`'s journal at merge
      time; do NOT blind-merge that file.
- [ ] **Sidebar conflict watch.** J4 edits `components/chat/Sidebar.tsx`; the
      other session may too. Small file, resolve by hand.
- [ ] **Re-run the full suite on the integrated branch**, not just per-agent:
      `pnpm --filter @mola/web typecheck && pnpm --filter @mola/web test`,
      plus `pytest` in `apps/ingest` if schema changes touched it (they
      shouldn't — J is additive).
- [ ] **Look at it in a browser.** Sign in as `alice@umbc.edu` /
      `mola-dev-password`, walk: `/calendar` (all three views) → `/plan`
      (propose → amend → accept) → new-chat landing (`NextUpPanel`) → ask the
      tutor "what's due this week?" and confirm Layer 2 + `read_schedule` make
      it answer from real data.
- [ ] **Consider e2e specs** for the two new surfaces, matching
      `apps/web/e2e/`'s existing style. Nobody was assigned these.

## Codebase trap found during J2 verification — check every agent's UI for it

**Do not use Tailwind's `dark:` variant in this codebase.** It keys off the OS
`prefers-color-scheme`, but the default "Mola" theme is light-only and ignores
that entirely (only the "inspired" theme responds to it — see `globals.css`).
So on any machine set to dark mode, `dark:` utilities win while the page is
still rendering the light palette. In J2's calendar this made every event chip
nearly invisible.

The fix pattern: let colour carry the CATEGORY (background wash, dot, border)
and let the theme's own `text-fg` / `text-fg-muted` tokens carry the contrast.

My own J-CONTRACTS.md told the agents "light and dark must both work", which
pointed them straight at this. Grep each branch for `dark:` at integration and
fix any text-colour pair the same way. Pre-existing `text-red-600
dark:text-red-400` error text is left alone — it matches what the rest of the
codebase already does.

## Verification discipline

Do not trust an agent's "green" report. For each branch, independently run
typecheck and the test suite in that worktree before merging, and read the diff
for anything touching files outside its ownership list. This has caught real
problems in every prior phase of this project.

## Cleanup after merge

Worktrees `agent-j`, `agent-j1..j5`; branches `feat/agent-j`, `feat/agent-j1..j5`;
databases `mola_j`, `mola_j1..j5`. Remove only once merged into `dev` and
verified.
