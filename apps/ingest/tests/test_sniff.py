import pytest

from ingest.sniff import SniffError, sniff


def test_rejects_renamed_executable(renamed_executable_bytes):
    """The core catch from §7/§12: a file claiming to be a PDF whose actual
    bytes are an executable must be rejected before extraction ever runs."""
    with pytest.raises(SniffError):
        sniff(renamed_executable_bytes, "totally_a_syllabus.pdf")


def test_accepts_real_pdf(minimal_pdf_bytes):
    result = sniff(minimal_pdf_bytes, "syllabus.pdf")
    assert result.kind == "pdf"
    assert result.detected_mime == "application/pdf"


def test_accepts_real_docx(minimal_docx_bytes):
    result = sniff(minimal_docx_bytes, "notes.docx")
    assert result.kind == "docx"


def test_zip_that_is_not_docx_is_rejected():
    import io
    import zipfile

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("not_word.txt", "just a zip, not a docx")
    with pytest.raises(SniffError):
        sniff(buf.getvalue(), "notes.docx")


def test_accepts_plain_text():
    result = sniff(b"Week 1: introductions. Week 2: processes.", "syllabus.txt")
    assert result.kind == "txt"


def test_accepts_markdown():
    result = sniff(b"# Syllabus\n\nWeek 1: introductions.", "syllabus.md")
    assert result.kind == "md"


def test_rejects_empty_file():
    with pytest.raises(SniffError):
        sniff(b"", "empty.pdf")
