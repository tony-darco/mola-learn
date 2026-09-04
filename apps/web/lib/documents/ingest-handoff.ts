/**
 * Agent D's ingestion handoff (§12, plan item S5).
 *
 * Agent D does NOT extract text, chunk, embed or summarize — that is Agent B's
 * worker, which does not exist yet. This module does exactly the three things
 * the handoff spec calls for and nothing else:
 *
 *   1. write the upload to the `mola-raw` bucket via a pre-signed URL
 *   2. insert a `documents` row with status "scanning"
 *   3. enqueue a row in the `jobs` table — the one trigger Agent B's worker polls
 *
 * The pre-signed URL is used here rather than a literal client fetch because
 * the create-course form and the course Context panel both post the file to
 * this Next.js server as normal multipart form data (avoiding a browser CORS
 * dance across five agents' ports — 3000-3003 — against one shared LocalStack
 * bucket already configured to allow only :3000). The server still never
 * writes to S3 with a long-lived credential path: it PUTs through the same
 * pre-signed URL a browser would get, so the handoff contract — "a pre-signed
 * URL is what reaches the raw bucket" — holds exactly as written.
 */
import { randomUUID } from "node:crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { db, documents, jobs } from "@mola/db";

const RAW_BUCKET = process.env.MOLA_RAW_BUCKET ?? "mola-raw";

export type DocumentKind = "syllabus" | "textbook" | "lecture_transcript" | "student_notes";

function s3Client(): S3Client {
  return new S3Client({
    endpoint: process.env.AWS_ENDPOINT_URL ?? "http://192.168.1.17:4566",
    region: process.env.AWS_REGION ?? "us-east-1",
    forcePathStyle: true,
    // The SDK's default ("WHEN_SUPPORTED") bakes an x-amz-checksum-* header
    // into the presigned URL's signature for any operation that supports one
    // — PutObject does. That header is then part of what the signature
    // covers, but the plain `fetch` PUT below never computes or sends a
    // matching checksum (nothing here runs through the SDK's own request
    // pipeline), so LocalStack rejects the request as an invalid checksum
    // value. "WHEN_REQUIRED" only adds one when the operation demands it.
    requestChecksumCalculation: "WHEN_REQUIRED",
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "test",
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "test",
    },
  });
}

export async function uploadDocumentAndEnqueue(input: {
  userId: string;
  courseId: string;
  kind: DocumentKind;
  file: File;
}) {
  const documentId = randomUUID();
  const key = `${input.userId}/${documentId}/${input.file.name}`;
  const contentType = input.file.type || "application/octet-stream";

  const putUrl = await getSignedUrl(
    s3Client(),
    new PutObjectCommand({ Bucket: RAW_BUCKET, Key: key, ContentType: contentType }),
    { expiresIn: 300 },
  );

  const bytes = Buffer.from(await input.file.arrayBuffer());
  const put = await fetch(putUrl, { method: "PUT", body: bytes, headers: { "content-type": contentType } });
  if (!put.ok) {
    throw new Error(`raw bucket upload failed: ${put.status} ${await put.text()}`);
  }

  const [doc] = await db
    .insert(documents)
    .values({
      id: documentId,
      userId: input.userId,
      courseId: input.courseId,
      kind: input.kind,
      title: input.file.name,
      s3KeyRaw: key,
      status: "scanning",
      byteSize: bytes.byteLength,
      mimeType: contentType,
    })
    .returning();

  // Ingest is triggered by this table in Phase 1 — one trigger, not two (§12).
  // Agent D does not claim or run this job; Agent B's worker does.
  await db.insert(jobs).values({
    userId: input.userId,
    kind: "ingest_document",
    payload: { documentId: doc!.id },
  });

  return doc!;
}
