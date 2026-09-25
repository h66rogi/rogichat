import os
from pathlib import Path
import re
import subprocess
import tempfile
import unittest

import auxiliary_image_changes as selector


ROOT = Path(__file__).resolve().parents[2]


def workflow_paths(name: str) -> set[str]:
    workflow = (ROOT / '.github/workflows' / name).read_text()
    block = workflow.split('  pull_request:\n    paths:\n', 1)[1].split('  push:\n', 1)[0]
    return set(re.findall(r"^      - '([^']+)'$", block, flags=re.MULTILINE))


class AuxiliaryImageChangesTest(unittest.TestCase):
    def test_push_selector_matches_pr_image_inputs(self):
        overlay = (selector.OVERLAY_FILES | {prefix + '**' for prefix in selector.OVERLAY_PREFIXES}
                   | {'apps/*/package.json'})
        gateway = selector.GATEWAY_FILES | {prefix + '**' for prefix in selector.GATEWAY_PREFIXES}
        self.assertEqual(overlay, workflow_paths('overlay.yml'))
        self.assertEqual(gateway, workflow_paths('media-gateway.yml'))

    def test_changed_inputs_and_unknown_boundary(self):
        with tempfile.TemporaryDirectory() as temporary:
            def git(*args: str) -> str:
                return subprocess.check_output(['git', '-C', temporary, *args],
                                               stderr=subprocess.PIPE).decode().strip()

            git('init', '-q')
            git('config', 'user.name', 'Fixture')
            git('config', 'user.email', 'fixture@example.invalid')
            readme = Path(temporary) / 'README.md'
            readme.write_text('baseline\n')
            git('add', '.')
            git('commit', '-qm', 'baseline')
            base = git('rev-parse', 'HEAD')
            readme.write_text('unrelated\n')
            git('commit', '-qam', 'unrelated')
            unrelated = git('rev-parse', 'HEAD')
            overlay = Path(temporary) / 'apps/overlay/src/page.tsx'
            overlay.parent.mkdir(parents=True)
            overlay.write_text('overlay\n')
            git('add', '.')
            git('commit', '-qm', 'overlay')
            overlay_head = git('rev-parse', 'HEAD')
            gateway = Path(temporary) / 'apps/media-gateway/src/app.py'
            gateway.parent.mkdir(parents=True)
            gateway.write_text('gateway\n')
            git('add', '.')
            git('commit', '-qm', 'gateway')
            gateway_head = git('rev-parse', 'HEAD')

            previous = Path.cwd()
            try:
                os.chdir(temporary)
                self.assertIsNone(selector.changed_paths(base, unrelated))
                self.assertIsNone(selector.changed_paths('0' * 40, gateway_head))
                self.assertIsNone(selector.changed_paths(gateway_head, base))
                names = selector.changed_paths(base, gateway_head)
                self.assertEqual(set(names), {'README.md', 'apps/overlay/src/page.tsx',
                                              'apps/media-gateway/src/app.py'})
                self.assertFalse(selector.affects('overlay', 'README.md'))
                self.assertTrue(selector.affects('overlay', 'apps/overlay/src/page.tsx'))
                self.assertFalse(selector.affects('gateway', 'apps/overlay/src/page.tsx'))
                self.assertTrue(selector.affects('gateway', 'apps/media-gateway/src/app.py'))
                self.assertIsNone(selector.changed_paths(overlay_head, unrelated))
            finally:
                os.chdir(previous)

    def test_shared_and_component_only_inputs(self):
        for path in ('AGENTS.md', '.dockerignore', '.gitleaks.toml',
                     'tools/security/image_scan.py',
                     'tools/infrastructure/auxiliary_image_changes.py'):
            self.assertTrue(selector.affects('overlay', path), path)
            self.assertTrue(selector.affects('gateway', path), path)
        self.assertTrue(selector.affects('overlay', 'apps/api/package.json'))
        self.assertFalse(selector.affects('gateway', 'apps/api/package.json'))
        self.assertFalse(selector.affects('overlay', 'apps/api/src/main.ts'))
        self.assertFalse(selector.affects('gateway', 'apps/api/src/main.ts'))


if __name__ == '__main__':
    unittest.main()
