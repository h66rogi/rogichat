import os

# Populate required settings for import-time Settings() in app.py
os.environ.setdefault("S3_REGION", "ap-northeast-2")
os.environ.setdefault("S3_ACCESS_KEY_ID", "test")
os.environ.setdefault("S3_SECRET_ACCESS_KEY", "test")
os.environ.setdefault("S3_BUCKET", "test-media-cache")

from fastapi.testclient import TestClient  # noqa: E402

from meloming_media_gateway.app import app  # noqa: E402


def test_healthz() -> None:
    with TestClient(app) as client:
        response = client.get("/healthz")
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}


def test_readyz() -> None:
    with TestClient(app) as client:
        response = client.get("/readyz")
        assert response.status_code == 200
