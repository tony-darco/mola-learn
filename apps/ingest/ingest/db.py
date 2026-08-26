"""
Thin Postgres access layer. Raw SQL against the Drizzle-owned schema
(packages/db/src/schema.ts, contract 1) — no ORM on the Python side, since this
worker only ever touches four tables (documents, document_chunks, jobs, users)
and the schema is frozen. Column names below must track that file exactly.
"""
from __future__ import annotations

from contextlib import contextmanager
from typing import Any, Iterator

import psycopg
from psycopg.rows import dict_row

from .config import CONFIG


@contextmanager
def get_conn() -> Iterator[psycopg.Connection]:
    conn = psycopg.connect(CONFIG.database_url, row_factory=dict_row, autocommit=False)
    try:
        yield conn
    finally:
        conn.close()


def get_document(conn: psycopg.Connection, document_id: str) -> dict[str, Any] | None:
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM documents WHERE id = %s", (document_id,))
        return cur.fetchone()


def set_document_status(
    conn: psycopg.Connection,
    document_id: str,
    status: str,
    detail: str | None = None,
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE documents SET status = %s, status_detail = %s, updated_at = now() "
            "WHERE id = %s",
            (status, detail, document_id),
        )
    conn.commit()


def set_document_safe_key(conn: psycopg.Connection, document_id: str, s3_key_safe: str) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE documents SET s3_key_safe = %s, updated_at = now() WHERE id = %s",
            (s3_key_safe, document_id),
        )
    conn.commit()


def set_document_hash_and_size(
    conn: psycopg.Connection, document_id: str, sha256: str, byte_size: int, mime_type: str
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE documents SET content_sha256 = %s, byte_size = %s, mime_type = %s, "
            "updated_at = now() WHERE id = %s",
            (sha256, byte_size, mime_type, document_id),
        )
    conn.commit()


def set_document_pointer(conn: psycopg.Connection, document_id: str, pointer_md: str) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE documents SET pointer_md = %s, updated_at = now() WHERE id = %s",
            (pointer_md, document_id),
        )
    conn.commit()


def find_ready_document_by_hash(
    conn: psycopg.Connection, sha256: str, exclude_document_id: str
) -> dict[str, Any] | None:
    """Dedup lookup (§12 content_sha256): a `ready` document with identical bytes
    means we can reuse its chunks instead of re-extracting and re-embedding."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT * FROM documents WHERE content_sha256 = %s AND status = 'ready' "
            "AND id != %s ORDER BY created_at ASC LIMIT 1",
            (sha256, exclude_document_id),
        )
        return cur.fetchone()


def sum_user_document_bytes(conn: psycopg.Connection, user_id: str, exclude_document_id: str) -> int:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT COALESCE(SUM(byte_size), 0) AS total FROM documents "
            "WHERE user_id = %s AND id != %s AND status NOT IN ('failed', 'quarantined')",
            (user_id, exclude_document_id),
        )
        row = cur.fetchone()
        return int(row["total"]) if row else 0


def insert_chunks(
    conn: psycopg.Connection,
    document_id: str,
    user_id: str,
    chunks: list[tuple[str, str | None]],
) -> int:
    """Insert extracted text with NO embedding yet — a chunk is grep/BM25
    searchable the moment it's extracted; the vector lands later (§7/§12)."""
    with conn.cursor() as cur:
        for ordinal, (text, locator) in enumerate(chunks):
            cur.execute(
                "INSERT INTO document_chunks (user_id, document_id, ordinal, text, locator) "
                "VALUES (%s, %s, %s, %s, %s) "
                "ON CONFLICT (document_id, ordinal) DO UPDATE SET text = EXCLUDED.text, "
                "locator = EXCLUDED.locator",
                (user_id, document_id, ordinal, text, locator),
            )
    conn.commit()
    return len(chunks)


def get_chunks_needing_embedding(conn: psycopg.Connection, document_id: str) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, ordinal, text FROM document_chunks "
            "WHERE document_id = %s AND embedding IS NULL ORDER BY ordinal",
            (document_id,),
        )
        return cur.fetchall()


def write_embedding(
    conn: psycopg.Connection,
    chunk_id: str,
    embedding: list[float],
    embedding_model: str,
    embedding_version: int,
) -> None:
    vector_literal = "[" + ",".join(repr(float(x)) for x in embedding) + "]"
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE document_chunks SET embedding = %s::vector, embedding_model = %s, "
            "embedding_version = %s WHERE id = %s",
            (vector_literal, embedding_model, embedding_version, chunk_id),
        )
    conn.commit()


def copy_chunks_from(
    conn: psycopg.Connection, source_document_id: str, target_document_id: str, target_user_id: str
) -> int:
    """Dedup fast path: clone another document's already-embedded chunks onto
    this document instead of re-extracting/re-embedding identical bytes."""
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO document_chunks "
            "(user_id, document_id, ordinal, text, locator, embedding, embedding_model, embedding_version) "
            "SELECT %s, %s, ordinal, text, locator, embedding, embedding_model, embedding_version "
            "FROM document_chunks WHERE document_id = %s "
            "ON CONFLICT (document_id, ordinal) DO NOTHING",
            (target_user_id, target_document_id, source_document_id),
        )
        count = cur.rowcount
    conn.commit()
    return count
