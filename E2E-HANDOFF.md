# E2E suite vs. the Tailwind redesign — handoff

`dev` → `feat/e2e-tests`. The Playwright suite (4 commits, 7 spec files, 12
passed / 2 intentionally-failing when last run before this merge) was written
against the pre-redesign UI. `dev` has since absorbed a full Tailwind
rewrite of the chat UI (`feat/ui-tailwind-redesign`, merged as `8f557b5` —
see `UI-TAILWIND-HANDOFF.md`) plus an infra move (Docker → remote host) and
a chat-model swap. This document covers: how the merge went, what had to be
fixed just to get the suite running again, and an honest, per-test diagnosis
of the post-merge run — 11 failed, 3 passed. **None of the 11 failures were
fixed here** — that's explicitly the next agent's job. This is a diagnostic
map, not a repair.

## Merge

Chose **merge over rebase**: `dev` had moved 43 commits since this branch's
fork point, restructuring large parts of the app. Rebasing this branch's 4
commits onto that would mean re-resolving the same kind of conflict
repeatedly against a moving target; a single merge resolves it once.

Two conflicts, both mechanical:

- `apps/web/package.json` — both branches added `devDependencies`
  (`@playwright/test`/`postgres` here, `@tailwindcss/postcss`/`tailwindcss`
  on `dev`). Combined both lists.
- `pnpm-lock.yaml` — took `dev`'s version wholesale, then ran `pnpm install`
  to fold this branch's two added packages back in.

`apps/web/e2e/**` and `apps/web/playwright.config.ts` merged in purely
additively — dev never touched those paths, so there was nothing to resolve
there and nothing in this branch's scope required a judgment call. Merge
commit: `ca55299`.

**Verification after the merge:**
- `pnpm -r typecheck` — clean, after deleting a stale `apps/web/.next`
  build-cache directory left over from before the merge, which was still
  referencing the now-deleted `(app)/courses`, `(app)/profile`,
  `(chat)/chats/[chatId]` routes and failing with `TS2307` on all of them.
  Not a real error — a rebuild resolved it.
- `pnpm --filter @mola/web build` — clean. Confirms the old `/courses`,
  `/courses/new`, `/profile`, `/settings` routes are genuinely gone from the
  production route list, and the new `/chat` landing page is present.

## Infra plumbing fixed (commit `ce0d819`)

This is what it took to get the suite to the point where it could even
attempt to run — plumbing only, no spec logic touched:

- **`apps/web/.env.local`** (gitignored, not part of the commit):
  `DATABASE_URL` and `AWS_ENDPOINT_URL` were still pointing at `localhost`
  from before the Docker-to-remote-host move (`f73cc57`). Repointed both at
  `192.168.1.17` (`postgres://mola:REDACTED@192.168.1.17:5433/mola_e2e` and
  `http://192.168.1.17:4566`). `MOLA_CHAT_MODEL` was already `qwen3.6:27b`
  in this file — no change needed there.
  - Note for whoever sets this up on a fresh machine: `.env.example` and
    `README.md` on `dev` itself *still* say `localhost` for both of these —
    that's a pre-existing gap in the redesign branch's own docs, not
    something introduced or fixed here. Worth a one-line follow-up on `dev`
    at some point, but out of scope for this branch.
- **`mola_e2e` database didn't exist yet** on the remote Postgres. Created
  it, then had to manually `CREATE EXTENSION vector; CREATE EXTENSION
  pg_trgm;` — `infra/initdb/00-extensions.sql` only runs once, for the
  container's default database, at first container init; a database created
  later by hand doesn't get it. Migrations failed with `operator class
  "gin_trgm_ops" does not exist` until this was done. Then ran
  `db:migrate` and `db:seed` against it successfully.
- **`helpers.ts`**: fixed a comment describing "the target model" as
  `qwen3.5:27b` — that's now stale as a statement of current reality, so
  updated to `qwen3.6:27b`. Deliberately left the `qwen3.5:27b` reference in
  `tool-calls.spec.ts` alone (`"CONTRACTS.md records 3/3 clean tool-calling
  on qwen3.5:27b for this exact demo tool"`) — that one cites a specific,
  dated historical test result from CONTRACTS.md, and is still accurate as
  a historical claim, not a current one.
- `playwright.config.ts` needed no changes — it never hardcoded a
  connection string, only `baseURL`/port 3020.
- Confirmed via `infra/docker-remote.sh ps` that Postgres and LocalStack
  were already up and healthy on the remote host (another agent/session had
  them running); did not need `docker:up`.

