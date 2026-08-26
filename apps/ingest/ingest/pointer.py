"""
Pointer file generation (§7): a lightweight SKILL.md-styled markdown per
document — title, topic summary, foreword-style summary, embedding status.
Written to documents.pointer_md; Layer 3 injects this, never full content.

Generating the summary needs an LLM call against MOLA_CHAT_MODEL, separate
from the embedding model (contract 3's platform-owned embedder is not a chat
model and cannot summarize).
"""
from __future__ import annotations

from typing import Protocol

import httpx

from .config import CONFIG

MAX_SAMPLE_CHARS = 6000  # enough for a syllabus/textbook opening without blowing the context budget


class Summarizer(Protocol):
    def summarize(self, title: str, sample_text: str) -> tuple[str, str]:
        """Returns (topic_summary, foreword_summary)."""
        ...


class OllamaSummarizer:
    def __init__(self, host: str | None = None, model: str | None = None):
        self.host = (host or CONFIG.ollama_host).rstrip("/")
        self.model = model or CONFIG.chat_model

    def summarize(self, title: str, sample_text: str) -> tuple[str, str]:
        sample = sample_text[:MAX_SAMPLE_CHARS]
        prompt = (
            "You are writing a short pointer summary for a course document so a "
            "student-facing AI tutor knows what it contains without reading the "
            "full text. Given the document title and an excerpt, produce exactly "
            "two short paragraphs separated by a blank line, and nothing else:\n\n"
            "1. A one-to-two sentence TOPIC SUMMARY of what the document covers.\n"
            "2. A one-to-two sentence FOREWORD, written as if introducing the "
            "document to a student about to read it.\n\n"
            f"Title: {title}\n\nExcerpt:\n{sample}\n"
        )
        resp = httpx.post(
            f"{self.host}/api/generate",
            json={"model": self.model, "prompt": prompt, "stream": False},
            timeout=600,
        )
        resp.raise_for_status()
        raw = resp.json()["response"].strip()
        parts = [p.strip() for p in raw.split("\n\n", 1)]
        topic = parts[0] if parts else raw
        foreword = parts[1] if len(parts) > 1 else ""
        return topic, foreword


def get_summarizer() -> Summarizer:
    return OllamaSummarizer()


def render_pointer_md(
    *,
    title: str,
    kind: str,
    topic_summary: str,
    foreword_summary: str,
    embedding_status: str,
    chunk_count: int,
) -> str:
    """SKILL.md-styled markdown (§7) — this, not the full document, is what
    gets injected into Layer 3."""
    return (
        f"# {title}\n\n"
        f"- **kind**: {kind}\n"
        f"- **embedding status**: {embedding_status}\n"
        f"- **chunks**: {chunk_count}\n\n"
        f"## Topic summary\n\n{topic_summary}\n\n"
        f"## Foreword\n\n{foreword_summary}\n"
    )
