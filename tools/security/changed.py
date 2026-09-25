#!/usr/bin/env python3
"""Run scanner self-tests on trust changes; always keep the full scan."""

import os
import re
import subprocess


SHA = re.compile(r"[a-f0-9]{40}\Z")
# These inputs cannot change the scanner implementation or its test fixtures.
# Unlisted paths deliberately run the self-tests.
APP_PREFIXES = (
    b"apps/api/", b"apps/android/app/", b"apps/ios/",
    b"apps/web/src/", b"apps/web/test/", b"docs/",
    b"tools/mobile/", b"tools/infrastructure/", b"tools/web/",
)
APP_FILES = {b"README.md", b"LICENSE", b"NOTICE"}


def needs_self_tests(paths):
    return not paths or any(
        path not in APP_FILES and not path.startswith(APP_PREFIXES)
        for path in paths
    )


def changed_paths(base, head):
    if not SHA.fullmatch(base) or base == "0" * 40 or not SHA.fullmatch(head):
        return None
    ancestor = subprocess.run(["git", "merge-base", "--is-ancestor", base, head],
                              capture_output=True, check=False)
    if ancestor.returncode:
        return None
    result = subprocess.run(["git", "diff", "--no-renames", "--name-only", "-z",
                             base, head, "--"], capture_output=True, check=False)
    if result.returncode or (result.stdout and not result.stdout.endswith(b"\0")):
        return None
    return [path for path in result.stdout.split(b"\0") if path]


def main():
    event = os.environ.get("GITHUB_EVENT_NAME", "")
    head = os.environ.get("GITHUB_SHA", "")
    base = os.environ.get("BASE_SHA", "")
    if event == "merge_group":
        checkout = subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True,
                                  check=False)
        if (checkout.returncode or checkout.stdout.decode().strip() != head
                or os.environ.get("MERGE_GROUP_HEAD_SHA") != head
                or os.environ.get("MERGE_GROUP_BASE_REF") not in
                {"refs/heads/qa", "refs/heads/main"}):
            raise SystemExit("Cannot establish security merge-group boundary")
    paths = changed_paths(base, head) if event in {"pull_request", "merge_group"} else None
    run_tests = paths is None or needs_self_tests(paths)
    with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
        output.write("run_tests=" + str(run_tests).lower() + "\n")
    print("Scanner self-tests required:", run_tests)


if __name__ == "__main__":
    main()