## The run

```
DATABASE_URL=postgres://mola:REDACTED@192.168.1.17:5433/mola_e2e pnpm --filter @mola/web e2e
```

14 tests total, **11 failed, 3 passed**, 16.2 minutes. Full output, plus a
`page snapshot` and screenshot per failure, is in
`apps/web/test-results/` (gitignored, not committed — regenerate by
re-running).

**A process note for whoever runs this next**: pipe the run to a real log
file (`... > /tmp/e2e-run.log 2>&1 &`), not through `tail` in a backgrounded
shell — a `| tail -200` on a 16-minute run silently drops everything but the
last 200 lines, which is what happened on this run. The per-test diagnosis
below for the first six failures was recovered from
`test-results/*/error-context.md` (Playwright saves one per failure
regardless of what happened to stdout), not from the truncated log.

### Passed (3)

- `auth.setup.ts` — both "authenticate as alice" and "authenticate as bob".
  Worth flagging: I'd expected this to be a likely failure point going in —
  `(shell)/page.tsx` now does `redirect("/chat")` unconditionally, so a
  successful sign-in's `redirectTo: "/"` immediately triggers a *second*,
  server-side redirect to `/chat`, and I thought `page.waitForURL(url =>
  url.pathname === "/")` might never observe the intermediate `/` and hang.
  It didn't — Playwright's navigation tracking does catch the intermediate
  hop. Flagging this only so the next agent doesn't waste time
  re-suspecting it; checked, not an issue.
- `auth-and-ownership.spec.ts` › "Bob typing Alice's course/chat URLs
  directly gets 404" — the ownership boundary itself
  (`requireOwned`/`AuthzError` → `notFound()`, `apps/web/lib/auth/ownership.ts`)
  is untouched by the redesign and still enforces correctly end to end.

### Failed (11) — grouped by root cause

**A. Selector gone — the redesign dropped the CSS class the spec keys off,
component is otherwise fine (5 failures)**

The Tailwind rewrite replaced nearly every semantic class (`.turn-*`,
`.compacted-banner`, `.hint-*`, `.activity-row-*`, `.sidebar-*`,
`.flashcard`, `.quiz-*`, `.mind-map-*`) with inline Tailwind utility
classes and no `className` hook at all in most cases. Confirmed by reading
the component source directly, not just inferring from the error:

- `TurnView.tsx` — no class distinguishes a user turn from an assistant
  turn anymore (alignment is done with `items-end`/`items-start` on a
  wrapper div); `.turn-error` is gone too. The **only** old class that
  survives unchanged is `.markdown` (`Markdown.tsx` line 10 — still
  literally `className="markdown text-base"`).
