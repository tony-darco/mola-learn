# Mola

An AI study companion for university students. Chat surface modelled on Claude.ai;
internals borrowed from Claude Code — agent loop, skills vs. sub-agents, layered
context assembly, compaction.

Design doc: [`docs/study-companion-design.md`](docs/study-companion-design.md).
Frozen interfaces: [`CONTRACTS.md`](CONTRACTS.md).

**Status: Phase 1 in progress (`feat/auth-courses`, Agent D).** Phase 0's
foundation and six contracts are built and tested. This branch replaces the
Phase 0 dev-cookie shim with real authentication and adds courses, the course
detail page, profile, and settings. Retrieval, flashcards, quizzes, mind maps
and calendar are still Phase 1 onward for other agents — see
[`CONTRACTS.md`](CONTRACTS.md) for who owns what.

---

## Authentication: real passwords now

`apps/web/lib/auth/session.ts` calls Auth.js v5 (Credentials provider, email +
password, JWT sessions) — the Phase 0 cookie shim and `/dev-signin` are gone.
Passwords are hashed with bcrypt and never logged. `getSession(): Promise<Session
| null>` — the signature every route and `requireOwned` depend on — is
unchanged; only its body is real now.

Create an account at **`/sign-up`**, or sign in at **`/sign-in`**.

**Seeded accounts** — `pnpm db:seed` creates two, both with the password
**`mola-dev-password`** (override with `SEED_PASSWORD`):

| Account | Password | Owns |
|---|---|---|
| `alice@umbc.edu` | `mola-dev-password` | a term, CMSC 421, and chats |
| `bob@umbc.edu` | `mola-dev-password` | nothing — he proves the ownership check |

Dev convenience only. The seed is idempotent and backfills a hash onto users
created before credentials auth existed, so re-running it repairs an account
that cannot sign in rather than skipping it.

Signing in as Bob and landing on an empty page is the ownership check working,
not a broken seed. Bob requesting Alice's course or chat URL gets a 404, never a
peek — see "Verifying the security boundary" below.

---

## Running it

Three things: Node 20+, pnpm, and an Ollama host. Postgres and LocalStack run
as Docker containers on a remote host (192.168.1.17) — no local Docker
install needed, just SSH access (see `infra/docker-remote.sh`).

```bash
pnpm install
pnpm docker:up           # Postgres + pgvector, LocalStack S3 (remote)
pnpm db:migrate
pnpm db:seed
pnpm dev                 # http://localhost:3000
```

Then open **http://localhost:3000** → **Sign up** → create a course.

`apps/web/.env.local` also needs, on top of the Ollama vars below:

```
AUTH_SECRET=<openssl rand -base64 32>
MOLA_ENCRYPTION_KEY=<openssl rand -base64 32>   # AES-256 key for BYOK keys at rest
AWS_ENDPOINT_URL=http://192.168.1.17:4566       # LocalStack, started by `pnpm docker:up`
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test
AWS_REGION=us-east-1
MOLA_RAW_BUCKET=mola-raw
```

### Ollama

`apps/web/.env.local` currently points at a LAN box:

```
OLLAMA_HOST=http://192.168.1.17:11434
MOLA_CHAT_MODEL=qwen3.6:27b
```

That machine must be reachable and running Ollama. To use a different one, change
`OLLAMA_HOST`; to use a smaller model, change `MOLA_CHAT_MODEL` to anything you
have pulled (`ollama list`). A model without tool-calling support will chat but
will not exercise the tool path.

Embeddings are separate and **not** user-selectable — `qwen3-embedding:0.6b` at
1024 dims, CPU-only. See contract 3.

### If something is wrong

