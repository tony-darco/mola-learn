/**
 * End-to-end golden-set harness for the RETRIEVAL AGENT itself, as opposed to
 * `evals/golden/run.ts` (owned by the Phase 0 measurement harness), which only
 * measures raw vector/BM25 ranking directly and never touches an agent.
 *
 * This seeds a real syllabus into mola_c's document_chunks (via the test-only
 * fixture, embedded for real through SelfHostedEmbeddingProvider), then runs
 * the actual ReAct sub-agent — real Ollama chat model, real tool calls — once
 * per golden question, and checks whether the verbatim expected answer string
 * shows up in the agent's final answer. That is the honest end-to-end number:
 * it is not enough for the right chunk to be retrieved: the agent has to
 * surface that fact back to the student.
 *
 * Requires: `pnpm up && pnpm db:migrate && pnpm db:seed`, a reachable
 * OLLAMA_HOST with both the chat model and qwen3-embedding:0.6b pulled.
 *
 * Usage:
 *   pnpm exec tsx apps/web/lib/agent/retrieval/golden-eval.ts \
 *     --txt <extracted-syllabus.txt> [--explain] [--offset N] [--limit N] \
 *     [--timeout-ms N] [--course-id <uuid>] [--no-cleanup]
 *
 * BATCHING: a full 20-question run takes longer than a single foreground
 * command should honestly claim to block for. --offset/--limit slice the
 * question set; --course-id reuses an already-seeded corpus instead of
 * re-embedding it (the expensive, one-time step) on every batch; --no-cleanup
 * leaves the scratch course behind for the next batch to reuse. First batch
 * omits --course-id (prints the new one to reuse) and passes --no-cleanup;
 * middle batches pass both; the last batch omits --no-cleanup to delete it.
 *
 * PER-QUESTION TIMEOUT: each sub-agent run makes multiple real network round
 * trips to the Ollama chat model. A prior run of this harness hung
 * indefinitely on question 5 — an un-timeouted fetch inside the streamed chat
 * response never resolved, and nothing in the frozen agent loop times it out.
 * Rather than patch loop.ts/ollama.ts (frozen — contract 4, contract 3), this
 * harness bounds each question two ways: an AbortSignal on ToolContext
 * (ToolContext.signal is already wired through runAgentLoop -> provider.stream
 * -> fetch, so this needed no changes to any frozen file), plus a
 * Promise.race belt-and-suspenders in case an abort doesn't unstick a given
 * fetch implementation. A question that times out is recorded as a miss with
 * the reason, and the run moves on rather than hanging.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { chats, courses, db, users } from "@mola/db";
import { seedTestDocument } from "./test-fixtures";
import { runRetrievalAgent } from "./agent";
import { buildRegistry } from "../tools";
import { SelfHostedEmbeddingProvider } from "../../llm";
import type { ToolContext } from "../registry";

const DEFAULT_TIMEOUT_MS = 90_000;

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms: ${label}`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

type Question = { q: string; expect: string };

/**
 * Same fixed-size chunking as evals/golden/run.ts, deliberately duplicated
 * rather than imported — this is a measurement harness, not Agent B's real
 * pipeline, and the two live in separate packages. Point this at B's real
 * chunker once it exists instead of keeping two copies in sync by hand.
 */