- `compaction.spec.ts` — `.compacted-banner` (`CompactedBanner.tsx`) is
  gone; the button text it also depends on ("Show summary", "Show raw
  messages", "Collapse raw messages") is unchanged, so this is a pure
  selector fix, not a behavior question.
- `flash-flicker.spec.ts` — fails on `.turn-assistant .markdown` before it
  ever gets to check the actual flash/flicker behavior. **This means the
  one thing this spec exists to answer — did the persistent-shell rewrite
  fix the chat-switch flash/flicker bug — was not verified either way this
  run.** That's the highest-value rerun once the selector is fixed.
- `navigation.spec.ts` › "reloading mid-conversation restores history" —
  same `.turn-assistant .markdown` locator. Notable: the message send
  itself (a deliberately trivial "Just acknowledge this message…") *did*
  complete successfully and quickly in this run — the failure is purely the
  missing class, not a slow/broken backend. Contrast with hint-ladder,
  below.
- `navigation.spec.ts` › "sidebar list re-sorts…" — `.sidebar-chat-link`
  (`ChatLink.tsx`) is gone; chat links are still real `<a href="/chats/...">`
  elements, just with no class, so `getByRole('link')` + href matching
  would work as a replacement. (The specific behavior this test asserts —
  `chats.updatedAt` never bumping on send, so a chat you're actively in
  never sorts above one merely created earlier — is a real, previously
  logged bug this suite found; unrelated to the redesign and presumably
  still present, but unverifiable with the current locator.)

**B. Route gone — the spec targets a URL that no longer exists (2 failures,
plus a latent third)**

- `auth-and-ownership.spec.ts` › "an unauthenticated visitor to an (app)
  route is redirected to sign-in" — goes to `/courses` (no id) expecting
  `redirect("/sign-in")`. `apps/web/app/(shell)/courses/` now only has
  `[id]/page.tsx`; the bare route has no page at all, so it 404s directly
  (confirmed in the saved page snapshot: `heading "404"`) rather than
  hitting the shell layout's auth redirect. Needs a real course id, or
  `/chat`, as the target.
- `auth-and-ownership.spec.ts` › "sign-up …" — fails first on a minor text
  case mismatch (`"no chats yet"` vs. the actual, now-capitalized `"No
  chats yet"` in `Sidebar.tsx` line 140), which masks a second, deeper
  problem later in the same test that never got reached this run: it then
  goes to `/courses` to find a "Sign out" button. That page is gone (see
  above), and Sign out has moved — it's now inside the sidebar's profile
  dropdown (click the `"{email} ▸"` button, then "Sign out" in the menu
  that opens, `Sidebar.tsx` lines 193–200). Flagging both problems now so
  the fix for the first doesn't just uncover the second as a surprise.

**C. Flow moved entirely — the spec's helper drives a UI affordance that no
longer exists anywhere (2 failures)**

- `navigation.spec.ts` › "a new general chat lands in the general Chats
  section, a new course chat lands under its course" — two compounding
  problems, not one. First, `newCourseChat()` (`helpers.ts`) clicks
  `.sidebar-section-add`, a "+" button next to a course's section header in
  the sidebar — that concept doesn't exist anymore. Course-scoped chats now
  start from a composer on the course's own detail page
  (`NewCourseChatComposer.tsx`, used in
  `app/(shell)/courses/[id]/page.tsx`). Second, even independent of that:
  the sidebar no longer groups chats by course at all — it's one flat
  "Chats" list regardless of which course (if any) a chat belongs to;
  courses are now purely navigational links to their own hub page
  (`Sidebar.tsx` lines 120–145). So this test's entire premise (chats
  grouped under their course in the sidebar) is gone, not just its
  selectors — it needs to be redesigned around what "a course chat" now
  means in the UI, not patched.
- `tool-calls.spec.ts` — same `newCourseChat()` problem. Its click on
  `.sidebar-section-add` matches zero elements, and Playwright's
  auto-waiting click retries until the *test's own* timeout
  (`test.setTimeout(5 * 60_000)`) rather than failing fast — that's why
  this one shows as a 300-second timeout rather than an instant "element
  not found." Once `newCourseChat()` is rewritten to go through the course
  page's composer, the rest of this spec (`.activity-row-tool`,
  `.activity-detail`, `.markdown .activity-row` — all gone from
  `ActivityRow.tsx`, same story as group A) still needs the same selector
  rewrite as everything else.

**D. Landing behavior changed, spec's starting assumption is now false (2
failures)**

- `artifacts.spec.ts` — `page.goto("/")` now lands on the new `/chat`
  landing page ("Ready to get started"), which has no active chat and
  therefore no composer — and the dev-only "Preview artifact renderers"
  button only exists inside `ChatMain` (an actual open chat), never on the
  landing page. Confirmed in the saved page snapshot: sidebar renders fine,
  main pane shows only the landing heading and a `NewCourseChatComposer`
  -style start box. The spec needs to open or create a chat before this
  button is reachable at all.
- `auth-and-ownership.spec.ts` › "an unauthenticated visitor to the chat
  root sees no protected content" — this one is a **behavior improvement**,
  not a regression, and the original spec even flagged the bug it's now
  asserting against: `/` and `/chats/[id]` used to render an inline "Not
  signed in" message with a 200 status when signed out, instead of a real
  server redirect like the rest of the `(app)` routes did. The persistent
  shell's `(shell)/layout.tsx` now does `redirect("/sign-in")` for
  *every* route in the group, including root — so a signed-out visit to
  `/` now correctly 302s to a real sign-in page. The old assertion
  (`expect(resp?.status()).toBe(200)`, body contains "Not signed in") is
  simply testing for the bug that's been fixed. Needs a new assertion for
  the corrected behavior, not a selector fix.

**E. Genuinely uncertain — possibly real latency, not (yet) proven broken
(1 failure)**

