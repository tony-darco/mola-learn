# Golden set — baseline run

**Corpus:** IS 300 Management Information Systems, Spring 2026 (UMBC) syllabus —
20 pages, 42k chars, 57 chunks at 900/150.
**Model:** `qwen3-embedding:0.6b`, 1024d, CPU-only.
**Date:** 2026-08-26 (Phase 0).

```
                            @1     @3     @5    @10
vector (correct prefix)  10/20  17/20  19/20  20/20    95% @5
vector (no prefix)       10/20  18/20  20/20  20/20   100% @5
BM25 baseline            10/20  13/20  13/20  19/20    65% @5
```

## The model choice is confirmed

Every gold chunk is retrieved by rank 10, and 19/20 by rank 5, against a BM25
baseline of 13/20. Reranking is not needed at pilot scale — consistent with the
S1.4 reasoning that quality saturates early in this family.

## The query/document asymmetry did NOT show a measurable benefit here

This is the finding worth recording, because it does not match the prior.

The prefix cost one question at @5 (19 vs 20) and was identical at @1 and @10.
Per-question ranks show it winning on some and losing on others — rank 3 vs 8 on
"what score should I aim for", 6 vs 2 on "who is the instructor". Net: noise at
n=20, not evidence in either direction.

**The implementation is unchanged and stays as specified.** It is the documented
usage for this model family, 20 questions cannot resolve a small effect, and a
syllabus is an easy corpus — short, factual, low ambiguity. The place it would
plausibly matter is a textbook chapter explaining a concept in words the student
would not have used, which is exactly what this corpus does not contain.

**Re-run this against a real textbook before drawing any conclusion.** If the
prefix is still neutral there, that is worth raising as a contract-3 simplification.
Do not act on this syllabus result alone.

## Vector and BM25 fail in opposite directions

Which is the empirical case for §6's three-tool retrieval agent:

- BM25 wins on exact tokens — exam dates, chapter ranges, "SafeAssign" (rank 1).
- BM25 collapses on paraphrase — "what do I need to score to get an A" → rank 9,
  where the syllabus says `≥ 90% - 100% A 593-659` and shares no words with the query.
- Vector is the inverse: strong on paraphrase, weaker where the answer is a bare
  token in a dense table.

Neither tool alone clears 20/20 at @5. Together they trivially would.

## Misses are tuning, not design

All four @5 misses landed at rank 6–7, never deep. Widening top-k to 10, or
reranking, recovers all of them.

## Reproduce

```bash
pnpm --filter @mola/evals golden -- --txt <extracted.txt> --explain
```
