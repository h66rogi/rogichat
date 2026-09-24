from __future__ import annotations

import time

from meloming_media_gateway.auth import (
    compute_sig,
    secret_bytes,
    src_fingerprint,
    validate_cache_key,
    verify_sig,
)


SECRET = secret_bytes("s" * 40)
OLD_SECRET = secret_bytes("p" * 40)


def _sign(method: str, path: str, params: dict[str, str], exp: int) -> str:
    merged = dict(params)
    merged["exp"] = str(exp)
    parts = [f"method={method.upper()}", f"path={path}"]
    for k in sorted(merged):
        parts.append(f"{k}={merged[k]}")
    canonical = "&".join(parts)
    return compute_sig(SECRET, canonical)


def test_verify_sig_ok() -> None:
    exp = int(time.time()) + 60
    sig = _sign("GET", "/play", {"vid": "abc12345678"}, exp)
    result = verify_sig(
        method="GET",
        path="/play",
        params={"vid": "abc12345678"},
        exp_raw=str(exp),
        sig=sig,
        secret_current=SECRET,
    )
    assert result.ok
    assert result.reason == "ok"


def test_verify_sig_expired() -> None:
    exp = int(time.time()) - 3600
    sig = _sign("GET", "/play", {"vid": "abc12345678"}, exp)
    result = verify_sig(
        method="GET",
        path="/play",
        params={"vid": "abc12345678"},
        exp_raw=str(exp),
        sig=sig,
        secret_current=SECRET,
    )
    assert not result.ok
    assert result.reason == "expired"


def test_verify_sig_tampered() -> None:
    exp = int(time.time()) + 60
    sig = _sign("GET", "/play", {"vid": "abc12345678"}, exp)
    result = verify_sig(
        method="GET",
        path="/play",
        params={"vid": "xyz12345678"},  # different vid, same sig
        exp_raw=str(exp),
        sig=sig,
        secret_current=SECRET,
    )
    assert not result.ok
    assert result.reason == "bad_sig"


def test_verify_sig_previous_secret_fallback() -> None:
    # Signature made with OLD_SECRET, verified against current+prev
    exp = int(time.time()) + 60
    merged = {"vid": "abc12345678", "exp": str(exp)}
    parts = ["method=GET", "path=/play"]
    for k in sorted(merged):
        parts.append(f"{k}={merged[k]}")
    canonical = "&".join(parts)
    old_sig = compute_sig(OLD_SECRET, canonical)
    result = verify_sig(
        method="GET",
        path="/play",
        params={"vid": "abc12345678"},
        exp_raw=str(exp),
        sig=old_sig,
        secret_current=SECRET,
        secret_previous=OLD_SECRET,
    )
    assert result.ok
    assert result.reason == "ok_prev"


def test_verify_sig_bad_format() -> None:
    result = verify_sig(
        method="GET",
        path="/play",
        params={"vid": "abc12345678"},
        exp_raw="1",
        sig="not_hex",
        secret_current=SECRET,
    )
    assert not result.ok
    assert result.reason == "bad_sig_format"


def test_verify_sig_missing_exp() -> None:
    result = verify_sig(
        method="GET",
        path="/play",
        params={"vid": "abc12345678"},
        exp_raw=None,
        sig="a" * 64,
        secret_current=SECRET,
    )
    assert not result.ok
    assert result.reason == "bad_exp"


def test_validate_cache_key_ok() -> None:
    assert validate_cache_key("channel-123/audio/song.m4a").ok


def test_validate_cache_key_traversal() -> None:
    assert not validate_cache_key("../etc/passwd").ok
    assert not validate_cache_key("a//b").ok
    assert not validate_cache_key("/abs/path").ok
    assert not validate_cache_key("a\\b").ok
    assert not validate_cache_key("").ok


def test_validate_cache_key_too_long() -> None:
    assert not validate_cache_key("x" * 201).ok


def test_src_fingerprint_stable() -> None:
    fp = src_fingerprint("abc")
    assert fp is not None
    assert len(fp) == 16  # 8 bytes hex
    assert fp == src_fingerprint("abc")
    assert fp != src_fingerprint("abd")
