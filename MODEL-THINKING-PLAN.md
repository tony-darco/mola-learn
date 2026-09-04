# Model switcher + thinking toggle — plan for review

Status: **prep only, nothing built.** Written from `feat/model-thinking-controls`
in its own worktree, branched off `dev` at `807e0ab`. This document proposes
scope and flags the real decisions; it is not an implementation.

## What you asked for (from the reference screenshots + description)

A pill button at the bottom-right of every composer — both the empty
"Ready to get started" landing composer and the in-conversation composer —
showing the current model. Clicking it opens a panel listing the available
models, with a row below the list where the reference has "Effort: High >"
replaced by a **Thinking: On/Off** row.

Models are predefined for this pass, Ollama only (no live discovery from a
provider API yet):

- `qwen3.6:27b` — the current platform default
- `RNJ-1` — Essential AI, 8B, code/STEM-optimized (exact Ollama pull tag TBD —
  still being pulled onto 192.168.1.17 as of this writing, so it won't show up
  in `ollama list` yet)
- `gemma4:26b`
- `gemma4:12b`
- `qwen3.8:27b`

## Current state, as it actually is in the code (not assumed)

I read the live files rather than guess. Two things change the shape of this
task:

**There is no per-request model selection today, anywhere.** `OllamaProvider`
(`apps/web/lib/llm/ollama.ts:30`) takes its model as a **constructor** argument,
defaulting to `DEFAULT_CHAT_MODEL` (env `MOLA_CHAT_MODEL`, currently
`qwen3.6:27b`). `CompletionRequest` (`apps/web/lib/llm/types.ts`) — the shape
every provider's `.stream()` receives — has no `model` field at all. There is
exactly one call site that matters for user-facing chat:
`apps/web/app/api/chat/[chatId]/route.ts:103`, `getChatProvider(session.userId)`.
It already has `chatId` and the loaded `chat` row in scope, which matters below.

**Two files here are explicitly marked FROZEN, with rationale comments
explaining why:**
- `apps/web/lib/llm/types.ts` — "CONTRACT 3 — the model abstraction. FROZEN."
- `packages/shared/src/stream.ts` — "CONTRACT 6 (part 2) — the SSE event
  taxonomy... Frozen."

`think` is never sent to Ollama today — confirmed in `ollama.ts`'s request
body, which sets only `temperature`/`num_predict` under `options`. Every
generation on `qwen3.6:27b` runs with thinking on, unconditionally, and the
reasoning tokens are never read (only `message.content`, never
`message.thinking`).

## The one decision that sizes this whole feature

**Does reasoning text ever reach the user, or does the toggle only control
whether Ollama computes it?**

- **Off (suppress only)** — the toggle sends `think: true/false` to Ollama
  and any `message.thinking` in the stream is simply never read, same as
  today. Small: touches provider construction, not the frozen contracts.
- **On (surface it)** — needs a new `thinking_delta`-style event added to
  **both** frozen contracts (`ProviderStreamEvent` in contract 3,
  `StreamEvent`/`streamEventSchema` in contract 6), plus a frontend
  component to render it (a collapsed "reasoning" block, roughly matching
  how Claude.ai or assistant-ui show extended thinking).

My read of "replace Effort with a Thinking toggle" is a plain on/off control,
which reads as the suppress-only version — I'd recommend building that first
and treating "show me the reasoning" as a clearly separable follow-up, not
because the second version is hard, but because it's the one part of this
that touches code marked frozen for a reason, and deserves its own explicit
go-ahead rather than riding along with a UI feature. **Confirm before I
scope further.**

## How model/think selection would plumb through — two options

Given no per-request model field exists today, there's a real fork:

**Option A — extend the frozen `CompletionRequest`** with `model?: string`
and `think?: boolean`. Every provider sees the same shape; future BYOK
providers (OpenAI's reasoning effort, Anthropic's extended thinking) could
eventually honor the same fields. Cost: deliberately editing a contract
whose docstring says FROZEN, and OpenAI/Anthropic providers would silently
ignore both fields today since only Ollama is in scope this pass.

