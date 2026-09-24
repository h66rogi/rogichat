#!/usr/bin/env python3
"""Verify the retained OBS overlay source is an exact file copy."""

from hashlib import sha256
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / 'docs/meloming-overlay-source-manifest.tsv'
DESTINATION = ROOT / 'apps/overlay'


def main() -> None:
    rows = MANIFEST.read_text().splitlines()
    if not rows[0].startswith('# source-repo=dylabs/meloming-overlay source-commit=540dd2a '):
        raise SystemExit('Overlay source commit is missing or changed')
    if rows[1] != 'path\tsha256':
        raise SystemExit('Overlay manifest header is invalid')
    expected = {}
    for row in rows[2:]:
        name, digest = row.split('\t')
        if name in expected or not name or Path(name).is_absolute() or '..' in Path(name).parts:
            raise SystemExit(f'Invalid overlay manifest entry: {name}')
        expected[name] = digest
    actual = {
        path.relative_to(DESTINATION).as_posix()
        for path in DESTINATION.rglob('*')
        if path.is_file() and not any(part in {'node_modules', '.next'}
                                      for part in path.relative_to(DESTINATION).parts)
    }
    if actual != set(expected):
        raise SystemExit(f'Overlay file set differs: missing={sorted(set(expected)-actual)[:10]}, '
                         f'extra={sorted(actual-set(expected))[:10]}')
    for name, digest in expected.items():
        if sha256((DESTINATION / name).read_bytes()).hexdigest() != digest:
            raise SystemExit(f'Overlay source changed: {name}')
    print(f'Verified {len(expected)} byte-for-byte Meloming overlay files.')


if __name__ == '__main__':
    main()
