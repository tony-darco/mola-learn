# Integration checkpoint 1 — COMPLETE

All four Phase 1 branches merged into `dev` in order D → A → C → B.
**4/4 typecheck · 62 web tests · 21 ingest tests.**

## Resolved during the merge
- **`chat.tsx` conflict (A/D)** — kept A's shim, added `hideSidebar` to it and to
  `ChatShell`, added a `.chat-layout--bare` CSS variant. Combined both sides
  rather than taking either.
- **Chat-model divergence** — unified on `qwen3.5:27b`, the established
  project-wide default. `apps/ingest` had drifted to `qwen3.6:27b`; its measured
  178s timing was taken on 3.6 and is annotated as such. Env-overridable, so
  trivially reversible if 3.6 was deliberate.
- **`pnpm-lock.yaml`** — regenerated rather than hand-merged.
- **Ingest dev extras** — `[dependency-groups]` (PEP 735) moved to
  `[project.optional-dependencies]` so the README's documented
  `pip install -e ".[dev]"` actually resolves. It previously failed.
- **Stale `.next` types** — deleting routes leaves generated types behind that
  fail typecheck. `rm -rf apps/web/.next` before a post-merge typecheck.

## Found by smoke-testing the merged app (not by tests)

### `AUTH_SECRET` was undocumented — sign-up and sign-in were completely broken
62 passing tests, and the merged app could not authenticate anyone:
`MissingSecret: Please define a 'secret'`. Agent D had it in its gitignored
`.env.local`, so it worked on D's machine and nowhere else. It was mentioned in
the README but absent from `.env.example`.

Now in `.env.example` alongside `MOLA_ENCRYPTION_KEY`, which had the identical
problem. **Two independent instances of the same failure mode in one branch** —
a secret that lives only in an untracked file, where the test suite never
exercises the path that needs it. Worth a CI check that boots the app with only
`.env.example` populated.

### Sign-up is not atomic
The failed attempt still created the user row before erroring at the sign-in
step, leaving an orphaned account whose owner was told only "there was a problem
with the server configuration". A second attempt then reports "an account with
that email already exists", which is confusing and wrong from the user's side.
`signUpAction` should either roll back the insert when `signIn` fails, or treat
"row exists but no session" as recoverable. Minor — it only surfaces on
misconfiguration — but it is a real correctness gap.

## STILL OPEN — needs your decision
- **Contract-4 sub-agent gap** (below). Not blocking now; blocks Agent E.
- **Pointer-summary cost** (below). 88% of ingest wall-clock; a config change.

---

## Original notes


Findings the orchestrator verified independently, to be resolved at merge time.
Merge order per the plan: **D → A → C → B**.

## Open — needs a decision

### Two different chat models in one codebase
- Everything else (`.env.example`, `apps/web/.env.local`, `README.md`,
  `apps/web/lib/llm/ollama.ts`) defaults to **`qwen3.5:27b`**.
- `apps/ingest/ingest/config.py` and `apps/ingest/.env.example` default to
  **`qwen3.6:27b`**.

Both exist on the LAN host, so nothing is broken today — but two defaults for the
same role will drift. Pick one at merge. Note the choice interacts with the
performance finding below.

### Sub-agent events are unreachable from the agent loop — contract 4 gap
**Found by Agent A, verified by the orchestrator. This is a defect in Phase 0's
contract, not in anyone's Phase 1 work.**

`loop.ts:77` executes a tool as `const result = await tools.run(...)` — a plain
`Promise<unknown>`. `Tool.execute` has no way to emit intermediate stream events.
Meanwhile `subagent.ts` exports `streamSubagent()`, which yields `subagent_start`
and `subagent_end`, and contract 6 defines both events. Nothing can call it from
inside the loop, so **those two events can never fire.**

Why it matters: §4 says the flashcard skill runs inside a sub-agent *every time*,
including every amendment, and Agents G (quizzes) and H (mind maps) follow the
same skill-wraps-sub-agent pattern. All three will want the collapsed
"sub-agent working" row that the events exist to drive.

Not blocking checkpoint 1 — no Phase 1 tool spawns a sub-agent. **It must be
resolved before Agent E starts.**

Recommended fix (additive, does not break existing tools): add an optional
`emit?: (ev: StreamEvent) => void` to `ToolContext`. The loop passes one that
pushes into a queue it drains around the `await`. Tools that ignore it are
unaffected. The simple version surfaces events when the tool returns; real-time
streaming needs a promise-based async queue, roughly another 20 lines.

Agent A did the right thing here — flagged it rather than editing frozen code.

