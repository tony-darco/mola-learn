/**
 * The 20-question golden set.
 *
 * Two jobs (plan: pulled into Phase 0):
 *   1. Confirm the S1.4 model choice against a REAL academic syllabus, because
 *      public benchmark averages are a prior, not a verdict on this corpus.
 *   2. Guard grounding regressions from integration checkpoint 1 onward.
 *
 * It also A/B-tests the query/document asymmetry. That failure mode is silent —
 * nothing errors, retrieval just gets worse — so it needs a measurement, not a
 * code comment.
 *
 *   pnpm --filter @mola/evals golden -- --pdf "/path/to/syllabus.pdf"
 */
import { readFileSync } from "node:fs";
import { EMBEDDING, EMBEDDING_TASK } from "@mola/shared";

const HOST = process.env.OLLAMA_HOST ?? "http://192.168.1.17:11434";
const TOP_K = [1, 3, 5, 10] as const;

type Question = { q: string; expect: string };

/**
 * Deliberately simple fixed-size chunking with overlap. This is a measurement
 * harness, not Agent B's pipeline — when real ingest lands, point this at that
 * chunker instead of duplicating its logic here.
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

async function embed(texts: string[], kind: "query" | "document"): Promise<number[][]> {
  const input = texts.map((t) =>
    kind === "query" ? `Instruct: ${EMBEDDING_TASK}\nQuery: ${t}` : t,
  );
  const res = await fetch(`${HOST}/api/embed`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: EMBEDDING.model, input, options: { num_gpu: 0 } }),
  });
  if (!res.ok) throw new Error(`embed failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { embeddings: number[][] }).embeddings;
}

/** Model output is already L2-normalised, so a dot product is the cosine. */
const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i]!, 0);

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ");

function rank(queryVec: number[], docVecs: number[][]): number[] {
  return docVecs
    .map((v, i) => ({ i, score: dot(queryVec, v) }))
    .sort((a, b) => b.score - a.score)
    .map((r) => r.i);
}

/** Lexical baseline, so the vector numbers have something to be compared against. */
function bm25Rank(query: string, chunks: string[]): number[] {
  const tok = (s: string) => norm(s).match(/[a-z0-9.@-]+/g) ?? [];
  const docs = chunks.map(tok);
  const avgdl = docs.reduce((s, d) => s + d.length, 0) / docs.length;
  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);
  const k1 = 1.5, b = 0.75;

  return docs
    .map((d, i) => {
      let score = 0;
      const tf = new Map<string, number>();
      for (const t of d) tf.set(t, (tf.get(t) ?? 0) + 1);
      for (const t of tok(query)) {
        const f = tf.get(t) ?? 0;
        if (!f) continue;
        const idf = Math.log(1 + (docs.length - (df.get(t) ?? 0) + 0.5) / ((df.get(t) ?? 0) + 0.5));
        score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.length) / avgdl)));
      }
      return { i, score };
    })
    .sort((a, b2) => b2.score - a.score)
    .map((r) => r.i);
}

function recallAt(ranked: number[], chunks: string[], expect: string, k: number): boolean {
  return ranked.slice(0, k).some((i) => norm(chunks[i]!).includes(norm(expect)));
}

async function main() {
  const pdfArg = process.argv.indexOf("--pdf");
  const txtArg = process.argv.indexOf("--txt");
  let text: string;

  if (txtArg !== -1) {
    text = readFileSync(process.argv[txtArg + 1]!, "utf8");
  } else if (pdfArg !== -1) {
    throw new Error("PDF extraction belongs to Agent B. Pass --txt with pre-extracted text.");
  } else {
    throw new Error("usage: golden --txt <extracted-syllabus.txt>");
  }

  const { questions } = JSON.parse(
    readFileSync(new URL("./questions.json", import.meta.url), "utf8"),
  ) as { questions: Question[] };

  const chunks = chunk(text);
  console.log(`corpus: ${chunks.length} chunks · model: ${EMBEDDING.model} (${EMBEDDING.dim}d)\n`);

  // Sanity floor: every expected answer must actually exist in the corpus,
  // otherwise a miss measures the question, not the retriever.
  const missing = questions.filter((q) => !chunks.some((c) => norm(c).includes(norm(q.expect))));
  if (missing.length) {
    console.error("Expected answers absent from corpus:");
    for (const m of missing) console.error(`  - ${m.expect}  (${m.q})`);
    process.exit(1);
  }

  const docVecs = await embed(chunks, "document");
  const correctQ = await embed(questions.map((q) => q.q), "query");
  // The wrong way: query embedded as a document, i.e. asymmetry ignored.
  const naiveQ = await embed(questions.map((q) => q.q), "document");

  const results = { vector: [0, 0, 0, 0], naive: [0, 0, 0, 0], bm25: [0, 0, 0, 0] };
  const failures: string[] = [];

  questions.forEach((q, qi) => {
    const rv = rank(correctQ[qi]!, docVecs);
    const rn = rank(naiveQ[qi]!, docVecs);
    const rb = bm25Rank(q.q, chunks);
    TOP_K.forEach((k, ki) => {
      if (recallAt(rv, chunks, q.expect, k)) results.vector[ki]!++;
      if (recallAt(rn, chunks, q.expect, k)) results.naive[ki]!++;
      if (recallAt(rb, chunks, q.expect, k)) results.bm25[ki]!++;
    });
    if (!recallAt(rv, chunks, q.expect, 5)) failures.push(`  ✗ ${q.q}  → expected "${q.expect}"`);
  });

  const n = questions.length;
  const row = (label: string, r: number[]) =>
    `${label.padEnd(26)}` + TOP_K.map((k, i) => `${`${r[i]}/${n}`.padStart(7)}`).join("") +
    `   (${((r[2]! / n) * 100).toFixed(0)}% @5)`;

  console.log(`${"".padEnd(26)}${TOP_K.map((k) => `   @${k}`.padStart(7)).join("")}`);
  console.log(row("vector (correct prefix)", results.vector));
  console.log(row("vector (no prefix)", results.naive));
  console.log(row("BM25 baseline", results.bm25));

  if (failures.length) {
    console.log(`\nmisses at @5:\n${failures.join("\n")}`);
  }

  // Where the correct chunk actually landed. A miss at rank 6 is a tuning
  // problem; a miss at rank 50 is a retrieval-design problem. Worth knowing
  // which, without re-running by hand.
  if (process.argv.includes("--explain")) {
    console.log("\ngold-chunk rank per question (prefix / no-prefix / bm25):");
    questions.forEach((q, qi) => {
      const gold = chunks.findIndex((c) => norm(c).includes(norm(q.expect)));
      const at = (r: number[]) => r.indexOf(gold) + 1;
      const rv = at(rank(correctQ[qi]!, docVecs));
      const rn = at(rank(naiveQ[qi]!, docVecs));
      const rb = at(bm25Rank(q.q, chunks));
      const flag = rv > 5 ? " ←" : "";
      console.log(
        `  ${String(rv).padStart(3)} ${String(rn).padStart(4)} ${String(rb).padStart(4)}   ${q.q}${flag}`,
      );
    });
  }

  const delta = results.vector[2]! - results.naive[2]!;
  console.log(
    `\nasymmetry delta @5: ${delta >= 0 ? "+" : ""}${delta} questions ` +
      `(${delta > 0 ? "prefix helps — keep it inside EmbeddingProvider" : "no measurable effect on this corpus"})`,
  );
}

await main();
