"""
End-to-end tests for the textbook chapter tree, against the real local infra
(same pattern as test_pipeline_integration.py). Builds small synthetic PDFs
with pymupdf rather than using a real textbook (none were available in this
environment) — this still exercises the real extract -> chunk -> insert_chunks
path and the real page-reconstruction-from-chunks logic, which the pure unit
tests in test_toc.py (synthetic string tuples, no DB/PDF involved) don't cover.
"""
from __future__ import annotations

import uuid

import pymupdf
import pytest

from ingest.chapters import process_chapter_fill, process_toc_detection
from ingest.db import get_conn
from ingest.pipeline import process_document
from ingest.s3 import upload_bytes
from ingest.config import CONFIG
from ingest.scanner import StubScanner

CHAPTERS = [
    ("Introduction", "This chapter introduces the fundamentals of the subject matter in depth."),
    ("Linear Equations", "This chapter covers solving systems of linear equations step by step."),
    ("Matrices", "This chapter covers matrix operations, determinants, and eigenvalues."),
]


class FakeEmbedder:
    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return [[0.001 * (i + 1)] * CONFIG.embed_dim for i in range(len(texts))]


class FakeSummarizer:
    def summarize(self, title: str, sample_text: str) -> tuple[str, str]:
        return f"Summary of {title}", "A short foreword."


class FakeChapterSummarizer:
    def summarize_chapter(self, title, chapter_number, sample_text):
        return ([f"topic-{title.lower()}"], f"Overview of {title}.")

    def propose_subsections(self, sample_text):
        return [("Subsection A", "Content of subsection A."), ("Subsection B", "Content of subsection B.")]


def _make_textbook_pdf(chapters: list[tuple[str, str]]) -> bytes:
    doc = pymupdf.open()

    preface = doc.new_page()
    preface.insert_text((72, 72), "Preface")
    preface.insert_text((72, 100), "This book introduces the reader to the subject matter.")

    toc_page = doc.new_page()
    toc_page.insert_text((72, 72), "Contents")
    y = 100
    for i, (title, _) in enumerate(chapters, start=1):
        toc_page.insert_text((72, y), f"{i}. {title} .......................... {i * 10 + 2}")
        y += 20

    for title, body in chapters:
        page = doc.new_page()
        page.insert_text((72, 72), title)
        page.insert_text((72, 100), body)

    data = doc.tobytes()
    doc.close()
    return data


def _make_no_toc_pdf() -> bytes:
    doc = pymupdf.open()
    for i in range(3):
        page = doc.new_page()
        page.insert_text((72, 72), f"Page {i + 1}")
        page.insert_text((72, 100), "Plain prose with no table of contents anywhere in this book.")
    data = doc.tobytes()
    doc.close()
    return data


def _upload_and_insert(db_conn, s3_client, user_id, filename, data, kind) -> str:
    document_id = str(uuid.uuid4())
    key = f"raw/{user_id}/{document_id}/{filename}"
    upload_bytes(s3_client, CONFIG.s3_bucket_raw, key, data)
    with db_conn.cursor() as cur:
        cur.execute(
            "INSERT INTO documents (id, user_id, kind, title, s3_key_raw, status, byte_size) "
            "VALUES (%s, %s, %s, %s, %s, 'scanning', %s)",
            (document_id, user_id, kind, filename, key, len(data)),
        )
    db_conn.commit()
    return document_id


def _get_document(db_conn, document_id):
    with db_conn.cursor() as cur:
        cur.execute("SELECT * FROM documents WHERE id = %s", (document_id,))
        return cur.fetchone()


def _get_textbook_chapters(db_conn, document_id):
    with db_conn.cursor() as cur:
        cur.execute(
            "SELECT * FROM textbook_chapters WHERE document_id = %s ORDER BY ordinal", (document_id,)
        )
        return cur.fetchall()


def _get_textbook_sections(db_conn, chapter_id):
    with db_conn.cursor() as cur:
        cur.execute(
            "SELECT * FROM textbook_sections WHERE chapter_id = %s ORDER BY ordinal", (chapter_id,)
        )
        return cur.fetchall()


