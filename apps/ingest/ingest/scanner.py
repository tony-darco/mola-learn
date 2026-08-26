"""
Malware scanning behind a clean interface (§12: "Use real ClamAV if you can run
it locally. If you cannot, implement the scan behind a clean interface with a
stub that always passes, and say so explicitly.").

STATUS FOR THIS DEPLOYMENT: real ClamAV IS running locally (clamd, TCP
127.0.0.1:3310, virus databases fetched via freshclam same day). ClamdScanner
below talks to it over the network using clamd's INSTREAM protocol — the file
bytes never touch clamd's filesystem, which also means this works unmodified if
clamd ever runs on a separate host/container from this worker.

`INGEST_SCANNER=stub` switches to StubScanner, which ALWAYS REPORTS CLEAN AND
PERFORMS NO SCAN. It exists only so this worker can run somewhere clamd is not
installed (e.g. a laptop without the ~100MB virus DB). Do not set this in any
environment that will actually receive untrusted uploads.
"""
from __future__ import annotations

import io
from dataclasses import dataclass
from typing import Protocol

import clamd

from .config import CONFIG


@dataclass(frozen=True)
class ScanResult:
    clean: bool
    signature: str | None = None  # e.g. "Eicar-Test-Signature" when infected
    engine: str = "clamd"


class MalwareScanner(Protocol):
    def scan(self, data: bytes) -> ScanResult: ...


class ClamdScanner:
    """Real ClamAV via clamd, using INSTREAM so we never write the upload to
    disk just to hand it to the scanner."""

    def __init__(self, host: str | None = None, port: int | None = None):
        self.host = host or CONFIG.clamd_host
        self.port = port or CONFIG.clamd_port

    def scan(self, data: bytes) -> ScanResult:
        client = clamd.ClamdNetworkSocket(host=self.host, port=self.port)
        result = client.instream(io.BytesIO(data))
        # clamd returns {'stream': ('OK', None)} or {'stream': ('FOUND', 'Eicar-Test-Signature')}
        status, signature = result["stream"]
        return ScanResult(clean=(status == "OK"), signature=signature)


class StubScanner:
    """ALWAYS PASSES. See module docstring — only for environments without
    clamd installed. Never use this where untrusted uploads are real."""

    def scan(self, data: bytes) -> ScanResult:
        return ScanResult(clean=True, signature=None, engine="stub-always-clean")


def get_scanner() -> MalwareScanner:
    if CONFIG.scanner == "stub":
        return StubScanner()
    return ClamdScanner()
