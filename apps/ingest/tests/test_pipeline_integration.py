"""
End-to-end pipeline tests against the real local infra: mola_b Postgres and
LocalStack S3. Malware detection uses the real ClamdScanner (skipped if clamd
isn't reachable). Embedding and pointer-summary generation use fakes here —
the actual Ollama models are exercised separately by the real 20-page-PDF
proof described in the README, so these tests stay fast and deterministic.
"""
from __future__ import annotations

import uuid

import pytest

from ingest.config import CONFIG
from ingest.pipeline import PermanentFailure, process_document
from ingest.s3 import object_exists, upload_bytes
from ingest.scanner import ClamdScanner, StubScanner

from conftest import requires_clamd

TEXT_CONTENT = ("Operating systems manage processes, memory, and file systems. " * 80)

EICAR = (
    r"X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"
).encode()


class FakeEmbedder:
    def __init__(self):
        self.calls = 0

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        self.calls += 1
        return [[0.001 * (i + 1)] * CONFIG.embed_dim for i in range(len(texts))]


class FakeSummarizer:
    def __init__(self):
        self.calls = 0

    def summarize(self, title: str, sample_text: str) -> tuple[str, str]:
        self.calls += 1
        return f"Summary of {title}", "A short foreword."


def _upload_and_insert(db_conn, s3_client, user_id, filename, data, kind="student_notes") -> str:
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


def _get_chunks(db_conn, document_id):
    with db_conn.cursor() as cur:
        cur.execute(
            "SELECT *, vector_dims(embedding) AS embedding_dims FROM document_chunks "
            "WHERE document_id = %s ORDER BY ordinal",
            (document_id,),
        )
        return cur.fetchall()


def test_status_walk_reaches_ready_with_1024_dim_embeddings(db_conn, s3_client, test_user):
    data = TEXT_CONTENT.encode()
    document_id = _upload_and_insert(db_conn, s3_client, test_user, "notes.txt", data)

    process_document(db_conn, s3_client, document_id, StubScanner(), FakeEmbedder(), FakeSummarizer())

    doc = _get_document(db_conn, document_id)
    assert doc["status"] == "ready"
    assert doc["content_sha256"] is not None
    assert doc["s3_key_safe"] is not None
    assert doc["pointer_md"] and "Summary of notes.txt" in doc["pointer_md"]

    # RAW copy is gone, SAFE copy exists — nothing downstream ever reads RAW (§12).
    assert not object_exists(s3_client, CONFIG.s3_bucket_raw, doc["s3_key_raw"])
    assert object_exists(s3_client, CONFIG.s3_bucket_safe, doc["s3_key_safe"])

    chunks = _get_chunks(db_conn, document_id)
    assert len(chunks) > 0
    for c in chunks:
        assert c["embedding_dims"] == 1024
        assert c["embedding_model"] == CONFIG.embed_model
        assert c["embedding_version"] == CONFIG.embed_version


def test_student_notes_md_reaches_ready(db_conn, s3_client, test_user, minimal_md_bytes):
    document_id = _upload_and_insert(db_conn, s3_client, test_user, "notes.md", minimal_md_bytes)

    process_document(db_conn, s3_client, document_id, StubScanner(), FakeEmbedder(), FakeSummarizer())

    doc = _get_document(db_conn, document_id)
    assert doc["status"] == "ready"
    assert len(_get_chunks(db_conn, document_id)) > 0


def test_student_notes_docx_reaches_ready(db_conn, s3_client, test_user, minimal_docx_bytes):
    document_id = _upload_and_insert(db_conn, s3_client, test_user, "notes.docx", minimal_docx_bytes)

    process_document(db_conn, s3_client, document_id, StubScanner(), FakeEmbedder(), FakeSummarizer())

    doc = _get_document(db_conn, document_id)
    assert doc["status"] == "ready"
    assert len(_get_chunks(db_conn, document_id)) > 0


