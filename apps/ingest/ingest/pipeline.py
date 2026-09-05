"""
The pipeline itself (§7): upload -> scan/verify -> extract text -> chunk -> embed.

Status walk on documents.status: scanning -> extracting -> indexing -> ready
(or failed / quarantined). Called once per claimed job by worker.py.

Security invariants enforced here (§12), not negotiable:
  - bytes are read from RAW exactly once, right at the top of `process_document`
  - everything after the scan step reads from the bytes already in hand or
    from SAFE — nothing downstream re-reads RAW
  - `_quarantine` and the clean-path move are the ONLY two places this whole
    package calls `s3.move_object`
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone

from .chunk import chunk_sections
from .config import CONFIG
from .db import (
    copy_chunks_from,
    find_ready_document_by_hash,
    get_chunks_needing_embedding,
    get_document,
    insert_chunks,
    set_document_hash_and_size,
    set_document_pointer,
    set_document_safe_key,
    set_document_status,
    write_embedding,
)
from .embed import EmbeddingProvider
from .extract import extract
from .pointer import Summarizer, render_pointer_md
from .policy import PolicyError, check_kind_allowed, check_quota, check_size
from .s3 import download_bytes, move_object
from .scanner import MalwareScanner
from .sniff import SniffError, sniff


class PermanentFailure(Exception):
    """Raised for rejections that will never succeed on retry (bad content,
    policy violation, malware). worker.py maps this to a non-retrying job
    failure; anything else is treated as transient and retried."""


def _rekey(raw_key: str, document_id: str, prefix: str) -> str:
    if raw_key.startswith("raw/"):
        return prefix + raw_key[len("raw/"):]
    return f"{prefix}{document_id}"


def _quarantine(conn, s3_client, doc: dict, reason: str) -> None:
    """The scanner is the ONLY component permitted to move objects between
    buckets (§12) — this and the clean-path move in process_document are the
    two call sites. Schema is frozen (contract 1), so the audit record lives
    in documents.status_detail as structured JSON rather than a new table."""
    dst_key = _rekey(doc["s3_key_raw"], doc["id"], "quarantine/")
    move_object(s3_client, CONFIG.s3_bucket_raw, doc["s3_key_raw"], CONFIG.s3_bucket_quarantine, dst_key)
    audit = json.dumps({
        "reason": reason,
        "quarantined_at": datetime.now(timezone.utc).isoformat(),
        "original_raw_key": doc["s3_key_raw"],
        "quarantine_key": dst_key,
    })
    set_document_status(conn, doc["id"], "quarantined", detail=audit)


def process_document(
    conn,
    s3_client,
    document_id: str,
    scanner: MalwareScanner,
    embedder: EmbeddingProvider,
    summarizer: Summarizer,
) -> None:
    doc = get_document(conn, document_id)
    if doc is None:
        raise PermanentFailure(f"document {document_id} does not exist")

    user_id = doc["user_id"]

    if doc["s3_key_safe"]:
        # A previous attempt already scanned this clean and moved it
        # RAW -> SAFE (that move happens at most once — the RAW object is
        # gone afterward). A retry must resume from SAFE rather than
        # re-reading RAW, which would 404.
        data = download_bytes(s3_client, CONFIG.s3_bucket_safe, doc["s3_key_safe"])
        sniffed = sniff(data, doc["title"])
        sha256 = doc["content_sha256"]
        byte_size = doc["byte_size"]
    else:
        # ── scan/verify ──────────────────────────────────────────────────────
        set_document_status(conn, document_id, "scanning")
        data = download_bytes(s3_client, CONFIG.s3_bucket_raw, doc["s3_key_raw"])
        sha256 = hashlib.sha256(data).hexdigest()
        byte_size = len(data)

        try:
            sniffed = sniff(data, doc["title"])
        except SniffError as e:
            _quarantine(conn, s3_client, doc, reason=f"type-sniff rejected: {e}")
            raise PermanentFailure(str(e)) from e

        try:
            check_kind_allowed(sniffed.kind)
            check_size(byte_size)
            check_quota(conn, user_id, byte_size, document_id)
        except PolicyError as e:
            set_document_status(conn, document_id, "failed", detail=str(e))
            raise PermanentFailure(str(e)) from e

        scan_result = scanner.scan(data)
        if not scan_result.clean:
            _quarantine(conn, s3_client, doc, reason=f"malware detected: {scan_result.signature}")
            raise PermanentFailure(f"malware detected: {scan_result.signature}")

        # Clean: move RAW -> SAFE. From this point on nothing reads RAW again.
        safe_key = _rekey(doc["s3_key_raw"], document_id, "safe/")
        move_object(s3_client, CONFIG.s3_bucket_raw, doc["s3_key_raw"], CONFIG.s3_bucket_safe, safe_key)
        set_document_safe_key(conn, document_id, safe_key)
        set_document_hash_and_size(conn, document_id, sha256, byte_size, sniffed.detected_mime)

    # ── dedup (§12 content_sha256) ───────────────────────────────────────────
    duplicate = find_ready_document_by_hash(conn, sha256, exclude_document_id=document_id)
    if duplicate is not None:
        set_document_status(conn, document_id, "indexing", detail="deduplicated, reusing chunks")
        chunk_count = copy_chunks_from(conn, duplicate["id"], document_id, user_id)
        # Identical bytes -> identical summary; skip the LLM call too.
        set_document_pointer(conn, document_id, duplicate["pointer_md"] or "")
        set_document_status(
            conn, document_id, "ready",
            detail=f"deduplicated from document {duplicate['id']} ({chunk_count} chunks reused)",
        )
        return

    # ── extract + chunk ──────────────────────────────────────────────────────
    set_document_status(conn, document_id, "extracting")
    sections = extract(sniffed.kind, data)
    chunks = chunk_sections(sections)
    if not chunks:
        set_document_status(conn, document_id, "failed", detail="no extractable text found")
        raise PermanentFailure("no extractable text found in document")
    insert_chunks(conn, document_id, user_id, chunks)

    # ── embed ────────────────────────────────────────────────────────────────
    set_document_status(conn, document_id, "indexing")
    pending = get_chunks_needing_embedding(conn, document_id)
    vectors = embedder.embed_documents([c["text"] for c in pending])
    if len(vectors) != len(pending):
        raise RuntimeError(f"embedder returned {len(vectors)} vectors for {len(pending)} chunks")
    for chunk_row, vector in zip(pending, vectors):
        if len(vector) != CONFIG.embed_dim:
            raise RuntimeError(f"embedding dim {len(vector)} != configured {CONFIG.embed_dim}")
        write_embedding(conn, chunk_row["id"], vector, CONFIG.embed_model, CONFIG.embed_version)

    # ── pointer file ─────────────────────────────────────────────────────────
    sample_text = "\n\n".join(text for text, _ in sections[:5])
    topic_summary, foreword_summary = summarizer.summarize(doc["title"], sample_text)
    pointer_md = render_pointer_md(
        title=doc["title"],
        kind=sniffed.kind,
        topic_summary=topic_summary,
        foreword_summary=foreword_summary,
        embedding_status="ready",
        chunk_count=len(chunks),
    )
    set_document_pointer(conn, document_id, pointer_md)

    set_document_status(conn, document_id, "ready")
