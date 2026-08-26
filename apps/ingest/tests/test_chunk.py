from ingest.chunk import chunk_sections


def test_short_section_stays_one_chunk():
    chunks = chunk_sections([("a short paragraph", "p.1")], chunk_chars=1000, overlap_chars=100)
    assert chunks == [("a short paragraph", "p.1")]


def test_long_section_splits_with_overlap():
    text = "x" * 5000
    chunks = chunk_sections([(text, "p.1")], chunk_chars=1800, overlap_chars=200)
    assert len(chunks) > 1
    assert all(locator == "p.1" for _, locator in chunks)
    assert all(len(t) <= 1800 for t, _ in chunks)


def test_empty_sections_are_skipped():
    chunks = chunk_sections([("   ", "p.1"), ("real text", "p.2")], chunk_chars=1000, overlap_chars=100)
    assert chunks == [("real text", "p.2")]
