# Mola ingest worker

Python worker for Phase 1 document ingestion (§7/§12 of the design doc).
Pipeline: `upload -> scan/verify -> extract text -> chunk -> embed`, off the
interactive path, walking `documents.status` through
`scanning -> extracting -> indexing -> ready` (or `failed` / `quarantined`).

Trigger: the `jobs` Postgres table only (contract, not S3 events — see the
comment in `ingest/jobs.py`). Poll, claim with `FOR UPDATE SKIP LOCKED`, retry
with backoff via `attempts` / `run_after` / `last_error`.

## Setup

From the repo root, the shared infra must already be up (`pnpm docker:up`,
`pnpm db:migrate`, `pnpm db:seed` against `mola_b` — see the top-level
README). Then, in this directory:

```bash
uv venv --python 3.11
uv pip install -e ".[dev]"      # or: uv pip install -e . && uv pip install pytest
cp .env.example .env            # edit if your ports/hosts differ
```

### Malware scanning — ClamAV

This worker talks to a **real clamd daemon** over TCP (`ClamdScanner` in
`ingest/scanner.py`), using clamd's INSTREAM protocol so file bytes never
touch clamd's filesystem. On this machine:

```bash
brew install libmagic clamav
cp /opt/homebrew/etc/clamav/freshclam.conf.sample /opt/homebrew/etc/clamav/freshclam.conf
cp /opt/homebrew/etc/clamav/clamd.conf.sample /opt/homebrew/etc/clamav/clamd.conf
# edit both: DatabaseDirectory -> /opt/homebrew/var/lib/clamav
# edit clamd.conf: uncomment TCPSocket 3310 and TCPAddr 127.0.0.1
mkdir -p /opt/homebrew/var/lib/clamav
/opt/homebrew/opt/clamav/bin/freshclam --config-file=/opt/homebrew/etc/clamav/freshclam.conf
/opt/homebrew/opt/clamav/sbin/clamd --config-file=/opt/homebrew/etc/clamav/clamd.conf &
```

**If clamd isn't available** (e.g. CI, a laptop without the ~100MB virus DB),
set `INGEST_SCANNER=stub` in `.env`. `StubScanner` **always reports clean and
performs no scan whatsoever** — see the large warning in `ingest/scanner.py`.
Never set this where the worker will receive real uploads. Tests that need
clamd (`tests/test_scanner.py`, the malware-quarantine case in
`tests/test_pipeline_integration.py`) auto-skip when it isn't reachable.

## Running the worker

```bash
source .venv/bin/activate
python -m ingest.worker
```

Polls every `INGEST_POLL_INTERVAL_SECONDS` (default 2s). Run more than one
process for parallelism — `SKIP LOCKED` makes concurrent claims safe.

### Manually enqueuing a document (no upload UI exists yet)

Agent D's pre-signed-URL upload flow is a separate, not-yet-built workstream.
Until it exists, `ingest/cli.py` uploads a local file to the RAW bucket and
inserts the `documents` + `jobs` rows a real upload endpoint would insert:

```bash
python -m ingest.cli enqueue path/to/file.pdf \
  --user-id <uuid> [--course-id <uuid>] [--kind syllabus|textbook|lecture_transcript|student_notes]
```

## Running the tests

```bash
python -m pytest -q
```

21 tests, all passing locally (real clamd + real mola_b Postgres + real
LocalStack S3; embedding/summarization use fakes for speed — see below).
Covers:

- **File-type sniffing rejects a renamed executable** (`tests/test_sniff.py`,
  plus a pipeline-level check that it never reaches SAFE).
- **A quarantined file never reaches SAFE** — both the malware path (real
  ClamdScanner against an EICAR string) and the type-spoof path.
- **The status walk reaches `ready`** with SAFE key, sha256, and pointer_md set.
- **Chunks land in Postgres with 1024-dim embeddings** (`vector_dims(embedding)`).
- **The sha256 dedupe path skips re-embedding and re-summarizing** — verified
  by asserting the fake embedder/summarizer are called zero times on the
  second, byte-identical upload.

Integration tests use `FakeEmbedder`/`FakeSummarizer` instead of live Ollama
calls so the suite runs in well under a second and doesn't depend on a
reachable LAN GPU box or a ~3-minute chat-model round trip. The real Ollama
path is exercised separately, below.

## Real end-to-end proof

Ran against the real 20-page syllabus at
`/Users/tdarco/Documents/IS 300 Spring 2026_Syllabus_MAntero(1).pdf` through
the full stack: real clamd, real LocalStack S3, real `mola_b` Postgres, real
Ollama (`qwen3-embedding:0.6b` for embeddings, `qwen3.6:27b` for the pointer
summary).

```bash
python -m ingest.cli enqueue "/path/to/IS 300 Spring 2026_Syllabus_MAntero(1).pdf" \
  --user-id <alice-uuid> --course-id <course-uuid> --kind syllabus
python -c "from ingest.worker import run_once; run_once()"
```

**Result:** `documents.status = 'ready'` in **202 seconds** wall clock for a
414 KB / 20-page PDF.