| Symptom | Cause |
|---|---|
| `ECONNREFUSED ... 5433` | `pnpm docker:up` not run, or Postgres still starting |
| Chat hangs, then errors | `OLLAMA_HOST` unreachable — `curl $OLLAMA_HOST/api/tags` |
| `model not found` | `MOLA_CHAT_MODEL` isn't pulled on that host |
| Empty page after sign-in | New account, no courses yet — expected. Add a course |
| `MOLA_ENCRYPTION_KEY is not set` | Add it to `.env.local` before saving a BYOK key in Settings |
| Course upload fails | `pnpm docker:up` not run — LocalStack (`mola-raw` bucket) isn't up |

`infra/docker-remote.sh logs -f` for the containers.

---

## What actually works today

- **Real auth** — Auth.js v5, credentials provider, bcrypt-hashed passwords
- **Chat** — streams from Ollama (or your own OpenAI/Anthropic key), renders in a Claude.ai-shaped layout
- **Tool calls** — one demo tool (`read_course_fact`) through the real registry
- **Five-layer context** — layers 1, 3, 5 real; 2 and 4 stubbed for Agents J and F
- **Hint ladder** — pointing → teaching → bottom-out, **student-pulled only**
- **Ownership** — 401 logged out, 404 for a different user, on every resource
- **Courses** — create with a syllabus upload, per-course chat, editable
  summary/instructions/memory, document list with live status, empty schedule
  panel pending Agent J
- **Profile** — name, university, year (first…fifth), additive terms, courses per term
- **Settings** — BYOK provider + key (OpenAI or Anthropic), encrypted at rest,
  never re-shown after saving; no key falls back to the platform Ollama default

Try the ladder: ask something conceptual, then press **Hint** repeatedly. It
should open by directing your attention without giving content, and only reach a
worked step on the third pull. Nothing advances it but your own click.

## What does not exist yet

Document extraction/summarization (Agent B's ingest worker — course summaries
and document status stay at `scanning` until it runs), retrieval agent, chat
search, flashcards, quizzes, mind maps, calendar, planning loop, AWS. See
[`CONTRACTS.md`](CONTRACTS.md) for who owns what.

---

## Layout

```
apps/web        Next.js — UI, API, agent loop, context assembly, LLM abstraction
apps/ingest     Python worker — empty, Agent B
packages/db     Drizzle schema + migrations (single source of truth)
packages/shared Embedding config, artifact schema, SSE taxonomy
evals/golden    20-question retrieval golden set + baseline results
infra           docker-compose (runs on 192.168.1.17, see docker-remote.sh); terraform/ is empty until Phase 3
```

## Commands

```bash
pnpm dev                        # dev server
pnpm docker:up / docker:down    # Postgres + LocalStack (remote, on 192.168.1.17)
pnpm db:generate      # new migration from schema changes
pnpm db:migrate       # apply migrations
pnpm db:seed          # idempotent — safe to re-run
pnpm test             # contract tests (needs the DB up)
pnpm typecheck        # all packages
```

Golden set (needs a text file, not a PDF — extraction is Agent B's job):

```bash
pnpm --filter @mola/evals golden -- --txt <extracted.txt> --explain
```

## Verifying the security boundary

There's no dev-login shortcut anymore, so this is a real sign-up flow:

```bash
curl -s -X POST localhost:3000/api/auth/sign-up -H 'content-type: application/json' \
  -d '{"name":"Alice","email":"alice2@umbc.edu","password":"correct-horse-1"}'
curl -s -X POST localhost:3000/api/auth/sign-up -H 'content-type: application/json' \
  -d '{"name":"Bob","email":"bob2@umbc.edu","password":"correct-horse-2"}'
```

Then, in a browser: sign in as `alice2@umbc.edu`, create a course, copy its
`/courses/{id}` URL. Sign out, sign in as `bob2@umbc.edu`, and open that same
URL — it 404s. A foreign row and a missing row both return 404, deliberately —
so the endpoint cannot be used to probe which ids are real. Sign back in as
`alice2@umbc.edu` and the course is there again.

The unauthenticated case is still a plain `curl`:

```bash
CHAT=$(docker exec mola-postgres psql -U mola -d mola_d -tAc "select id from chats limit 1")
curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/api/chat/$CHAT   # 401, logged out
```