**Option B — parameterize provider construction, not the request.** Change
`getChatProvider(userId, opts?: { model?: string; think?: boolean })`; the
Ollama branch uses `opts` to build `new OllamaProvider(opts?.model, opts?.think)`,
BYOK branches ignore it. `CompletionRequest` stays untouched. Providers are
already constructed fresh per call (`LazyProvider` resolves a new
`OllamaProvider` on every `stream()` — there's a comment on this in
`ollama.ts` about a bug it caused elsewhere), so this needs no new
per-request plumbing inside the contract at all.

**Recommendation: B.** It's the smaller, more surgical change, and it
doesn't touch a contract that three other frozen contracts (4, 6) were
explicitly designed around. "Ollama only, for now" is a stated temporary
scope limit, not a permanent one — Option A can still happen later if BYOK
model selection becomes real. But this is a real architectural fork, not a
detail — flagging for your call, not deciding it myself.

## Where the selection would live: DB-backed per chat, not client-only

The font-scale dev tool (Settings → General) is `localStorage`-only, and
that was fine there — it's a personal browser preference with no server
meaning. Model/thinking choice is different: chats are account-level
persisted entities (title, pinned state, summary already live in the
`chats` table), viewable across devices, and "what model wrote this
message" is meaningful history, not just a UI preference.

