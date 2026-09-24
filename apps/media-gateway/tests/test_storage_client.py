from typing import Any

from meloming_media_gateway import storage


def test_s3_client_pins_regional_virtual_host_endpoint(monkeypatch: Any) -> None:
    captured: dict[str, Any] = {}

    def fake_client(service: str, **kwargs: Any) -> object:
        captured["service"] = service
        captured.update(kwargs)
        return object()

    monkeypatch.setattr(storage.boto3, "client", fake_client)

    storage.make_s3_client(
        "aws",
        "ap-northeast-2",
        "access-key",
        "secret-key",
        "https://s3.ap-northeast-2.amazonaws.com",
    )

    assert captured["service"] == "s3"
    assert captured["region_name"] == "ap-northeast-2"
    assert captured["endpoint_url"] == "https://s3.ap-northeast-2.amazonaws.com"
    assert captured["config"].signature_version == "s3v4"
    assert captured["config"].s3 == {"addressing_style": "virtual"}


def test_r2_client_uses_scoped_endpoint_credentials_and_path_addressing(
    monkeypatch: Any,
) -> None:
    captured: dict[str, Any] = {}

    def fake_client(service: str, **kwargs: Any) -> object:
        captured["service"] = service
        captured.update(kwargs)
        return object()

    monkeypatch.setattr(storage.boto3, "client", fake_client)
    storage.make_s3_client(
        "r2",
        "auto",
        "r2-access-key",
        "r2-secret-key",
        "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com",
    )

    assert captured["region_name"] == "auto"
    assert captured["aws_access_key_id"] == "r2-access-key"
    assert captured["endpoint_url"].endswith(".r2.cloudflarestorage.com")
    assert captured["config"].s3 == {"addressing_style": "path"}


def test_r2_upload_omits_unsupported_aws_storage_class() -> None:
    r2_args = storage.object_upload_extra_args("r2", "video/mp4")
    aws_args = storage.object_upload_extra_args("aws", "video/mp4")

    assert "StorageClass" not in r2_args
    assert aws_args["StorageClass"] == "INTELLIGENT_TIERING"
    assert r2_args["ContentType"] == aws_args["ContentType"]
    assert r2_args["CacheControl"] == aws_args["CacheControl"]
