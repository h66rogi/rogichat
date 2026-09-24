from __future__ import annotations

import hashlib
import logging
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime

import httpx
from fastapi import FastAPI, Header, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse, Response
from prometheus_client import CONTENT_TYPE_LATEST, Counter, generate_latest

from .auth import (
    secret_bytes,
    src_fingerprint,
    validate_cache_key,
    verify_sig,
)
from .config import get_settings
from .extractor import YoutubeExtractor, is_valid_video_id
from .proxy import proxy_stream
from .storage import (
    generate_presigned_url,
    head_object,
    ingest_to_s3,
    is_enabled,
    make_s3_client,
)

settings = get_settings()
logger = logging.getLogger("gateway")


class _ProbeAccessLogFilter(logging.Filter):
    """Drop routine probe access records while preserving application logs."""

    _paths = ("/healthz", "/readyz", "/metrics")

    def filter(self, record: logging.LogRecord) -> bool:
        message = record.getMessage()
        return not any(f" {path} " in message for path in self._paths)


_probe_access_log_filter = _ProbeAccessLogFilter()
logging.getLogger("uvicorn.access").addFilter(_probe_access_log_filter)
logging.getLogger("gunicorn.access").addFilter(_probe_access_log_filter)

# -----------------------------------------------------------------------------
# Metrics
# -----------------------------------------------------------------------------

AUTH_FAIL = Counter(
    "gateway_auth_fail_total",
    "Authentication failures by reason and path.",
    labelnames=("path", "reason"),
)
UNSIGNED_REQUESTS = Counter(
    "gateway_unsigned_requests_total",
    "Unsigned requests let through under GATEWAY_ALLOW_UNSIGNED_UNTIL.",
    labelnames=("path",),
)
# Outcomes of /play yt-dlp extraction. Drives auto-detection of IP-level
# failure modes (Google bot challenge, Oxylabs proxy exhaustion) that are
# invisible to a plain healthz probe.
#   success       — yt-dlp returned a muxed format, S3 write-through queued
#   timeout       — extractor.extract hit the asyncio.wait_for ceiling
#   bot_block     — yt-dlp surfaced "Sign in to confirm you're not a bot"
#   unavailable   — Video unavailable / Private / Removed by uploader
#   no_muxed      — yt-dlp returned formats but none was a muxed mp4/webm
#   invalid_input — video_id failed validation (sanity, near-zero in prod)
#   other         — uncategorised exception, see logs
PLAY_EXTRACT = Counter(
    "gateway_play_extract_total",
    "Outcomes of /play yt-dlp extraction attempts.",
    labelnames=("outcome",),
)
CACHED_DELIVERY = Counter(
    "gateway_cached_delivery_total",
    "Authenticated /cached requests by delivery mode and selection reason.",
    labelnames=("mode", "reason"),
)


# -----------------------------------------------------------------------------
# Bootstrap guard: hard-expire the unsigned bypass
# -----------------------------------------------------------------------------


def _allow_unsigned_active() -> bool:
    raw = settings.gateway_allow_unsigned_until.strip()
    if not raw:
        return False
    try:
        deadline = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError as exc:
        raise RuntimeError(
            f"invalid GATEWAY_ALLOW_UNSIGNED_UNTIL={raw!r}; expected ISO-8601"
        ) from exc
    if deadline.tzinfo is None:
        deadline = deadline.replace(tzinfo=UTC)
    now = datetime.now(UTC)
    if now >= deadline:
        raise RuntimeError(
            f"GATEWAY_ALLOW_UNSIGNED_UNTIL ({raw}) has passed; "
            "refusing to start with the unsigned bypass still enabled. "
            "Remove the env var or update the deadline."
        )
    return True


_UNSIGNED_BYPASS = _allow_unsigned_active()


# -----------------------------------------------------------------------------
# App + lifespan
# -----------------------------------------------------------------------------


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    app.state.extractor = YoutubeExtractor(
        max_concurrent=settings.play_extract_concurrency,
        timeout_seconds=settings.play_extract_timeout_seconds,
    )
    if _UNSIGNED_BYPASS:
        logger.warning(
            "unsigned_bypass_active",
            extra={"until": settings.gateway_allow_unsigned_until},
        )
    yield


app = FastAPI(title="meloming-media-gateway-cdn", version="0.2.0", lifespan=lifespan)

