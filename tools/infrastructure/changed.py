#!/usr/bin/env python3
"""Skip heavy infrastructure checks only for proven app and prose changes."""

import os
from pathlib import PurePosixPath
import re
import subprocess


SHA = re.compile(r"[a-f0-9]{40}\Z")
APP_ROOTS = frozenset({"android", "api", "ios", "media-gateway", "migration", "overlay", "web"})
TARGET_REFS = frozenset({"refs/heads/qa", "refs/heads/main"})


def unrelated(path: str) -> bool:
    if not path or path.startswith("/") or "\\" in path or "\n" in path:
        return False
    parts = PurePosixPath(path).parts
    if not parts or ".." in parts or "." in parts:
        return False
    name = parts[-1]
    if name in {"AGENTS.md", ".dockerignore", ".gitleaksignore"} or name.startswith("Dockerfile"):
        return False
    if len(parts) >= 2 and parts[0] == "docs":
        # Manifests and evidence below docs can be trust inputs. Only prose is safe.
        return path.endswith(".md")
    if len(parts) >= 3 and parts[0] == "apps" and parts[1] in APP_ROOTS:
        return True
    return False


def changed_paths(base: str, head: str) -> list[str] | None:
    if not SHA.fullmatch(base) or base == "0" * 40 or not SHA.fullmatch(head):
        return None
    for commit in (base, head):
        probe = subprocess.run(["git", "cat-file", "-t", commit], capture_output=True)
        if probe.returncode or probe.stdout.strip() != b"commit":
            return None
    result = subprocess.run(
        ["git", "diff", "--no-renames", "--name-only", "-z", base, head, "--"],
        capture_output=True,
    )
    if result.returncode or result.stdout and not result.stdout.endswith(b"\0"):
        return None
    try:
        return [part.decode("utf-8") for part in result.stdout.split(b"\0") if part]
    except UnicodeDecodeError:
        return None


def requires_full(event: str, base: str, head: str, checkout: str,
                  group_head: str = "", group_base_ref: str = "") -> bool:
    if event == "workflow_dispatch":
        return True
    if event not in {"pull_request", "merge_group", "push"}:
        return True
    if not SHA.fullmatch(head) or checkout != head:
        return True
    if event == "merge_group" and (group_head != head or group_base_ref not in TARGET_REFS):
        return True
    paths = changed_paths(base, head)
    return not paths or not all(unrelated(path) for path in paths)


def main() -> None:
    checkout = subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True)
    actual_head = checkout.stdout.decode("ascii", errors="replace").strip() if checkout.returncode == 0 else ""
    full = requires_full(
        os.environ.get("GITHUB_EVENT_NAME", ""), os.environ.get("BASE_SHA", ""),
        os.environ.get("GITHUB_SHA", ""), actual_head,
        os.environ.get("MERGE_GROUP_HEAD_SHA", ""), os.environ.get("MERGE_GROUP_BASE_REF", ""),
    )
    with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
        output.write(f"full={str(full).lower()}\n")
    print("Full infrastructure validation required." if full else "App and prose changes: scope guard passed.")


if __name__ == "__main__":
    main()