def test_pdf_as_student_notes_is_rejected(db_conn, s3_client, test_user, minimal_pdf_bytes):
    document_id = _upload_and_insert(db_conn, s3_client, test_user, "notes.pdf", minimal_pdf_bytes)

    with pytest.raises(PermanentFailure):
        process_document(db_conn, s3_client, document_id, StubScanner(), FakeEmbedder(), FakeSummarizer())

    doc = _get_document(db_conn, document_id)
    assert doc["status"] == "failed"


@requires_clamd
def test_malware_is_quarantined_and_never_reaches_safe(db_conn, s3_client, test_user):
    document_id = _upload_and_insert(db_conn, s3_client, test_user, "virus.txt", EICAR)

    with pytest.raises(PermanentFailure):
        process_document(db_conn, s3_client, document_id, ClamdScanner(), FakeEmbedder(), FakeSummarizer())

    doc = _get_document(db_conn, document_id)
    assert doc["status"] == "quarantined"
    assert doc["s3_key_safe"] is None
    assert not object_exists(s3_client, CONFIG.s3_bucket_raw, doc["s3_key_raw"])
    assert not object_exists(
        s3_client, CONFIG.s3_bucket_safe, doc["s3_key_raw"].replace("raw/", "safe/", 1)
    )
    quarantine_key = doc["s3_key_raw"].replace("raw/", "quarantine/", 1)
    assert object_exists(s3_client, CONFIG.s3_bucket_quarantine, quarantine_key)
    assert "malware detected" in (doc["status_detail"] or "")


def test_renamed_executable_is_quarantined_and_never_reaches_safe(
    db_conn, s3_client, test_user, renamed_executable_bytes
):
    document_id = _upload_and_insert(db_conn, s3_client, test_user, "malware.pdf", renamed_executable_bytes)

    with pytest.raises(PermanentFailure):
        process_document(db_conn, s3_client, document_id, StubScanner(), FakeEmbedder(), FakeSummarizer())

    doc = _get_document(db_conn, document_id)
    assert doc["status"] == "quarantined"
    assert doc["s3_key_safe"] is None
    assert not object_exists(
        s3_client, CONFIG.s3_bucket_safe, doc["s3_key_raw"].replace("raw/", "safe/", 1)
    )
    assert "type-sniff rejected" in (doc["status_detail"] or "")


def test_dedupe_reuses_chunks_and_skips_reembedding(db_conn, s3_client, test_user):
    data = TEXT_CONTENT.encode()

    doc1 = _upload_and_insert(db_conn, s3_client, test_user, "textbook.txt", data)
    embedder1, summarizer1 = FakeEmbedder(), FakeSummarizer()
    process_document(db_conn, s3_client, doc1, StubScanner(), embedder1, summarizer1)
    assert embedder1.calls == 1
    assert summarizer1.calls == 1

    # A second student uploads byte-identical content under a different filename.
    doc2 = _upload_and_insert(db_conn, s3_client, test_user, "textbook-copy.txt", data)
    embedder2, summarizer2 = FakeEmbedder(), FakeSummarizer()
    process_document(db_conn, s3_client, doc2, StubScanner(), embedder2, summarizer2)

    assert embedder2.calls == 0, "dedup path must not call the embedder at all"
    assert summarizer2.calls == 0, "dedup path must not re-run pointer summarization"

    doc2_row = _get_document(db_conn, doc2)
    assert doc2_row["status"] == "ready"
    assert doc2_row["pointer_md"] == _get_document(db_conn, doc1)["pointer_md"]

    chunks1 = _get_chunks(db_conn, doc1)
    chunks2 = _get_chunks(db_conn, doc2)
    assert len(chunks1) == len(chunks2) > 0
    for c1, c2 in zip(chunks1, chunks2):
        assert c1["text"] == c2["text"]
        assert c1["embedding"] == c2["embedding"]
