from fastapi.testclient import TestClient

from meloming_media_gateway.app import app


def _preflight(client: TestClient, *, path: str, origin: str) -> object:
    return client.options(
        path,
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "range",
        },
    )


def test_cors_preflight_allows_exact_origin() -> None:
    with TestClient(app) as client:
        resp = _preflight(client, path="/play", origin="https://meloming.com")
        assert resp.status_code == 200
        assert resp.headers.get("access-control-allow-origin") == "https://meloming.com"
        # Range is the only header we expect a browser to ask for during seek.
        assert "range" in resp.headers.get("access-control-allow-headers", "").lower()


def test_cors_preflight_allows_regex_origin() -> None:
    with TestClient(app) as client:
        resp = _preflight(
            client,
            path="/play",
            origin="https://meloming-front-git-feature.vercel.app",
        )
        assert resp.status_code == 200
        assert (
            resp.headers.get("access-control-allow-origin")
            == "https://meloming-front-git-feature.vercel.app"
        )


def test_cors_preflight_blocks_disallowed_origin() -> None:
    with TestClient(app) as client:
        resp = _preflight(client, path="/play", origin="https://evil.example")
        # Starlette's CORSMiddleware returns 400 for a preflight from a
        # disallowed origin and never echoes Access-Control-Allow-Origin.
        assert resp.headers.get("access-control-allow-origin") is None


def test_cors_actual_get_response_has_allow_origin_for_allowed_origin() -> None:
    """Even when the upstream call would fail (no real signature), the CORS
    headers must still be on the response so the browser doesn't block it."""
    with TestClient(app) as client:
        resp = client.get(
            "/healthz",
            headers={"Origin": "https://meloming.com"},
        )
        assert resp.status_code == 200
        assert resp.headers.get("access-control-allow-origin") == "https://meloming.com"
