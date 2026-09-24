#!/usr/bin/env python3
"""Verify the retained R2-capable Meloming media gateway source bytes."""
from hashlib import sha256
from pathlib import Path

root = Path(__file__).resolve().parents[1]
manifest = root / 'docs/meloming-media-gateway-source-manifest.tsv'
lines = manifest.read_text().splitlines()
if lines[0] != '# source-repo=dylabs/meloming-media-gateway-cdn source-commit=376132e destination=apps/media-gateway' or lines[1] != 'path\tsha256':
    raise SystemExit('Media gateway source pin changed')
expected = dict(line.split('\t') for line in lines[2:])
directory = root / 'apps/media-gateway'
actual = {path.relative_to(directory).as_posix() for path in directory.rglob('*') if path.is_file()}
if set(expected) != actual:
    raise SystemExit('Media gateway file set differs from reviewed upstream')
for name, digest in expected.items():
    if sha256((directory / name).read_bytes()).hexdigest() != digest:
        raise SystemExit('Media gateway source bytes differ from reviewed upstream')
print(f'Verified {len(expected)} byte-for-byte media gateway source files.')
