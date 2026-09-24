from __future__ import annotations

import hashlib
import hmac
import re
import time
from dataclasses import dataclass

_SIG_RE = re.compile(r"^[0-9a-f]{64}$")
_KEY_RE = re.compile(r"^[A-Za-z0-9/_.-]{1,200}$")
_CLOCK_SKEW_SEC = 10


@dataclass(frozen=True)
class VerifyResult:
    ok: bool
    reason: str = "ok"


def _canonical(method: str, path: str, params: dict[str, str]) -> str:
    parts = [f"method={method.upper()}", f"path={path}"]
    for k in sorted(params):
        parts.append(f"{k}={params[k]}")
    return "&".join(parts)


def compute_sig(secret: bytes, canonical: str) -> str:
    return hmac.new(secret, canonical.encode("utf-8"), hashlib.sha256).hexdigest()


def verify_sig(
    *,
    method: str,
    path: str,
    params: dict[str, str],
    exp_raw: str | None,
    sig: str | None,
    secret_current: bytes,
    secret_previous: bytes | None = None,
) -> VerifyResult:
    if not sig or not _SIG_RE.fullmatch(sig):
        return VerifyResult(False, "bad_sig_format")
    if exp_raw is None:
        return VerifyResult(False, "bad_exp")
    try:
        exp = int(exp_raw)
    except (TypeError, ValueError):
        return VerifyResult(False, "bad_exp")

    now = int(time.time())
    if exp < now - _CLOCK_SKEW_SEC:
        return VerifyResult(False, "expired")

    canonical_params = dict(params)
    canonical_params["exp"] = str(exp)
    canonical = _canonical(method, path, canonical_params)

    expected = compute_sig(secret_current, canonical)
    if hmac.compare_digest(expected, sig):
        return VerifyResult(True, "ok")

    if secret_previous:
        expected_prev = compute_sig(secret_previous, canonical)
        if hmac.compare_digest(expected_prev, sig):
            return VerifyResult(True, "ok_prev")

    return VerifyResult(False, "bad_sig")


def validate_cache_key(key: str) -> VerifyResult:
    if not key or ".." in key or "//" in key or "\\" in key:
        return VerifyResult(False, "bad_key_format")
    if key.startswith("/"):
        return VerifyResult(False, "bad_key_format")
    if not _KEY_RE.fullmatch(key):
        return VerifyResult(False, "bad_key_format")
    return VerifyResult(True, "ok")


def src_fingerprint(src_b64: str | None) -> str | None:
    if not src_b64:
        return None
    return hashlib.blake2b(src_b64.encode("utf-8"), digest_size=8).hexdigest()


def secret_bytes(s: str) -> bytes:
    return s.encode("utf-8")
