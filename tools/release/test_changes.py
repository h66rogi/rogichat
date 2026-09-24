import unittest

from changes import classify, classify_path


class ComponentChangesTest(unittest.TestCase):
    def test_web_only(self):
        self.assertEqual(classify(['apps/web/src/app/page.tsx']), (True, False))
        for path in ('tools/operations/web_release.py',
                     'tools/operations/test_web_release.py',
                     'tools/operations/web-release.md'):
            self.assertEqual(classify_path(path), (True, False), path)

    def test_backend_only(self):
        self.assertEqual(classify(['apps/api/src/main.ts']), (False, True))
        self.assertEqual(classify(['apps/migration/package.json']), (False, True))

    def test_unrelated_and_unknown(self):
        self.assertEqual(classify(['apps/ios/project.yml', 'docs/notes.md']), (False, False))
        self.assertEqual(classify_path('new-build-system/config'), (True, True))

    def test_shared_and_security_inputs(self):
        for path in ('pnpm-lock.yaml', 'patches/mariadb.patch',
                     'tools/security/image_scan.py', '.github/workflows/web.yml',
                     'tools/release/changes.py', 'apps/api/package.json'):
            self.assertEqual(classify_path(path), (True, True), path)

    def test_deleted_or_renamed_source_is_detected_by_path(self):
        self.assertEqual(classify(['apps/web/src/removed.tsx']), (True, False))
        self.assertEqual(classify(['apps/web/src/old.tsx', 'apps/api/src/new.ts']), (True, True))


if __name__ == '__main__':
    unittest.main()
