"""
File-type sniffing by magic bytes (libmagic), independent of the filename or
any client-supplied Content-Type. This is what catches the renamed-executable
trick (§7/§12): a `.pdf` whose first bytes are a Mach-O or PE header fails here
before it ever reaches extraction.
"""
from __future__ import annotations

import zipfile
from dataclasses import dataclass
from io import BytesIO

import magic

DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


class SniffError(Exception):
    """Raised when the actual file content doesn't match an allowed type."""


@dataclass(frozen=True)
class SniffResult:
    kind: str  # "pdf" | "docx" | "md" | "txt"
    detected_mime: str


def _looks_like_docx(data: bytes) -> bool:
    try:
        with zipfile.ZipFile(BytesIO(data)) as zf:
            names = zf.namelist()
            return "word/document.xml" in names and "[Content_Types].xml" in names
    except zipfile.BadZipFile:
        return False


def sniff(data: bytes, claimed_filename: str) -> SniffResult:
    """Inspect the actual bytes and classify. Raises SniffError if the content
    doesn't match any allowed document type — this is a security rejection,
    not a soft failure; callers must quarantine rather than proceed."""
    if not data:
        raise SniffError("empty file")

    detected = magic.from_buffer(data, mime=True)
    ext = claimed_filename.rsplit(".", 1)[-1].lower() if "." in claimed_filename else ""

    if detected == "application/pdf":
        return SniffResult(kind="pdf", detected_mime=detected)

    if detected in ("application/zip", DOCX_MIME):
        if _looks_like_docx(data):
            return SniffResult(kind="docx", detected_mime=DOCX_MIME)
        raise SniffError(
            f"claimed extension '.{ext}' but content is a zip archive that is not a .docx"
        )

    if detected.startswith("text/"):
        kind = "md" if ext == "md" else "txt"
        return SniffResult(kind=kind, detected_mime=detected)

    raise SniffError(
        f"claimed extension '.{ext}' but magic bytes identify content as '{detected}'"
    )
