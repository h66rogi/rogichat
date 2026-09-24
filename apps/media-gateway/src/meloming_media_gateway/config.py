from functools import cached_property, lru_cache
import re
from typing import Literal
from urllib.parse import urlparse

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    object_storage_mode: Literal["aws", "r2"] = "aws"
    object_storage_endpoint: str = ""
    object_storage_region: str = ""
    object_storage_access_key_id: str = ""
    object_storage_secret_access_key: str = ""
    object_storage_bucket: str = ""
    object_storage_public_base_url: str = ""

    # Exact legacy AWS fallback. These remain independent from the scoped R2
    # credentials so an AWS SDK provider used elsewhere cannot consume R2 keys.
    s3_region: str = "ap-northeast-2"
    s3_access_key_id: str = ""
    s3_secret_access_key: str = ""
    s3_bucket: str = ""

    @model_validator(mode="after")
    def validate_object_storage(self) -> "Settings":
        if self.object_storage_mode == "r2":
            values = (
                ("OBJECT_STORAGE_ENDPOINT", self.object_storage_endpoint),
                ("OBJECT_STORAGE_REGION", self.object_storage_region),
                ("OBJECT_STORAGE_ACCESS_KEY_ID", self.object_storage_access_key_id),
                ("OBJECT_STORAGE_SECRET_ACCESS_KEY", self.object_storage_secret_access_key),
                ("OBJECT_STORAGE_BUCKET", self.object_storage_bucket),
                ("OBJECT_STORAGE_PUBLIC_BASE_URL", self.object_storage_public_base_url),
            )
            missing = [name for name, value in values if not value.strip()]
            if missing:
                raise ValueError("R2 storage requires " + ", ".join(missing))

            endpoint = urlparse(self.object_storage_endpoint)
            public_url = urlparse(self.object_storage_public_base_url)
            if (
                endpoint.scheme != "https"
                or endpoint.username
                or endpoint.password
                or endpoint.query
                or endpoint.fragment
                or endpoint.path not in ("", "/")
                or not endpoint.hostname
                or not endpoint.hostname.endswith(".r2.cloudflarestorage.com")
                or re.fullmatch(
                    r"[a-f0-9]{32}\.r2\.cloudflarestorage\.com",
                    endpoint.hostname,
                    re.IGNORECASE,
                )
                is None
            ):
                raise ValueError(
                    "OBJECT_STORAGE_ENDPOINT must be an account-scoped Cloudflare R2 HTTPS endpoint"
                )
            if self.object_storage_region != "auto":
                raise ValueError("OBJECT_STORAGE_REGION must be exactly auto for R2")
            if (
                public_url.scheme != "https"
                or public_url.username
                or public_url.password
                or public_url.query
                or public_url.fragment
                or not public_url.hostname
            ):
                raise ValueError(
                    "OBJECT_STORAGE_PUBLIC_BASE_URL must be a credential-free HTTPS URL"
                )
            return self

        missing = [
            name
            for name, value in (
                ("S3_REGION", self.s3_region),
                ("S3_ACCESS_KEY_ID", self.s3_access_key_id),
                ("S3_SECRET_ACCESS_KEY", self.s3_secret_access_key),
                ("S3_BUCKET", self.s3_bucket),
            )
            if not value.strip()
        ]
        if missing:
            raise ValueError("S3 storage requires " + ", ".join(missing))
        return self

    @property
    def storage_region(self) -> str:
        return self.object_storage_region if self.object_storage_mode == "r2" else self.s3_region

    @property
    def storage_access_key_id(self) -> str:
        return (
            self.object_storage_access_key_id
            if self.object_storage_mode == "r2"
            else self.s3_access_key_id
        )

    @property
    def storage_secret_access_key(self) -> str:
        return (
            self.object_storage_secret_access_key
            if self.object_storage_mode == "r2"
            else self.s3_secret_access_key
        )

    @property
    def storage_bucket(self) -> str:
        return self.object_storage_bucket if self.object_storage_mode == "r2" else self.s3_bucket

    @property
    def storage_endpoint(self) -> str:
        if self.object_storage_mode == "r2":
            return self.object_storage_endpoint.rstrip("/")
        return f"https://s3.{self.s3_region}.amazonaws.com"

    # Cached objects should leave the gateway immediately after HMAC
    # verification. Set to "proxy" only for an emergency S3 delivery fallback;
    # unknown browser origins also fall back to proxy automatically.
    cached_delivery_mode: Literal["redirect", "proxy"] = "redirect"

    # Origin fetch
    fetch_user_agent: str = (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
    )
    fetch_timeout_seconds: float = 30.0
    max_concurrent_fetches: int = 20

    # -------------------------------------------------------------------------
    # HMAC signing — see docs/SECURITY.md
    # -------------------------------------------------------------------------

    # Primary secret for /play and /cached. Required unless allow_unsigned is active.
    gateway_sign_secret: str = ""

    # Previous secret during rotation overlap window. Verified as fallback.
    gateway_sign_secret_prev: str = ""

    # ISO-8601 UTC datetime (e.g. "2026-05-31T00:00:00Z"). While before this,
    # unsigned requests are allowed but counted in `gateway_unsigned_requests_total`.
    # After this instant the process refuses to start with the bypass enabled.
    # Leave unset to disable the bypass entirely (prod default).
    gateway_allow_unsigned_until: str = ""

    # -------------------------------------------------------------------------
    # CORS — required so meloming-front console can run a Web Audio pitch
    # shifter against /play responses. Normal cache hits use CloudFront/S3 CORS;
    # /cached remains an authenticated emergency fallback.
    # -------------------------------------------------------------------------

    # Comma-separated list of exact origins (e.g. "https://meloming.com,https://www.meloming.com").
    # Stored as a raw string because pydantic-settings tries to JSON-parse list[str] from env vars.
    cors_allowed_origins_csv: str = ""

    # Optional regex for origins that can't be enumerated (Vercel preview deploys, etc.).
    cors_allowed_origin_regex: str = ""

    @cached_property
    def cors_allowed_origins(self) -> list[str]:
        return [item.strip() for item in self.cors_allowed_origins_csv.split(",") if item.strip()]

    # -------------------------------------------------------------------------
    # /play (yt-dlp self-extraction) — Codex 리뷰 반영 strict bounded pipeline.
    # 빈 값이면 endpoint 가 503 반환 (전환 전 prod 안전 default).
    # -------------------------------------------------------------------------

    # 노드당 동시 yt-dlp 추출 수. 작은 VPS (2 core / 1.9GB) 보호용.
    play_extract_concurrency: int = 1

    # yt-dlp 추출 1회 hard timeout (초). 예: 20s.
    play_extract_timeout_seconds: float = 20.0

    # backend internal callback (S3 write 완료 후 fire-and-forget).
    # 비면 callback skip — backend 가 다음 호출에서 S3 HEAD repair 로 self-heal.
    play_cache_upsert_url: str = ""

    # callback HMAC secret (backend 와 공유).
    play_callback_secret: str = ""


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