# CORS for browser playback through /play and the authenticated /cached
# fallback. CloudFront/S3 enforce their own CORS on normal cache hits.
if settings.cors_allowed_origins or settings.cors_allowed_origin_regex:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_allowed_origins,
        allow_origin_regex=settings.cors_allowed_origin_regex or None,
        allow_methods=["GET", "HEAD"],
        allow_headers=["Range"],
        expose_headers=[
            "Content-Length",
            "Content-Range",
            "Accept-Ranges",
            "Content-Type",
            "ETag",
        ],
        max_age=3600,
    )

_storage_client = make_s3_client(
    settings.object_storage_mode,
    settings.storage_region,
    settings.storage_access_key_id,
    settings.storage_secret_access_key,
    settings.storage_endpoint,
)


# -----------------------------------------------------------------------------
# Health + metrics (unauthenticated on purpose)
# -----------------------------------------------------------------------------


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/readyz")
def readyz() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/metrics")
def metrics() -> Response:
    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)


# -----------------------------------------------------------------------------
# Auth helpers
# -----------------------------------------------------------------------------


def _log_auth_fail(request: Request, *, reason: str, src_b64: str | None, exp: str | None, sig: str | None) -> None:
    AUTH_FAIL.labels(path=request.url.path, reason=reason).inc()
    logger.warning(
        "auth_fail",
        extra={
            "reason": reason,
            "path": request.url.path,
            "method": request.method,
            "src_fp": src_fingerprint(src_b64),
            "exp": exp,
            "now": int(time.time()),
            "sig_present": bool(sig),
            "sig_len": len(sig or ""),
            "ip": request.client.host if request.client else None,
            "ua": (request.headers.get("user-agent") or "")[:120],
            "req_id": request.headers.get("x-request-id"),
        },
    )


def _auth_response(reason: str) -> JSONResponse:
    if reason == "expired":
        return JSONResponse({"error": "expired"}, status_code=410)
    if reason in {"bad_sig", "bad_sig_format"}:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    if reason in {"bad_exp", "bad_scheme", "bad_host", "blocked_ip", "dns_fail", "unparseable", "bad_key_format"}:
        return JSONResponse({"error": "bad_request"}, status_code=400)
    return JSONResponse({"error": "bad_request"}, status_code=400)


def _verify_or_bypass(
    request: Request,
    *,
    path: str,
    params: dict[str, str],
    exp_raw: str | None,
    sig: str | None,
    secret: str,
    secret_prev: str = "",
    src_b64_for_log: str | None = None,
) -> tuple[bool, str]:
    """Returns (ok, reason). ok=False → caller should return _auth_response(reason)."""
    if not secret:
        # No secret configured. Only acceptable when the unsigned bypass window is open.
        if _UNSIGNED_BYPASS:
            UNSIGNED_REQUESTS.labels(path=path).inc()
            return True, "ok_unsigned_bypass_no_secret"
        return False, "bad_sig"

    if sig is None and exp_raw is None and _UNSIGNED_BYPASS:
        UNSIGNED_REQUESTS.labels(path=path).inc()
        return True, "ok_unsigned_bypass"

    result = verify_sig(
        method=request.method,
        path=path,
        params=params,
        exp_raw=exp_raw,
        sig=sig,
        secret_current=secret_bytes(secret),
        secret_previous=secret_bytes(secret_prev) if secret_prev else None,
    )
    if not result.ok:
        _log_auth_fail(request, reason=result.reason, src_b64=src_b64_for_log, exp=exp_raw, sig=sig)
        return False, result.reason
    return True, result.reason


# -----------------------------------------------------------------------------
# /cached/{key} — authenticate, then hand the byte path directly to S3.
#
# Browser origins that are not in the configured CORS allowlist retain the
# gateway proxy path. This keeps preview/unknown origins working while normal
# production and QA media traffic avoids relaying cache-hit bytes through on-prem.
# -----------------------------------------------------------------------------


def _select_cached_delivery(
    mode: str,
    origin: str | None,
    storage_cors_origins: list[str],
) -> tuple[str, str]:
    if mode == "proxy":
        return "proxy", "configured"
    if origin and origin not in storage_cors_origins:
        return "proxy", "origin_not_storage_cors"
    return "redirect", "direct"


def _direct_storage_response(presigned_url: str) -> RedirectResponse:
    return RedirectResponse(
        url=presigned_url,
        status_code=307,
        headers={
            "Cache-Control": "private, no-store",
            "Referrer-Policy": "no-referrer",
        },
    )


