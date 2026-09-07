"""
Table-of-contents detection for the textbook chapter tree. Pure functions, no
DB/S3/LLM — unit-testable in isolation, same style as chunk.py.

Deliberately heuristic, not LLM-assisted (a hard product decision): pattern-
match a "Contents" heading, then a page is still-TOC while enough of its lines
look like "<title> .... <page>" or "<title>   <page>". This will sometimes
miss (odd layouts, scanned/OCR'd books, non-English headings) — that is an
accepted, explicitly handled outcome (chapters.py degrades to no_toc_found),
not a bug to eliminate here.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from difflib import SequenceMatcher

from .config import CONFIG

# A page counts as "still TOC" while at least this fraction of its non-blank
# lines look like a TOC entry line.
LINE_MATCH_RATIO_THRESHOLD = 0.4

# A candidate must yield at least this many parsed entries to be considered
# confident enough to build a chapter tree from.
MIN_CONFIDENT_ENTRIES = 3

# How far into the book (in pages) to look for the TOC heading at all — it is
# always near the front; searching the whole book risks matching an index or
# a "Contents" mention deep in back matter.
MAX_HEADING_SEARCH_PAGES = 60

# How many characters at the start of a page to compare against an entry's
# title when resolving that entry's start locator.
TITLE_MATCH_WINDOW_CHARS = 200
TITLE_MATCH_RATIO_THRESHOLD = 0.6

_HEADING_RE = re.compile(r"^\s*(table\s+of\s+)?contents\s*$", re.IGNORECASE)
_DOT_LEADER_RE = re.compile(r"^(.{2,}?)\.{2,}\s*(\d{1,4})\s*$")
_WHITESPACE_ALIGNED_RE = re.compile(r"^(.{2,}?)\s{2,}(\d{1,4})\s*$")
_LEADING_CHAPTER_NUM_RE = re.compile(r"^(?:chapter\s+)?(\d+)[.:]?\s+(.*)$", re.IGNORECASE)


@dataclass(frozen=True)
class TocEntry:
    title: str
    chapter_number: int | None
    toc_locator: str
    start_locator: str | None = None


@dataclass(frozen=True)
class TocCandidate:
    heading_locator: str
    toc_page_locators: list[str]
    entries: list[TocEntry] = field(default_factory=list)


def is_toc_heading(text: str) -> bool:
    return any(_HEADING_RE.match(line.strip()) for line in text.splitlines())


def _entry_line_match_ratio(text: str) -> float:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if not lines:
        return 0.0
    matches = sum(1 for line in lines if _DOT_LEADER_RE.match(line) or _WHITESPACE_ALIGNED_RE.match(line))
    return matches / len(lines)


def find_toc(pages: list[tuple[str, str]]) -> TocCandidate | None:
    """Scans `pages` (as (text, locator) tuples, in page order) for a TOC
    heading, then extends across subsequent pages while they still look like
    TOC content — this is what makes a multi-page TOC work."""
    search_limit = min(len(pages), MAX_HEADING_SEARCH_PAGES)
    for i in range(search_limit):
        text, locator = pages[i]
        if not is_toc_heading(text):
            continue

        toc_locators = [locator]
        j = i + 1
        while j < len(pages):
            next_text, next_locator = pages[j]
            if _entry_line_match_ratio(next_text) < LINE_MATCH_RATIO_THRESHOLD:
                break
            toc_locators.append(next_locator)
            j += 1

        return TocCandidate(heading_locator=locator, toc_page_locators=toc_locators)

    return None


def parse_toc_entries(candidate: TocCandidate, pages: list[tuple[str, str]]) -> list[TocEntry]:
    pages_by_locator = {locator: text for text, locator in pages}
    entries: list[TocEntry] = []

    for locator in candidate.toc_page_locators:
        text = pages_by_locator.get(locator, "")
        for line in text.splitlines():
            line = line.strip()
            if not line or is_toc_heading(line):
                continue

            match = _DOT_LEADER_RE.match(line) or _WHITESPACE_ALIGNED_RE.match(line)
            if not match:
                continue

            raw_title = match.group(1).strip(" .")
            if not raw_title:
                continue

            chapter_number = None
            num_match = _LEADING_CHAPTER_NUM_RE.match(raw_title)
            if num_match:
                chapter_number = int(num_match.group(1))
                raw_title = num_match.group(2).strip()

            entries.append(TocEntry(title=raw_title, chapter_number=chapter_number, toc_locator=locator))

    return entries


def is_toc_confident(entries: list[TocEntry]) -> bool:
    return len(entries) >= MIN_CONFIDENT_ENTRIES


def _normalized(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip().lower()


def resolve_chapter_start_locators(
    entries: list[TocEntry], pages: list[tuple[str, str]], search_from_locator: str | None
) -> list[TocEntry]:
    """Best-effort: match each entry's title against the leading text of the
    pages that follow the TOC, in order. Deliberately ignores printed page
    numbers in the TOC itself — front matter (roman numerals, unnumbered
    pages) makes them unreliable as direct locator offsets. Unresolved
    entries simply keep start_locator=None; chapters.py falls back to a
    bounded title search over document_chunks for those."""
    start_index = 0
    if search_from_locator is not None:
        for idx, (_, locator) in enumerate(pages):
            if locator == search_from_locator:
                start_index = idx + 1
                break

    resolved: list[TocEntry] = []
    search_cursor = start_index
    for entry in entries:
        target = _normalized(entry.title)
        found_locator = None
        for idx in range(search_cursor, len(pages)):
            page_text, locator = pages[idx]
            window = _normalized(page_text[:TITLE_MATCH_WINDOW_CHARS])
            if not window:
                continue
            if target and target in window:
                found_locator = locator
                search_cursor = idx + 1
                break
            ratio = SequenceMatcher(None, target, window[: len(target) + 20]).ratio()
            if ratio >= TITLE_MATCH_RATIO_THRESHOLD:
                found_locator = locator
                search_cursor = idx + 1
                break

        resolved.append(TocEntry(
            title=entry.title,
            chapter_number=entry.chapter_number,
            toc_locator=entry.toc_locator,
            start_locator=found_locator,
        ))

    return resolved


def assign_end_locators(entries: list[TocEntry]) -> list[tuple[TocEntry, str | None]]:
    """Pairs each entry with an end_locator: the next entry's start_locator,
    or None for the last entry (or one whose own start could not be resolved)."""
    result: list[tuple[TocEntry, str | None]] = []
    for i, entry in enumerate(entries):
        end_locator = None
        for later in entries[i + 1:]:
            if later.start_locator is not None:
                end_locator = later.start_locator
                break
        result.append((entry, end_locator))
    return result


def reconstruct_pages(chunks: list[dict], overlap_chars: int | None = None) -> list[tuple[str, str]]:
    """Rebuilds full per-page text from already-extracted document_chunks
    rows (ordered by ordinal) — never re-downloads from S3 or re-runs
    PyMuPDF. A page chunk.py split into multiple ordinals shares one
    `locator`; subsequent pieces of the same page have their leading overlap
    trimmed before rejoining."""
    overlap = CONFIG.chunk_overlap_chars if overlap_chars is None else overlap_chars
    pages: list[tuple[str, str]] = []
    current_locator: str | None = None
    parts: list[str] = []

    for chunk in chunks:
        locator = chunk["locator"]
        text = chunk["text"]
        if locator != current_locator:
            if current_locator is not None:
                pages.append(("".join(parts), current_locator))
            current_locator = locator
            parts = [text]
        else:
            parts.append(text[overlap:] if len(text) > overlap else "")

    if current_locator is not None:
        pages.append(("".join(parts), current_locator))

    return pages
