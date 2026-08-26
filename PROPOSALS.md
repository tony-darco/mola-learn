# Open proposals — investigated, not implemented

Two agents investigated and proposed; neither had edit tools. Nothing below is
built. Claims marked **verified** were re-checked independently by the
orchestrator, not taken from the agent's report.

---

## 1. Chat rendering: flash, flicker, and content jumping

### Symptom 1 is mostly NOT a bug — LaTeX never renders at all
**Verified.** `apps/web/components/chat/Markdown.tsx:11` wires only
`remarkPlugins={[remarkGfm]}`. No `remark-math`, `rehype-katex`, or `katex`
exists in `package.json` or the lockfile. `$$...$$` renders as raw text
permanently, not transiently. Bold markdown renders correctly.

The investigator found no code path showing a fully-loaded message half-parsed,
and said so rather than inventing a mechanism — its explanation is that the
perceived "raw → rendered" was the blank-spinner transition landing beside math
that never resolves.

**Fix:** add `remark-math` + `rehype-katex` + `katex` and its CSS import.
**Assigned to the UI lead** — it is rebuilding the message renderer anyway.

### Symptoms 2 + 3 are one cause
**Verified** in `ChatShell.tsx`: state is not keyed by chatId (no cache at all);
the history effect unconditionally `setLoading(true)` and refetches on every
chatId change (line 103); the whole list is gated on `!loading` (338/345/351);
and `ChatShell` is **not remounted** between chats since all use one route
pattern. So the previous chat's turns are still in memory but get hidden the
instant loading flips — old content hidden → blank spinner → new content, every
click, with no fast path.

**Fix (both parts needed, neither sufficient alone):** server-seed the first
paint from `app/(chat)/chats/[chatId]/page.tsx`, which already does a DB read for
ownership; plus a per-chat client cache so revisits hydrate immediately.
**Assigned to the UI lead** — do not port this architecture forward.

### Checked and NOT broken
The effect's `cancelled` cleanup guard correctly prevents stale responses
clobbering current state. No `AbortController`, so abandoned requests still
complete server-side — wasted work, not a correctness bug. Do not "fix" it.

### Separate defects found in passing
- `CompactedBanner.tsx:38` renders the LLM-authored summary as a **raw string**,
  not through `<Markdown>` — raw asterisks whenever "Show summary" is clicked.
- `ChatShell.tsx:131-140` refetches the whole sidebar list on every chat switch
  *and* every new turn during a send.

---

## 2. Automatic chat titling

### Recommended: one full exchange, not two user messages
The agent pushed back on the "two messages" instinct, and the argument is sound:
a single-question chat ("what's the derivative of x³?") is plausibly the most
common shape in a study tool, and under a two-message rule it stays "New chat"
forever — the exact symptom the feature exists to fix.

It also found that a bare hint pull is persisted as the literal string
`"(asked for a hint)"` (**verified**, `route.ts:61`), so keying the trigger on
"first user message with real typed text" skips hint-only turns for free.

### Recommended: in-process fire-and-forget, not the jobs table
**Verified**: `apps/ingest/ingest/jobs.py` claims only `kind="ingest_document"`,
and the Python worker touches only `documents`/`document_chunks`/`jobs` — it has
no contact with chats today. Routing titling through it would hand the ingestion
worker an unrelated responsibility purely to borrow its poll loop.

Titling is cosmetic and the retry is self-healing, so it does not need queue
durability. Also **verified** from §11 that production is ECS/Fargate with
"Vercel explicitly ruled out", so a long-running Node process genuinely keeps a
`void`ed async call alive after the response closes — the serverless caveat does
not bind here.

### Recommended: a non-thinking model, and this is measured
**Verified via `/api/show`:**

| model | size | thinking |
|---|---|---|
| `llama3.2:latest` | 3.2B | **false** |
| `gemma3:4b` | 4.3B | **false** |
| `qwen3.5:0.8b` | 873M | true |
| `qwen3.5:27b` | 27.8B | true |

Even the 873M qwen reports `thinking=true`, so picking a structurally
non-thinking model sidesteps hidden reasoning cost rather than depending on a
`think:false` flag this codebase never sets.

**Measured end-to-end by the orchestrator:** `llama3.2:latest` produced
"Reducing Page Frame Replacement" from a real exchange in **7.0 seconds**.
Compare ~80s+ on a thinking model for a trivial prompt.

### Recommended: bypass BYOK by construction
**Verified** that `runSubagent` and the chat route both hardwire
`getChatProvider(userId)` (`subagent.ts:47`, `route.ts:95`), which resolves a
student's saved key. Titling is platform-initiated housekeeping the student
never asked for — the same reasoning contract 3 uses for embeddings. The design
constructs `OllamaProvider` directly so a user key cannot be reached.

It also confirmed the **contract-4 sub-agent-events gap does not affect this
design** — that gap is scoped to sub-agents spawned as tool calls inside the
running loop; titling is called from the route after the stream closes.

### ⚠ NEEDS SIGN-OFF: contract-1 schema change
`chats.title` defaults to the non-null string `"New chat"`, so "never titled" and
"user deliberately named it that" are indistinguishable. The proposal adds:

```ts
export const chatTitleSourceEnum = pgEnum("chat_title_source", ["default","generated","user"]);
titleSource: chatTitleSourceEnum("title_source").notNull().default("default"),
titleAttemptedAt: timestamp("title_attempted_at", { withTimezone: true }),
```

`titleSource` is the never-overwrite sentinel; `titleAttemptedAt` makes an
atomic `UPDATE ... WHERE title_source='default' ... RETURNING id` act as the
claim lock, so concurrent triggers, retries after failure, and a title landing
after the chat is deleted all resolve without a queue or an advisory lock.

**Contract 1 is frozen. This needs your approval before anyone builds it.**

### Assumption the agent flagged rather than hid
That ECS task recycling mid-generation is rare and low-stakes enough for
fire-and-forget. Its stated fallback if you want stronger durability is a
lightweight **Node** poller on the `jobs` table — not the Python worker.
