from __future__ import annotations

import asyncio
import tempfile
from typing import Any

import boto3
import httpx
from botocore.client import Config


def make_s3_client(
    mode: str,
    region: str,
    access_key_id: str,
    secret_access_key: str,
    endpoint: str,
) -> Any:
    # Pin the regional endpoint explicitly. Without this, botocore can create
    # a presigned URL on the global virtual-host endpoint; S3 then redirects it
    # to the bucket region and the changed Host invalidates the SigV4 signature.
    return boto3.client(
        "s3",
        aws_access_key_id=access_key_id,
        aws_secret_access_key=secret_access_key,
        endpoint_url=endpoint,
        config=Config(
            signature_version="s3v4",
            s3={"addressing_style": "path" if mode == "r2" else "virtual"},
        ),
        region_name=region,
    )


def is_enabled(access_key_id: str) -> bool:
    return access_key_id not in ("", "dummy")


def object_upload_extra_args(storage_mode: str, content_type: str) -> dict[str, str]:
    args = {
        "ContentType": content_type,
        "CacheControl": "public, max-age=31536000, immutable",
    }
    if storage_mode == "aws":
        args["StorageClass"] = "INTELLIGENT_TIERING"
    elif storage_mode != "r2":
        raise ValueError("storage_mode must be aws or r2")
    return args


def generate_presigned_url(
    client: Any,
    bucket: str,
    key: str,
    expires_in: int = 3600,
) -> str:
    return client.generate_presigned_url(
        "get_object",
        Params={"Bucket": bucket, "Key": key},
        ExpiresIn=expires_in,
    )


def head_object(client: Any, bucket: str, key: str) -> dict[str, Any] | None:
    """Return S3 object metadata, or None when the cache key does not exist."""
    from botocore.exceptions import ClientError

    try:
        response = client.head_object(Bucket=bucket, Key=key)
        return {
            "size": int(response.get("ContentLength", 0)),
            "content_type": response.get("ContentType", "application/octet-stream"),
            "etag": response.get("ETag", "").strip('"'),
        }
    except ClientError as error:
        code = error.response.get("Error", {}).get("Code", "")
        if code in ("404", "NoSuchKey", "NotFound"):
            return None
        raise


# Bytes kept in RAM before SpooledTemporaryFile rolls to disk. Caps per-request
# memory under concurrency on gateway nodes.
_SPOOL_MAX_BYTES = 5 * 1024 * 1024


async def ingest_to_s3(
    client: Any,
    bucket: str,
    key: str,
    source_url: str,
    user_agent: str,
    storage_mode: str = "aws",
    timeout: float = 120.0,
) -> dict[str, str | int]:
    """Stream a complete source object into the configured object store."""
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as http:
        async with http.stream("GET", source_url, headers={"User-Agent": user_agent}) as response:
            response.raise_for_status()
            content_type = response.headers.get("content-type", "application/octet-stream")
            expected_size_raw = response.headers.get("content-length")
            expected_size = int(expected_size_raw) if expected_size_raw is not None else None

            spool = tempfile.SpooledTemporaryFile(max_size=_SPOOL_MAX_BYTES)
            try:
                total_size = 0
                async for chunk in response.aiter_bytes():
                    spool.write(chunk)
                    total_size += len(chunk)

                if expected_size is not None and total_size != expected_size:
                    raise RuntimeError(
                        f"partial_download size={total_size} expected={expected_size}"
                    )
                if total_size == 0:
                    raise RuntimeError("empty_body")

                spool.seek(0)
                loop = asyncio.get_running_loop()
                await loop.run_in_executor(
                    None,
                    lambda: client.upload_fileobj(
                        spool,
                        bucket,
                        key,
                        ExtraArgs=object_upload_extra_args(storage_mode, content_type),
                    ),
                )
                return {"size": total_size, "content_type": content_type}
            finally:
                spool.close()
