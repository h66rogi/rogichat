import unittest
import os
from pathlib import Path
import subprocess
import sys
import tempfile

import changed
from changed import affected_checks, affected_platforms, mobile_changed


class ChangesTest(unittest.TestCase):
    def test_pull_request_uses_checked_merge_parent_after_base_advances(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            def git(*args):
                return subprocess.check_output(["git", "-C", temporary, *args],
                                               stderr=subprocess.PIPE).decode().strip()
            git("init", "-q")
            git("config", "user.name", "Fixture")
            git("config", "user.email", "fixture@example.invalid")
            (root / "docs").mkdir()
            (root / "docs/intro.md").write_text("base\n")
            git("add", ".")
            git("commit", "-qm", "base")
            stale = git("rev-parse", "HEAD")
            base_branch = git("branch", "--show-current")
            git("branch", "feature")
            ios = root / "apps/ios/Sources/Screen.swift"
            ios.parent.mkdir(parents=True)
            ios.write_text("base advanced\n")
            git("add", ".")
            git("commit", "-qm", "advance base")
            actual_base = git("rev-parse", "HEAD")
            git("checkout", "-q", "feature")
            api = root / "apps/api/src/main.ts"
            api.parent.mkdir(parents=True)
            api.write_text("candidate\n")
            git("add", ".")
            git("commit", "-qm", "candidate")
            git("checkout", "-q", base_branch)
            git("merge", "-q", "--no-ff", "feature", "-m", "checked merge")
            merged = git("rev-parse", "HEAD")
            output = root / "result"
            script = str(Path(changed.__file__).resolve())
            env = dict(os.environ, EVENT_NAME="pull_request", BASE_SHA=stale,
                       GITHUB_SHA=merged, GITHUB_OUTPUT=str(output))
            previous = Path.cwd()
            try:
                os.chdir(root)
                self.assertEqual(changed.pull_request_base(stale, merged), actual_base)
                self.assertIsNone(changed.pull_request_base("f" * 40, merged))
                self.assertEqual(changed.affected_platforms(
                    subprocess.check_output(["git", "diff", "--name-only", "-z",
                                             stale, merged]).split(b"\0")), (False, True))
                result = subprocess.run([sys.executable, script], cwd=root, env=env,
                                        capture_output=True)
                self.assertEqual(result.returncode, 0, result.stderr.decode())
                self.assertEqual(output.read_text(), "android=false\nios=false\nios_build=false\n")
            finally:
                os.chdir(previous)

    def test_native_and_signing_inputs_require_builds(self):
        for path in [b"apps/android/app/build.gradle.kts", b"apps/ios/project.yml",
                     b"tools/mobile/keychain_unlock.py", b".github/workflows/mobile.yml"]:
            self.assertTrue(mobile_changed([path]))

    def test_platform_only_changes_skip_the_other_expensive_build(self):
        self.assertEqual(affected_platforms([b"apps/android/app/src/main/Feature.kt"]), (True, False))
        self.assertEqual(affected_platforms([b"apps/ios/Sources/Feature.swift"]), (False, True))
        self.assertEqual(affected_platforms([b"tools/mobile/check_android_storage.py"]), (True, False))
        self.assertEqual(affected_platforms([b"tools/mobile/check_ios_wireframe.py"]), (False, True))
        self.assertEqual(affected_platforms([b"apps/android/app/src/main/Feature.kt",
                                             b"apps/ios/Sources/Feature.swift"]), (True, True))

    def test_ios_checker_only_runs_state_gate(self):
        for path in (b"tools/mobile/check_ios_wireframe.py",
                     b"tools/mobile/test_ios_focused_checks.py"):
            with self.subTest(path=path):
                self.assertEqual(affected_checks([path]), (False, True, False))
        self.assertEqual(affected_checks([b"apps/ios/Sources/Feature.swift"]),
                         (False, True, True))
        self.assertEqual(affected_checks([b"tools/mobile/check_ios_wireframe.py",
                                          b"apps/ios/Sources/Feature.swift"]),
                         (False, True, True))
        self.assertEqual(affected_checks([b"tools/mobile/ios_dependencies.py"]),
                         (False, True, True))
        for path in (b"tools/mobile/changed.py",
                     b".github/workflows/mobile.yml", b"tools/mobile/future/tool.py"):
            with self.subTest(path=path):
                self.assertEqual(affected_checks([path]), (True, True, True))

    def test_shared_and_unknown_mobile_tools_keep_both_gates(self):
        for path in (b"tools/mobile/product_guards.py", b"tools/mobile/changed.py",
                     b"tools/mobile/qa_release.py", b"tools/mobile/future/tool.py",
                     b".github/workflows/mobile.yml"):
            with self.subTest(path=path):
                self.assertEqual(affected_platforms([path]), (True, True))

    def test_unrelated_docs_do_not_spend_mobile_build_minutes(self):
        self.assertFalse(mobile_changed([b"docs/design.md", b"apps/api/src/main.ts", b""]))

    def test_filename_is_data(self):
        self.assertTrue(mobile_changed([b"apps/ios/line\nbreak.swift"]))
        self.assertFalse(mobile_changed([b"docs/tools/mobile/example.md"]))

    def test_git_rename_out_of_mobile_still_requires_build(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            def git(*args):
                return subprocess.check_output(["git", "-C", temporary, *args], stderr=subprocess.PIPE).decode().strip()
            git("init", "-q")
            git("config", "user.name", "Fixture")
            git("config", "user.email", "fixture@example.invalid")
            old = root / "apps/ios/Example.swift"
            old.parent.mkdir(parents=True)
            old.write_text("source fixture\n")
            git("add", ".")
            git("commit", "-qm", "fixture")
            base = git("rev-parse", "HEAD")
            git("mv", "apps/ios/Example.swift", "Example.swift")
            git("commit", "-qm", "move")
            output = root / "result"
            result = subprocess.run([sys.executable, str(Path(changed.__file__).resolve())], cwd=root,
                                    env=dict(os.environ, EVENT_NAME="push", BASE_SHA=base,
                                             GITHUB_OUTPUT=str(output)), capture_output=True)
            self.assertEqual(result.returncode, 0)
            self.assertEqual(output.read_text(), "android=false\nios=true\nios_build=true\n")

    def test_merge_group_checks_exact_head_and_cumulative_changes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            def git(*args):
                return subprocess.check_output(["git", "-C", temporary, *args], stderr=subprocess.PIPE).decode().strip()
            git("init", "-q")
            git("config", "user.name", "Fixture")
            git("config", "user.email", "fixture@example.invalid")
            (root / "docs").mkdir()
            (root / "docs/intro.md").write_text("baseline\n")
            git("add", ".")
            git("commit", "-qm", "baseline")
            base = git("rev-parse", "HEAD")
            for path in ("apps/android/Feature.kt", "apps/ios/Feature.swift"):
                target = root / path
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text("candidate\n")
                git("add", ".")
                git("commit", "-qm", path)
            head = git("rev-parse", "HEAD")
            output = root / "result"
            env = dict(os.environ, EVENT_NAME="merge_group", BASE_SHA=base,
                       MERGE_GROUP_HEAD_SHA=head, GITHUB_SHA=head,
                       MERGE_GROUP_BASE_REF="refs/heads/qa", GITHUB_OUTPUT=str(output))
            command = [sys.executable, str(Path(changed.__file__).resolve())]
            result = subprocess.run(command, cwd=root, env=env, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr.decode())
            self.assertEqual(output.read_text(), "android=true\nios=true\nios_build=true\n")
            output.unlink()
            result = subprocess.run(command, cwd=root,
                                    env=dict(env, MERGE_GROUP_HEAD_SHA=base), capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse(output.exists())
            result = subprocess.run(command, cwd=root,
                                    env=dict(env, MERGE_GROUP_BASE_REF="refs/heads/other"), capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse(output.exists())

    def test_missing_boundary_fails_closed_without_raw_value(self):
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "result"
            marker = "invalid-boundary-fixture"
            result = subprocess.run([sys.executable, str(Path(changed.__file__).resolve())],
                                    env=dict(os.environ, EVENT_NAME="pull_request", BASE_SHA=marker,
                                             GITHUB_OUTPUT=str(output)), capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertNotIn(marker.encode(), result.stdout + result.stderr)
            self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