function chunk(text: string, size = 900, overlap = 150): string[] {
  const clean = text.replace(/\r/g, "").replace(/[ \t]+/g, " ");
  const out: string[] = [];
  for (let i = 0; i < clean.length; i += size - overlap) {
    const piece = clean.slice(i, i + size).trim();
    if (piece.length > 50) out.push(piece);
  }
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ");

async function main() {
  const txtArg = process.argv.indexOf("--txt");
  if (txtArg === -1) {
    throw new Error(
      "usage: golden-eval --txt <extracted-syllabus.txt> [--explain] [--offset N] [--limit N] " +
        "[--timeout-ms N] [--course-id <uuid>] [--no-cleanup]",
    );
  }
  const explain = process.argv.includes("--explain");
  const noCleanup = process.argv.includes("--no-cleanup");
  const limitArg = process.argv.indexOf("--limit");
  const limit = limitArg === -1 ? undefined : Number(process.argv[limitArg + 1]);
  const offsetArg = process.argv.indexOf("--offset");
  const offset = offsetArg === -1 ? 0 : Number(process.argv[offsetArg + 1]);
  const timeoutArg = process.argv.indexOf("--timeout-ms");
  const timeoutMs = timeoutArg === -1 ? DEFAULT_TIMEOUT_MS : Number(process.argv[timeoutArg + 1]);
  const courseIdArg = process.argv.indexOf("--course-id");
  const reuseCourseId = courseIdArg === -1 ? undefined : process.argv[courseIdArg + 1];

  const text = readFileSync(process.argv[txtArg + 1]!, "utf8");
  const questionsPath = fileURLToPath(new URL("../../../../../evals/golden/questions.json", import.meta.url));
  const { questions: allQuestions } = JSON.parse(readFileSync(questionsPath, "utf8")) as { questions: Question[] };
  const sliced = allQuestions.slice(offset, limit ? offset + limit : undefined);

  const [alice] = await db.select().from(users).where(eq(users.email, "alice@umbc.edu"));
  if (!alice) throw new Error("run `pnpm db:seed` first");
  const [chat] = await db.select().from(chats).where(eq(chats.userId, alice.id)).limit(1);
  if (!chat) throw new Error("run `pnpm db:seed` first");

  let courseId: string;
  if (reuseCourseId) {
    courseId = reuseCourseId;
    console.error(`reusing already-seeded course ${courseId} (skipping embedding)`);
  } else {
    const [course] = await db
      .insert(courses)
      .values({ userId: alice.id, name: "Golden-eval scratch course (IS 300)" })
      .returning();
    courseId = course!.id;

    const chunks = chunk(text);
    console.error(`corpus: ${chunks.length} chunks, embedding for real (this calls Ollama)...`);
    await seedTestDocument({
      userId: alice.id,
      courseId,
      kind: "syllabus",
      title: "IS 300 Syllabus",
      status: "ready",
      chunks,
      embedder: new SelfHostedEmbeddingProvider(),
    });
    console.error(`seeded course-id=${courseId} — pass --course-id ${courseId} --no-cleanup to reuse across batches`);
  }

  const registry = buildRegistry();
  const ctx: ToolContext = { session: { userId: alice.id, email: alice.email }, chatId: chat.id, courseId };
  const questions = sliced;

  try {
    let hits = 0;
    const rows: { q: string; expect: string; hit: boolean; answer: string; iterations: number; ms: number }[] = [];

    for (const question of questions) {
      const controller = new AbortController();
      const qCtx: ToolContext = { ...ctx, signal: controller.signal };
      const t0 = Date.now();
      try {
        const { answer, iterations } = await withTimeout(
          runRetrievalAgent(question.q, registry, qCtx),
          timeoutMs,
          question.q,
        );
        const ms = Date.now() - t0;
        const hit = norm(answer).includes(norm(question.expect));
        if (hit) hits++;
        rows.push({ q: question.q, expect: question.expect, hit, answer, iterations, ms });
        console.error(`${hit ? "✓" : "✗"} (${ms}ms, ${iterations} tool call(s)) ${question.q}`);
      } catch (err) {
        controller.abort();
        const ms = Date.now() - t0;
        const message = err instanceof Error ? err.message : String(err);
        rows.push({ q: question.q, expect: question.expect, hit: false, answer: `ERROR: ${message}`, iterations: -1, ms });
        console.error(`✗ (${ms}ms, ERROR) ${question.q} — ${message}`);
      }
    }

    const n = questions.length;
    console.log(`\nretrieval agent end-to-end: ${hits}/${n} (${((hits / n) * 100).toFixed(0)}%) — sample size ${n} of 20`);
    if (n < 20) {
      console.log("PARTIAL RUN — not the full golden set. Do not compare this fraction directly to the @5/@10 baseline.");
    }
    console.log("baseline (evals/golden/RESULTS.md, raw ranking, NOT an agent): vector 19/20 (95%) @5, BM25 13/20 (65%) @5");
    if (n === 20) {
      if (hits > 19) console.log(`beat the raw-vector baseline by ${hits - 19}`);
      else if (hits === 19) console.log("matched the raw-vector baseline");
      else console.log(`behind the raw-vector baseline by ${19 - hits}`);
    }

    if (explain) {
      console.log("\nmisses:");
      for (const r of rows.filter((r) => !r.hit)) {
        console.log(`  ✗ ${r.q}\n    expected: "${r.expect}"\n    answer (${r.iterations} tool calls): ${r.answer.slice(0, 300)}`);
      }
    }
  } finally {
    if (!noCleanup) {
      await db.delete(courses).where(eq(courses.id, courseId));
      console.error(`cleaned up course ${courseId}`);
    }
  }
}

// @mola/db opens a postgres.js connection pool that otherwise keeps the
// event loop alive indefinitely (unlike evals/golden/run.ts, which only
// fetches — no DB connection to hang around). Force exit, same as
// packages/db/src/seed.ts does for the same reason.
try {
  await main();
  process.exit(0);
} catch (err) {
  console.error(err);
  process.exit(1);
}
