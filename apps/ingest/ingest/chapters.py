"""
Textbook chapter-tree orchestration — this module's role for the chapter
tree is the same as pipeline.py's role for base ingestion. Two entrypoints,
each handling one job kind (see jobs.py/worker.py):

  process_toc_detection  -- detect_textbook_toc jobs
  process_chapter_fill   -- fill_textbook_chapter jobs

Both are pure-DB operations: page text is reconstructed from already-
extracted document_chunks rows (toc.reconstruct_pages), never by re-reading
S3 or re-running PyMuPDF.
"""
from __future__ import annotations

import re
from typing import Protocol

import httpx

from .config import CONFIG
from .db import (
    count_pending_textbook_chapters,
    get_document,
    get_document_chunks,
    get_ready_textbook_chapters,
    get_textbook_chapter,
    insert_textbook_chapters,
    insert_textbook_sections,
    lock_document_row,
    set_document_pointer,
    set_textbook_chapter_content,
    set_textbook_chapter_status,
    set_textbook_toc_status,
)
from .jobs import FILL_CHAPTER_JOB_KIND, enqueue
from .pipeline import PermanentFailure
from .toc import (
    TocEntry,
    assign_end_locators,
    find_toc,
    is_toc_confident,
    parse_toc_entries,
    reconstruct_pages,
    resolve_chapter_start_locators,
)

# Bounded cap on how much chapter text goes into a single Ollama call — a
# chapter is the unit of interest, so this is deliberately larger than
# pointer.py's 6000-char document sample, but still bounded.
MAX_CHAPTER_SAMPLE_CHARS = 12000

# When a chapter's start_locator couldn't be resolved from the TOC and its
# end_locator is also unknown, cap the bounded title-match fallback slice at
# this many pages rather than reading to the end of the book.
MAX_CHAPTER_PAGES_FALLBACK = 20


