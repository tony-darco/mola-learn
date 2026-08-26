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
 *     --txt <extracted-syllabus.txt> [--explain]
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
  if (txtArg === -1) throw new Error("usage: golden-eval --txt <extracted-syllabus.txt> [--explain]");
  const explain = process.argv.includes("--explain");

  const text = readFileSync(process.argv[txtArg + 1]!, "utf8");
  const questionsPath = fileURLToPath(new URL("../../../../../evals/golden/questions.json", import.meta.url));
  const { questions } = JSON.parse(readFileSync(questionsPath, "utf8")) as { questions: Question[] };

  const [alice] = await db.select().from(users).where(eq(users.email, "alice@umbc.edu"));
  if (!alice) throw new Error("run `pnpm db:seed` first");
  const [chat] = await db.select().from(chats).where(eq(chats.userId, alice.id)).limit(1);
  if (!chat) throw new Error("run `pnpm db:seed` first");

  const [course] = await db
    .insert(courses)
    .values({ userId: alice.id, name: "Golden-eval scratch course (IS 300)" })
    .returning();

  const registry = buildRegistry();
  const ctx: ToolContext = { session: { userId: alice.id, email: alice.email }, chatId: chat.id, courseId: course!.id };

  try {
    const chunks = chunk(text);
    console.error(`corpus: ${chunks.length} chunks, embedding for real (this calls Ollama)...`);
    await seedTestDocument({
      userId: alice.id,
      courseId: course!.id,
      kind: "syllabus",
      title: "IS 300 Syllabus",
      status: "ready",
      chunks,
      embedder: new SelfHostedEmbeddingProvider(),
    });

    let hits = 0;
    const rows: { q: string; expect: string; hit: boolean; answer: string; iterations: number }[] = [];

    for (const question of questions) {
      const { answer, iterations } = await runRetrievalAgent(question.q, registry, ctx);
      const hit = norm(answer).includes(norm(question.expect));
      if (hit) hits++;
      rows.push({ q: question.q, expect: question.expect, hit, answer, iterations });
      console.error(`${hit ? "✓" : "✗"} ${question.q}`);
    }

    const n = questions.length;
    console.log(`\nretrieval agent end-to-end: ${hits}/${n} (${((hits / n) * 100).toFixed(0)}%)`);
    console.log("baseline (evals/golden/RESULTS.md): vector 19/20 (95%) @5, BM25 13/20 (65%) @5");
    if (hits > 19) console.log(`beat the raw-vector baseline by ${hits - 19}`);
    else if (hits === 19) console.log("matched the raw-vector baseline");
    else console.log(`behind the raw-vector baseline by ${19 - hits}`);

    if (explain) {
      console.log("\nmisses:");
      for (const r of rows.filter((r) => !r.hit)) {
        console.log(`  ✗ ${r.q}\n    expected: "${r.expect}"\n    answer (${r.iterations} tool calls): ${r.answer.slice(0, 300)}`);
      }
    }
  } finally {
    await db.delete(courses).where(eq(courses.id, course!.id));
  }
}

await main();
