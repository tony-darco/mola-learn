"""
Embedding via Ollama, CPU-only (contract 3).

CRITICAL ASYMMETRY (see packages/shared/src/embedding.ts): qwen3-embedding is
instruction-aware. Queries get a task-prefix; stored DOCUMENT chunks do NOT.
This module ONLY ever embeds documents — raw chunk text, no prefix, no
exceptions. Getting this backwards fails silently (nothing errors, retrieval
just degrades), which is exactly why it is fenced off in its own function
rather than a shared `embed(text, kind)` helper the caller could misuse.

Query embedding (with the `Instruct: ...\\nQuery: ...` prefix) belongs to
Agent C's retrieval agent and does not exist anywhere in this package.
"""
from __future__ import annotations

from typing import Protocol

import httpx

from .config import CONFIG


class EmbeddingProvider(Protocol):
    def embed_documents(self, texts: list[str]) -> list[list[float]]: ...


class OllamaEmbeddingProvider:
    def __init__(self, host: str | None = None, model: str | None = None, batch_size: int = 16):
        self.host = (host or CONFIG.ollama_host).rstrip("/")
        self.model = model or CONFIG.embed_model
        self.batch_size = batch_size

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        out: list[list[float]] = []
        for i in range(0, len(texts), self.batch_size):
            batch = texts[i : i + self.batch_size]
            resp = httpx.post(
                f"{self.host}/api/embed",
                json={
                    "model": self.model,
                    "input": batch,
                    # Ingestion is batch/offline and must never contend with the
                    # chat model for VRAM (contract 3).
                    "options": {"num_gpu": 0},
                },
                timeout=300,
            )
            resp.raise_for_status()
            embeddings = resp.json()["embeddings"]
            out.extend(embeddings)
        return out


def get_embedding_provider() -> EmbeddingProvider:
    return OllamaEmbeddingProvider()
