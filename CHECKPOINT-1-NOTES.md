# Integration checkpoint 1 — running notes

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

### Contract-3 asymmetry holds on the document side
`grep -rn "Instruct:" apps/ingest/ingest/` returns only a docstring stating that
query prefixing belongs to Agent C. `embed_documents` sends raw chunk text with
`num_gpu: 0`. Agent C still needs verifying on the query side.