def _normalized(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip().lower()


def process_toc_detection(conn, document_id: str) -> None:
    """detect_textbook_toc handler. Never raises for "no confident TOC" —
    that is an expected, common outcome (odd layout, scan, no TOC at all),
    not a failure: the document already reached documents.status='ready'
    via the base pipeline before this job ever ran."""
    doc = get_document(conn, document_id)
    if doc is None:
        raise PermanentFailure(f"document {document_id} does not exist")

    chunks = get_document_chunks(conn, document_id)
    pages = reconstruct_pages(chunks)

    candidate = find_toc(pages)
    if candidate is None:
        set_textbook_toc_status(conn, document_id, "no_toc_found")
        return

    entries = parse_toc_entries(candidate, pages)
    if not is_toc_confident(entries):
        set_textbook_toc_status(conn, document_id, "no_toc_found")
        return

    resolved = resolve_chapter_start_locators(
        entries, pages, search_from_locator=candidate.toc_page_locators[-1]
    )
    paired: list[tuple[TocEntry, str | None]] = assign_end_locators(resolved)

    chapters_payload = [
        {
            "chapter_number": entry.chapter_number,
            "title": entry.title,
            "toc_locator": entry.toc_locator,
            "start_locator": entry.start_locator,
            "end_locator": end_locator,
        }
        for entry, end_locator in paired
    ]

    set_textbook_toc_status(conn, document_id, "building")
    chapter_ids = insert_textbook_chapters(conn, document_id, doc["user_id"], chapters_payload)
    for chapter_id in chapter_ids:
        enqueue(conn, doc["user_id"], FILL_CHAPTER_JOB_KIND, {"documentId": document_id, "chapterId": chapter_id})


def _slice_chapter_pages(chapter: dict, pages: list[tuple[str, str]]) -> list[tuple[str, str]]:
    start_idx = None
    if chapter["start_locator"] is not None:
        for idx, (_, locator) in enumerate(pages):
            if locator == chapter["start_locator"]:
                start_idx = idx
                break

    if start_idx is None:
        # Bounded fallback: the TOC title match failed to resolve a start
        # page — search for the chapter title appearing directly in a page's
        # own text instead of giving up.
        target = _normalized(chapter["title"])
        if target:
            for idx, (text, _) in enumerate(pages):
                if target in _normalized(text):
                    start_idx = idx
                    break

    if start_idx is None:
        return []

    end_idx = len(pages)
    if chapter["end_locator"] is not None:
        for idx in range(start_idx, len(pages)):
            if pages[idx][1] == chapter["end_locator"]:
                end_idx = idx
                break
    else:
        end_idx = min(len(pages), start_idx + MAX_CHAPTER_PAGES_FALLBACK)

    return pages[start_idx:end_idx]


def _render_chapter_md(*, title: str, chapter_number: int | None, topics: list[str], overview_markdown: str) -> str:
    meta_lines = []
    if chapter_number is not None:
        meta_lines.append(f"- **chapter**: {chapter_number}")
    if topics:
        meta_lines.append(f"- **topics**: {', '.join(topics)}")
    meta = ("\n".join(meta_lines) + "\n\n") if meta_lines else ""
    return f"# {title}\n\n{meta}{overview_markdown}\n"


def _render_book_pointer_md(title: str, chapters: list[dict]) -> str:
    titles = [c["title"] for c in chapters]
    overview = (
        f"This textbook is organized into {len(chapters)} chapters: " + ", ".join(titles) + "."
        if titles else "This textbook's chapter structure could not be determined."
    )
    lines = [f"{i + 1}. **{c['title']}**" + (f" — {', '.join(c['topics'])}" if c["topics"] else "")
             for i, c in enumerate(chapters)]
    return f"# {title}\n\n{overview}\n\n## Chapters\n\n" + "\n".join(lines) + "\n"


def process_chapter_fill(conn, document_id: str, chapter_id: str, chapter_summarizer: "ChapterSummarizer") -> None:
    """fill_textbook_chapter handler. Idempotent: a chapter already 'ready'
    is a no-op, mirroring pipeline.py's resume-from-SAFE style — safe to
    retry after a crash mid-job."""
    chapter = get_textbook_chapter(conn, chapter_id)
    if chapter is None:
        raise PermanentFailure(f"textbook chapter {chapter_id} does not exist")
    if chapter["status"] == "ready":
        return

    doc = get_document(conn, document_id)
    if doc is None:
        raise PermanentFailure(f"document {document_id} does not exist")

    set_textbook_chapter_status(conn, chapter_id, "filling")

    chunks = get_document_chunks(conn, document_id)
    pages = reconstruct_pages(chunks)
    chapter_pages = _slice_chapter_pages(chapter, pages)

    if not chapter_pages:
        set_textbook_chapter_status(conn, chapter_id, "failed", detail="could not locate chapter content in extracted pages")
        return

    chapter_text = "\n\n".join(text for text, _ in chapter_pages)[:MAX_CHAPTER_SAMPLE_CHARS]

    topics, overview_markdown = chapter_summarizer.summarize_chapter(
        chapter["title"], chapter["chapter_number"], chapter_text
    )
    markdown = _render_chapter_md(
        title=chapter["title"], chapter_number=chapter["chapter_number"],
        topics=topics, overview_markdown=overview_markdown,
    )
    set_textbook_chapter_content(conn, chapter_id, markdown, topics)

    sections = chapter_summarizer.propose_subsections(chapter_text)
    if sections:
        insert_textbook_sections(conn, chapter_id, document_id, doc["user_id"], sections)

    lock_document_row(conn, document_id)
    if count_pending_textbook_chapters(conn, document_id) == 0:
        ready_chapters = get_ready_textbook_chapters(conn, document_id)
        pointer_md = _render_book_pointer_md(doc["title"], ready_chapters)
        set_document_pointer(conn, document_id, pointer_md)
        set_textbook_toc_status(conn, document_id, "ready")


_SUBSECTION_HEADING_RE = re.compile(r"^#{2,3}\s+(.+)$")


def _parse_subsections(raw: str) -> list[tuple[str, str]]:
    """Splits a chapter-summarizer response on '## '/'### ' headers into
    (title, markdown) pairs — delimiter-based rather than asking a local
    27B model for strict JSON, mirroring pointer.py's own "split on blank
    line" simplicity bias."""
    sections: list[tuple[str, str]] = []
    current_title: str | None = None
    current_lines: list[str] = []

    for line in raw.splitlines():
        match = _SUBSECTION_HEADING_RE.match(line.strip())
        if match:
            if current_title is not None:
                sections.append((current_title, "\n".join(current_lines).strip()))
            current_title = match.group(1).strip()
            current_lines = []
        elif current_title is not None:
            current_lines.append(line)

    if current_title is not None:
        sections.append((current_title, "\n".join(current_lines).strip()))

    return sections


class ChapterSummarizer(Protocol):
    def summarize_chapter(
        self, title: str, chapter_number: int | None, sample_text: str
    ) -> tuple[list[str], str]:
        """Returns (topics, overview_markdown)."""
        ...

    def propose_subsections(self, sample_text: str) -> list[tuple[str, str]]:
        """Returns a list of (subsection_title, subsection_markdown)."""
        ...


class OllamaChapterSummarizer:
    """Separate from pointer.py's Summarizer — different return shape
    (topics + markdown, and N proposed subsections, not a two-paragraph
    tuple) — so pointer.py stays untouched and single-purpose."""

    def __init__(self, host: str | None = None, model: str | None = None):
        self.host = (host or CONFIG.ollama_host).rstrip("/")
        self.model = model or CONFIG.chat_model

    def _generate(self, prompt: str) -> str:
        resp = httpx.post(
            f"{self.host}/api/generate",
            json={"model": self.model, "prompt": prompt, "stream": False},
            timeout=600,
        )
        resp.raise_for_status()
        return resp.json()["response"].strip()

    def summarize_chapter(
        self, title: str, chapter_number: int | None, sample_text: str
    ) -> tuple[list[str], str]:
        prompt = (
            "You are writing a short study-guide entry for one chapter of a textbook. "
            "Given the chapter title and an excerpt of its text, respond with exactly:\n\n"
            "1. A first line starting with 'TOPICS:' followed by 3-6 short comma-separated topics "
            "this chapter covers.\n"
            "2. A blank line.\n"
            "3. A short markdown overview (2-4 sentences) of what the chapter covers.\n\n"
            f"Chapter title: {title}\n\nExcerpt:\n{sample_text}\n"
        )
        raw = self._generate(prompt)
        lines = raw.split("\n", 1)
        topics: list[str] = []
        overview = raw
        if lines and lines[0].strip().upper().startswith("TOPICS:"):
            topics = [t.strip() for t in lines[0].split(":", 1)[1].split(",") if t.strip()]
            overview = lines[1].strip() if len(lines) > 1 else ""
        return topics, overview

    def propose_subsections(self, sample_text: str) -> list[tuple[str, str]]:
        prompt = (
            "Break the following textbook chapter excerpt into its logical subsections. "
            "Respond with each subsection as a markdown '### ' heading (the subsection title) "
            "followed by a short markdown summary (1-3 sentences) of that subsection, "
            "and nothing else. Propose 2-6 subsections depending on how much distinct content "
            "the excerpt actually contains.\n\n"
            f"Excerpt:\n{sample_text}\n"
        )
        raw = self._generate(prompt)
        return _parse_subsections(raw)


def get_chapter_summarizer() -> ChapterSummarizer:
    return OllamaChapterSummarizer()
