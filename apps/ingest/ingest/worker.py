"""
Worker entrypoint: `python -m ingest.worker`.

Polls the `jobs` table — the ONE trigger for this pipeline in Phase 1 (see
jobs.py docstring). Claims one row at a time with FOR UPDATE SKIP LOCKED,
processes it fully off the interactive path, and loops. Run more than one
process for parallelism; SKIP LOCKED makes that safe.
"""
from __future__ import annotations

import logging
import time

from .chapters import get_chapter_summarizer, process_chapter_fill, process_toc_detection
from .config import CONFIG
from .db import get_conn
from .embed import get_embedding_provider
from .jobs import DETECT_TOC_JOB_KIND, FILL_CHAPTER_JOB_KIND, INGEST_JOB_KIND, claim_job, mark_done, mark_failed
from .pipeline import PermanentFailure, process_document
from .pointer import get_summarizer
from .s3 import get_s3_client
from .scanner import get_scanner

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("ingest.worker")


def run_once() -> bool:
    """Claim and process a single job. Returns True if a job was found."""
    scanner = get_scanner()
    embedder = get_embedding_provider()
    summarizer = get_summarizer()
    chapter_summarizer = get_chapter_summarizer()
    s3_client = get_s3_client()

    with get_conn() as conn:
        job = claim_job(conn)
        if job is None:
            return False

        document_id = job["payload"]["documentId"]
        log.info("claimed job %s (kind %s, document %s, attempt %s)",
                  job["id"], job["kind"], document_id, job["attempts"] + 1)
        try:
            if job["kind"] == INGEST_JOB_KIND:
                process_document(conn, s3_client, document_id, scanner, embedder, summarizer)
            elif job["kind"] == DETECT_TOC_JOB_KIND:
                process_toc_detection(conn, document_id)
            elif job["kind"] == FILL_CHAPTER_JOB_KIND:
                process_chapter_fill(conn, document_id, job["payload"]["chapterId"], chapter_summarizer)
            else:
                raise PermanentFailure(f"unknown job kind: {job['kind']}")
        except PermanentFailure as e:
            log.warning("job %s permanently failed: %s", job["id"], e)
            mark_failed(conn, job["id"], job["attempts"], str(e), permanent=True)
            return True
        except Exception as e:  # noqa: BLE001 — transient, retry with backoff
            log.exception("job %s failed, will retry: %s", job["id"], e)
            mark_failed(conn, job["id"], job["attempts"], str(e))
            return True

        mark_done(conn, job["id"])
        log.info("job %s done (document %s)", job["id"], document_id)
        return True


def main() -> None:
    log.info("ingest worker starting, polling every %ss", CONFIG.poll_interval_seconds)
    while True:
        try:
            found = run_once()
        except Exception:
            log.exception("unexpected error in worker loop")
            found = False
        if not found:
            time.sleep(CONFIG.poll_interval_seconds)


if __name__ == "__main__":
    main()