| Stage | Time |
|---|---|
| scan (clamd) + sniff + policy + move RAW->SAFE | a few seconds |
| extract (PyMuPDF) + chunk + insert | well under 1s |
| embed 37 chunks, 3 batches of 16 (`qwen3-embedding:0.6b`, CPU-only) | ~21s |
| pointer summary (chat call) | ~178s |

Note: this timing was measured against `qwen3.6:27b`. The project briefly
unified on `qwen3.5:27b` at checkpoint 1, then moved back to `qwen3.6:27b` when
`qwen3.5:27b` was retired from the shared Ollama host. So this number is once
again measured against the live default — but re-measure if the exact figure
matters, since the underlying host/hardware may have changed too.

The chat-model call dominates: `qwen3.6:27b` is a "thinking" model and burns
most of its time on hidden reasoning tokens even for a short two-paragraph
summary (confirmed separately — a trivial "say hello" prompt to the same
model took ~80s end to end). This is a model-choice cost, not a pipeline
inefficiency, and it's fully async/backgrounded so it never blocks the
student's chat.

Row counts and a sample chunk:

```
document: status=ready, byte_size=414427, mime_type=application/pdf
chunks: 37 total, 37 embedded, all vector_dims=1024

chunk[0] locator=p.1: "Page 1\nRevised: 1/21/2026 - Sections 5 & 6\nSpring 2026\n
IS 300 – Management Information Systems\nSpring 2026\nUMBC\n..."
```

Generated pointer_md (`documents.pointer_md`):

```markdown
# IS 300 Spring 2026_Syllabus_MAntero(1).pdf

- **kind**: pdf
- **embedding status**: ready
- **chunks**: 37

## Topic summary

This document provides the syllabus for IS 300: Management Information
Systems at UMBC for Spring 2026, detailing course logistics, the emphasis on
managerial and strategic information systems, and seven specific student
learning outcomes. It also outlines prerequisites, grading criteria, and
strict policies regarding academic integrity and the ethical use of AI tools
in coursework.

## Foreword

As you prepare for the semester, review this syllabus to locate class meeting
times, instructor office hours, and instructions for accessing the required
textbook via Blackboard without purchasing it separately. Please pay special
attention to the guidelines on AI usage to ensure your assignments demonstrate
original work and comply with the course's citation and integrity standards.
```

Re-uploading the identical PDF bytes under a different filename, for a
different user, took the dedupe path: it copied 37 already-embedded chunks
and the pointer_md from the first document, with zero calls to Ollama.

## Environment variables

See `.env.example`. Highlights:

- `DATABASE_URL` — **must point at `mola_b`**, never `mola`/`mola_a`/`mola_c`/`mola_d`.
- `S3_*` — LocalStack endpoint and the three bucket names (§12).
- `EMBED_MODEL` / `EMBED_DIM` / `EMBED_VERSION` — mirror
  `packages/shared/src/embedding.ts` (contract 3) by hand; Python can't import
  TS. A test in `tests/test_pipeline_integration.py` asserts the written
  `embedding_model`/`embedding_version` match, and asserts the Postgres vector
  width via `vector_dims()`.
- `OLLAMA_HOST` / `MOLA_CHAT_MODEL` — chat model is used ONLY for pointer
  summaries, never for embeddings.
- `INGEST_SCANNER` — `clamd` (default) or `stub`.
- `INGEST_MAX_BYTES` / `INGEST_USER_QUOTA_BYTES` / `INGEST_ALLOWED_KINDS` — policy.
- `INGEST_CHUNK_CHARS` / `INGEST_CHUNK_OVERLAP_CHARS` — chunking (defaults
  1800/200 chars; contract 3 warns against widening chunks to exploit the
  embedder's 32K context window, so these stay conservative).

## Design notes / judgment calls

- **Quarantine audit record.** The design doc says infected files get
  "QUARANTINE + audit record." `packages/db/src/schema.ts` is frozen
  (contract 1) and has no dedicated audit table, so the audit record is
  written as structured JSON into the existing `documents.status_detail`
  column (reason, timestamp, original/quarantine S3 keys, signature if
  malware). If a real audit table is ever wanted, that's a schema change to
  raise with Tony, not something this worker should freelance.
- **Type-spoof also quarantines, not just fails.** A file whose magic bytes
  don't match its claimed type (the renamed-executable trick) is treated as a
  security rejection like malware, not a soft policy failure — both move the
  object to QUARANTINE and set `documents.status = 'quarantined'`. Plain
  policy violations (size cap, disallowed kind, quota) set `status = 'failed'`
  and leave the object in RAW untouched, since there is nothing malicious to
  contain.
- **Chunking is intentionally simple**: fixed-size character windows with
  overlap, split at existing section boundaries (PDF page / docx paragraph).
  No semantic/sentence-aware splitting — nothing in §7 asked for it, and it
  would be speculative complexity for a Phase 1 pipeline.

## Not completed / open items

- No S3 event-notification path exists, by design (Phase 3 scope) — the
  `jobs` table is the only trigger, per contract.
- No load/concurrency testing of multiple worker processes against the same
  queue beyond confirming `SKIP LOCKED` semantics in the SQL.
- Pointer summaries are English-only prompts; no attempt to handle non-English
  source documents differently.
