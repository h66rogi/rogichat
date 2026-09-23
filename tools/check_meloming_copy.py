#!/usr/bin/env python3
"""Verify retained copied source and mounted route provenance.

Original backend files are recorded by commit and SHA-256 in the manifest,
without carrying unused source snapshots in the product repository.
"""

from __future__ import annotations

import hashlib
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / 'docs/meloming-source-manifest.tsv'
ADAPTATIONS = ROOT / 'docs/meloming-adaptations.tsv'
FRONTEND = ROOT / 'apps/web/src/meloming'
QA_MANIFEST = ROOT / 'docs/meloming-qa-source-manifest.tsv'
ASSETS = ROOT / 'apps/web/public'
FRONTEND_ROUTES = ROOT / 'apps/web/src/app/(meloming-channel)/channel/[user]'
MOUNTED_ADAPTATIONS = ROOT / 'docs/meloming-mounted-route-adaptations.tsv'
SOURCE_ROUTE_PREFIX = 'app/(default)/channel/[user]/'
TEXT_SUFFIXES = {'.ts', '.tsx', '.js', '.jsx', '.css'}
CSS_CLASS_ALIAS_FILE = 'domains/channel/components/musicbook/song-request-price-pills.tsx'


def digest(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def verify_files(directory: Path, hashes: dict[str, str], *, namespace: bool = False,
                 adaptations: dict[str, str] | None = None, allow_subset: bool = False) -> None:
    actual = {str(path.relative_to(directory)) for path in directory.rglob('*') if path.is_file()}
    expected = set(hashes)
    assert (actual <= expected if allow_subset else actual == expected), f'{directory}: missing={sorted(expected - actual)}, extra={sorted(actual - expected)}'
    for relative in sorted(actual):
        expected_hash = hashes[relative]
        path = directory / relative
        if adaptations and relative in adaptations:
            assert digest(path.read_bytes()) == adaptations[relative], f'Adapted source diverged: {path}'
            continue
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
    adaptations: dict[str, str] = {}
    for line in ADAPTATIONS.read_text().splitlines():
        if line.startswith('#'):
            continue
        expected_hash, relative = line.split('\t', 1)
        assert relative in manifest['frontend'] and len(expected_hash) == 64
        adaptations[relative] = expected_hash
    verify_files(FRONTEND, manifest['frontend'], namespace=True, adaptations=adaptations, allow_subset=True)
    qa_hashes = {}
    for line in QA_MANIFEST.read_text().splitlines():
        if line.startswith('#'):
            continue
        expected_hash, relative = line.split('\t', 1)
        qa_hashes[relative] = expected_hash
    mime_runtime = ROOT / 'apps/api/src/modules/channel-content/upstream/sheet-music/sheet-music-mime.ts'
    assert digest(mime_runtime.read_bytes()) == qa_hashes['src/upload/utils/sheet-music-mime.ts'], 'Copied sheet-music MIME logic diverged'
    mxl_runtime = ROOT / 'apps/api/src/modules/channel-content/upstream/sheet-music/mxl-extractor.ts'
    assert digest(mxl_runtime.read_bytes()) == '3da35db24b970e604b4f4f589fa546d7d8cdf471b9017cb1d90c901de5573b9b', 'Adapted MXL extraction logic diverged'
    mounted_adaptations = {}
    if MOUNTED_ADAPTATIONS.exists():
        for line in MOUNTED_ADAPTATIONS.read_text().splitlines():
            if line.startswith('#') or not line:
                continue
            expected_hash, relative = line.split('\t', 1)
            mounted_adaptations[relative] = expected_hash
    routes = [path for path in FRONTEND_ROUTES.rglob('*') if path.is_file()]
    for path in routes:
        relative = str(path.relative_to(FRONTEND_ROUTES))
        source_hash = manifest['frontend'][SOURCE_ROUTE_PREFIX + relative]
        content = path.read_bytes()
        if relative in mounted_adaptations:
            assert digest(content) == mounted_adaptations[relative], f'Adapted route diverged: {path}'
        else:
            assert digest(content.replace(b'@/meloming/', b'@/')) == source_hash, f'Copied route diverged: {path}'
    for relative, expected_hash in manifest['assets'].items():
        path = ASSETS / relative
        assert digest(path.read_bytes()) == expected_hash, f'Copied asset diverged: {path}'
    retained_frontend = sum(path.is_file() for path in FRONTEND.rglob('*'))
    print(f"Verified {retained_frontend} retained frontend files ({len(adaptations)} adapted), 2 runtime sheet-music utilities, {len(routes)} mounted routes, and {len(manifest['assets'])} assets. Backend source commits/hashes remain in provenance manifests.")


if __name__ == '__main__':
    main()
