"""
Unit tests for the TOC-detection heuristic (ingest/toc.py). These exercise
the layout diversity the plan calls out as the riskiest part of the whole
textbook feature: dot-leader vs. whitespace-aligned entries, a TOC spanning
multiple pages, and a book with no TOC page at all (must degrade cleanly,
never raise).

Built from synthetic fixtures, not real scanned textbooks — no real textbook
PDFs were available to test against in this environment. Real-world layout
diversity (scans, OCR artifacts, non-English headings) should still be
validated against actual sample PDFs before this ships.
"""
from __future__ import annotations

from ingest.toc import (
    assign_end_locators,
    find_toc,
    is_toc_confident,
    is_toc_heading,
    parse_toc_entries,
    reconstruct_pages,
    resolve_chapter_start_locators,
)


def test_is_toc_heading_matches_common_variants():
    assert is_toc_heading("Contents")
    assert is_toc_heading("Table of Contents")
    assert is_toc_heading("  CONTENTS  ")
    assert is_toc_heading("Some text\nTable of Contents\nmore text")


def test_is_toc_heading_rejects_unrelated_text():
    assert not is_toc_heading("Chapter 1: Introduction")
    assert not is_toc_heading("This chapter's contents are summarized below.")


DOT_LEADER_PAGE = (
    "Contents\n"
    "1. Introduction .......................... 3\n"
    "2. Linear Equations ...................... 15\n"
    "Chapter 3: Matrices ...................... 42\n"
)

WHITESPACE_PAGE = (
    "Table of Contents\n"
    "Introduction    3\n"
    "Linear Equations    15\n"
    "Matrices    42\n"
)

NO_TOC_PAGES = [
    ("Preface\n\nThis book is intended for undergraduates.", "p.1"),
    ("Chapter 1\n\nIntroduction to the field.", "p.2"),
    ("More chapter text goes here in prose form.", "p.3"),
]


def test_find_toc_dot_leader_single_page():
    pages = [("Front matter with no heading.", "p.1"), (DOT_LEADER_PAGE, "p.2"), ("Chapter 1 text.", "p.3")]
    candidate = find_toc(pages)
    assert candidate is not None
    assert candidate.heading_locator == "p.2"
    assert candidate.toc_page_locators == ["p.2"]


def test_find_toc_whitespace_aligned_single_page():
    pages = [(WHITESPACE_PAGE, "p.1"), ("Chapter 1 text.", "p.2")]
    candidate = find_toc(pages)
    assert candidate is not None
    assert candidate.toc_page_locators == ["p.1"]


def test_find_toc_extends_across_multiple_pages():
    toc_page_1 = "Contents\n1. Introduction .......... 3\n2. Basics .......... 10\n"
    toc_page_2 = "3. Advanced Topics .......... 40\n4. Appendix .......... 90\n"
    pages = [(toc_page_1, "p.1"), (toc_page_2, "p.2"), ("Chapter 1 prose.", "p.3")]
    candidate = find_toc(pages)
    assert candidate is not None
    assert candidate.toc_page_locators == ["p.1", "p.2"]


def test_find_toc_returns_none_when_no_heading_present():
    assert find_toc(NO_TOC_PAGES) is None


def test_parse_toc_entries_extracts_titles_and_chapter_numbers():
    pages = [(DOT_LEADER_PAGE, "p.2")]
    candidate = find_toc([("front matter", "p.1"), (DOT_LEADER_PAGE, "p.2")])
    entries = parse_toc_entries(candidate, pages)
    assert [e.title for e in entries] == ["Introduction", "Linear Equations", "Matrices"]
    assert [e.chapter_number for e in entries] == [1, 2, 3]
    assert all(e.toc_locator == "p.2" for e in entries)


def test_is_toc_confident_requires_minimum_entries():
    thin_page = "Contents\nIntroduction .......... 3\n"
    candidate = find_toc([(thin_page, "p.1")])
    entries = parse_toc_entries(candidate, [(thin_page, "p.1")])
    assert not is_toc_confident(entries)

    candidate2 = find_toc([(DOT_LEADER_PAGE, "p.1")])
    entries2 = parse_toc_entries(candidate2, [(DOT_LEADER_PAGE, "p.1")])
    assert is_toc_confident(entries2)


def test_resolve_chapter_start_locators_matches_titles_in_order():
    candidate = find_toc([(DOT_LEADER_PAGE, "p.1")])
    toc_pages = [(DOT_LEADER_PAGE, "p.1")]
    entries = parse_toc_entries(candidate, toc_pages)

    all_pages = toc_pages + [
        ("Introduction\n\nThis chapter introduces the subject.", "p.3"),
        ("Linear Equations\n\nThis chapter covers linear equations.", "p.15"),
        ("Matrices\n\nThis chapter covers matrices.", "p.42"),
    ]

    resolved = resolve_chapter_start_locators(entries, all_pages, search_from_locator="p.1")
    assert [e.start_locator for e in resolved] == ["p.3", "p.15", "p.42"]


def test_resolve_chapter_start_locators_leaves_unresolved_as_none():
    entries = parse_toc_entries(find_toc([(DOT_LEADER_PAGE, "p.1")]), [(DOT_LEADER_PAGE, "p.1")])
    all_pages = [(DOT_LEADER_PAGE, "p.1"), ("Completely unrelated prose about cooking.", "p.3")]

    resolved = resolve_chapter_start_locators(entries, all_pages, search_from_locator="p.1")
    assert all(e.start_locator is None for e in resolved)


def test_assign_end_locators_chains_to_next_start():
    entries = parse_toc_entries(find_toc([(DOT_LEADER_PAGE, "p.1")]), [(DOT_LEADER_PAGE, "p.1")])
    all_pages = [
        (DOT_LEADER_PAGE, "p.1"),
        ("Introduction\n\ntext", "p.3"),
        ("Linear Equations\n\ntext", "p.15"),
        ("Matrices\n\ntext", "p.42"),
    ]
    resolved = resolve_chapter_start_locators(entries, all_pages, search_from_locator="p.1")
    paired = assign_end_locators(resolved)

    assert [end for _, end in paired] == ["p.15", "p.42", None]


def test_reconstruct_pages_single_chunk_per_page():
    chunks = [
        {"ordinal": 0, "text": "Page one text.", "locator": "p.1"},
        {"ordinal": 1, "text": "Page two text.", "locator": "p.2"},
    ]
    assert reconstruct_pages(chunks) == [("Page one text.", "p.1"), ("Page two text.", "p.2")]


def test_reconstruct_pages_trims_overlap_across_split_chunks():
    chunks = [
        {"ordinal": 0, "text": "ABCDEFGHIJ", "locator": "p.1"},
        {"ordinal": 1, "text": "FGHIJKLMNO", "locator": "p.1"},
        {"ordinal": 2, "text": "Page two.", "locator": "p.2"},
    ]
    pages = reconstruct_pages(chunks, overlap_chars=5)
    assert pages == [("ABCDEFGHIJKLMNO", "p.1"), ("Page two.", "p.2")]
