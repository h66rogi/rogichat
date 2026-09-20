import unittest
import os
from pathlib import Path
import subprocess
import sys
import tempfile

import changed
from changed import mobile_changed


class ChangesTest(unittest.TestCase):
    def test_native_and_signing_inputs_require_builds(self):
        for path in [b"apps/android/app/build.gradle.kts", b"apps/ios/project.yml",
                     b"tools/mobile/keychain_unlock.py", b".github/workflows/mobile.yml"]:
            self.assertTrue(mobile_changed([path]))

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
            self.assertEqual(output.read_text(), "changed=true\n")

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
