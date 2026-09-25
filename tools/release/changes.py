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
    'apps/api/', 'apps/migration/',
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
WEB_ONLY_FILES = {
    '.github/workflows/web.yml',
    '.github/workflows/web-publish.yml',
    '.github/workflows/web-export.yml',
    'tools/operations/web_release.py',
    'tools/operations/test_web_release.py',
    'tools/operations/web-release.md',
}
BACKEND_ONLY_FILES = {
    '.github/workflows/backend.yml',
    '.github/workflows/backend-publish.yml',
    '.github/workflows/backend-export.yml',
    '.github/workflows/backend-quality.yml',
    '.github/workflows/backend-soak.yml',
    '.github/workflows/backend-expansion.yml',
    '.github/workflows/backend-restore.yml',
}
# Only these MySQL harness files are outside every image verification command.
# Other test files may be bind-mounted into image checks; unknown paths rebuild.
BACKEND_NON_IMAGE_TEST_FILES = {
    'apps/api/test/run-mysql.mjs',
    'apps/api/test/support/migration-mode.mjs',
    'apps/api/test/unit/migration-mode.test.mjs',
}
UNRELATED_PREFIXES = (
    'apps/android/', 'apps/ios/', 'docs/', 'tools/mobile/',
    'tools/infrastructure/',
)
UNRELATED_FILES = {
    'README.md', 'LICENSE', '.gitignore',
    '.github/workflows/mobile.yml',
    '.github/workflows/infrastructure.yml',
    '.github/workflows/overlay.yml',
    '.github/workflows/media-gateway.yml',
}
SHA = re.compile(r'[a-f0-9]{40}\Z')


def classify_path(path: str) -> tuple[bool, bool]:
    """Return web/backend impact. Unknown paths intentionally affect both."""
    if path in WEB_ONLY_FILES:
        return True, False
    if path in BACKEND_ONLY_FILES:
        return False, True
    if path in UNRELATED_FILES or path.startswith(UNRELATED_PREFIXES):
        return False, False
    if path in SHARED_FILES or path.startswith(SHARED_PREFIXES):
        return True, True
    if path.startswith(WEB_PREFIXES):
        return True, False
    if path.startswith(BACKEND_PREFIXES):
        return False, True
    return True, True


def classify(paths: list[str]) -> tuple[bool, bool]:
    web = backend = False
    for path in paths:
        changed_web, changed_backend = classify_path(path)
        web |= changed_web
        backend |= changed_backend
    return web, backend


def backend_image_changed(paths: list[str]) -> bool:
    """Skip image work only for reviewed MySQL harness files."""
    return any(classify_path(path)[1] and path not in BACKEND_NON_IMAGE_TEST_FILES
               for path in paths)


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


def valid_merge_group_boundary(base: str, head: str, group_head: str,
                               base_ref: str, checkout_head: str) -> bool:
    return (bool(SHA.fullmatch(base)) and base != '0' * 40
            and bool(SHA.fullmatch(head)) and group_head == head
            and base_ref in {'refs/heads/qa', 'refs/heads/main'}
            and checkout_head == head)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--base', required=True)
    parser.add_argument('--head', required=True)
    args = parser.parse_args()
    if os.getenv('GITHUB_EVENT_NAME') == 'merge_group':
        checkout = subprocess.run(['git', 'rev-parse', 'HEAD'], capture_output=True, check=False)
        if (checkout.returncode or not valid_merge_group_boundary(
                args.base, args.head, os.getenv('MERGE_GROUP_HEAD_SHA', ''),
                os.getenv('MERGE_GROUP_BASE_REF', ''), checkout.stdout.decode().strip())):
            raise SystemExit('Cannot establish the release change boundary')
    paths = changed_paths(args.base, args.head)
    web, backend = (True, True) if paths is None else classify(paths)
    image = True if paths is None else backend_image_changed(paths)
    result = {'web': web, 'backend': backend, 'backend_image': image, 'paths': paths}
    print(json.dumps(result, sort_keys=True))
    if output := os.getenv('GITHUB_OUTPUT'):
        with open(output, 'a', encoding='utf-8') as stream:
            stream.write(f'web={str(web).lower()}\nbackend={str(backend).lower()}\n'
                         f'backend_image={str(image).lower()}\n')


if __name__ == '__main__':
    main()