### Known merge conflict: `apps/web/app/chat.tsx` (Agents A and D)
Both agents changed the same file in incompatible directions. It will not
auto-merge, and the resolution is not "take one side".

- **D** extended it: added a `hideSidebar?: boolean` prop and a sign-out action,
  and passes `hideSidebar` from `app/(app)/courses/[id]/page.tsx:112` so the
  course detail page can reuse the chat composer without a second sidebar.
- **A** gutted it from 155 lines to 16, making it a compat shim over the new
  `components/chat/ChatShell.tsx` — deliberately, so that D's `page.tsx` (which
  A was told not to touch) kept working.

A anticipated the collision and left the shim for exactly this reason, but its
shim does **not** accept `hideSidebar`. Merge order is D → A, so A's version
lands last and D's course page then passes an unknown prop: a typecheck error,
and a duplicated sidebar if it were forced through.

**Resolution at merge:** keep A's shim, add `hideSidebar?: boolean` to its props,
and forward it into `ChatShell` (which needs to honour it). Small and
well-defined — but it must be done deliberately, not by picking a side.

### FIXED on `main`: un-timeouted fetch in both LLM providers
Agent C hit this as an indefinite hang in its golden-set harness, correctly
diagnosed it, worked around it from its own side, and flagged the real fix as
out of its scope. It was Phase 0 code, and on inspection it was worse than
reported:

- `ollama.ts` aborted only if a caller passed a signal. Nothing forced one.
- `embedding.ts` had **no signal at all** — a stalled host would block an ingest
  worker forever, with the job never failing, never retrying, and the document
  stuck in `indexing`.

Fixed on `main`:
- **Chat: an inactivity timeout, not a duration cap** (`OLLAMA_STALL_TIMEOUT_MS`,
  default 120s). A legitimate generation on a 27B reasoning model runs for
  minutes — B measured a single summary call at 178s — so a total cap would kill
  good requests. Silence is what is never legitimate. Composes with a
  caller-supplied signal so a client disconnect still aborts.
- **Embedding: a total cap** (`OLLAMA_EMBED_TIMEOUT_MS`, default 300s), which is
  the right shape for a single non-streaming request over a bounded batch.

Two regression tests, including the negative case: a slow-but-progressing stream
must survive a stall window it exceeds in total duration.

## Verified findings

### Pointer-summary generation dominates ingest cost
Measured on the real 20-page syllabus: **202s total, of which ~178s (88%) was a
single LLM call** to generate the pointer summary. Scan/sniff/policy/move was a
few seconds; extract + chunk + insert under 1s; embedding 37 chunks ~21s.

The cost is hidden reasoning tokens — a thinking model spends ~80s even on a
trivial prompt. Ingestion is async and off the interactive path (§7), so this
does not block a student. But it sets the floor on throughput: a course with 10
documents is ~30 minutes of mostly-idle waiting on one model call.

Worth considering at merge: a smaller non-thinking model for pointer summaries
specifically. The summary is a few paragraphs of description — it does not need
27B of reasoning. This is a config change, not a design change.

### Dedupe copies chunks rather than sharing them
`content_sha256` dedupe works and is fast (0.13s vs 202s). But each document row
gets its own copy of the 37 chunks rather than referencing a shared set. That
saves the *embedding* cost, which is the expensive part, and keeps ownership and
deletion simple — one document, one set of chunks, one `user_id`. It does not
save storage. Correct tradeoff for a pilot; note it before corpus size grows.

### ClamAV is real, not stubbed
Verified independently: `clamd` listening on 127.0.0.1:3310, EICAR detected
(`Infected files: 1`). A `StubScanner` exists for CI and is clearly labelled; it
is not what is wired up. Do not let the stub become the default in any
environment that accepts real uploads.

### Agent D's tests were environment-dependent (fixed)
D reported "32/32 green". Independently they were **3 failed / 29 passed**: the
api-keys tests read `MOLA_ENCRYPTION_KEY` from `.env.local`, which is gitignored,
so they passed only on the machine that wrote that file. Fixed on D's branch —
the test now generates a throwaway key, and the var was added to `.env.example`
where it was missing. Production behaviour is unchanged and still throws when the
key is absent, which is correct for encryption at rest.

Worth noting as a pattern: an agent verifying in its own environment can report
green on a suite that fails everywhere else.

### Contract-3 asymmetry holds on the document side
`grep -rn "Instruct:" apps/ingest/ingest/` returns only a docstring stating that
query prefixing belongs to Agent C. `embed_documents` sends raw chunk text with
`num_gpu: 0`. Agent C still needs verifying on the query side.
