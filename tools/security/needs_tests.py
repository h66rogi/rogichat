#!/usr/bin/env python3
"""Run security tests unless a pull request changes only known product inputs.

The full tracked-file and history scan is independent of this decision.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import re
import subprocess


SHA = re.compile(r'[0-9a-f]{40}\Z')
PR_REF = re.compile(r'refs/pull/[1-9][0-9]*/merge\Z')
SAFE_PREFIXES = (
    'apps/api/', 'apps/android/', 'apps/ios/', 'apps/migration/',
    'apps/web/', 'docs/', 'infrastructure/', 'packages/', 'patches/',
    'tools/mobile/', 'tools/operations/', 'tools/web/',
)
SAFE_ROOTS = {
    '.node-version', '.nvmrc', 'LICENSE', 'NOTICE',
    'README.md', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml',
}
# The guard tests read these exact-byte exceptions and the overlay manifest.
# Any new/unrecognized path also requires tests, so this list need not predict
# future trust inputs outside known product directories.
TRUST_FILES = {
    'docs/meloming-overlay-source-manifest.tsv',
}
TRUST_PREFIXES = (
    'apps/android/gradle/wrapper/', 'apps/overlay/',
    'apps/web/public/fonts/', 'apps/web/public/static/',
)


def needs_tests(paths: list[str] | None) -> bool:
    if not paths:
        return True
    for path in paths:
        if (path in TRUST_FILES or path.startswith(TRUST_PREFIXES)
                or path not in SAFE_ROOTS and not path.startswith(SAFE_PREFIXES)):
            return True
    return False


def git(*args: str) -> bytes | None:
    try:
        result = subprocess.run(['git', *args], capture_output=True, check=False,
                                timeout=20)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return result.stdout if result.returncode == 0 and len(result.stdout) <= 8 * 1024 * 1024 else None


def valid_boundary(base: str, merge: str, pr_head: str, checkout: str,
                   parents: list[str], ref: str, base_ref: str) -> bool:
    return (all(SHA.fullmatch(value) for value in (base, merge, pr_head, checkout))
            and merge == checkout and base != merge and pr_head != merge
            and base != pr_head
            and parents == [merge, base, pr_head]
            and PR_REF.fullmatch(ref) is not None
            and base_ref in ('qa', 'main'))


def changed_paths(base: str, merge: str) -> list[str] | None:
    raw = git('diff', '--name-only', '-z', '--no-renames', '--no-ext-diff',
              base, merge, '--')
    if raw is None or raw and not raw.endswith(b'\0'):
        return None
    try:
        entries = raw[:-1].split(b'\0') if raw else []
        if any(not entry for entry in entries):
            return None
        paths = [entry.decode('utf-8') for entry in entries]
    except UnicodeDecodeError:
        return None
    return paths if len(paths) == len(set(paths)) else None


def decide(environment: dict[str, str]) -> tuple[bool, str]:
    if environment.get('GITHUB_EVENT_NAME') != 'pull_request':
        return True, 'non-pr'
    checkout_raw = git('rev-parse', 'HEAD')
    parents_raw = git('rev-list', '--parents', '-n', '1', 'HEAD')
    if checkout_raw is None or parents_raw is None:
        return True, 'boundary-unavailable'
    checkout = checkout_raw.decode('ascii', 'replace').strip()
    parents = parents_raw.decode('ascii', 'replace').split()
    base = environment.get('BASE_SHA', '')
    merge = environment.get('MERGE_SHA', '')
    pr_head = environment.get('PR_HEAD_SHA', '')
    if not valid_boundary(base, merge, pr_head, checkout, parents,
                          environment.get('GITHUB_REF', ''),
                          environment.get('PR_BASE_REF', '')):
        return True, 'boundary-rejected'
    paths = changed_paths(base, merge)
    if paths is None:
        return True, 'comparison-unavailable'
    required = needs_tests(paths)
    return required, 'trust-input' if required else 'product-only'


def main() -> None:
    required, reason = decide(os.environ)
    value = 'true' if required else 'false'
    if output := os.environ.get('GITHUB_OUTPUT'):
        with Path(output).open('a', encoding='utf-8') as stream:
            stream.write('run_tests=' + value + '\n')
    print(json.dumps({'run_tests': required, 'reason': reason}, sort_keys=True))


if __name__ == '__main__':
    main()
