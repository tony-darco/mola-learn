# Mola

**An AI study partner that teaches instead of answering.**

Mola is a tutoring app for university students. You give it your courses — a
syllabus, lecture notes, a textbook — and it becomes a study partner that knows
what *you* are taking, what is due next, and where you got stuck last time. Ask
it something and it walks you toward the answer with graduated hints rather than
handing you a solution. Along the way it can build quizzes, flashcard decks and
mind maps out of your own material, and keep a study plan that reacts to your
real calendar.

![A walkthrough of Mola: the landing page, signing in, a tutoring chat on virtual memory, a flashcard deck, a graded quiz, a concept mind map, the study plan and the calendar](docs/demo.gif)

<sub>The landing page → signing in → a chat on page tables and TLBs (with a flashcard deck generated inline) → flipping through that deck → taking and grading a practice quiz → a mind map of the same topic → the week's plan → the semester calendar.</sub>

---

## The goal

Most "AI for studying" tools are a chat box with a textbook stapled to it. They
answer the question you asked, which is usually the one thing that does not help
you learn. Mola is built around three ideas instead:

1. **Productive struggle beats a correct answer.** Assistance is delivered on a
   ladder — *pointing* → *teaching* → *bottom-out* — and the student pulls the
   next rung. Nothing auto-escalates on a timer or a wrong-answer count,
   because rapid skipping to the full solution correlates with worse outcomes.
   (`apps/web/lib/context/hint-ladder.ts`)
2. **Grounding in your material, not a generic corpus.** Every quiz question,
   flashcard and mind-map node is retrieved from documents you uploaded to that
   specific course, through one shared tiered-retrieval path.
3. **Studying is a schedule problem too.** Knowing the material is half of it;
   knowing what to do on Tuesday is the other half. Plans are proposed,
   amended and accepted — never silently rewritten behind your back.

---

## What it does

| Surface | What you get |
| --- | --- |
| **Chat** | An agentic tutor with a read → think → act loop, per-course context, and a Socratic hint ladder you control |
| **Quizzes** | Multiple-choice and short-answer sets generated from your uploaded material, graded with explanations |
| **Flashcards** | Decks built on demand, scheduled by an FSRS-shaped spaced-repetition scheduler |
| **Mind maps** | Interactive D3 maps of how the concepts in a topic connect |
| **Plan** | Today / this-week / semester study plans, generated and re-proposed as your term moves |
| **Calendar** | Deadlines and exams, with optional Google Calendar and ICS feed sync |
| **Courses** | Per-course summary, instructions, memory, and document uploads |
| **Artifacts** | Everything the tutor generates is saved, browsable and re-openable |

Bring your own key (OpenAI or Anthropic, AES-256-encrypted at rest), or point it
at a self-hosted Ollama box.

---

## How it works

### The agent loop

`apps/web/lib/agent/loop.ts` is deliberately small: a message array and a
read–think–act cycle that streams tool calls and text deltas to the client over
SSE. Everything else is a layer bolted onto it.

Tools are registered in a `ToolRegistry` (`lib/agent/registry.ts`), which can
hand a **restricted subset** to a sub-agent — so the mind-map generator, the
quiz generator and the chat-history searcher each run with their own allowlist
rather than the full toolbox.

Current tools: `grep_search`, `bm25_search`, `vector_search`,
`grep_chat_search`, `bm25_chat_search`, `read_course_fact`, `calculator`,
`read_schedule`, `read_plan`, `add_schedule_item`, `complete_task`,
`get_due_flashcards`, `record_flashcard_review`, plus the artifact emitters
(`emit_quiz`, `emit_flashcard_deck`, `emit_mind_map`) and their creators.

### Five context layers

`lib/context/assemble.ts` builds the system prompt from five ordered layers.
Layers 1–4 are deterministic and always loaded; only layer 5 and retrieval
results are judged for relevance:

1. **Identity** — who the student is, which course this chat belongs to
2. **Calendar** — what is due, rendered by the same formatter `read_schedule` uses
3. **Catalog** — one line per available tool; full instructions load on demand
4. **Rules** — the Socratic rulebook and the current hint rung, plus per-course instruction overrides
5. **History** — recent raw turns, with older ones replaced by compaction summaries

### Tiered retrieval

One fallback strategy, shared by every consumer
(`lib/agent/retrieval/tiered-search.ts`):

```
textbook chapter tree  →  raw document chunks  →  pgvector semantic search
```

Chat, quizzes, flashcards and mind maps all reach it through the *same*
`grep_search` / `bm25_search` tool objects, so improving retrieval is one change
rather than four prompt edits.

### Document ingestion

