import unittest
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import changes
from changes import changed_paths, classify, classify_path


class ComponentChangesTest(unittest.TestCase):
    def test_web_only(self):
        self.assertEqual(classify(['apps/web/src/app/page.tsx']), (True, False))
        for path in ('tools/operations/web_release.py',
                     'tools/operations/test_web_release.py',
                     'tools/operations/web-release.md',
                     '.github/workflows/web.yml',
                     '.github/workflows/web-publish.yml',
                     '.github/workflows/web-export.yml'):
            self.assertEqual(classify_path(path), (True, False), path)

    def test_backend_only(self):
        self.assertEqual(classify(['apps/api/src/main.ts']), (False, True))
        self.assertEqual(classify(['apps/migration/package.json']), (False, True))

    def test_unrelated_and_unknown(self):
        self.assertEqual(classify(['apps/ios/project.yml', 'docs/notes.md']), (False, False))
        self.assertEqual(classify_path('new-build-system/config'), (True, True))

    def test_shared_and_security_inputs(self):
        for path in ('pnpm-lock.yaml', 'patches/mariadb.patch',
                     'tools/security/image_scan.py',
                     'tools/release/changes.py', 'apps/api/package.json'):
            self.assertEqual(classify_path(path), (True, True), path)

    def test_deleted_or_renamed_source_is_detected_by_path(self):
        self.assertEqual(classify(['apps/web/src/removed.tsx']), (True, False))
        self.assertEqual(classify(['apps/web/src/old.tsx', 'apps/api/src/new.ts']), (True, True))

    def test_merge_group_base_to_head_covers_cumulative_batch(self):
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
            for path in ("apps/web/src/page.tsx", "apps/api/src/main.ts"):
                target = root / path
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text("candidate\n")
                git("add", ".")
                git("commit", "-qm", path)
            head = git("rev-parse", "HEAD")
            previous = Path.cwd()
            try:
                os.chdir(root)
                self.assertEqual(classify(changed_paths(base, head)), (True, True))
                self.assertIsNone(changed_paths("missing", head))
            finally:
                os.chdir(previous)
            command = [sys.executable, str(Path(changes.__file__).resolve()),
                       "--base", base, "--head", head]
            env = dict(os.environ, GITHUB_EVENT_NAME="merge_group",
                       MERGE_GROUP_HEAD_SHA=head, MERGE_GROUP_BASE_REF="refs/heads/qa")
            result = subprocess.run(command, cwd=root, env=env, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr.decode())
            self.assertEqual((json.loads(result.stdout)["web"],
                              json.loads(result.stdout)["backend"]), (True, True))
            result = subprocess.run(command, cwd=root,
                                    env=dict(env, MERGE_GROUP_HEAD_SHA=base), capture_output=True)
            self.assertNotEqual(result.returncode, 0)


if __name__ == '__main__':
    unittest.main()
