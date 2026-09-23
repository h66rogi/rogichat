#!/usr/bin/env python3
"""Verify the byte provenance of directly copied Meloming source files.

Frontend imports use the sole namespace substitution @/ -> @/meloming/.
The backend snapshot and public assets must be byte-for-byte identical.
"""

from __future__ import annotations

import hashlib
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / 'docs/meloming-source-manifest.tsv'
FRONTEND = ROOT / 'apps/web/src/meloming'
BACKEND = ROOT / 'apps/api/meloming-source'
ASSETS = ROOT / 'apps/web/public'
TEXT_SUFFIXES = {'.ts', '.tsx', '.js', '.jsx', '.css'}
CSS_CLASS_ALIAS_FILE = 'domains/channel/components/musicbook/song-request-price-pills.tsx'


def digest(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def verify_files(directory: Path, hashes: dict[str, str], *, namespace: bool = False) -> None:
    actual = {str(path.relative_to(directory)) for path in directory.rglob('*') if path.is_file()}
    expected = set(hashes)
    assert actual == expected, f'{directory}: missing={sorted(expected - actual)}, extra={sorted(actual - expected)}'
    for relative, expected_hash in hashes.items():
        path = directory / relative
        content = path.read_bytes()
        if namespace and path.suffix in TEXT_SUFFIXES:
            content = content.replace(b'@/meloming/', b'@/')
        if namespace and relative == CSS_CLASS_ALIAS_FILE:
            content = content.replace(b'badgeClass', b'tokenClass')
        assert digest(content) == expected_hash, f'Copied source diverged: {path}'


def main() -> None:
    manifest: dict[str, dict[str, str]] = {'frontend': {}, 'backend': {}, 'assets': {}}
    groups = {'F': 'frontend', 'B': 'backend', 'A': 'assets'}
    for line in MANIFEST.read_text().splitlines():
        if line.startswith('#'):
            continue
        kind, expected_hash, relative = line.split('\t', 2)
        assert kind in groups and len(expected_hash) == 64
        manifest[groups[kind]][relative] = expected_hash
    verify_files(FRONTEND, manifest['frontend'], namespace=True)
    verify_files(BACKEND, manifest['backend'])
    for relative, expected_hash in manifest['assets'].items():
        path = ASSETS / relative
        assert digest(path.read_bytes()) == expected_hash, f'Copied asset diverged: {path}'
    print(f"Verified {len(manifest['frontend'])} frontend files, {len(manifest['backend'])} backend files, and {len(manifest['assets'])} assets.")


if __name__ == '__main__':
    main()