`apps/ingest` is a separate Python worker with a strict security walk
(`§12` invariants are enforced in `ingest/pipeline.py`, not by convention):

```
upload → ClamAV scan + MIME sniff → extract → chapter/TOC detect → chunk → embed
status: scanning → extracting → indexing → ready   (or failed / quarantined)
```

Bytes are read from the RAW bucket exactly once; nothing downstream re-reads it,
and only two call sites may move an object between the raw / safe / quarantine
buckets.

### Stack

- **Web** — Next.js 15 (App Router, RSC), React 19, Tailwind CSS 4, Auth.js v5
- **Data** — PostgreSQL 16 + `pgvector` + `pg_trgm`, Drizzle ORM
- **Storage** — S3 (LocalStack in dev), three buckets: raw / safe / quarantine
- **Models** — Ollama (self-hosted) by default; OpenAI or Anthropic via BYOK
- **Ingest** — Python 3.11, PyMuPDF, python-docx, ClamAV
- **Testing** — Vitest (unit), Playwright (e2e), pytest (ingest), a 20-question golden retrieval eval

---

## Repository layout

```
apps/
  web/                 Next.js app — UI, API routes, agent loop, tools, planning
    app/(marketing)/   Public landing, feature and pricing pages
    app/(auth)/        Sign-in and the multi-step sign-up wizard
    app/(shell)/       The signed-in product: chat, quizzes, flashcards,
                       mindmaps, plan, calendar, courses, artifacts
    app/api/           Route handlers (chat SSE, plan, calendar, tasks, settings)
    lib/agent/         Loop, tool registry, retrieval, sub-agents, SRS
    lib/context/       The five-layer context assembler and hint ladder
    lib/llm/           Ollama + BYOK providers, model catalog, embeddings
    e2e/               Playwright specs
  ingest/              Python ingestion worker (scan → extract → chunk → embed)
packages/
  db/                  Drizzle schema, migrations, seeds
  shared/              Frozen cross-boundary contracts (artifacts, stream, planning)
evals/                 Golden retrieval eval set
infra/                 docker-compose, Postgres init SQL, LocalStack bucket init
```

---

## Getting started

### Prerequisites

