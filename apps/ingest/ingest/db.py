"""
Thin Postgres access layer. Raw SQL against the Drizzle-owned schema
(packages/db/src/schema.ts, contract 1) — no ORM on the Python side. This
worker touches documents, document_chunks, jobs, users, and — as of the
textbook knowledge tree — textbook_chapters/textbook_sections. Column names
below must track that file exactly.
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


def get_document_chunks(conn: psycopg.Connection, document_id: str) -> list[dict[str, Any]]:
    """Ordered chunk rows for reconstructing per-page text (toc.py's
    reconstruct_pages) — never re-reads S3 or re-runs extraction."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT ordinal, text, locator FROM document_chunks "
            "WHERE document_id = %s ORDER BY ordinal",
            (document_id,),
        )
        return cur.fetchall()


def set_textbook_toc_status(conn: psycopg.Connection, document_id: str, status: str) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE documents SET textbook_toc_status = %s, updated_at = now() WHERE id = %s",
            (status, document_id),
        )
    conn.commit()


def insert_textbook_chapters(
    conn: psycopg.Connection,
    document_id: str,
    user_id: str,
    chapters: list[dict[str, Any]],
) -> list[str]:
    """Inserts one row per chapter (ordinal, chapter_number, title,
    toc_locator, start_locator, end_locator) and returns the new chapter ids
    in the same order — chapters.py enqueues one fill job per id. Only ever
    called once per document (TOC detection runs at most once), so no
    ON CONFLICT handling is needed here."""
    ids: list[str] = []
    with conn.cursor() as cur:
        for ordinal, chapter in enumerate(chapters):
            cur.execute(
                "INSERT INTO textbook_chapters "
                "(user_id, document_id, ordinal, chapter_number, title, toc_locator, start_locator, end_locator) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
                (
                    user_id, document_id, ordinal, chapter.get("chapter_number"), chapter["title"],
                    chapter.get("toc_locator"), chapter.get("start_locator"), chapter.get("end_locator"),
                ),
            )
            ids.append(str(cur.fetchone()["id"]))
    conn.commit()
    return ids


def get_textbook_chapter(conn: psycopg.Connection, chapter_id: str) -> dict[str, Any] | None:
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM textbook_chapters WHERE id = %s", (chapter_id,))
        return cur.fetchone()


def set_textbook_chapter_content(
    conn: psycopg.Connection, chapter_id: str, markdown: str, topics: list[str]
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE textbook_chapters SET markdown = %s, topics = %s, status = 'ready', "
            "updated_at = now() WHERE id = %s",
            (markdown, psycopg.types.json.Json(topics), chapter_id),
        )
    conn.commit()


def set_textbook_chapter_status(
    conn: psycopg.Connection, chapter_id: str, status: str, detail: str | None = None
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE textbook_chapters SET status = %s, status_detail = %s, updated_at = now() WHERE id = %s",
            (status, detail, chapter_id),
        )
    conn.commit()


def insert_textbook_sections(
    conn: psycopg.Connection,
    chapter_id: str,
    document_id: str,
    user_id: str,
    sections: list[tuple[str, str]],
) -> int:
    """(title, markdown) pairs, ON CONFLICT (chapter_id, ordinal) DO UPDATE —
    the same idempotency pattern as insert_chunks, so a retried chapter-fill
    job safely overwrites rather than duplicating."""
    with conn.cursor() as cur:
        for ordinal, (title, markdown) in enumerate(sections):
            cur.execute(
                "INSERT INTO textbook_sections (user_id, document_id, chapter_id, ordinal, title, markdown) "
                "VALUES (%s, %s, %s, %s, %s, %s) "
                "ON CONFLICT (chapter_id, ordinal) DO UPDATE SET title = EXCLUDED.title, "
                "markdown = EXCLUDED.markdown, updated_at = now()",
                (user_id, document_id, chapter_id, ordinal, title, markdown),
            )
    conn.commit()
    return len(sections)


def lock_document_row(conn: psycopg.Connection, document_id: str) -> None:
    """SELECT ... FOR UPDATE with no other effect — call before
    count_pending_textbook_chapters when deciding whether the last chapter
    just finished, so two chapter-fill jobs completing concurrently don't
    both regenerate the book-level pointer."""
    with conn.cursor() as cur:
        cur.execute("SELECT id FROM documents WHERE id = %s FOR UPDATE", (document_id,))


def count_pending_textbook_chapters(conn: psycopg.Connection, document_id: str) -> int:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT count(*) AS n FROM textbook_chapters "
            "WHERE document_id = %s AND status IN ('pending', 'filling')",
            (document_id,),
        )
        return int(cur.fetchone()["n"])


def get_ready_textbook_chapters(conn: psycopg.Connection, document_id: str) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT chapter_number, title, topics FROM textbook_chapters "
            "WHERE document_id = %s AND status = 'ready' ORDER BY ordinal",
            (document_id,),
        )
        return cur.fetchall()


def copy_textbook_tree_from(
    conn: psycopg.Connection, source_document_id: str, target_document_id: str, target_user_id: str
) -> int:
    """Dedup fast path for the chapter tree, mirroring copy_chunks_from:
    clone another document's already-built chapters/sections instead of
    re-running TOC detection and N chapter-fill jobs. Chapters are copied
    first (capturing old->new id mapping) since sections FK to chapter ids,
    not document ids."""
    chapter_id_map: dict[str, str] = {}
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, ordinal, chapter_number, title, toc_locator, start_locator, end_locator, "
            "topics, markdown, status, status_detail FROM textbook_chapters "
            "WHERE document_id = %s ORDER BY ordinal",
            (source_document_id,),
        )
        source_chapters = cur.fetchall()

        for chapter in source_chapters:
            cur.execute(
                "INSERT INTO textbook_chapters "
                "(user_id, document_id, ordinal, chapter_number, title, toc_locator, start_locator, "
                "end_locator, topics, markdown, status, status_detail) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
                (
                    target_user_id, target_document_id, chapter["ordinal"], chapter["chapter_number"],
                    chapter["title"], chapter["toc_locator"], chapter["start_locator"], chapter["end_locator"],
                    psycopg.types.json.Json(chapter["topics"]), chapter["markdown"], chapter["status"],
                    chapter["status_detail"],
                ),
            )
            chapter_id_map[chapter["id"]] = cur.fetchone()["id"]

        count = len(chapter_id_map)
        if chapter_id_map:
            cur.execute(
                "SELECT chapter_id, ordinal, title, start_locator, end_locator, markdown, status, "
                "status_detail FROM textbook_sections WHERE document_id = %s ORDER BY chapter_id, ordinal",
                (source_document_id,),
            )
            for section in cur.fetchall():
                new_chapter_id = chapter_id_map.get(section["chapter_id"])
                if new_chapter_id is None:
                    continue
                cur.execute(
                    "INSERT INTO textbook_sections "
                    "(user_id, document_id, chapter_id, ordinal, title, start_locator, end_locator, "
                    "markdown, status, status_detail) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                    (
                        target_user_id, target_document_id, new_chapter_id, section["ordinal"],
                        section["title"], section["start_locator"], section["end_locator"],
                        section["markdown"], section["status"], section["status_detail"],
                    ),
                )
    conn.commit()
    return count
