from meloming_media_gateway.app import (
    _direct_storage_response,
    _select_cached_delivery,
)


STORAGE_CORS_ORIGINS = [
    "https://meloming.com",
    "https://music.meloming.com",
]


def test_cached_delivery_redirects_first_party_origin() -> None:
    assert _select_cached_delivery(
        "redirect", "https://music.meloming.com", STORAGE_CORS_ORIGINS
    ) == ("redirect", "direct")


def test_cached_delivery_redirects_clients_without_origin() -> None:
    assert _select_cached_delivery("redirect", None, STORAGE_CORS_ORIGINS) == (
        "redirect",
        "direct",
    )


def test_cached_delivery_proxies_unknown_browser_origin() -> None:
    assert _select_cached_delivery(
        "redirect", "https://preview.example", STORAGE_CORS_ORIGINS
    ) == ("proxy", "origin_not_storage_cors")


def test_cached_delivery_proxy_mode_is_emergency_rollback() -> None:
    assert _select_cached_delivery(
        "proxy", "https://meloming.com", STORAGE_CORS_ORIGINS
    ) == ("proxy", "configured")


def test_direct_storage_response_preserves_method_and_is_not_cacheable() -> None:
    response = _direct_storage_response(
        "https://s3.example/object?signature=redacted"
    )

    assert response.status_code == 307
    assert response.headers["location"] == (
        "https://s3.example/object?signature=redacted"
    )
    assert response.headers["cache-control"] == "private, no-store"
    assert response.headers["referrer-policy"] == "no-referrer"
