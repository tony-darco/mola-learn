"""
The `jobs` table is the ONE trigger for this worker (CONTRACTS.md: "Ingest is
triggered by the jobs table in Phase 1 — one trigger, not two."). No S3 event
subscription exists anywhere in this package; that swap is Phase 3 and, per
the same contract, must stay wiring-only. worker.py is the only caller of
claim_job — that boundary is what keeps the swap cheap.

Rows are claimed with `FOR UPDATE SKIP LOCKED` so multiple worker processes
can run against the same queue without double-processing a row.
"""
from __future__ import annotations

from typing import Any

import psycopg

from .config import CONFIG

INGEST_JOB_KIND = "ingest_document"
DETECT_TOC_JOB_KIND = "detect_textbook_toc"
FILL_CHAPTER_JOB_KIND = "fill_textbook_chapter"


def claim_job(conn: psycopg.Connection) -> dict[str, Any] | None:
    """Claims the oldest pending row of ANY kind — worker.py dispatches on
    job["kind"]. (Previously scoped to INGEST_JOB_KIND only; the jobs table
    docstring already frames it as "the ONE trigger", not "the one job
    kind", so serving more kinds through the same queue is a narrowing
    correction, not a contract break.)"""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT * FROM jobs WHERE status = 'pending' AND run_after <= now() "
            "ORDER BY created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED",
        )
        row = cur.fetchone()
        if row is None:
            conn.commit()
            return None
        cur.execute(
            "UPDATE jobs SET status = 'running', locked_at = now() WHERE id = %s",
            (row["id"],),
        )
    conn.commit()
    return row


def mark_done(conn: psycopg.Connection, job_id: str) -> None:
    with conn.cursor() as cur:
        cur.execute("UPDATE jobs SET status = 'done' WHERE id = %s", (job_id,))
    conn.commit()


def mark_failed(
    conn: psycopg.Connection, job_id: str, attempts: int, error: str, permanent: bool = False
) -> None:
    """Permanent failures (policy/sniff/scan rejections — the document is
    already 'failed' or 'quarantined', retrying won't change the bytes) go
    straight to job status 'failed' with no retry. Transient errors (DB
    hiccup, Ollama timeout) retry with exponential backoff up to max_attempts."""
    new_attempts = attempts + 1
    if permanent or new_attempts >= CONFIG.max_attempts:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE jobs SET status = 'failed', attempts = %s, last_error = %s "
                "WHERE id = %s",
                (new_attempts, error, job_id),
            )
    else:
        backoff_seconds = min(2**new_attempts, 300)
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE jobs SET status = 'pending', attempts = %s, last_error = %s, "
                "run_after = now() + (%s * interval '1 second') WHERE id = %s",
                (new_attempts, error, backoff_seconds, job_id),
            )
    conn.commit()


def enqueue(conn: psycopg.Connection, user_id: str, kind: str, payload: dict[str, Any]) -> str:
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO jobs (user_id, kind, payload) VALUES (%s, %s, %s) RETURNING id",
            (user_id, kind, psycopg.types.json.Json(payload)),
        )
        job_id = cur.fetchone()["id"]
    conn.commit()
    return job_id