**Recommendation:** two new columns on `chats` —
`model text not null default 'qwen3.6:27b'` and
`thinking_enabled integer not null default 1` — same pattern as the existing
`is_pinned` column (small, precedented migration; `drizzle-kit generate`
after hand-editing, per what already bit this project once with
`is_pinned`'s migration not being registered in the journal). The
`[chatId]/route.ts` handler already loads the `chat` row before calling
`getChatProvider` — reading `chat.model`/`chat.thinkingEnabled` there and
passing them through costs nothing structurally.

Selecting a new model/thinking state on an *existing* chat mid-conversation
would update that chat's row (affects future turns in that chat, not past
ones — same as how you'd expect it to work). Selecting on the landing page's
composer (no chat exists yet) would set the value the new chat is created
with.

## UI components

Two separate composer implementations exist today —
`components/chat/NewCourseChatComposer.tsx` (landing + course-page empty
state) and `components/chat/ChatMain.tsx` (in-conversation) — matching the
screenshots, which show the pill on both. Plan: one shared component (e.g.
`ModelPicker.tsx`) — the pill + expandable panel — used from both, rather
than duplicating the picker in each. Settings still lists the predefined
model set for visibility/management (likely folded into the existing API
Keys section, since that's already where provider/model concerns live), but
the actual switching UI is the composer pill, not Settings — matches what
the screenshots show (the picker opens from the chat surface itself).

## Explicit non-goals for this pass

- No live model discovery from Ollama's `/api/tags` — the five models are
  hardcoded.
- No model selection for BYOK (OpenAI/Anthropic) — Ollama only.
- No reasoning-text UI unless you confirm you want that phase now (see
  above).
- No graded thinking effort (Ollama supports `"low"/"medium"/"high"` for
  some models, mirroring the reference screenshot's Effort levels) — you
  asked for on/off, that's what's scoped.

## Suggested build order, once scope is confirmed

1. Migration: `chats.model`, `chats.thinking_enabled` columns.
2. `OllamaProvider` constructor takes `think`; request body sends it.
   Confirm exact Ollama `think` wire format against the real API first
   (I have not verified this against a live Ollama instance yet).
3. `getChatProvider` accepts `{ model?, think? }`, threads into the Ollama
   branch only.
4. `[chatId]/route.ts` reads `chat.model`/`chat.thinkingEnabled`, passes
   through.
5. `ModelPicker.tsx` shared component; wire into both composers.
6. Settings surface for the predefined model list (read-only display, or
   management — tell me which once we're here).
7. Manual verification in a browser per this project's established
   practice (typecheck, build, then click through), plus e2e coverage
   using the Playwright suite MOLA MAIN mentioned just landed on `dev`.

## Decisions — confirmed

1. **Thinking toggle is suppress-only.** Sends `think: true/false` to
   Ollama; `message.thinking` (if present) is never read, same as today.
   No reasoning-text UI, no touching contracts 3/6's frozen event
   taxonomies. That's the whole feature-sizing question resolved — this
   stays a small, contained change.
2. **Option B** — thread model/think through provider construction
   (`getChatProvider(userId, opts)`), not through `CompletionRequest`.
   `CompletionRequest` stays byte-for-byte as it is; only the Ollama branch
   of `resolveProvider`/`LazyProvider` changes.
3. **DB-backed, two-tier.** Two places the choice lives, not one:
   - **A per-user default** (new columns on `users`: `default_model text
     not null default 'qwen3.6:27b'`, `default_thinking_enabled integer
     not null default 1`) — what a brand-new chat is created with.
   - **A per-chat value** (new columns on `chats`, same names/shapes,
     matching the existing `is_pinned` migration pattern) — snapshotted
     from the user's default at chat creation, then overridable per chat.
     Changing the model/thinking state on chat X updates chat X's own row
     **and** the user's default (so the *next* new chat starts there too).
     Existing chats never change underneath you — only the one you're
     actively changing, plus the forward-looking default. This is what
     "persistent for the chat, changes the default for new chats, old
     chats keep what they had" means concretely.
4. **RNJ-1, gemma4:12b, gemma4:26b, qwen3.8:27b confirmed pulled** on
   192.168.1.17 as of this writing. Exact Ollama tag string for RNJ-1
   (case, colon-tag format) still needs a quick `ollama list` check against
   that host before it's hardcoded into the model list — small, do this
   right before implementing, not now.
5. **Compaction and sub-agent calls respect the chat's chosen model.**
   Concretely, grounded in the actual call sites:
   - `apps/web/lib/agent/compaction.ts`'s `llmSummarizer` calls
     `getChatProvider("system")` today — the `"system"` sentinel means "no
     BYOK key, just use the Ollama default," which no longer reflects what
     we want. `maybeCompact(chatId, userId)` (called from
     `[chatId]/route.ts:136`, which already has the `chat` row loaded) needs
     to receive and forward the chat's `model`/`thinkingEnabled` down into
     `llmSummarizer` → `getChatProvider`.
   - `apps/web/lib/agent/subagent.ts`'s `runSubagent` calls
     `getChatProvider(ctx.session.userId)` — `ctx: ToolContext` already
     carries `chatId` (set in `route.ts`), so the same chat lookup applies;
     sub-agents inherit the parent chat's model/thinking, not a fixed
     default.
   - Both of these files carry their own FROZEN markers (contract 5's
     compaction boundary, contract 4's sub-agent spawner). Same caveat as
     Option B generally: this is a call-site edit (an extra argument to
     `getChatProvider`), not a change to either file's exported contract
     shape (`SubagentSpec`/`SubagentResult`, the compaction boundary
     semantics) — worth flagging explicitly when this actually gets built,
     so it reads as "touched, contract shape unchanged" rather than
     silently editing something marked frozen.

## Suggested build order, updated

1. Migration: `users.default_model`, `users.default_thinking_enabled`,
   `chats.model`, `chats.thinking_enabled`.
2. `OllamaProvider` constructor takes `think`; request body sends it.
   Confirm exact Ollama `think` wire format against the live 192.168.1.17
   host first — not yet verified against a real response.
3. `getChatProvider(userId, opts?: { model?, think? })`; Ollama branch only.
4. `[chatId]/route.ts` reads `chat.model`/`chat.thinkingEnabled`, passes
   through to `runAgentLoop`, `maybeCompact`, and `runSubagent`'s call
   sites.
5. A model/thinking change on a chat writes both that chat's row and
   `users.default_*` in the same update.
6. `ModelPicker.tsx` shared component (the mockup shown above), wired into
   both `NewCourseChatComposer.tsx` and `ChatMain.tsx`.
7. Settings surface for the predefined model list — read-only display for
   now, no live Ollama discovery this pass.
8. Manual verification in a browser (typecheck, build, click through) plus
   e2e coverage via the Playwright suite already on `dev`.
