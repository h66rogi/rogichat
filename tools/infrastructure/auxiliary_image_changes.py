#!/usr/bin/env python3
"""Select QA overlay/gateway image builds from an exact push boundary.

An unknown comparison boundary fails closed by building the image. The path
sets mirror each workflow's pull-request image inputs. Pull requests already
use those workflow filters and never call this selector.
"""

from __future__ import annotations

import argparse
import os
import re
import subprocess


SHA = re.compile(r'[a-f0-9]{40}\Z')
OVERLAY_FILES = {
    '.github/workflows/overlay.yml', '.dockerignore', '.gitleaks.toml',
    '.node-version', 'AGENTS.md', 'docs/meloming-overlay-source-manifest.tsv',
    'infrastructure/runtime/overlay.Dockerfile',
    'infrastructure/runtime/web/compose.overlay.qa.yaml',
    'infrastructure/runtime/web/Caddyfile.qa', 'package.json',
    'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tools/check_overlay_copy.py',
    'tools/infrastructure/auxiliary_image_changes.py',
}
OVERLAY_PREFIXES = ('apps/overlay/', 'packages/', 'patches/', 'tools/security/')
GATEWAY_FILES = {
    '.github/workflows/media-gateway.yml', '.dockerignore', '.gitleaks.toml',
    'AGENTS.md', 'docs/meloming-media-gateway-source-manifest.tsv',
    'infrastructure/runtime/media-gateway.Dockerfile',
    'infrastructure/runtime/web/compose.media-gateway.qa.yaml',
    'infrastructure/runtime/Caddyfile.app', 'tools/check_media_gateway_copy.py',
    'tools/infrastructure/auxiliary_image_changes.py',
}
GATEWAY_PREFIXES = ('apps/media-gateway/', 'tools/security/')


def affects(component: str, path: str) -> bool:
    if component == 'overlay':
        return (path in OVERLAY_FILES or path.startswith(OVERLAY_PREFIXES)
                or (path.startswith('apps/') and path.endswith('/package.json')
                    and path.count('/') == 2))
    if component == 'gateway':
        return path in GATEWAY_FILES or path.startswith(GATEWAY_PREFIXES)
    raise ValueError('Unknown component')


def changed_paths(base: str, head: str) -> list[str] | None:
    if not SHA.fullmatch(base) or base == '0' * 40 or not SHA.fullmatch(head):
        return None
    checkout = subprocess.run(['git', 'rev-parse', 'HEAD'], capture_output=True, check=False)
    if checkout.returncode or checkout.stdout.decode('ascii', errors='replace').strip() != head:
        return None
    ancestor = subprocess.run(['git', 'merge-base', '--is-ancestor', base, head],
                             capture_output=True, check=False)
    if ancestor.returncode:
        return None
    result = subprocess.run(['git', 'diff', '--name-only', '-z', '--no-renames', base, head],
                            capture_output=True, check=False)
    if result.returncode or (result.stdout and not result.stdout.endswith(b'\0')):
        return None
    try:
        return [part.decode('utf-8') for part in result.stdout.split(b'\0') if part]
    except UnicodeDecodeError:
        return None


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--component', choices=('overlay', 'gateway'), required=True)
    parser.add_argument('--base', required=True)
    parser.add_argument('--head', required=True)
    args = parser.parse_args()
    if (os.getenv('GITHUB_EVENT_NAME') != 'push' or os.getenv('GITHUB_REF') != 'refs/heads/qa'
            or os.getenv('GITHUB_REPOSITORY') != 'h66rogi/rogichat'
            or os.getenv('GITHUB_SHA') != args.head):
        raise SystemExit('Expected an exact trusted QA push')
    paths = changed_paths(args.base, args.head)
    changed = paths is None or any(affects(args.component, path) for path in paths)
    print(f'{args.component}: {"build" if changed else "skip"} '
          f'({"unknown boundary" if paths is None else str(len(paths)) + " changed paths"})')
    if output := os.getenv('GITHUB_OUTPUT'):
        with open(output, 'a', encoding='utf-8') as stream:
            stream.write(f'changed={str(changed).lower()}\n')


if __name__ == '__main__':
    main()
