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

## The name

Mola is named for **Lady Kofoworola Ademola**, the first Black African woman to
obtain a degree from the University of Oxford.

The icon is a mola fish, drawn in the style of a **mola** — the traditional
textile and folk art of the indigenous Guna (or Kuna) people of Panama and
parts of Colombia.

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
pnpm db:seed                           # Alice + Bob, a term, and a course
pnpm --filter @mola/db seed:calendar   # optional: schedule fixtures
```

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
   derivations, not definitions."* that is injected into every chat scoped to
   that course.
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
   the card's real FSRS schedule — the same state that chat-driven review
   (*"quiz me on my due cards"*) writes.
7. **Plan your week** at `/plan`. Mola proposes today, the week and the
   semester; you amend and accept. Amendments accumulate rather than silently
   rewriting the semester — the end-of-week review reads that pattern and
   re-proposes through the same gate.
8. **Bring your own key** in Settings → paste an OpenAI or Anthropic key and
   chat switches providers. Keys are encrypted with `MOLA_ENCRYPTION_KEY` and
   never returned to the client in plaintext.

---

## Where it stands

A working pilot. The plumbing is real and covered by tests, but this is not a
finished product, and the list below is meant to be read literally.

### Working today

| | |
| --- | --- |
| **Chat** | Agentic tutor with a read → think → act loop, per-course context, streamed tool calls, and a Socratic hint ladder the student controls |
| **Retrieval** | Grep, BM25 and pgvector search over your uploaded material, behind one shared fallback path |
| **Quizzes** | Multiple-choice and short-answer sets generated from your own documents, graded with explanations |
| **Flashcards** | Decks built on demand; Flashcards / Learn modes, scheduled by an FSRS-shaped spaced-repetition scheduler |
| **Mind maps** | Interactive pan/zoom concept maps built from course material |
| **Plan** | Today / week / semester plans on a propose → amend → accept gate |
| **Calendar** | Month, week and day views; Google Calendar OAuth sync and ICS feed subscriptions |
| **Courses** | Per-course summary, instructions and memory; document upload into the ingest pipeline |
| **Ingestion** | Malware scan → MIME sniff → extract → chapter/TOC detection → chunk → embed, with raw/safe/quarantine bucket separation |
| **Accounts** | Email/password auth, a multi-step sign-up wizard, and per-user ownership checks on every resource |
| **Models** | Self-hosted Ollama, or bring-your-own OpenAI / Anthropic key, encrypted at rest |
| **Long chats** | Automatic compaction with summarised boundaries, plus search across your own chat history |

### Not there yet

- **Pricing and Resources** are placeholder marketing pages.
- **No standalone Agents surface** — the agent loop powers chat, but there is no
  page for it.
- **Model choice is Ollama-only.** BYOK providers ignore the per-chat model and
  thinking toggles.
- **The SRS scheduler is FSRS-*shaped*, not FSRS-4.5.** The state matches, so a
  real per-user optimizer can slot in without a schema change — but it has not
  been fitted against review history.
- **Ingestion needs Docker** for S3 and ClamAV; there is no Docker-free path.
- **The golden retrieval eval is scoped to a single syllabus corpus** (20
  questions), so it guards regressions rather than proving general quality.
- **Desktop-shaped.** No mobile layout work has been done.

### Next

- Fit the SRS optimizer against real review history.
- Honour per-chat model and thinking selection for BYOK providers.
- Broaden the golden eval past one corpus, and keep it in CI.
- Fill in Resources with real usage guides, and decide pricing.

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
    lib/context/       The context assembler and the hint ladder
    lib/llm/           Ollama + BYOK providers, model catalog, embeddings
    e2e/               Playwright specs
  ingest/              Python ingestion worker (scan → extract → chunk → embed)
packages/
  db/                  Drizzle schema, migrations, seeds
  shared/              Frozen cross-boundary contracts (artifacts, stream, planning)
evals/                 Golden retrieval eval set
infra/                 docker-compose, Postgres init SQL, LocalStack bucket init
```

Next.js 15 (App Router) · React 19 · Tailwind CSS 4 · Auth.js v5 · Drizzle ORM ·
PostgreSQL 16 + pgvector · S3 · Ollama / OpenAI / Anthropic · Python 3.11

---

## Development

```bash
pnpm typecheck                        # tsc --noEmit across the workspace
pnpm test                             # Vitest unit suites
pnpm build                            # build every package

pnpm --filter @mola/web e2e           # Playwright suite (own DB, port 3020)
pnpm --filter @mola/evals golden -- --pdf /path/to/syllabus.pdf

cd apps/ingest && pip install -e ".[dev]" && pytest
```

The e2e suite boots a real `next dev` against a dedicated `mola_e2e` database on
port 3020 so it never collides with your own session on 3000. Seed that database
first (`DATABASE_URL=<mola_e2e url> pnpm db:seed`); `e2e/global-setup.ts` then
inserts the multi-turn chat and compaction fixtures the specs need.

`packages/shared` holds the schemas that cross four or more boundaries —
artifacts, stream events, planning payloads — and they are **frozen**. Extend
the union there first; never widen a payload to `any`. The same applies to the
tool registry, the agent loop and the context assembler, which are marked
`FROZEN` in-file so parallel workstreams can build against them without drift.
