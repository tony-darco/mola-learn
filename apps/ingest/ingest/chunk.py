"""
Chunking. Deliberately simple, fixed-size-with-overlap on characters, per
section boundary (page / paragraph) from extract.py. Contract 3 explicitly
warns against widening chunks to exploit the embedder's 32K context window —
defaults here (~1800 chars, ~200 overlap) stay well short of that.
"""
from __future__ import annotations

from .config import CONFIG


def chunk_sections(
    sections: list[tuple[str, str | None]],
    chunk_chars: int | None = None,
    overlap_chars: int | None = None,
) -> list[tuple[str, str | None]]:
    chunk_chars = chunk_chars or CONFIG.chunk_chars
    overlap_chars = overlap_chars if overlap_chars is not None else CONFIG.chunk_overlap_chars

    chunks: list[tuple[str, str | None]] = []
    for text, locator in sections:
        text = text.strip()
        if not text:
            continue
        if len(text) <= chunk_chars:
            chunks.append((text, locator))
            continue

        start = 0
        length = len(text)
        while start < length:
            end = min(start + chunk_chars, length)
            piece = text[start:end].strip()
            if piece:
                chunks.append((piece, locator))
            if end >= length:
                break
            start = end - overlap_chars
    return chunks
