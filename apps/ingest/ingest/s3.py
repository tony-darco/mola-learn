"""
S3 access (LocalStack in dev, real S3 in prod — same API).

Phase-3 boundary: today the ONLY trigger into this worker is the `jobs` table
(see jobs.py / worker.py). This module never subscribes to S3 events. When
Phase 3 swaps in real S3 event notifications, only the trigger wiring changes —
everything below (download/upload/move) stays exactly as-is.
"""
from __future__ import annotations

import boto3
from botocore.client import Config as BotoConfig

from .config import CONFIG


def get_s3_client():
    return boto3.client(
        "s3",
        endpoint_url=CONFIG.s3_endpoint,
        region_name=CONFIG.s3_region,
        aws_access_key_id=CONFIG.s3_access_key_id,
        aws_secret_access_key=CONFIG.s3_secret_access_key,
        config=BotoConfig(s3={"addressing_style": "path"}),
    )


def download_bytes(client, bucket: str, key: str) -> bytes:
    resp = client.get_object(Bucket=bucket, Key=key)
    return resp["Body"].read()


def upload_bytes(client, bucket: str, key: str, data: bytes, content_type: str | None = None) -> None:
    extra = {"ContentType": content_type} if content_type else {}
    client.put_object(Bucket=bucket, Key=key, Body=data, **extra)


def move_object(client, src_bucket: str, src_key: str, dst_bucket: str, dst_key: str) -> None:
    """Copy RAW -> {SAFE,QUARANTINE} then delete the RAW copy. Called ONLY by
    scanner.py's caller (pipeline.py) — the scanner is the sole component
    permitted to move objects between buckets (§12)."""
    client.copy_object(
        Bucket=dst_bucket, Key=dst_key, CopySource={"Bucket": src_bucket, "Key": src_key}
    )
    client.delete_object(Bucket=src_bucket, Key=src_key)


def object_exists(client, bucket: str, key: str) -> bool:
    try:
        client.head_object(Bucket=bucket, Key=key)
        return True
    except client.exceptions.ClientError:
        return False
