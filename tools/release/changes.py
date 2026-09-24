#!/usr/bin/env python3
"""Fail-closed component input classification for trusted QA release jobs."""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess


WEB_PREFIXES = (
    'apps/web/', 'tools/web/', 'infrastructure/runtime/web/',
)
BACKEND_PREFIXES = (
    'apps/api/',
)
SHARED_PREFIXES = (
    '.github/workflows/', '.githooks/', 'patches/', 'packages/',
    'tools/operations/', 'tools/release/', 'tools/security/',
)
SHARED_FILES = {
    '.dockerignore', '.gitleaks.toml', '.node-version', 'AGENTS.md',
    'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'apps/api/package.json',
    'tools/operations/backend_archive.py',
}
UNRELATED_PREFIXES = (
    'apps/android/', 'apps/ios/', 'docs/', 'tools/mobile/',
)
UNRELATED_FILES = {'README.md', 'LICENSE', '.gitignore'}
SHA = re.compile(r'[a-f0-9]{40}\Z')


def classify_path(path: str) -> tuple[bool, bool]:
    """Return web/backend impact. Unknown paths intentionally affect both."""
    if path in SHARED_FILES or path.startswith(SHARED_PREFIXES):
        return True, True
    if path.startswith(WEB_PREFIXES):
        return True, False
    if path.startswith(BACKEND_PREFIXES):
        return False, True
    if path in UNRELATED_FILES or path.startswith(UNRELATED_PREFIXES):
        return False, False
    return True, True


def classify(paths: list[str]) -> tuple[bool, bool]:
    web = backend = False
    for path in paths:
        changed_web, changed_backend = classify_path(path)
        web |= changed_web
        backend |= changed_backend
    return web, backend


def changed_paths(base: str, head: str) -> list[str] | None:
    """Return None when the comparison cannot be proven; callers rebuild both."""
    if not SHA.fullmatch(base) or not SHA.fullmatch(head) or base == '0' * 40:
        return None
    result = subprocess.run(
        ['git', 'diff', '--name-only', '-z', '--no-renames', base, head],
        capture_output=True, check=False,
    )
    if result.returncode or not result.stdout.endswith(b'\0') and result.stdout:
        return None
    try:
        return [part.decode('utf-8') for part in result.stdout.split(b'\0') if part]
    except UnicodeDecodeError:
        return None


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--base', required=True)
    parser.add_argument('--head', required=True)
    args = parser.parse_args()
    paths = changed_paths(args.base, args.head)
    web, backend = (True, True) if paths is None else classify(paths)
    result = {'web': web, 'backend': backend, 'paths': paths}
    print(json.dumps(result, sort_keys=True))
    if output := os.getenv('GITHUB_OUTPUT'):
        with open(output, 'a', encoding='utf-8') as stream:
            stream.write(f'web={str(web).lower()}\nbackend={str(backend).lower()}\n')


if __name__ == '__main__':
    main()
