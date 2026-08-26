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


def check_quota(conn: psycopg.Connection, user_id: str, byte_size: int, document_id: str) -> None:
    existing = sum_user_document_bytes(conn, user_id, exclude_document_id=document_id)
    if existing + byte_size > CONFIG.user_quota_bytes:
        raise PolicyError(
            f"user quota exceeded: {existing} + {byte_size} > {CONFIG.user_quota_bytes} bytes"
        )