def test_textbook_toc_detection_and_chapter_fill_happy_path(db_conn, s3_client, test_user):
    data = _make_textbook_pdf(CHAPTERS)
    document_id = _upload_and_insert(db_conn, s3_client, test_user, "textbook.pdf", data, kind="textbook")

    process_document(db_conn, s3_client, document_id, StubScanner(), FakeEmbedder(), FakeSummarizer())

    doc = _get_document(db_conn, document_id)
    assert doc["status"] == "ready"
    assert doc["textbook_toc_status"] == "pending"  # chaining trigger fired, job not run yet

    # Run the enqueued detect_textbook_toc job's handler directly rather than
    # draining the queue through worker.run_once().
    process_toc_detection(db_conn, document_id)

    doc = _get_document(db_conn, document_id)
    assert doc["textbook_toc_status"] == "building"

    chapters = _get_textbook_chapters(db_conn, document_id)
    assert [c["title"] for c in chapters] == [title for title, _ in CHAPTERS]
    assert [c["chapter_number"] for c in chapters] == [1, 2, 3]
    assert all(c["status"] == "pending" for c in chapters)
    # First two chapters resolved a start_locator from title-matching; end
    # chains to the next chapter's start; last chapter's end is unresolved.
    assert chapters[0]["start_locator"] is not None
    assert chapters[-1]["end_locator"] is None

    fake_summarizer = FakeChapterSummarizer()
    for chapter in chapters:
        process_chapter_fill(db_conn, document_id, chapter["id"], fake_summarizer)

    chapters = _get_textbook_chapters(db_conn, document_id)
    assert all(c["status"] == "ready" for c in chapters)
    assert all(c["markdown"] for c in chapters)
    assert all(c["topics"] for c in chapters)

    for chapter in chapters:
        sections = _get_textbook_sections(db_conn, chapter["id"])
        assert len(sections) == 2
        assert all(s["status"] == "ready" and s["markdown"] for s in sections)

    doc = _get_document(db_conn, document_id)
    assert doc["textbook_toc_status"] == "ready"
    assert "Introduction" in doc["pointer_md"]


def test_chapter_fill_is_idempotent_on_retry(db_conn, s3_client, test_user):
    data = _make_textbook_pdf(CHAPTERS)
    document_id = _upload_and_insert(db_conn, s3_client, test_user, "textbook.pdf", data, kind="textbook")
    process_document(db_conn, s3_client, document_id, StubScanner(), FakeEmbedder(), FakeSummarizer())
    process_toc_detection(db_conn, document_id)

    chapters = _get_textbook_chapters(db_conn, document_id)
    fake_summarizer = FakeChapterSummarizer()
    chapter_id = chapters[0]["id"]

    process_chapter_fill(db_conn, document_id, chapter_id, fake_summarizer)
    process_chapter_fill(db_conn, document_id, chapter_id, fake_summarizer)  # no-op, already ready

    sections = _get_textbook_sections(db_conn, chapter_id)
    assert len(sections) == 2  # ON CONFLICT DO UPDATE, not duplicated


def test_textbook_without_toc_degrades_gracefully(db_conn, s3_client, test_user):
    data = _make_no_toc_pdf()
    document_id = _upload_and_insert(db_conn, s3_client, test_user, "no-toc.pdf", data, kind="textbook")

    process_document(db_conn, s3_client, document_id, StubScanner(), FakeEmbedder(), FakeSummarizer())

    doc = _get_document(db_conn, document_id)
    assert doc["status"] == "ready"  # base ingestion never fails because of this

    process_toc_detection(db_conn, document_id)

    doc = _get_document(db_conn, document_id)
    assert doc["textbook_toc_status"] == "no_toc_found"
    assert _get_textbook_chapters(db_conn, document_id) == []


def test_txt_textbook_never_attempts_chapter_tree(db_conn, s3_client, test_user):
    data = ("Operating systems manage processes, memory, and file systems. " * 80).encode()
    document_id = _upload_and_insert(db_conn, s3_client, test_user, "textbook.txt", data, kind="textbook")

    process_document(db_conn, s3_client, document_id, StubScanner(), FakeEmbedder(), FakeSummarizer())

    doc = _get_document(db_conn, document_id)
    assert doc["status"] == "ready"
    assert doc["textbook_toc_status"] == "not_applicable"
