"""yt-dlp 기반 video_id → muxed mp4 URL 추출.

원칙 (Codex 리뷰 반영):
- 같은 IP에서 추출 + fetch → IP-bind 자동 매칭. proxy 사용 X
- per-process semaphore 로 동시 추출 수 제한 (작은 VPS 보호)
- per-process singleflight 로 같은 video_id 중복 추출 방지
- muxed/progressive format only (DASH 분리 / ffmpeg merge 금지)
- video_id 정규식 검증 (playlist/임의 URL 차단)
- signed URL의 `expire` 파라미터로 cache TTL 결정 (고정 6h X)
- 로그에 signed googlevideo URL 노출 금지
"""
from __future__ import annotations

import asyncio
import logging
import re
import time
import urllib.parse
from dataclasses import dataclass

from yt_dlp import YoutubeDL

logger = logging.getLogger("gateway.extractor")

VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")


def is_valid_video_id(video_id: str) -> bool:
    return bool(VIDEO_ID_RE.fullmatch(video_id))


@dataclass(frozen=True)
class ExtractedFormat:
    url: str
    content_type: str
    expires_at: int  # epoch seconds — signed URL `expire` param


# ─────────────────────────────────────────────────────────────────────────────
# Concurrency primitives
# ─────────────────────────────────────────────────────────────────────────────


class _Singleflight:
    """같은 key 의 동시 호출을 한 번의 실제 fn 실행으로 묶는다."""

    def __init__(self) -> None:
        self._inflight: dict[str, asyncio.Future[ExtractedFormat]] = {}

    async def do(
        self,
        key: str,
        fn,  # type: ignore[no-untyped-def]
    ) -> ExtractedFormat:
        existing = self._inflight.get(key)
        if existing is not None:
            return await existing
        loop = asyncio.get_running_loop()
        fut: asyncio.Future[ExtractedFormat] = loop.create_future()
        self._inflight[key] = fut
        try:
            result = await fn()
        except BaseException as exc:
            if not fut.done():
                fut.set_exception(exc)
            raise
        else:
            if not fut.done():
                fut.set_result(result)
            return result
        finally:
            self._inflight.pop(key, None)


class YoutubeExtractor:
    """yt-dlp wrapper — bounded concurrency + singleflight + muxed-only."""

    def __init__(
        self,
        max_concurrent: int = 1,
        timeout_seconds: float = 20.0,
    ) -> None:
        self._semaphore = asyncio.Semaphore(max_concurrent)
        self._singleflight = _Singleflight()
        self._timeout_seconds = timeout_seconds

    async def extract(self, video_id: str) -> ExtractedFormat:
        if not is_valid_video_id(video_id):
            raise ValueError(f"invalid_video_id")

        async def _do() -> ExtractedFormat:
            async with self._semaphore:
                return await asyncio.wait_for(
                    asyncio.to_thread(self._extract_sync, video_id),
                    timeout=self._timeout_seconds,
                )

        return await self._singleflight.do(video_id, _do)

    def _extract_sync(self, video_id: str) -> ExtractedFormat:
        opts: dict[str, object] = {
            "quiet": True,
            "no_warnings": True,
            "skip_download": True,
            "noplaylist": True,
            # progressive (videos+audio) only — VPS 에서 DASH merge 못 함
            "format": "18/best[ext=mp4][vcodec!=none][acodec!=none]/best[vcodec!=none][acodec!=none]",
            "youtube_include_dash_manifest": False,
            "youtube_include_hls_manifest": False,
            # logger 를 가로채면 yt-dlp 가 signed URL 을 노출시킬 위험이 있어
            # 별도 핸들러 미설정. 위 quiet/no_warnings 로 stdout 자체 막음.
        }

        url = f"https://www.youtube.com/watch?v={video_id}"
        with YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)

        formats = info.get("formats") or []
        muxed = [
            f
            for f in formats
            if f.get("vcodec") and f.get("vcodec") != "none"
            and f.get("acodec") and f.get("acodec") != "none"
            and (f.get("protocol") or "").startswith("https")
        ]
        if not muxed:
            raise RuntimeError("no_muxed_format")

        # 가장 높은 비트레이트
        best = max(muxed, key=lambda f: f.get("tbr") or 0)
        signed_url = best.get("url")
        if not signed_url:
            raise RuntimeError("muxed_format_missing_url")

        content_type = "video/mp4"
        ext = best.get("ext")
        if ext == "mp4":
            content_type = "video/mp4"
        elif ext == "webm":
            content_type = "video/webm"

        expires_at = _parse_expire(signed_url)

        # 로그에 video_id 만, signed URL 본문 X
        logger.info(
            "extracted",
            extra={"video_id": video_id, "format_id": best.get("format_id"), "expires_at": expires_at},
        )
        return ExtractedFormat(url=signed_url, content_type=content_type, expires_at=expires_at)


def _parse_expire(signed_url: str) -> int:
    """signed googlevideo URL 의 `expire` 파라미터 (epoch seconds) 추출.

    실패 시 보수적으로 현재 + 5분 (memory cache 가 거의 안 묶이도록).
    """
    try:
        qs = urllib.parse.parse_qs(urllib.parse.urlparse(signed_url).query)
        raw = qs.get("expire", [None])[0]
        if raw is not None:
            value = int(raw)
            if value > int(time.time()):
                return value
    except (ValueError, KeyError):
        pass
    return int(time.time()) + 300
