from __future__ import annotations

import io
import socket
import uuid

import pymupdf
import pytest
from docx import Document as DocxDocument

from ingest.config import CONFIG
from ingest.db import get_conn
from ingest.s3 import get_s3_client


def clamd_available() -> bool:
    try:
        with socket.create_connection((CONFIG.clamd_host, CONFIG.clamd_port), timeout=1):
            return True
    except OSError:
        return False


requires_clamd = pytest.mark.skipif(
    not clamd_available(), reason="clamd not reachable on CLAMD_HOST:CLAMD_PORT"
)


@pytest.fixture(scope="session")
def s3_client():
    return get_s3_client()


@pytest.fixture()
def db_conn():
    with get_conn() as conn:
        yield conn


@pytest.fixture()
def test_user(db_conn):
    """A throwaway user, deleted (cascading to its documents/chunks/jobs) at
    teardown so tests don't pollute mola_b or interfere with each other's
    per-user quota checks."""
    user_id = str(uuid.uuid4())
    email = f"pytest-{user_id}@test.mola"
    with db_conn.cursor() as cur:
        cur.execute(
            "INSERT INTO users (id, email, name) VALUES (%s, %s, 'Pytest User')",
            (user_id, email),
        )
    db_conn.commit()
    yield user_id
    with db_conn.cursor() as cur:
        cur.execute("DELETE FROM users WHERE id = %s", (user_id,))
    db_conn.commit()


@pytest.fixture()
def minimal_pdf_bytes() -> bytes:
    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_text((72, 72), "Operating systems manage processes and memory.")
    data = doc.tobytes()
    doc.close()
    return data


@pytest.fixture()
def minimal_md_bytes() -> bytes:
    return b"# Notes\n\nOperating systems manage processes and memory.\n"


@pytest.fixture()
def minimal_docx_bytes() -> bytes:
    doc = DocxDocument()
    doc.add_paragraph("Operating systems manage processes and memory.")
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


@pytest.fixture()
def renamed_executable_bytes() -> bytes:
    """First bytes of a real Mach-O binary — enough for libmagic to identify
    it as an executable, not a document, even with a .pdf filename."""
    with open("/bin/ls", "rb") as f:
        return f.read(4096)
