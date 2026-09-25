"""The required infrastructure check may skip work only on a proven boundary."""

from contextlib import contextmanager
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import changed


@contextmanager
def repository():
    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        def git(*args):
            return subprocess.check_output(["git", "-C", temporary, *args], stderr=subprocess.PIPE).decode().strip()
        git("init", "-q")
        git("config", "user.name", "Fixture")
        git("config", "user.email", "fixture@example.invalid")
        yield root, git


def commit(root, git, path, content="candidate\n"):
    target = root / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content)
    git("add", ".")
    git("commit", "-qm", path)
    return git("rev-parse", "HEAD")


class InfrastructureScopeTest(unittest.TestCase):
    def test_only_app_and_prose_paths_are_unrelated(self):
        for path in ("apps/ios/Sources/Screen.swift", "apps/android/app/src/main/App.kt",
                     "apps/api/src/main.ts", "apps/web/src/app/page.tsx",
                     "apps/overlay/src/app/page.tsx", "apps/media-gateway/src/app.py",
                     "docs/mobile-implementation-plan.md", "docs/runbooks/guide.md"):
            with self.subTest(path=path):
                self.assertTrue(changed.unrelated(path))
        for path in ("infrastructure/runtime/Caddyfile.app", ".github/workflows/infrastructure.yml",
                     "tools/security/check.py", "tools/infrastructure/changed.py", "package.json",
                     "apps/web/Dockerfile", "apps/api/Dockerfile.test", "apps/api/AGENTS.md",
                     "apps/web/.dockerignore", "docs/meloming-overlay-source-manifest.tsv",
                     "docs/evidence/release.json", "docs/AGENTS.md", "apps/api/.gitleaksignore",
                     "README.md", "apps/new-service/src/main.ts",
                     "docs/../infrastructure/plan.md", ".", ""):
            with self.subTest(path=path):
                self.assertFalse(changed.unrelated(path))

    def test_real_pr_push_and_merge_group_boundaries(self):
        with repository() as (root, git):
            base = commit(root, git, "docs/intro.md", "baseline\n")
            commit(root, git, "apps/ios/Sources/Screen.swift")
            head = commit(root, git, "docs/notes.md")
            previous = Path.cwd()
            try:
                os.chdir(root)
                self.assertEqual(changed.changed_paths(base, head),
                                 ["apps/ios/Sources/Screen.swift", "docs/notes.md"])
                self.assertFalse(changed.requires_full("pull_request", base, head, head))
                self.assertFalse(changed.requires_full("push", base, head, head))
                self.assertFalse(changed.requires_full(
                    "merge_group", base, head, head, head, "refs/heads/qa"))
                self.assertTrue(changed.requires_full(
                    "merge_group", base, head, head, base, "refs/heads/qa"))
                self.assertTrue(changed.requires_full(
                    "merge_group", base, head, head, head, "refs/heads/other"))
                self.assertTrue(changed.requires_full("pull_request", base, head, base))
                self.assertTrue(changed.requires_full("pull_request", "0" * 40, head, head))
                self.assertTrue(changed.requires_full("pull_request", "f" * 40, head, head))
                self.assertTrue(changed.requires_full("workflow_dispatch", base, head, head))
                self.assertTrue(changed.requires_full("unknown", base, head, head))
                self.assertTrue(changed.requires_full("pull_request", head, head, head))
                full_head = commit(root, git, "infrastructure/runtime/Caddyfile.app")
                self.assertTrue(changed.requires_full("pull_request", base, full_head, full_head))
            finally:
                os.chdir(previous)

    def test_rename_from_infrastructure_cannot_be_hidden_under_apps(self):
        with repository() as (root, git):
            base = commit(root, git, "infrastructure/runtime/input.yaml")
            (root / "apps/web/src").mkdir(parents=True)
            git("mv", "infrastructure/runtime/input.yaml", "apps/web/src/input.yaml")
            git("commit", "-qm", "move")
            head = git("rev-parse", "HEAD")
            previous = Path.cwd()
            try:
                os.chdir(root)
                self.assertEqual(changed.changed_paths(base, head),
                                 ["apps/web/src/input.yaml", "infrastructure/runtime/input.yaml"])
                self.assertTrue(changed.requires_full("pull_request", base, head, head))
            finally:
                os.chdir(previous)

    def test_cli_emits_explicit_false_only_after_proven_comparison(self):
        with repository() as (root, git):
            base = commit(root, git, "docs/intro.md", "baseline\n")
            head = commit(root, git, "apps/web/src/page.tsx")
            output = root / "scope.out"
            script = Path(changed.__file__).resolve()
            env = dict(os.environ, GITHUB_EVENT_NAME="pull_request", BASE_SHA=base,
                       GITHUB_SHA=head, GITHUB_OUTPUT=str(output))
            result = subprocess.run([sys.executable, str(script)], cwd=root, env=env,
                                    capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr.decode())
            self.assertEqual(output.read_text(), "full=false\n")
            output.unlink()
            result = subprocess.run([sys.executable, str(script)], cwd=root,
                                    env=dict(env, BASE_SHA="missing"), capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr.decode())
            self.assertEqual(output.read_text(), "full=true\n")


if __name__ == "__main__":
    unittest.main()
