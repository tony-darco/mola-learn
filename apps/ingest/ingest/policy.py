"""Size cap, allowed types, per-user quota (§12)."""
from __future__ import annotations

import psycopg

from .config import CONFIG
from .db import sum_user_document_bytes


class PolicyError(Exception):
    """A policy violation — not malicious, just rejected. Document ends in
    'failed', not 'quarantined' (that status is reserved for scan/sniff hits)."""


def check_size(byte_size: int) -> None:
    if byte_size > CONFIG.max_bytes:
        raise PolicyError(
            f"file is {byte_size} bytes, exceeds the {CONFIG.max_bytes}-byte cap"
        )


def check_kind_allowed(kind: str) -> None:
    if kind not in CONFIG.allowed_kinds:
        raise PolicyError(f"file kind '{kind}' is not an allowed type ({CONFIG.allowed_kinds})")


# Restricts which sniffed file formats a given documents.kind may upload as.
# document_kind values absent from this map (syllabus, lecture_transcript) are
# unrestricted — out of scope for this check.
ALLOWED_FORMATS_BY_DOCUMENT_KIND: dict[str, set[str]] = {
    "student_notes": {"txt", "md", "docx"},
    "textbook": {"pdf", "txt"},
}


def check_kind_matches_document_kind(file_kind: str, document_kind: str) -> None:
    allowed = ALLOWED_FORMATS_BY_DOCUMENT_KIND.get(document_kind)
    if allowed is not None and file_kind not in allowed:
        raise PolicyError(
            f"file format '{file_kind}' is not allowed for document kind "
            f"'{document_kind}' (allowed: {sorted(allowed)})"
        )


def check_quota(conn: psycopg.Connection, user_id: str, byte_size: int, document_id: str) -> None:
    existing = sum_user_document_bytes(conn, user_id, exclude_document_id=document_id)
    if existing + byte_size > CONFIG.user_quota_bytes:
        raise PolicyError(
            f"user quota exceeded: {existing} + {byte_size} > {CONFIG.user_quota_bytes} bytes"
        )
