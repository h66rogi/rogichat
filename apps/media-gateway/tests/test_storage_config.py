import pytest
from pydantic import ValidationError

from meloming_media_gateway.config import Settings


def test_s3_backend_requires_complete_configuration() -> None:
    with pytest.raises(ValidationError, match="S3_BUCKET"):
        Settings(
            s3_access_key_id="s3-key",
            s3_secret_access_key="s3-secret",
            s3_bucket="",
        )


def test_s3_backend_accepts_complete_configuration() -> None:
    settings = Settings(
        s3_region="ap-northeast-2",
        s3_access_key_id="s3-key",
        s3_secret_access_key="s3-secret",
        s3_bucket="media-prod",
    )

    assert settings.s3_access_key_id == "s3-key"
    assert settings.s3_bucket == "media-prod"


def test_r2_requires_complete_scoped_configuration() -> None:
    with pytest.raises(ValidationError, match="OBJECT_STORAGE_ENDPOINT"):
        Settings(object_storage_mode="r2")


def test_r2_isolates_scoped_credentials_from_legacy_aws() -> None:
    settings = Settings(
        object_storage_mode="r2",
        object_storage_endpoint=(
            "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com"
        ),
        object_storage_region="auto",
        object_storage_access_key_id="r2-key",
        object_storage_secret_access_key="r2-secret",
        object_storage_bucket="meloming-media-gateway-cdn-prod",
        object_storage_public_base_url="https://media.example.com",
        s3_access_key_id="aws-key",
        s3_secret_access_key="aws-secret",
        s3_bucket="legacy-media",
    )

    assert settings.storage_access_key_id == "r2-key"
    assert settings.storage_bucket == "meloming-media-gateway-cdn-prod"
    assert settings.storage_region == "auto"


def test_r2_rejects_aws_endpoint_and_region() -> None:
    values = {
        "object_storage_mode": "r2",
        "object_storage_endpoint": "https://s3.ap-northeast-2.amazonaws.com",
        "object_storage_region": "ap-northeast-2",
        "object_storage_access_key_id": "r2-key",
        "object_storage_secret_access_key": "r2-secret",
        "object_storage_bucket": "meloming-media-gateway-cdn-prod",
        "object_storage_public_base_url": "https://media.example.com",
    }
    with pytest.raises(ValidationError, match="account-scoped Cloudflare R2"):
        Settings(**values)
