# Mola

An AI study companion for university students. Chat surface modelled on Claude.ai;
internals borrowed from Claude Code — agent loop, skills vs. sub-agents, layered
context assembly, compaction.

Design doc: [`docs/study-companion-design.md`](docs/study-companion-design.md).
Frozen interfaces: [`CONTRACTS.md`](CONTRACTS.md).

**Status: end of Phase 0.** The foundation and its six contracts are built and
tested. None of the product features exist yet — no ingestion, no retrieval, no
flashcards, no calendar. What runs today is a thin slice proving the contracts
hold end to end.

---

## Authentication: there are no passwords

Nothing to look up — **no passwords were ever set.** Real auth (Auth.js v5) is
Agent D's Phase 1 workstream.

Until then `apps/web/lib/auth/session.ts` is a **shim** that trusts a cookie.
`/dev-signin` lists the seeded users and lets you click one. That is the whole
login system. It throws at import if `NODE_ENV=production`, so it cannot ship.

| User | Owns |
|---|---|
| `alice@umbc.edu` | one term, one course (CMSC 421), one chat |
| `bob@umbc.edu` | nothing — he exists to prove the ownership check |

Signing in as Bob and landing on an empty page **is the correct result**, not a
broken seed. Bob requesting Alice's chat URL gets a 404, never a peek.

---

## Running it

Four things: Docker, Node 20+, pnpm, and an Ollama host.

```bash
pnpm install
pnpm up                 # Postgres + pgvector, LocalStack S3
pnpm db:migrate
pnpm db:seed
pnpm dev                # http://localhost:3000
```

Then open **http://localhost:3000** → *Pick a dev user* → Alice.

### Ollama

`apps/web/.env.local` currently points at a LAN box:

```
OLLAMA_HOST=http://192.168.1.17:11434
MOLA_CHAT_MODEL=qwen3.5:27b
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
| `ECONNREFUSED ... 5433` | `pnpm up` not run, or Postgres still starting |
| Chat hangs, then errors | `OLLAMA_HOST` unreachable — `curl $OLLAMA_HOST/api/tags` |
| `model not found` | `MOLA_CHAT_MODEL` isn't pulled on that host |
| Empty page after sign-in | You are Bob. Expected — switch to Alice |
| `no such user` on sign-in | `pnpm db:seed` not run |

`docker compose -f infra/docker-compose.yml logs -f` for the containers.

---

## What actually works today

- **Chat** — streams from Ollama, renders in a Claude.ai-shaped layout
- **Tool calls** — one demo tool (`read_course_fact`) through the real registry
- **Five-layer context** — layers 1, 3, 5 real; 2 and 4 stubbed for Agents J and F
- **Hint ladder** — pointing → teaching → bottom-out, **student-pulled only**
- **Ownership** — 401 logged out, 404 for a different user, on every resource

Try the ladder: ask something conceptual, then press **Hint** repeatedly. It
should open by directing your attention without giving content, and only reach a
worked step on the third pull. Nothing advances it but your own click.

## What does not exist yet

Document upload · retrieval agent · chat search · flashcards · quizzes · mind maps ·
calendar · planning loop · real auth · AWS. That is Phase 1 onward — see
[`CONTRACTS.md`](CONTRACTS.md) for who owns what.

---

## Layout

```
apps/web        Next.js — UI, API, agent loop, context assembly, LLM abstraction
apps/ingest     Python worker — empty, Agent B
packages/db     Drizzle schema + migrations (single source of truth)
packages/shared Embedding config, artifact schema, SSE taxonomy
evals/golden    20-question retrieval golden set + baseline results
infra           docker-compose; terraform/ is empty until Phase 3
```

## Commands

```bash
pnpm dev              # dev server
pnpm up / pnpm down   # local Postgres + LocalStack
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

```bash
curl -c a.txt -X POST localhost:3000/api/dev-login -H 'content-type: application/json' -d '{"email":"alice@umbc.edu"}'
curl -c b.txt -X POST localhost:3000/api/dev-login -H 'content-type: application/json' -d '{"email":"bob@umbc.edu"}'
CHAT=$(docker exec mola-postgres psql -U mola -d mola -tAc "select id from chats limit 1")
curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/api/chat/$CHAT          # 401
curl -s -b b.txt -o /dev/null -w '%{http_code}\n' localhost:3000/api/chat/$CHAT # 404
curl -s -b a.txt -o /dev/null -w '%{http_code}\n' localhost:3000/api/chat/$CHAT # 200
```

A foreign row and a missing row both return 404, deliberately — so the endpoint
cannot be used to probe which ids are real.
