from ingest.scanner import ClamdScanner, StubScanner

from conftest import requires_clamd

EICAR = (
    r"X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"
).encode()


@requires_clamd
def test_clamd_detects_eicar():
    result = ClamdScanner().scan(EICAR)
    assert result.clean is False
    assert result.signature and "Eicar" in result.signature


@requires_clamd
def test_clamd_passes_clean_file():
    result = ClamdScanner().scan(b"just a normal text file, nothing to see here")
    assert result.clean is True


def test_stub_always_passes_even_eicar():
    """Documents the stub's behavior in a test, not just a comment: it is
    ALWAYS clean, including on a known-bad signature. Never wire this into an
    environment receiving real uploads."""
    result = StubScanner().scan(EICAR)
    assert result.clean is True
    assert result.engine == "stub-always-clean"
