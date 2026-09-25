import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from datetime import datetime, timezone

import backend_publication_base as baseline
from changes import changed_paths, classify


SOURCE = 'a' * 40
HEAD = 'b' * 40
RUN_ID = 42
REPO_ID = 1377178939
NOW = datetime(2026, 9, 26, 0, 4, tzinfo=timezone.utc)


def evidence():
    artifact = {'id': 7, 'name': baseline.ARTIFACT, 'size_in_bytes': 800, 'expired': False,
                'created_at': '2026-09-26T00:02:00Z', 'expires_at': '2026-10-26T00:02:00Z',
                'workflow_run': {'id': RUN_ID, 'head_sha': SOURCE, 'head_branch': 'qa',
                                 'repository_id': REPO_ID, 'head_repository_id': REPO_ID}}
    run = {'id': RUN_ID, 'run_attempt': 1, 'head_sha': SOURCE, 'head_branch': 'qa',
           'event': 'push', 'path': baseline.WORKFLOW, 'status': 'completed', 'conclusion': 'success',
           'repository': {'id': REPO_ID, 'full_name': baseline.REPOSITORY},
           'head_repository': {'id': REPO_ID, 'full_name': baseline.REPOSITORY}}
    steps = [
        {'number': 10, 'name': 'Publish only the checked images', 'conclusion': 'success',
         'started_at': '2026-09-26T00:00:00Z', 'completed_at': '2026-09-26T00:00:30Z'},
        {'number': 11, 'name': 'Retain successfully published backend source', 'conclusion': 'success',
         'started_at': '2026-09-26T00:00:31Z', 'completed_at': '2026-09-26T00:00:32Z'},
        {'number': 12, 'name': 'Upload successful backend publication marker', 'conclusion': 'success',
         'started_at': '2026-09-26T00:01:00Z', 'completed_at': '2026-09-26T00:02:10Z'},
    ]
    jobs = {'total_count': 2, 'jobs': [
        {'run_id': RUN_ID, 'head_sha': SOURCE, 'name': 'publish',
         'status': 'completed', 'conclusion': 'success', 'steps': steps},
        {'run_id': RUN_ID, 'head_sha': SOURCE, 'name': 'changes',
         'status': 'completed', 'conclusion': 'success', 'steps': []},
    ]}
    return artifact, run, jobs


def api_for(artifact, run, jobs):
    def api(path):
        if path.startswith('actions/artifacts?'):
            return {'total_count': 1, 'artifacts': [artifact]}
        if path == f'actions/runs/{RUN_ID}':
            return run
        if path == f'actions/runs/{RUN_ID}/attempts/1/jobs?per_page=100':
            return jobs
        raise AssertionError(path)
    return api


class BackendPublicationBaseTest(unittest.TestCase):
    def test_trusted_success_is_cumulative_base(self):
        artifact, run, jobs = evidence()
        self.assertEqual(baseline.select_base(HEAD, api_for(artifact, run, jobs),
                                              lambda source, head: (source, head) == (SOURCE, HEAD), NOW), SOURCE)

    def test_spoofed_or_incomplete_publication_cannot_skip_backend(self):
        for mutate in (
                lambda a, r, j: r.update(event='pull_request'),
                lambda a, r, j: r['head_repository'].update(full_name='fork/rogichat'),
                lambda a, r, j: j['jobs'][0].update(conclusion='skipped'),
                lambda a, r, j: j['jobs'][0]['steps'][-1].update(conclusion='failure'),
                lambda a, r, j: a.update(created_at='2026-09-25T23:59:59Z'),
                lambda a, r, j: a.update(expired=True),
                lambda a, r, j: a['workflow_run'].update(head_repository_id=1),
        ):
            with self.subTest(mutate=mutate):
                artifact, run, jobs = evidence()
                mutate(artifact, run, jobs)
                self.assertEqual(baseline.select_base(HEAD, api_for(artifact, run, jobs),
                                                      lambda *_: True, NOW), baseline.ZERO)

    def test_non_ancestor_or_api_uncertainty_causes_full_build(self):
        artifact, run, jobs = evidence()
        self.assertEqual(baseline.select_base(HEAD, api_for(artifact, run, jobs),
                                              lambda *_: False, NOW), baseline.ZERO)
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / 'github-output'
            environment = {'GITHUB_EVENT_NAME': 'push', 'GITHUB_REF': 'refs/heads/qa',
                           'GITHUB_REPOSITORY': baseline.REPOSITORY, 'GITHUB_SHA': HEAD,
                           'GH_TOKEN': 'fixture', 'GITHUB_OUTPUT': str(output)}
            with patch.dict(os.environ, environment), patch.object(sys, 'argv', ['baseline', '--head', HEAD]), \
                    patch.object(baseline, 'urlopen', side_effect=OSError('fixture network failure')):
                baseline.main()
            self.assertEqual(output.read_text(), f'base={baseline.ZERO}\n')

    def test_interrupted_middle_backend_source_is_detected_at_latest_docs_head(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            def git(*args):
                return subprocess.check_output(['git', '-C', temporary, *args], stderr=subprocess.PIPE).decode().strip()
            git('init', '-q')
            git('config', 'user.name', 'Fixture')
            git('config', 'user.email', 'fixture@example.invalid')
            for name, path in [('base', 'apps/api/src/main.ts'),
                               ('backend-change', 'apps/api/src/feature.ts'),
                               ('docs-only-after-cancel', 'docs/notes.md')]:
                target = root / path
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(name + '\n')
                git('add', '.')
                git('commit', '-qm', name)
                if name == 'base':
                    base = git('rev-parse', 'HEAD')
            head = git('rev-parse', 'HEAD')
            before = git('rev-parse', 'HEAD^')
            previous = Path.cwd()
            try:
                os.chdir(root)
                self.assertEqual(classify(changed_paths(before, head)), (False, False))
                self.assertEqual(classify(changed_paths(base, head)), (False, True))
            finally:
                os.chdir(previous)


if __name__ == '__main__':
    unittest.main()