- **Node.js ≥ 20** and **pnpm 11** (`corepack enable` will do)
- **PostgreSQL 16** with the `vector` and `pg_trgm` extensions
- An **LLM endpoint** — a self-hosted [Ollama](https://ollama.com) host, or an
  OpenAI / Anthropic API key you add in Settings once signed in
- *(optional)* Docker, for S3 (LocalStack), ClamAV and the ingest worker
- *(optional)* Python 3.11, to run the ingestion worker outside Docker

### 1. Install

```bash
git clone <this repo> && cd mola-learn
pnpm install
```

### 2. Bring up Postgres

Either use the bundled compose stack:

```bash
docker compose -f infra/docker-compose.yml up -d postgres localstack
```

…or point at any Postgres 16 you already have. Whichever you choose, the two
extensions in `infra/initdb/00-extensions.sql` must exist in the database:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

On a system Postgres, `pgvector` is a separate package — e.g.
`apt install postgresql-16-pgvector` on Debian/Ubuntu, `brew install pgvector`
on macOS. The compose image (`pgvector/pgvector:pg16`) already has it.

> `pnpm docker:up` / `pnpm docker:down` wrap `infra/docker-remote.sh`, which
> drives Docker on a **specific remote LAN host** over SSH. Use plain
> `docker compose` locally unless you are on that network.

### 3. Configure

Next.js auto-loads `apps/web/.env.local` and nothing else, so start there:

```bash
cp .env.example apps/web/.env.local
```

At minimum, set:

| Variable | Why |
| --- | --- |
| `DATABASE_URL` | Postgres connection string — **required**, everything throws without it |
| `AUTH_SECRET` | Signs Auth.js session JWTs. Without it every sign-in fails with `MissingSecret`. Generate: `openssl rand -base64 32` |
| `MOLA_ENCRYPTION_KEY` | AES-256 key encrypting BYOK API keys at rest. Generate: `openssl rand -base64 32` |
| `OLLAMA_HOST` / `MOLA_CHAT_MODEL` | Your self-hosted chat + embedding endpoint (skip if you'll use BYOK) |

`S3_*` are only needed for document ingestion; `GOOGLE_CLIENT_ID` /
`GOOGLE_CLIENT_SECRET` are optional — unset simply renders Google Calendar sync
as "not configured" rather than a broken button. `.env.example` documents the
rest, including the two testing-only debug loggers (both off by default, and
never to be enabled in production).

The `db:*` and `worker` scripts run as plain Node processes and read
`process.env` directly — they load **no** dotenv file, whatever you name it.
Export the variables into your shell for those.

### 4. Migrate and seed

```bash
export DATABASE_URL=postgres://mola:...@localhost:5432/mola

pnpm db:migrate
pnpm db:seed                      # Alice + Bob, a term, and a course
pnpm --filter @mola/db seed:calendar   # optional: schedule fixtures
```

> Re-running `db:migrate` against an already-migrated database prints a raw
> Postgres error object and *then* `migrations applied`. It is harmless.

The seed creates two users so cross-user authorization is testable. Both sign in
with `mola-dev-password` (override with `SEED_PASSWORD`):

| Email | Password |
| --- | --- |
| `alice@umbc.edu` | `mola-dev-password` |
| `bob@umbc.edu` | `mola-dev-password` |

### 5. Run

```bash
pnpm dev                          # Next.js on http://localhost:3000
```

Two optional background workers:

```bash
pnpm --filter @mola/web worker    # calendar sync + weekly plan proposals
docker compose -f infra/docker-compose.yml up -d clamav ingest-worker
```

Neither is a hard dependency in dev — the app opportunistically drains due jobs
on page load. The standalone worker is what makes the time-driven behaviours
(Google watch-channel renewal, Sunday's weekly proposal) actually time-driven.

---

## Using it

1. **Sign up** at `/sign-up` — a short wizard collects your university,
   graduation date and phone, or sign in with a seeded account.
2. **Create a course** and open it. Give it a summary and, optionally,
   *instructions* — a free-text note like *"Prefers precise notation. Tests
   derivations, not definitions."* that is injected into layer 4 of every chat
   scoped to that course.
3. **Upload material** — syllabus, notes, a textbook PDF — from the course page.
   The ingest worker scans, extracts, chunks and embeds it; the document's
   status walks `scanning → extracting → indexing → ready`. Once ready it is
   retrievable by every tool.
4. **Ask a question** in chat. The tutor answers Socratically — press for more
   help and it climbs the hint ladder one rung at a time. Tool calls (searching
   your notes, doing arithmetic, reading your schedule) appear inline as they
   run.
5. **Ask for artifacts**: *"quiz me on chapter 4"*, *"make a deck for the
   vector-space axioms"*, *"map out how these ideas connect"*. They stream into
   the chat, and are saved to **Quizzes**, **Flashcards** and **Artifacts** in
   the sidebar.
6. **Review** a deck from its own page. *Flashcards* mode flips and autoplays;
   *Learn* mode has you self-grade, requeues the ones you missed, and advances
   the card's real FSRS schedule — the same `card_srs_state` row that
   chat-driven review (*"quiz me on my due cards"*) writes.
7. **Plan your week** at `/plan`. Mola proposes today, the week and the
   semester; you amend and accept. Amendments accumulate rather than silently
   rewriting the semester — the end-of-week review reads that pattern and
   re-proposes through the same gate.
8. **Bring your own key** in Settings → paste an OpenAI or Anthropic key and
   chat switches providers. Keys are encrypted with `MOLA_ENCRYPTION_KEY` and
   never returned to the client in plaintext.

---

## Development

```bash
pnpm typecheck                        # tsc --noEmit across the workspace
pnpm test                             # Vitest unit suites
pnpm build                            # build every package

pnpm --filter @mola/web e2e           # Playwright suite (own DB, port 3020)
pnpm --filter @mola/evals golden -- --pdf /path/to/syllabus.pdf
```

The e2e suite boots a real `next dev` against a dedicated `mola_e2e` database on
port 3020 so it never collides with your own session on 3000. Seed that database
first (`DATABASE_URL=<mola_e2e url> pnpm db:seed`); `e2e/global-setup.ts` then
inserts the multi-turn chat and compaction fixtures the specs need. Override
`E2E_PORT` to run several suites against one checkout concurrently — `distDir`
keys off the same variable, so builds do not corrupt each other.

Ingest tests:

```bash
cd apps/ingest && pip install -e ".[dev]" && pytest
```

### Contracts

`packages/shared` holds the schemas that cross four or more boundaries —
artifacts, stream events, planning payloads — and they are **frozen**. Extend
the union there first; never widen a payload to `any`. The same applies to the
tool registry, the agent loop and the context assembler, which are marked
`FROZEN` in-file so parallel workstreams can build against them without drift.

---

## Status

A working pilot, not a finished product. Pricing is a placeholder, there is no
standalone agents surface yet, and the golden eval is scoped to a single
syllabus corpus. The plumbing — retrieval, ingestion, the agent loop, planning,
auth and authorization — is real and covered by tests.
