"""
Manual enqueue helper: `python -m ingest.cli enqueue <path> --user-id <uuid> [--course-id <uuid>] [--kind syllabus]`

This exists because, at Phase 1, Agent D's pre-signed-URL upload flow doesn't
exist yet — there is no other way to get a real file into RAW and a row into
`documents`/`jobs` to exercise this worker end to end. It uploads the file to
S3 RAW directly (the same place a real pre-signed PUT would land it) and
inserts the documents + jobs rows a real upload endpoint would insert.
"""
from __future__ import annotations

import argparse
import os
import uuid

from .config import CONFIG
from .db import get_conn
from .jobs import INGEST_JOB_KIND, enqueue
from .s3 import get_s3_client, upload_bytes


def cmd_enqueue(args: argparse.Namespace) -> None:
    path = args.path
    if not os.path.isfile(path):
        raise SystemExit(f"no such file: {path}")

    document_id = str(uuid.uuid4())
    filename = os.path.basename(path)
    raw_key = f"raw/{args.user_id}/{document_id}/{filename}"

    with open(path, "rb") as f:
        data = f.read()

    s3_client = get_s3_client()
    upload_bytes(s3_client, CONFIG.s3_bucket_raw, raw_key, data)

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO documents (id, user_id, course_id, kind, title, s3_key_raw, "
                "status, byte_size) VALUES (%s, %s, %s, %s, %s, %s, 'scanning', %s)",
                (document_id, args.user_id, args.course_id, args.kind, filename, raw_key, len(data)),
            )
        conn.commit()
        job_id = enqueue(conn, args.user_id, INGEST_JOB_KIND, {"documentId": document_id})

    print(f"document {document_id} uploaded to {CONFIG.s3_bucket_raw}/{raw_key}")
    print(f"job {job_id} enqueued")
    print(document_id)


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m ingest.cli")
    sub = parser.add_subparsers(dest="command", required=True)

    p_enqueue = sub.add_parser("enqueue", help="upload a local file to RAW and enqueue an ingest job")
    p_enqueue.add_argument("path", help="path to a local pdf/docx/md/txt file")
    p_enqueue.add_argument("--user-id", required=True)
    p_enqueue.add_argument("--course-id", default=None)
    p_enqueue.add_argument(
        "--kind", default="syllabus", choices=["syllabus", "textbook", "lecture_transcript", "student_notes"]
    )
    p_enqueue.set_defaults(func=cmd_enqueue)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
