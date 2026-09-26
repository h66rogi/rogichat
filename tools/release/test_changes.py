import unittest
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import changes
from changes import (backend_image_changed, backend_tests_changed, changed_paths,
                     classify, classify_path, pull_request_base, web_image_changed)


class ComponentChangesTest(unittest.TestCase):
    def test_web_only(self):
        self.assertEqual(classify(['apps/web/src/app/page.tsx']), (True, False))
        self.assertEqual(classify_path('.docker-next-cache/.gitkeep'), (True, False))
        self.assertFalse(backend_image_changed(['.docker-next-cache/.gitkeep']))
        self.assertTrue(web_image_changed(['.docker-next-cache/.gitkeep']))
        for path in ('tools/operations/web_release.py',
                     'tools/operations/test_web_release.py',
                     'tools/operations/web-release.md',
                     '.github/workflows/web.yml',
                     '.github/workflows/web-publish.yml',
                     '.github/workflows/web-export.yml'):
            self.assertEqual(classify_path(path), (True, False), path)

    def test_backend_only(self):
        self.assertEqual(classify(['apps/api/src/main.ts']), (False, True))
        self.assertEqual(classify(['apps/decoder/package.json']), (False, True))
        self.assertEqual(classify(['apps/migration/package.json']), (False, True))
        for path in changes.BACKEND_ONLY_FILES:
            self.assertEqual(classify_path(path), (False, True), path)

    def test_backend_host_delivery_does_not_rebuild_web(self):
        paths = ['infrastructure/runtime/compose.app.yaml',
                 'infrastructure/environments/prod/runtime/compose.app.yaml',
                 'tools/operations/backend_release.py',
                 'tools/operations/test_backend_release.py',
                 'tools/operations/backend_production_release.py',
                 'tools/operations/test_backend_production.py',
                 'docs/backend-native-push.md']
        self.assertEqual(classify(paths), (False, True))
        self.assertFalse(web_image_changed(paths))
        # A backend archive must still carry these changed deployment inputs.
        self.assertTrue(backend_image_changed(paths))
        self.assertTrue(backend_tests_changed(paths))
        self.assertEqual(classify_path('infrastructure/runtime/web/compose.yaml'),
                         (True, False))

    def test_reviewed_backend_helpers_run_tests_without_rebuilding_images(self):
        tests = ['apps/api/test/run-mysql.mjs',
                 'apps/api/test/support/migration-mode.mjs',
                 'apps/api/test/unit/migration-mode.test.mjs',
                 'apps/api/test/support/shard.mjs',
                 'apps/api/test/unit/shard.test.mjs',
                 'apps/api/test/integration/channel-content.test.mjs',
                 'apps/api/test/integration/channel-content-fixture.mjs',
                 'tools/operations/backend_release.py',
                 'tools/operations/test_backend_release.py',
                 'tools/operations/backend-release.md']
        self.assertEqual(classify(tests), (False, True))
        self.assertFalse(backend_image_changed(tests))
        self.assertTrue(backend_tests_changed(tests))
        self.assertFalse(backend_image_changed(tests + ['docs/test-plan.md']))
        for release_input in ('apps/api/src/main.ts', 'apps/api/prisma/schema.prisma',
                              'apps/api/Dockerfile', '.github/workflows/backend-publish.yml',
                              'new-build-system/config',
                              'apps/api/test/migration-image.mjs',
                              'apps/api/test/decoder/video.test.mjs',
                              'apps/api/test/unit/media-image-decoder.test.mjs',
                              'apps/api/test/unit/unreviewed.test.mjs',
                              'apps/api/test/integration-image.test.mjs',
                              'apps/api/test/integration-not-covered/new.test.mjs',
                              'apps/api/test/integration/new-image-fixture.mjs',
                              'tools/operations/backend_archive.py',
                              'tools/operations/new_release_helper.py'):
            self.assertTrue(backend_image_changed(tests + [release_input]), release_input)

    def test_ci_controls_validate_without_rebuilding_unchanged_products(self):
        controls = ['.github/workflows/backend.yml', '.github/workflows/web.yml',
                    'tools/release/changes.py', 'tools/release/test_changes.py',
                    'docs/release-throughput.md']
        self.assertEqual(classify(controls), (True, True))
        self.assertTrue(backend_tests_changed(controls))
        self.assertFalse(backend_image_changed(controls))
        self.assertFalse(web_image_changed(controls))
        for changed in ('apps/api/src/main.ts', 'apps/api/Dockerfile',
                        '.github/workflows/backend-publish.yml',
                        'tools/release/new_helper.py'):
            self.assertTrue(backend_image_changed(controls + [changed]), changed)
        for changed in ('apps/web/src/app/page.tsx', 'apps/web/Dockerfile',
                        '.github/workflows/web-publish.yml',
                        'tools/web/new_runtime_helper.mjs', 'new-build-system/config'):
            self.assertTrue(web_image_changed(controls + [changed]), changed)
        self.assertFalse(web_image_changed(['tools/operations/web_release.py',
                                            'tools/operations/test_web_release.py']))
        self.assertFalse(backend_image_changed(['tools/release/web_publication_base.py']))
        self.assertTrue(web_image_changed(['tools/release/web_publication_base.py']))

    def test_dockerfile_only_requires_image_check_without_source_tests(self):
        self.assertEqual(classify(['apps/api/Dockerfile']), (False, True))
        self.assertTrue(backend_image_changed(['apps/api/Dockerfile']))
        self.assertFalse(backend_tests_changed(['apps/api/Dockerfile']))
        self.assertFalse(backend_tests_changed(['apps/api/Dockerfile', 'docs/release.md']))
        for extra in ('apps/api/src/main.ts', 'apps/api/test/integration/messages.test.mjs',
                      '.dockerignore', 'apps/api/new-build-input'):
            self.assertTrue(backend_tests_changed(['apps/api/Dockerfile', extra]), extra)

    def test_classifier_only_uses_its_own_unit_suite(self):
        classifier = ['tools/release/changes.py', 'tools/release/test_changes.py']
        self.assertEqual(classify(classifier), (False, False))
        self.assertFalse(backend_tests_changed(classifier))
        self.assertFalse(backend_image_changed(classifier))
        self.assertFalse(web_image_changed(classifier))
        self.assertTrue(backend_tests_changed(classifier + ['apps/api/src/main.ts']))
        self.assertTrue(backend_tests_changed(classifier + ['.github/workflows/backend.yml']))
        self.assertEqual(classify(classifier + ['apps/web/src/app/page.tsx']),
                         (True, False))

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            def git(*args):
                return subprocess.check_output(['git', '-C', temporary, *args],
                                               stderr=subprocess.PIPE).decode().strip()
            git('init', '-q')
            git('config', 'user.name', 'Fixture')
            git('config', 'user.email', 'fixture@example.invalid')
            dockerfile = root / 'apps/api/Dockerfile'
            dockerfile.parent.mkdir(parents=True)
            dockerfile.write_text('FROM scratch\n')
            git('add', '.')
            git('commit', '-qm', 'baseline')
            base = git('rev-parse', 'HEAD')
            dockerfile.write_text('FROM scratch\n# image-only change\n')
            git('add', '.')
            git('commit', '-qm', 'image input')
            output = root / 'outputs.txt'
            result = subprocess.run(
                [sys.executable, str(Path(changes.__file__).resolve()),
                 '--base', base, '--head', git('rev-parse', 'HEAD')], cwd=root,
                env=dict(os.environ, GITHUB_EVENT_NAME='push', GITHUB_OUTPUT=str(output)),
                capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr.decode())
            self.assertEqual(output.read_text(),
                             'web=false\nbackend=true\nweb_image=false\nbackend_image=true\nbackend_tests=false\n')
            for missing_base in ('0' * 40, ''):
                uncertain = subprocess.run(
                    [sys.executable, str(Path(changes.__file__).resolve()),
                     '--base', missing_base, '--head', git('rev-parse', 'HEAD')], cwd=root,
                    env=dict(os.environ, GITHUB_EVENT_NAME='push'), capture_output=True)
                self.assertEqual(uncertain.returncode, 0, uncertain.stderr.decode())
                self.assertTrue(json.loads(uncertain.stdout)['web_image'])
                self.assertTrue(json.loads(uncertain.stdout)['backend_image'])

    def test_test_only_boundary_writes_backend_without_image_output(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            def git(*args):
                return subprocess.check_output(['git', '-C', temporary, *args],
                                               stderr=subprocess.PIPE).decode().strip()
            git('init', '-q')
            git('config', 'user.name', 'Fixture')
            git('config', 'user.email', 'fixture@example.invalid')
            target = root / 'apps/api/test/unit/migration-mode.test.mjs'
            target.parent.mkdir(parents=True)
            target.write_text('baseline\n')
            git('add', '.')
            git('commit', '-qm', 'baseline')
            base = git('rev-parse', 'HEAD')
            target.write_text('changed\n')
            git('add', '.')
            git('commit', '-qm', 'test only')
            head = git('rev-parse', 'HEAD')
            output = root / 'outputs.txt'
            command = [sys.executable, str(Path(changes.__file__).resolve()),
                       '--base', base, '--head', head]
            # This fixture models a push boundary even when invoked by a real
            # merge_group runner with unrelated group SHA environment values.
            result = subprocess.run(command, cwd=root,
                                    env=dict(os.environ, GITHUB_EVENT_NAME='push',
                                             GITHUB_OUTPUT=str(output)),
                                    capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr.decode())
            self.assertEqual(json.loads(result.stdout)['backend_image'], False)
            self.assertEqual(output.read_text(),
                             'web=false\nbackend=true\nweb_image=false\nbackend_image=false\nbackend_tests=true\n')

    def test_pull_request_uses_merge_commit_parent_when_event_base_is_stale(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            def git(*args):
                return subprocess.check_output(['git', '-C', temporary, *args],
                                               stderr=subprocess.PIPE).decode().strip()
            git('init', '-q')
            git('config', 'user.name', 'Fixture')
            git('config', 'user.email', 'fixture@example.invalid')
            (root / 'docs').mkdir()
            (root / 'docs/intro.md').write_text('base\n')
            git('add', '.')
            git('commit', '-qm', 'base')
            stale = git('rev-parse', 'HEAD')
            base_branch = git('branch', '--show-current')
            git('branch', 'feature')
            web = root / 'apps/web/src/page.tsx'
            web.parent.mkdir(parents=True)
            web.write_text('base advanced\n')
            git('add', '.')
            git('commit', '-qm', 'advance base')
            actual_base = git('rev-parse', 'HEAD')
            git('checkout', '-q', 'feature')
            api = root / 'apps/api/src/main.ts'
            api.parent.mkdir(parents=True)
            api.write_text('candidate\n')
            git('add', '.')
            git('commit', '-qm', 'candidate')
            candidate = git('rev-parse', 'HEAD')
            git('checkout', '-q', base_branch)
            git('merge', '-q', '--no-ff', 'feature', '-m', 'checked merge')
            merged = git('rev-parse', 'HEAD')
            previous = Path.cwd()
            try:
                os.chdir(root)
                self.assertEqual(pull_request_base(stale, merged), actual_base)
                self.assertEqual(classify(changed_paths(stale, merged)), (True, True))
                self.assertEqual(classify(changed_paths(actual_base, merged)), (False, True))
                self.assertIsNone(pull_request_base(stale, candidate))
                self.assertIsNone(pull_request_base('f' * 40, merged))
                output = root / 'outputs.txt'
                result = subprocess.run(
                    [sys.executable, str(Path(changes.__file__).resolve()),
                     '--base', stale, '--head', merged], cwd=root,
                    env=dict(os.environ, GITHUB_EVENT_NAME='pull_request',
                             GITHUB_OUTPUT=str(output)), capture_output=True)
                self.assertEqual(result.returncode, 0, result.stderr.decode())
                self.assertEqual(output.read_text(),
                                 'web=false\nbackend=true\nweb_image=false\nbackend_image=true\nbackend_tests=true\n')
            finally:
                os.chdir(previous)

    def test_unrelated_and_unknown(self):
        self.assertEqual(classify(['apps/ios/project.yml', 'docs/notes.md']), (False, False))
        self.assertEqual(classify([
            '.github/workflows/infrastructure.yml',
            '.github/workflows/overlay.yml',
            '.github/workflows/media-gateway.yml',
            'tools/infrastructure/changed.py',
            'tools/mobile/release_ios.py',
        ]), (False, False))
        self.assertEqual(classify_path('.github/workflows/mobile.yml'), (False, False))
        self.assertEqual(classify([
            '.github/workflows/infrastructure.yml', 'apps/web/src/app/page.tsx',
        ]), (True, False))
        self.assertEqual(classify_path('.github/workflows/new-release.yml'), (True, True))
        self.assertEqual(classify_path('new-build-system/config'), (True, True))

    def test_host_only_terraform_changes_skip_product_checks(self):
        host_files = [
            'infrastructure/environments/qa/aws-ec2/main.tf',
            'infrastructure/environments/qa/aws-ec2/security.tftest.hcl',
            'infrastructure/environments/management/aws/bootstrap.sh',
            'infrastructure/environments/management/aws/README.md',
        ]
        self.assertEqual(classify(host_files), (False, False))
        self.assertFalse(web_image_changed(host_files))
        self.assertFalse(backend_image_changed(host_files))
        self.assertFalse(backend_tests_changed(host_files))
        self.assertEqual(classify(host_files + ['apps/web/src/app/page.tsx']),
                         (True, False))
        self.assertEqual(classify_path('infrastructure/runtime/web/compose.yaml'),
                         (True, False))
        self.assertEqual(classify_path('infrastructure/environments/prod/aws-ec2/main.tf'),
                         (True, True))

    def test_shared_and_security_inputs(self):
        for path in ('pnpm-lock.yaml', 'patches/mariadb.patch',
                     'tools/security/image_scan.py',
                     'apps/api/package.json'):
            self.assertEqual(classify_path(path), (True, True), path)

    def test_exact_security_guard_changes_skip_product_builds(self):
        self.assertEqual(classify(list(changes.SECURITY_ONLY_FILES)), (False, False))
        self.assertFalse(backend_image_changed(list(changes.SECURITY_ONLY_FILES)))
        self.assertFalse(web_image_changed(list(changes.SECURITY_ONLY_FILES)))
        for path in ('tools/security/image_scan.py', 'tools/security/install.py',
                     'tools/security/new_guard.py', '.gitleaks.toml'):
            self.assertEqual(classify_path(path), (True, True), path)
            self.assertTrue(backend_image_changed([path]), path)
        self.assertEqual(classify(['tools/security/check.py', 'apps/api/src/main.ts']), (False, True))
        self.assertTrue(backend_image_changed(['tools/security/check.py', 'apps/api/src/main.ts']))

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
