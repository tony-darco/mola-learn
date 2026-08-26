/**
 * TEST-ONLY FIXTURE. Do not import from any production code path.
 *
 * Agent B's ingestion pipeline (upload → scan → extract → chunk → embed) does
 * not exist yet in this worktree, so `document_chunks` is empty in mola_c.
 * Rather than wait on B or build a second ingestion pipeline, this inserts a
 * document + its chunks directly, in the exact shape B's real pipeline will
 * eventually produce — the schema (contract 1) is frozen and already migrated,
 * so the shape is stable.
 *
 * When `status: "ready"` and an `embedder` is supplied, chunks are embedded
 * with `kind: "document"` — mirroring Agent B's real call, no query prefix
 * (contract 3) — so vector_search sees realistic vectors rather than fakes.
 * Omit the embedder (or use a non-ready status) to exercise the degradation
 * path: chunks exist and are grep/BM25-searchable, but embedding is null.
 */
import { db, documentChunks, documents } from "@mola/db";
import { EMBEDDING } from "@mola/shared";
import type { EmbeddingProvider } from "../../llm/types";

export type SeedDocumentSpec = {
  userId: string;
  courseId: string | null;
  kind: "syllabus" | "textbook" | "lecture_transcript" | "student_notes";
  title: string;
  status: "scanning" | "extracting" | "indexing" | "ready" | "failed" | "quarantined";
  chunks: string[];
  pointerMd?: string | null;
  embedder?: EmbeddingProvider;
};

export async function seedTestDocument(spec: SeedDocumentSpec) {
  const [doc] = await db
    .insert(documents)
    .values({
      userId: spec.userId,
      courseId: spec.courseId,
      kind: spec.kind,
      title: spec.title,
      s3KeyRaw: `test-fixture/${spec.title}`,
      status: spec.status,
      pointerMd: spec.pointerMd ?? null,
    })
    .returning();

  const vectors =
    spec.embedder && spec.status === "ready"
      ? await spec.embedder.embed(spec.chunks, "document")
      : spec.chunks.map(() => null);

  const rows = await db
    .insert(documentChunks)
    .values(
      spec.chunks.map((text, i) => ({
        userId: spec.userId,
        documentId: doc!.id,
        ordinal: i,
        text,
        embedding: vectors[i] ?? null,
        embeddingModel: vectors[i] ? EMBEDDING.model : null,
        embeddingVersion: vectors[i] ? EMBEDDING.version : null,
      })),
    )
    .returning();

  return { document: doc!, chunks: rows };
}
