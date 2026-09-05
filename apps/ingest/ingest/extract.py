"""
Text extraction for PDF, docx, markdown, txt (§7). Runs against SAFE bucket
bytes only — the caller (pipeline.py) never hands this module a RAW-bucket
read (§12: "Nothing downstream ever reads from RAW.").

Returns a list of (text, locator) "sections" — a page for PDF, a paragraph
group for docx, a single blob for md/txt — which chunk.py then splits further.
"""
from __future__ import annotations

import io

import pymupdf as fitz
from docx import Document as DocxDocument


def extract_pdf(data: bytes) -> list[tuple[str, str | None]]:
    sections: list[tuple[str, str | None]] = []
    with fitz.open(stream=data, filetype="pdf") as doc:
        for i, page in enumerate(doc):
            # PyMuPDF occasionally emits embedded NUL bytes from certain
            # fonts' text streams — Postgres text columns reject them outright.
            text = page.get_text().replace("\x00", "").strip()
            if text:
                sections.append((text, f"p.{i + 1}"))
    return sections


def extract_docx(data: bytes) -> list[tuple[str, str | None]]:
    doc = DocxDocument(io.BytesIO(data))
    sections: list[tuple[str, str | None]] = []
    for i, para in enumerate(doc.paragraphs):
        text = para.text.strip()
        if text:
            sections.append((text, f"¶{i + 1}"))
    return sections


def _decode_text(data: bytes) -> str:
    for encoding in ("utf-8", "utf-16", "latin-1"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace")


def extract_txt(data: bytes) -> list[tuple[str, str | None]]:
    text = _decode_text(data).strip()
    return [(text, None)] if text else []


def extract_markdown(data: bytes) -> list[tuple[str, str | None]]:
    # Markdown is chunked as plain text — the tsvector/trigram indexes and the
    # embedder both work fine on raw markdown; no need to parse structure here.
    return extract_txt(data)


EXTRACTORS = {
    "pdf": extract_pdf,
    "docx": extract_docx,
    "md": extract_markdown,
    "txt": extract_txt,
}


def extract(kind: str, data: bytes) -> list[tuple[str, str | None]]:
    extractor = EXTRACTORS.get(kind)
    if extractor is None:
        raise ValueError(f"no extractor for kind '{kind}'")
    return extractor(data)