@app.get("/cached/{key:path}", response_model=None)
async def cached(
    request: Request,
    key: str,
    exp: str | None = Query(default=None),
    sig: str | None = Query(default=None),
    range_header: str | None = Header(default=None, alias="range"),
):
    if not is_enabled(settings.storage_access_key_id):
        return JSONResponse({"error": "storage_not_configured"}, status_code=503)

    key_check = validate_cache_key(key)
    if not key_check.ok:
        _log_auth_fail(request, reason=key_check.reason, src_b64=None, exp=exp, sig=sig)
        return _auth_response(key_check.reason)

    ok, reason = _verify_or_bypass(
        request,
        path=f"/cached/{key}",
        params={"key": key},
        exp_raw=exp,
        sig=sig,
        secret=settings.gateway_sign_secret,
        secret_prev=settings.gateway_sign_secret_prev,
    )
    if not ok:
        return _auth_response(reason)

    try:
        presigned = generate_presigned_url(
            _storage_client, settings.storage_bucket, key, expires_in=3600
        )
    except Exception:
        CACHED_DELIVERY.labels(mode="error", reason="presign_failed").inc()
        logger.exception("cached_presign_failed", extra={"path": request.url.path})
        return JSONResponse({"error": "internal"}, status_code=500)

    delivery_mode, delivery_reason = _select_cached_delivery(
        settings.cached_delivery_mode,
        request.headers.get("origin"),
        settings.cors_allowed_origins,
    )
    CACHED_DELIVERY.labels(mode=delivery_mode, reason=delivery_reason).inc()

    if delivery_mode == "redirect":
        return _direct_storage_response(presigned)

    return await proxy_stream(
        presigned,
        range_header,
        settings.fetch_user_agent,
        settings.fetch_timeout_seconds,
    )


# -----------------------------------------------------------------------------
# /play — video_id 단위 cold cache fill pipeline (Codex 리뷰 strict bounded)
#
# 흐름:
#   1. video_id 정규식 검증 + HMAC 서명 검증
#   2. S3 HEAD-before-extract → 있으면 cached 흐름으로 우회 (yt-dlp 호출 X)
#      + DB repair callback (fire-and-forget)
#   3. 없으면 yt-dlp 자체 추출 (singleflight + per-node semaphore)
#   4. background ingest_to_s3 + S3 write 완료 후에만 callback (partial cache 방지)
#   5. 즉시 클라에 muxed URL 을 proxy_stream — 첫 재생 latency 최소화
#
# `vid` 만 받음 (arbitrary src 금지). Backend 가 hash(video_id) 로 온프렘
# A/B/C 노드를 결정해서 sign — singleflight 가 의미를 갖도록.
# -----------------------------------------------------------------------------


def _classify_extract_error(exc: BaseException) -> str:
    """Bucket a yt-dlp / extractor exception into a small set of metric labels.

    Used for the `gateway_play_extract_total{outcome=...}` counter so that
    IP-level failure modes (bot challenge, Oxylabs exhaustion) can be
    distinguished from transient unavailability or app-internal errors.
    """
    msg = str(exc).lower()
    # YouTube bot-challenge wording is fairly stable across yt-dlp releases.
    if "sign in to confirm" in msg or "are you a bot" in msg:
        return "bot_block"
    if (
        "video unavailable" in msg
        or "private video" in msg
        or "removed by the uploader" in msg
        or "this video is no longer available" in msg
    ):
        return "unavailable"
    # Internal markers raised by extractor._extract_sync when yt-dlp returns
    # zero usable formats. Distinct from upstream errors.
    if isinstance(exc, RuntimeError) and str(exc) in {
        "no_muxed_format",
        "muxed_format_missing_url",
    }:
        return "no_muxed"
    return "other"


def _build_cache_key(video_id: str) -> str:
    return f"youtube/{video_id}/itag18.mp4"


