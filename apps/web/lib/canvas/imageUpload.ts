"use server";

/**
 * Canvas image uploads, following the same pre-signed-URL shape as
 * lib/documents/ingest-handoff.ts (§12) — a browser file goes to this
 * server as multipart form data, and the server PUTs it to S3 through a
 * pre-signed URL rather than holding a long-lived credential path itself.
 * Canvas images live in their own bucket/prefix, separate from course
 * document ingestion (a different pipeline with different retention needs).
 */
import { randomUUID } from "node:crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { requireSession } from "@/lib/auth/ownership";

const CANVAS_BUCKET = process.env.MOLA_CANVAS_BUCKET ?? "mola-canvas";

function s3Client(): S3Client {
  return new S3Client({
    endpoint: process.env.AWS_ENDPOINT_URL ?? "http://192.168.1.17:4566",
    region: process.env.AWS_REGION ?? "us-east-1",
    forcePathStyle: true,
    requestChecksumCalculation: "WHEN_REQUIRED",
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "test",
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "test",
    },
  });
}

export async function uploadCanvasImageAction(formData: FormData): Promise<{ url: string }> {
  const session = await requireSession();
  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("no file provided");
  if (!file.type.startsWith("image/")) throw new Error("only image files are supported");

  const key = `${session.userId}/${randomUUID()}-${file.name}`;
  const contentType = file.type || "application/octet-stream";

  const putUrl = await getSignedUrl(
    s3Client(),
    new PutObjectCommand({ Bucket: CANVAS_BUCKET, Key: key, ContentType: contentType }),
    { expiresIn: 300 },
  );

  const bytes = Buffer.from(await file.arrayBuffer());
  const put = await fetch(putUrl, { method: "PUT", body: bytes, headers: { "content-type": contentType } });
  if (!put.ok) throw new Error(`canvas image upload failed: ${put.status} ${await put.text()}`);

  // A presigned GET would eventually expire and break an already-persisted
  // canvas element, so this stores the plain object URL instead — relies on
  // the canvas bucket allowing anonymous GET (true by default on this dev
  // LocalStack setup). A real deployment would need either a bucket policy
  // making canvas images public-read, or a proxy route that streams the
  // object through an authenticated request instead of a public URL.
  const endpoint = process.env.AWS_ENDPOINT_URL ?? "http://192.168.1.17:4566";
  return { url: `${endpoint}/${CANVAS_BUCKET}/${key}` };
}
