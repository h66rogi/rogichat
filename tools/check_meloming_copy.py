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
ADAPTATIONS = ROOT / 'docs/meloming-adaptations.tsv'
FRONTEND = ROOT / 'apps/web/src/meloming'
BACKEND = ROOT / 'references/meloming-back'
QA_BACKEND = ROOT / 'references/meloming-back-qa'
QA_MANIFEST = ROOT / 'docs/meloming-qa-source-manifest.tsv'
ASSETS = ROOT / 'apps/web/public'
FRONTEND_ROUTES = ROOT / 'apps/web/src/app/(meloming-channel)/channel/[user]'
SOURCE_ROUTES = FRONTEND / 'app/(default)/channel/[user]'
TEXT_SUFFIXES = {'.ts', '.tsx', '.js', '.jsx', '.css'}
CSS_CLASS_ALIAS_FILE = 'domains/channel/components/musicbook/song-request-price-pills.tsx'


def digest(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def verify_files(directory: Path, hashes: dict[str, str], *, namespace: bool = False,
                 adaptations: dict[str, str] | None = None) -> None:
    actual = {str(path.relative_to(directory)) for path in directory.rglob('*') if path.is_file()}
    expected = set(hashes)
    assert actual == expected, f'{directory}: missing={sorted(expected - actual)}, extra={sorted(actual - expected)}'
    for relative, expected_hash in hashes.items():
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
    verify_files(FRONTEND, manifest['frontend'], namespace=True, adaptations=adaptations)
    verify_files(BACKEND, manifest['backend'])
    qa_hashes = {}
    for line in QA_MANIFEST.read_text().splitlines():
        if line.startswith('#'):
            continue
        expected_hash, relative = line.split('\t', 1)
        qa_hashes[relative] = expected_hash
    verify_files(QA_BACKEND, qa_hashes)
    mime_source = QA_BACKEND / 'src/upload/utils/sheet-music-mime.ts'
    mime_runtime = ROOT / 'apps/api/src/modules/channel-content/upstream/sheet-music/sheet-music-mime.ts'
    assert mime_source.read_bytes() == mime_runtime.read_bytes(), 'Copied sheet-music MIME logic diverged'
    mxl_source = (QA_BACKEND / 'src/upload/utils/mxl-extractor.ts').read_bytes()
    mxl_expected = mxl_source.replace(b"from './sheet-music-mime'", b"from './sheet-music-mime.js'").replace(
        b"import { Readable } from 'stream';", b"import type { Readable } from 'stream';").replace(
        b'candidates.sort((a, b) => b.size - a.size)[0];', b'candidates.sort((a, b) => b.size - a.size)[0]!;')
    mxl_runtime = ROOT / 'apps/api/src/modules/channel-content/upstream/sheet-music/mxl-extractor.ts'
    assert mxl_expected == mxl_runtime.read_bytes(), 'Copied MXL extraction logic diverged'
    routes = [path for path in FRONTEND_ROUTES.rglob('*') if path.is_file()]
    for path in routes:
        source = SOURCE_ROUTES / path.relative_to(FRONTEND_ROUTES)
        assert source.is_file() and path.read_bytes() == source.read_bytes(), f'Copied route diverged: {path}'
    for relative, expected_hash in manifest['assets'].items():
        path = ASSETS / relative
        assert digest(path.read_bytes()) == expected_hash, f'Copied asset diverged: {path}'
    print(f"Verified {len(manifest['frontend'])} frontend files ({len(adaptations)} adapted), {len(manifest['backend'])} backend files, {len(qa_hashes)} QA sheet-music sources, {len(routes)} mounted routes, and {len(manifest['assets'])} assets.")


if __name__ == '__main__':
    main()
