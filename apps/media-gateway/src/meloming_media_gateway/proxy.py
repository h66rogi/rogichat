from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator

import httpx
from fastapi.responses import JSONResponse, StreamingResponse

logger = logging.getLogger("gateway.proxy")

_PASSTHROUGH_HEADERS = {
    "content-type",
    "content-length",
    "content-range",
    "accept-ranges",
    "last-modified",
    "etag",
}

# Headers we always add on proxy responses to prevent any intermediate cache
# (browser, Caddy, CDN) from reusing a signed URL response past the signature's
# exp window.
_NO_STORE_HEADERS = {
    "Cache-Control": "no-store",
    "Pragma": "no-cache",
}

# Origin status codes worth retrying. Transient googlevideo edge failures
# return 502/503/504 occasionally. 5xx-other we leave alone (could be auth /
# format issues that won't recover).
_RETRY_STATUS = {502, 503, 504}
_RETRY_DELAY_SECONDS = 0.4


async def _open_origin(
    client: httpx.AsyncClient,
    src_url: str,
    headers: dict[str, str],
) -> httpx.Response:
    request = client.build_request("GET", src_url, headers=headers)
    return await client.send(request, stream=True)


async def proxy_stream(
    src_url: str,
    range_header: str | None,
    user_agent: str,
    timeout: float,
) -> StreamingResponse | JSONResponse:
    headers = {"User-Agent": user_agent}
    if range_header:
        headers["Range"] = range_header

    client = httpx.AsyncClient(timeout=timeout, follow_redirects=True)
    response: httpx.Response | None = None
    last_exc: Exception | None = None

    # 2 attempts total: initial + 1 retry on transient failure.
    for attempt in (1, 2):
        try:
            response = await _open_origin(client, src_url, headers)
        except (httpx.TimeoutException, httpx.TransportError) as exc:
            last_exc = exc
            logger.warning(
                "origin_transport_error",
                extra={"attempt": attempt, "err": type(exc).__name__, "detail": str(exc)[:200]},
            )
            if attempt == 2:
                await client.aclose()
                return JSONResponse({"error": "origin_unreachable"}, status_code=502)
            await asyncio.sleep(_RETRY_DELAY_SECONDS)
            continue

        if response.status_code in _RETRY_STATUS and attempt == 1:
            logger.warning(
                "origin_retryable_status",
                extra={"attempt": attempt, "status": response.status_code},
            )
            await response.aclose()
            await asyncio.sleep(_RETRY_DELAY_SECONDS)
            continue

        break

    assert response is not None  # mypy: at this point we either have response or returned
    _ = last_exc  # silence unused

    async def body() -> AsyncIterator[bytes]:
        try:
            async for chunk in response.aiter_bytes():
                yield chunk
        finally:
            await response.aclose()
            await client.aclose()

    passthrough = {
        k: v for k, v in response.headers.items() if k.lower() in _PASSTHROUGH_HEADERS
    }
    passthrough.update(_NO_STORE_HEADERS)
    return StreamingResponse(
        body(),
        status_code=response.status_code,
        headers=passthrough,
    )