async def _send_cache_upsert_callback(
    video_id: str,
    storage_key: str,
    meta: dict[str, str | int],
) -> None:
    """S3 write 완료 후 backend `/internal/video-cache/upsert` 호출 (fire-and-forget).

    HMAC canonical = `ts|videoId|r2Key|size|contentType` (fields-explicit, raw body parser
    의존성 없이 backend 가 단순히 검증 가능). 실패해도 다음 `/play` 가 S3 HEAD repair self-heal.
    """
    if not settings.play_cache_upsert_url or not settings.play_callback_secret:
        return
    import hmac as _hmac
    size = meta.get("size", "")
    content_type = meta.get("content_type", "")
    ts = str(int(time.time()))
    canonical = f"{ts}|{video_id}|{storage_key}|{size}|{content_type}"
    sig = _hmac.new(
        settings.play_callback_secret.encode("utf-8"),
        canonical.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    body = {
        "videoId": video_id,
        # The callback field remains r2Key for the existing database/API
        # contract; its value is now an object-storage-neutral cache key.
        "r2Key": storage_key,
        "size": size if size != "" else None,
        "contentType": content_type if content_type != "" else None,
    }
    try:
        async with httpx.AsyncClient(timeout=5.0) as http:
            r = await http.post(
                settings.play_cache_upsert_url,
                json=body,
                headers={
                    "X-Callback-Timestamp": ts,
                    "X-Callback-Signature": sig,
                },
            )
            if r.status_code >= 300:
                logger.warning(
                    "callback_non_2xx",
                    extra={"video_id": video_id, "status": r.status_code},
                )
    except Exception:
        logger.warning("callback_failed", extra={"video_id": video_id})


async def _ingest_and_callback(
    video_id: str, storage_key: str, src_url: str
) -> None:
    """배경 task: S3 write-through 후 S3 write 완료 시에만 callback."""
    try:
        meta = await ingest_to_s3(
            _storage_client,
            settings.storage_bucket,
            storage_key,
            src_url,
            settings.fetch_user_agent,
            settings.object_storage_mode,
            timeout=settings.fetch_timeout_seconds + 30.0,
        )
        await _send_cache_upsert_callback(video_id, storage_key, meta)
    except Exception:
        # partial download / S3 write 실패 → callback 안 보냄 (partial cache 방지).
        logger.exception("play_background_ingest_failed", extra={"video_id": video_id})


@app.get("/play", response_model=None)
async def play(
    request: Request,
    vid: str = Query(..., min_length=11, max_length=11),
    exp: str | None = Query(default=None),
    sig: str | None = Query(default=None),
    range_header: str | None = Header(default=None, alias="range"),
):
    if not is_valid_video_id(vid):
        return JSONResponse({"error": "bad_video_id"}, status_code=400)

    if not is_enabled(settings.storage_access_key_id):
        return JSONResponse({"error": "storage_not_configured"}, status_code=503)

    ok, reason = _verify_or_bypass(
        request,
        path="/play",
        params={"vid": vid},
        exp_raw=exp,
        sig=sig,
        secret=settings.gateway_sign_secret,
        secret_prev=settings.gateway_sign_secret_prev,
    )
    if not ok:
        return _auth_response(reason)

    storage_key = _build_cache_key(vid)

    # 1) S3 HEAD-before-extract — 이미 있으면 yt-dlp 호출 회피 + DB repair callback.
    import asyncio as _asyncio
    try:
        head_meta = await _asyncio.to_thread(
            head_object, _storage_client, settings.storage_bucket, storage_key
        )
    except Exception:
        logger.exception("s3_head_failed", extra={"video_id": vid})
        head_meta = None

    if head_meta is not None:
        # callback 으로 backend 인덱스 self-heal (best-effort, latency 영향 0).
        _asyncio.create_task(
            _send_cache_upsert_callback(vid, storage_key, head_meta)
        )
        try:
            presigned = generate_presigned_url(
                _storage_client, settings.storage_bucket, storage_key, expires_in=3600
            )
        except Exception:
            logger.exception("cached_presign_failed", extra={"video_id": vid})
            return JSONResponse({"error": "internal"}, status_code=500)
        return await proxy_stream(
            presigned,
            range_header,
            settings.fetch_user_agent,
            settings.fetch_timeout_seconds,
        )

    # 2) yt-dlp 자체 추출 — singleflight + semaphore.
    extractor: YoutubeExtractor = request.app.state.extractor
    try:
        extracted = await extractor.extract(vid)
    except ValueError:
        PLAY_EXTRACT.labels(outcome="invalid_input").inc()
        return JSONResponse({"error": "bad_video_id"}, status_code=400)
    except (TimeoutError, _asyncio.TimeoutError):
        PLAY_EXTRACT.labels(outcome="timeout").inc()
        logger.warning("extract_timeout", extra={"video_id": vid})
        return JSONResponse({"error": "extract_timeout"}, status_code=504)
    except Exception as exc:
        outcome = _classify_extract_error(exc)
        PLAY_EXTRACT.labels(outcome=outcome).inc()
        logger.exception(
            "extract_failed", extra={"video_id": vid, "outcome": outcome}
        )
        return JSONResponse({"error": "extract_failed"}, status_code=502)
    PLAY_EXTRACT.labels(outcome="success").inc()

    # 3) background S3 write-through + callback (S3 write 완료 후에만).
    _asyncio.create_task(_ingest_and_callback(vid, storage_key, extracted.url))

    # 4) 즉시 클라에 muxed URL proxy_stream — 첫 재생 latency 최소화.
    return await proxy_stream(
        extracted.url,
        range_header,
        settings.fetch_user_agent,
        settings.fetch_timeout_seconds,
    )
