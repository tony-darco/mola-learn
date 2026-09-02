"""
Environment configuration for the ingest worker.

Embedding model constants mirror packages/shared/src/embedding.ts (contract 3).
Python cannot import that TS module, so these three values are kept in sync by
hand — if you change the model, dims, or version in embedding.ts, update the
defaults below (or the env vars) to match. A test in tests/test_embed.py
asserts EMBED_DIM matches the vector column width.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field

from dotenv import load_dotenv

load_dotenv()


def _int(name: str, default: int) -> int:
    return int(os.environ.get(name, default))


def _list(name: str, default: str) -> list[str]:
    return [s.strip() for s in os.environ.get(name, default).split(",") if s.strip()]


@dataclass(frozen=True)
class Config:
    database_url: str = field(default_factory=lambda: os.environ.get(
        "DATABASE_URL", "postgres://mola:mola@localhost:5433/mola_b"))

    s3_endpoint: str = field(default_factory=lambda: os.environ.get(
        "S3_ENDPOINT", "http://localhost:4566"))
    s3_region: str = field(default_factory=lambda: os.environ.get("S3_REGION", "us-east-1"))
    s3_access_key_id: str = field(default_factory=lambda: os.environ.get("S3_ACCESS_KEY_ID", "test"))
    s3_secret_access_key: str = field(default_factory=lambda: os.environ.get("S3_SECRET_ACCESS_KEY", "test"))
    s3_bucket_raw: str = field(default_factory=lambda: os.environ.get("S3_BUCKET_RAW", "mola-raw"))
    s3_bucket_safe: str = field(default_factory=lambda: os.environ.get("S3_BUCKET_SAFE", "mola-safe"))
    s3_bucket_quarantine: str = field(default_factory=lambda: os.environ.get(
        "S3_BUCKET_QUARANTINE", "mola-quarantine"))

    embed_model: str = field(default_factory=lambda: os.environ.get("EMBED_MODEL", "qwen3-embedding:0.6b"))
    embed_dim: int = field(default_factory=lambda: _int("EMBED_DIM", 1024))
    embed_version: int = field(default_factory=lambda: _int("EMBED_VERSION", 1))

    ollama_host: str = field(default_factory=lambda: os.environ.get("OLLAMA_HOST", "http://192.168.1.17:11434"))
    chat_model: str = field(default_factory=lambda: os.environ.get("MOLA_CHAT_MODEL", "qwen3.6:27b"))

    scanner: str = field(default_factory=lambda: os.environ.get("INGEST_SCANNER", "clamd"))
    clamd_host: str = field(default_factory=lambda: os.environ.get("CLAMD_HOST", "127.0.0.1"))
    clamd_port: int = field(default_factory=lambda: _int("CLAMD_PORT", 3310))

    max_bytes: int = field(default_factory=lambda: _int("INGEST_MAX_BYTES", 50 * 1024 * 1024))
    user_quota_bytes: int = field(default_factory=lambda: _int("INGEST_USER_QUOTA_BYTES", 500 * 1024 * 1024))
    allowed_kinds: list[str] = field(default_factory=lambda: _list("INGEST_ALLOWED_KINDS", "pdf,docx,md,txt"))

    poll_interval_seconds: float = field(default_factory=lambda: float(
        os.environ.get("INGEST_POLL_INTERVAL_SECONDS", "2")))
    max_attempts: int = field(default_factory=lambda: _int("INGEST_MAX_ATTEMPTS", 5))
    chunk_chars: int = field(default_factory=lambda: _int("INGEST_CHUNK_CHARS", 1800))
    chunk_overlap_chars: int = field(default_factory=lambda: _int("INGEST_CHUNK_OVERLAP_CHARS", 200))


CONFIG = Config()
