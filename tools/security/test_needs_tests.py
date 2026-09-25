"""Offline change-boundary tests for the PR-only security-suite shortcut."""
import contextlib
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import needs_tests as guard


BASE = 'a' * 40
MERGE = 'b' * 40
PR_HEAD = 'c' * 40
PR_ENV = {
    'GITHUB_EVENT_NAME': 'pull_request', 'GITHUB_REF': 'refs/pull/123/merge',
    'PR_BASE_REF': 'qa', 'BASE_SHA': BASE, 'MERGE_SHA': MERGE,
    'PR_HEAD_SHA': PR_HEAD,
}


class SecurityTestSelectionTests(unittest.TestCase):
    def test_only_known_product_paths_skip(self):
        self.assertFalse(guard.needs_tests([
            'apps/web/src/app/page.tsx', 'apps/api/src/main.ts',
            'apps/android/app/src/main.kt', 'apps/ios/Sources/App.swift',
            'docs/mobile-implementation-plan.md', 'tools/mobile/changed.py',
            'tools/operations/web_release.py', 'package.json',
        ]))
        self.assertTrue(guard.needs_tests([]))
        self.assertTrue(guard.needs_tests(None))

    def test_security_inputs_and_unknown_paths_run(self):
        paths = (
            'tools/security/check.py', 'tools/security/needs_tests.py',
            '.github/workflows/security.yml', '.github/actions/a/action.yml',
            '.githooks/pre-push', '.gitleaks.toml', '.gitleaksignore',
            '.dockerignore',
            'tools/access.py', 'tools/release/changes.py',
            'docs/meloming-overlay-source-manifest.tsv',
            'apps/android/gradle/wrapper/gradle-wrapper.jar',
            'apps/web/public/fonts/NanumSquareNeoTTF-aLt.woff2',
            'apps/web/public/static/soop-square.png',
            'apps/overlay/public/font.woff2', 'new-root-file',
        )
        for path in paths:
            with self.subTest(path=path):
                self.assertTrue(guard.needs_tests(['apps/ios/Sources/App.swift', path]))

    def test_only_exact_pr_merge_boundary_can_skip(self):
        valid = (BASE, MERGE, PR_HEAD, MERGE, [MERGE, BASE, PR_HEAD],
                 'refs/pull/123/merge', 'qa')
        self.assertTrue(guard.valid_boundary(*valid))
        for index, bad in ((0, '0' * 40), (1, 'not-a-sha'), (2, BASE),
                           (3, PR_HEAD), (4, [MERGE, PR_HEAD, BASE]),
                           (5, 'refs/heads/qa'), (6, 'feature')):
            arguments = list(valid); arguments[index] = bad
            with self.subTest(index=index):
                self.assertFalse(guard.valid_boundary(*arguments))

    def test_diff_framing_and_ambiguous_names_fail_closed(self):
        with patch.object(guard, 'git', return_value=b'apps/web/a.ts\0docs/a.md\0'):
            self.assertEqual(guard.changed_paths(BASE, MERGE),
                             ['apps/web/a.ts', 'docs/a.md'])
        for raw in (None, b'apps/web/a.ts', b'\xff\0',
                    b'apps/web/a.ts\0apps/web/a.ts\0',
                    b'apps/web/a.ts\0\0'):
            with self.subTest(raw=raw), patch.object(guard, 'git', return_value=raw):
                self.assertIsNone(guard.changed_paths(BASE, MERGE))

    def test_pr_decision_and_unverified_boundary(self):
        def fake_git(*args):
            return (MERGE + '\n').encode() if args[0] == 'rev-parse' else (
                MERGE + ' ' + BASE + ' ' + PR_HEAD + '\n').encode()
        with patch.object(guard, 'git', side_effect=fake_git):
            with patch.object(guard, 'changed_paths', return_value=['apps/web/a.ts']):
                self.assertEqual(guard.decide(PR_ENV), (False, 'product-only'))
            with patch.object(guard, 'changed_paths', return_value=['tools/security/check.py']):
                self.assertEqual(guard.decide(PR_ENV), (True, 'trust-input'))
            with patch.object(guard, 'changed_paths', return_value=None):
                self.assertEqual(guard.decide(PR_ENV), (True, 'comparison-unavailable'))
            with patch.object(guard, 'changed_paths') as compare:
                self.assertEqual(guard.decide(dict(PR_ENV, BASE_SHA='0' * 40)),
                                 (True, 'boundary-rejected'))
                compare.assert_not_called()
        for event in ('merge_group', 'push', 'workflow_dispatch'):
            self.assertEqual(guard.decide({'GITHUB_EVENT_NAME': event}),
                             (True, 'non-pr'))

    def test_output_is_boolean_and_workflow_preserves_full_scan(self):
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / 'output'
            with (patch.object(guard, 'decide', return_value=(False, 'product-only')),
                  patch.dict(os.environ, {'GITHUB_OUTPUT': str(output)}),
                  contextlib.redirect_stdout(io.StringIO())):
                guard.main()
            self.assertEqual(output.read_text(), 'run_tests=false\n')
        workflow = (Path(__file__).resolve().parents[2] /
                    '.github/workflows/security.yml').read_text()
        self.assertIn('merge_group:', workflow)
        self.assertIn("steps.test_plan.outputs.run_tests != 'false'", workflow)
        self.assertIn('Scan tracked files and all history\n        if: ${{ always() }}',
                      workflow)

    def test_real_merge_checkout_skips_only_verified_product_change(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            script = Path(guard.__file__).resolve()

            def git(*args):
                result = subprocess.run(['git', *args], cwd=root, check=True,
                                        capture_output=True, text=True)
                return result.stdout.strip()

            git('init', '-q')
            git('checkout', '-qb', 'qa')
            product = root / 'apps/web/src/page.tsx'
            product.parent.mkdir(parents=True)
            product.write_text('first\n')
            git('add', '.')
            git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid',
                'commit', '-qm', 'baseline')
            base = git('rev-parse', 'HEAD')
            git('checkout', '-qb', 'feature')
            product.write_text('second\n')
            git('add', '.')
            git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid',
                'commit', '-qm', 'product change')
            head = git('rev-parse', 'HEAD')
            git('checkout', '-q', 'qa')
            git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid',
                'merge', '--no-ff', '-qm', 'merge pull request', 'feature')
            merge = git('rev-parse', 'HEAD')
            output = root / 'output'
            env = {**os.environ, **PR_ENV, 'BASE_SHA': base,
                   'MERGE_SHA': merge, 'PR_HEAD_SHA': head,
                   'GITHUB_OUTPUT': str(output)}
            result = subprocess.run(['python3', '-I', str(script)], cwd=root,
                                    env=env, capture_output=True, text=True,
                                    timeout=10, check=True)
            self.assertEqual(json.loads(result.stdout),
                             {'reason': 'product-only', 'run_tests': False})
            self.assertEqual(output.read_text(), 'run_tests=false\n')


if __name__ == '__main__':
    unittest.main()
