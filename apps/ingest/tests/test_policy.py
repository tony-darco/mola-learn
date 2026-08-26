import pytest

from ingest.config import CONFIG
from ingest.policy import PolicyError, check_kind_allowed, check_quota, check_size


def test_size_cap():
    check_size(1024)  # does not raise
    with pytest.raises(PolicyError):
        check_size(CONFIG.max_bytes + 1)


def test_kind_allowed():
    check_kind_allowed("pdf")
    with pytest.raises(PolicyError):
        check_kind_allowed("exe")


def test_quota_ok_under_limit(db_conn, test_user):
    check_quota(db_conn, test_user, byte_size=1024, document_id="00000000-0000-0000-0000-000000000000")


def test_quota_exceeded(db_conn, test_user):
    with pytest.raises(PolicyError):
        check_quota(
            db_conn,
            test_user,
            byte_size=CONFIG.user_quota_bytes + 1,
            document_id="00000000-0000-0000-0000-000000000000",
        )
