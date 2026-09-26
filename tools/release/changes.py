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
    'apps/api/', 'apps/decoder/', 'apps/migration/',
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
SECURITY_ONLY_FILES = {
    '.githooks/pre-commit',
    '.githooks/pre-push',
    '.github/workflows/security.yml',
    '.github/workflows/security-audit.yml',
    'tools/security/README.md',
    'tools/security/check.py',
    'tools/security/test_guard.py',
    'tools/security/changed.py',
    'tools/security/test_changed.py',
    'tools/security/fetch_public_refs.py',
    'tools/security/test_fetch_public_refs.py',
}
WEB_ONLY_FILES = {
    '.docker-next-cache/.gitkeep',
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
    'tools/operations/backend_release.py',
    'tools/operations/test_backend_release.py',
    'tools/operations/backend_production_release.py',
    'tools/operations/test_backend_production.py',
    'tools/operations/backend-release.md',
    # API/worker host templates are deployment inputs, not web image inputs.
    # Backend publication still validates and archives them for delivery.
    'infrastructure/runtime/compose.app.yaml',
    'infrastructure/environments/prod/runtime/compose.app.yaml',
}
# Verified delivery and CI control files do not enter the web image build.
# Keep validation jobs active when they change; only skip image publication.
WEB_NON_IMAGE_FILES = {
    '.github/workflows/web.yml',
    'tools/operations/web_release.py',
    'tools/operations/test_web_release.py',
    'tools/operations/web-release.md',
    'tools/release/test_web_publication_base.py',
}
# Exact backend-only helpers and tests that no image build or verification reads.
# Other tests can be bind-mounted into image checks; unknown paths rebuild.
BACKEND_NON_IMAGE_FILES = {
    '.github/workflows/backend.yml',
    'apps/api/test/run-mysql.mjs',
    'apps/api/test/support/migration-mode.mjs',
    'apps/api/test/unit/migration-mode.test.mjs',
    'apps/api/test/support/shard.mjs',
    'apps/api/test/unit/shard.test.mjs',
    'apps/api/test/integration/channel-content-fixture.mjs',
    'tools/operations/backend_release.py',
    'tools/operations/test_backend_release.py',
    'tools/operations/backend-release.md',
    'tools/release/web_publication_base.py',
    'tools/release/test_web_publication_base.py',
}
# The API build excludes test/, and image verification runs only the explicit
# migration and decoder test files outside integration/. New integration helpers
# remain fail-closed; only test cases and the reviewed fixture above skip images.
BACKEND_NON_IMAGE_PREFIXES = (
    'apps/api/test/integration/',
)
# A Dockerfile-only change changes the image, but not the application sources
# exercised by the disposable MySQL and static test jobs. Unknown image inputs
# continue through both checks.
BACKEND_IMAGE_ONLY_FILES = {
    'apps/api/Dockerfile',
}
UNRELATED_PREFIXES = (
    'apps/android/', 'apps/ios/', 'docs/', 'tools/mobile/',
    'tools/infrastructure/',
    # These host-only Terraform roots are validated by infrastructure.yml.
    # They cannot change the web or backend source/container inputs.
    'infrastructure/environments/qa/aws-ec2/',
    'infrastructure/environments/management/aws/',
)
UNRELATED_FILES = {
    'README.md', 'LICENSE', '.gitignore',
    # The backend changes job always runs this classifier's unit suite.
    # Product source checks do not exercise or package these CI-only files.
    'tools/release/changes.py',
    'tools/release/test_changes.py',
    '.github/workflows/mobile.yml',
    '.github/workflows/infrastructure.yml',
    '.github/workflows/overlay.yml',
    '.github/workflows/media-gateway.yml',
}
SHA = re.compile(r'[a-f0-9]{40}\Z')


def classify_path(path: str) -> tuple[bool, bool]:
    """Return web/backend impact. Unknown paths intentionally affect both."""
    if path in SECURITY_ONLY_FILES:
        return False, False
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
    """Skip image work only for reviewed backend inputs excluded from image checks."""
    return any(classify_path(path)[1]
               and path not in BACKEND_NON_IMAGE_FILES
               and not (path.startswith(BACKEND_NON_IMAGE_PREFIXES)
                        and path.endswith('.test.mjs'))
               for path in paths)


def web_image_changed(paths: list[str]) -> bool:
    """Skip web publication only for exact reviewed non-artifact inputs."""
    return any(classify_path(path)[0] and path not in WEB_NON_IMAGE_FILES
               for path in paths)


def backend_tests_changed(paths: list[str]) -> bool:
    """Skip source tests only when every backend input is the reviewed Dockerfile."""
    return any(classify_path(path)[1] and path not in BACKEND_IMAGE_ONLY_FILES
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


def pull_request_base(event_base: str, head: str) -> str | None:
    """Use the checked merge commit's base parent, proving stale event ancestry."""
    if not SHA.fullmatch(event_base) or not SHA.fullmatch(head):
        return None
    checkout = subprocess.run(['git', 'rev-parse', 'HEAD'], capture_output=True, check=False)
    parents = subprocess.run(['git', 'rev-list', '--parents', '-n', '1', head],
                             capture_output=True, check=False)
    if checkout.returncode or checkout.stdout.decode().strip() != head or parents.returncode:
        return None
    parts = parents.stdout.decode().split()
    if len(parts) != 3 or parts[0] != head or not all(SHA.fullmatch(p) for p in parts):
        return None
    ancestor = subprocess.run(['git', 'merge-base', '--is-ancestor', event_base, parts[1]],
                              capture_output=True, check=False)
    return parts[1] if ancestor.returncode == 0 else None


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
    base = args.base
    if os.getenv('GITHUB_EVENT_NAME') == 'pull_request':
        base = pull_request_base(args.base, args.head)
    paths = changed_paths(base, args.head) if base is not None else None
    web, backend = (True, True) if paths is None else classify(paths)
    web_image = True if paths is None else web_image_changed(paths)
    image = True if paths is None else backend_image_changed(paths)
    tests = True if paths is None else backend_tests_changed(paths)
    result = {'web': web, 'web_image': web_image, 'backend': backend, 'backend_image': image,
              'backend_tests': tests, 'paths': paths}
    print(json.dumps(result, sort_keys=True))
    if output := os.getenv('GITHUB_OUTPUT'):
        with open(output, 'a', encoding='utf-8') as stream:
            stream.write(f'web={str(web).lower()}\nbackend={str(backend).lower()}\n'
                         f'web_image={str(web_image).lower()}\n'
                         f'backend_image={str(image).lower()}\n'
                         f'backend_tests={str(tests).lower()}\n')


if __name__ == '__main__':
    main()