- `hint-ladder.spec.ts` — the very first message send in the test
  (`sendMessage`, a substantive Socratic-style question) left the composer
  disabled for the full 120-second `LLM_TIMEOUT_MS` budget and never
  re-enabled; the test failed there, before reaching any hint-specific
  logic or selector. This is **not** the same failure mode as the
  selector-gone group above — `Promise.all` in `triggerTurnAndWait` had
  already resolved past `page.waitForResponse` (the POST's response
  headers did come back) by the time it timed out waiting for the input to
  re-enable, meaning the SSE stream itself was still open past 120s, not
  that the request never went out.
  - I manually confirmed the Ollama host is reachable and responsive right
    now (`curl http://192.168.1.17:11434/api/tags` returns cleanly), and a
    trivial `qwen3.6:27b` completion ("say hi in one word") took ~17s
    including thinking-mode reasoning tokens. A real Socratic hint response
    — full system prompt, thinking mode, possibly retrieval — plausibly
    runs well past 120s on this model, especially since `LLM_TIMEOUT_MS`
    was tuned against the retired `qwen3.5:27b`, not `qwen3.6:27b`.
  - Circumstantial support for "just slow, not broken": in the same run,
    `navigation.spec.ts`'s reload test sent a deliberately trivial
    one-line message and it completed normally well within budget — so the
    send→respond→re-enable pipeline does work; it's specifically a
    complex-prompt latency question.
  - I could not fully resolve this from logs alone. **Recommend the next
    agent manually send a comparable real question in a live browser tab
    and time it end-to-end** before deciding whether to just raise
    `LLM_TIMEOUT_MS`, or whether there's an actual regression in how the
    redesigned `ChatMain` clears its `disabled` state after a stream ends.

## What's confirmed still working, unprompted

Useful for whoever rewrites these — locators that survived the rewrite and
don't need to change:

- `.markdown` (the one surviving content class)
- Role/text locators: `getByRole("button", { name: "Send", exact: true })`,
  `"+ New chat"`, `getByPlaceholder("Ask about your course…")`,
  `getByLabel("Email"/"Password"/"Name")` on sign-in/sign-up
  (`(auth)` route group is untouched by the redesign)
- Chat links are still real `<a href="/chats/{id}">` elements with the
  chat's title as their accessible name — `getByRole("link", { name:
  <title> })` and `a[href="/chats/${id}"]` both still work
  (`ChatLink.tsx`)
- The hint ladder's `aria-label="Hint N of 3"` is preserved exactly
  (`HintControl.tsx` line 41) — only the `.hint-dots` class wrapping it is
  gone; the aria-label itself is a fine replacement locator
- `aria-expanded` on the activity-row's toggle button (`ActivityRow.tsx`
  line 33) survives, even though `.activity-row-*` classes don't
- The cross-user ownership boundary (404-not-403, real vs. missing id
  indistinguishable) is completely unaffected by the UI work
- `/api/chat` (list) and `/api/chat/:id` (POST for a turn) response shapes
  are unchanged — `pullHint()`'s SSE-body regex parsing needs no changes

## Prioritized punch list for the next agent

1. **`helpers.ts` first** — `lastAssistantReply`, `newCourseChat`,
   `triggerTurnAndWait`'s locators are shared by most specs; fixing the
   class names there (or switching to role/text locators per the survivors
   list above) unblocks compaction, flash-flicker, hint-ladder,
   navigation's reload test, and tool-calls in one pass. `newCourseChat`
   specifically needs a real rewrite (navigate to the course page, drive
   `NewCourseChatComposer`), not just a class swap.
2. **Decide what "navigation.spec.ts's first test" should even assert now**
   — the course-grouped-sidebar premise is gone; this needs a product
   decision (what does "lands under its course" mean when the sidebar
   doesn't group by course anymore?) before it needs code.
3. **Re-run `flash-flicker.spec.ts` once its selectors are fixed** — this
   is the one spec whose entire reason for existing (verify the flash/flicker
   fix) is still an open question after this run, not a closed one.
4. **Resolve the hint-ladder timeout question** (group E above) with a
   manual timed test before touching that spec's code — raising
   `LLM_TIMEOUT_MS` blind, without knowing whether it's genuinely just slow
   vs. a real regression, risks masking a bug.
5. **`auth-and-ownership.spec.ts`**: fix the "no chats yet" case mismatch,
   redirect the sign-up test's sign-out check away from the dead `/courses`
   route to the sidebar profile menu, and rewrite the signed-out-root test
   to assert the new (better) redirect-to-sign-in behavior instead of the
   old inline-message behavior.
6. **`artifacts.spec.ts`** — open/create a chat before reaching for the
   "Preview artifact renderers" button; selectors inside the artifact
   renderers themselves (`.flashcard`, `.quiz-*`, `.mind-map-*`) are all
   gone too and need role/text-based replacements, same pattern as
   everywhere else.
