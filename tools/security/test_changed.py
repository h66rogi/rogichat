import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import changed


class ScannerSelfTestSelection(unittest.TestCase):
    def test_app_edits_skip_only_self_tests(self):
        self.assertFalse(changed.needs_self_tests([
            b"apps/api/src/main.ts", b"apps/ios/Sources/App.swift",
            b"apps/android/app/src/main/Feature.kt", b"apps/web/src/app/page.tsx",
            b"docs/mobile.md", b"tools/mobile/release_ios.py",
            b"infrastructure/environments/qa/aws-ec2/main.tf",
            b"infrastructure/environments/management/aws/bootstrap.sh",
            b"tools/release/changes.py", b"tools/release/test_changes.py",
        ]))

    def test_trust_and_unknown_edits_keep_self_tests(self):
        for path in (b"tools/security/check.py", b".gitleaks.toml",
                     b".githooks/pre-push", b".github/workflows/security.yml",
                     b"AGENTS.md", b"apps/android/gradle/wrapper/gradle-wrapper.jar",
                     b"apps/web/public/fonts/font.woff2",
                     b"infrastructure/runtime/bootstrap.sh.tftpl",
                     b"tools/release/web_publication_base.py", b"new/root/file"):
            with self.subTest(path=path):
                self.assertTrue(changed.needs_self_tests([b"apps/api/src/main.ts", path]))
        self.assertTrue(changed.needs_self_tests([]))

    def test_merge_group_uses_cumulative_base_and_rejects_wrong_head(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            def git(*args):
                return subprocess.check_output(["git", "-C", directory, *args],
                                               stderr=subprocess.PIPE).decode().strip()
            git("init", "-q")
            git("config", "user.name", "Fixture")
            git("config", "user.email", "fixture@example.invalid")
            target = root / "apps/api/src/main.ts"
            target.parent.mkdir(parents=True)
            target.write_text("base\n")
            git("add", ".")
            git("commit", "-qm", "base")
            base = git("rev-parse", "HEAD")
            target.write_text("next\n")
            git("commit", "-qam", "app")
            head = git("rev-parse", "HEAD")
            output = root / "result"
            env = dict(os.environ, GITHUB_EVENT_NAME="merge_group", GITHUB_SHA=head,
                       BASE_SHA=base, MERGE_GROUP_HEAD_SHA=head,
                       MERGE_GROUP_BASE_REF="refs/heads/qa", GITHUB_OUTPUT=str(output))
            command = [sys.executable, str(Path(changed.__file__).resolve())]
            result = subprocess.run(command, cwd=root, env=env, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr.decode())
            self.assertEqual(output.read_text(), "run_tests=false\n")
            result = subprocess.run(command, cwd=root,
                                    env=dict(env, MERGE_GROUP_HEAD_SHA=base), capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIsNone(changed.changed_paths("invalid", head))

    def test_push_uses_ancestor_diff_and_falls_back_on_unknown_boundary(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            def git(*args):
                return subprocess.check_output(["git", "-C", directory, *args],
                                               stderr=subprocess.PIPE).decode().strip()
            git("init", "-q")
            git("config", "user.name", "Fixture")
            git("config", "user.email", "fixture@example.invalid")
            target = root / "infrastructure/environments/qa/aws-ec2/main.tf"
            target.parent.mkdir(parents=True)
            target.write_text("base\n")
            git("add", ".")
            git("commit", "-qm", "base")
            base = git("rev-parse", "HEAD")
            target.write_text("next\n")
            git("commit", "-qam", "host")
            head = git("rev-parse", "HEAD")
            output = root / "result"
            command = [sys.executable, str(Path(changed.__file__).resolve())]
            env = dict(os.environ, GITHUB_EVENT_NAME="push", GITHUB_SHA=head,
                       BASE_SHA=base, GITHUB_OUTPUT=str(output))
            result = subprocess.run(command, cwd=root, env=env, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr.decode())
            self.assertEqual(output.read_text(), "run_tests=false\n")
            output.write_text("")
            result = subprocess.run(command, cwd=root,
                                    env=dict(env, BASE_SHA="0" * 40), capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr.decode())
            self.assertEqual(output.read_text(), "run_tests=true\n")
            result = subprocess.run(command, cwd=root,
                                    env=dict(env, GITHUB_SHA=base), capture_output=True)
            self.assertNotEqual(result.returncode, 0)


if __name__ == "__main__":
    unittest.main()
