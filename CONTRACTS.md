# CONTRACTS.md — frozen interfaces

**Read-only to agents.** If your workstream needs one of these to change, stop and
escalate to Tony. Do not change it unilaterally and do not work around it locally —
a divergent copy is the exact failure this file exists to prevent.

Everything here ships as working code with passing tests, not as type shapes.
Run `pnpm --filter @mola/web test` before and after your changes.

---

## 1 — Database schema
`packages/db/src/schema.ts` (product) · `packages/db/src/auth-schema.ts` (Auth.js)

- Every user-owned table carries `user_id` **directly**, so the §9 check is one
  predicate rather than a join walk. Keep this true for any table you add.
- `courses.summary` is the **single source of truth**. Layer 1 reads the same row
  the course detail page renders and the student edits. Do not cache it anywhere.
- Migrations: `pnpm db:generate` → review the SQL → `pnpm db:migrate`. Never
  hand-edit an applied migration.
- **`document_chunks.embedding` does not exist yet** — see contract 3.

## 2 — Ownership check
`apps/web/lib/auth/ownership.ts` → `requireOwned(kind, id, session?)`

Every route that loads a resource by id calls this. No route hand-rolls the check.

- Logged out → `401`. Owned by someone else → `404`. Missing → `404`.
  Foreign and missing are **deliberately indistinguishable** so the endpoint
  cannot be used to probe which ids exist.
- `lib/auth/session.ts` is a **dev shim** and throws at import in production.
  **Agent D** replaces its body with Auth.js v5 and deletes `app/api/dev-login/`.
  The `getSession(): Promise<Session | null>` signature does not change.

## 3 — Model abstraction (two interfaces, deliberately split)
`apps/web/lib/llm/types.ts`

```ts
interface LLMProvider       { stream(req): AsyncIterable<ProviderStreamEvent> }  // BYOK
interface EmbeddingProvider { embed(texts): Promise<number[][]> }                // platform
```

The split **is** the enforcement. The BYOK path has no `embed` method, so ingest
embeddings cannot be billed to a student's key by accident. Do not add `embed` to
`LLMProvider` and do not let a user-supplied key reach `EmbeddingProvider`.

No provider SDK is imported outside `lib/llm/`. Get a provider via
`getChatProvider(userId)` — never construct one directly.

> ### ⚠ BLOCKED: `EMBEDDING.dim` (plan item S1.4)
> `packages/shared/src/embedding.ts` has `model: null, dim: null`, and
> `requireEmbeddingConfig()` throws. This is deliberate — the width is permanent
> once migrated, and it is pending a benchmark of 2–3 candidates against ~20 real
> syllabus questions.
>
> **Agents B and C:** build everything else; the vector tool degrades to
> grep/BM25 until the column exists. Do not pick a dimension to unblock yourself.

## 4 — Agent loop, tool registry, sub-agent spawner
`apps/web/lib/agent/{loop,registry,subagent}.ts`

- Register tools in `lib/agent/tools/index.ts` via `buildRegistry()`. Do **not**
  construct your own `ToolRegistry` — Layer 3's catalog and the provider's tool
  specs are generated from this one, and a second registry silently desyncs them.
- `description` is the single line injected into Layer 3. Keep it to one line.
- Sub-agents (`runSubagent`) start from a blank context, get a restricted
  `toolAllowlist`, and return only a final result. Use one wherever intermediate
  retrieval or drafting noise would otherwise land in the parent conversation.
- A sub-agent **returns** an artifact envelope; it never writes to the artifacts
  table itself. The parent loop persists, so ownership stamping stays in one place.

## 5 — Context assembler
`apps/web/lib/context/assemble.ts` → `assembleContext(input): AssembledContext`

Five ordered layers. **1–4 are deterministic and always loaded**; only layer 5 and
retrieval results are judged for relevance.

| Layer | Content | Owner |
|---|---|---|
| 1 Identity | student, enrolled courses, active course summary | done |
| 2 Calendar | today / this week / semester | **STUB — Agent J** |
| 3 Catalog | tool + document names and one-line descriptions | done |
| 4 Rules | Socratic base + hint rung + per-course override | skeleton — **Agent F** |
| 5 History | raw recent turns + compaction summaries | done |

Fill in a stub; do not change the return shape or the layer order.

## 6 — Artifact schema + stream taxonomy
`packages/shared/src/artifacts.ts` · `packages/shared/src/stream.ts`

- **Agents E, G, H** produce artifacts; **Agent A** renders them. All four code
  against these types. Add a new artifact kind by extending the discriminated
  union here first — never by widening a `payload` to `any`.
- A tool result is an artifact iff it carries `__artifact: true`
  (`isArtifactToolResult`). Anything else is treated as text.
- `StreamEvent` is the server→client rendering contract. Emit only these events.
- `ArtifactRecord` is **self-contained**: the Artifacts page reconstructs an
  artifact without replaying the chat it came from. Keep it that way.

---

## Rules that are not interfaces but are still frozen

- **Hints are student-pulled.** Nothing advances a hint rung on a timer or an
  attempt count. `escalate()` is called only in response to an explicit pull (§3).
- **The retrieval agent never guesses.** It reads `documents.status` and degrades
  to grep/BM25 when a document is not `ready`, and says what it could not search (§6).
- **The scanner is the only component that moves objects between S3 buckets.**
  Nothing downstream ever reads from RAW (§12).
- **Ingest is triggered by the `jobs` table in Phase 1** — one trigger, not two.
  Keep the worker entrypoint clean so Phase 3 can swap in S3 events as wiring.
- **API keys are never returned to the client after save**, and never logged (§9).

## Working agreement

- Branch off `dev`, one feature branch per workstream, merge at checkpoints.
- **Rebase from `dev` whenever a dependency you consume lands** — this is not
  gated by the checkpoint. A two-week-old fork of a contract file is expensive.
- Ownership-check coverage is a required test for any new resource route.

---

## Known issues

*(none open)*

**Resolved — tool calls leaking as text.** Seen once with `llama3.2` on a compound
question: the model emitted `{"name": "read_course_fact", ...}` as message content
instead of a structured `tool_calls` field, and it streamed to the user as visible
JSON. Re-tested on the target model `qwen3.5:27b`: 3/3 clean, two correctly
structured calls each. Small-model artifact, not a loop defect. No fix was written.

**Resolved — the model announced the hint rung.** `qwen3.5:27b` opened replies with
"Let me help with a **teaching hint**" and "**Bottom-Out Hint:**", which tells the
student they are being walked up a ladder. `SOCRATIC_BASE` in
`lib/context/hint-ladder.ts` now forbids naming the scaffolding; re-tested 3/3 clean
across all three rungs. **Agent F**, keep that rule when you build out the full
rulebook — it is easy to lose in a rewrite.
