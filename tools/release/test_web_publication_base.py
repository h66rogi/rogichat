import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from datetime import datetime, timezone

import web_publication_base as baseline
from changes import changed_paths, web_image_changed


SOURCE = 'a' * 40
HEAD = 'b' * 40
RUN_ID = 42
REPO_ID = 1377178939
NOW = datetime(2026, 9, 26, 0, 4, tzinfo=timezone.utc)


def evidence():
    artifact = {'id': 7, 'name': f'web-publication-proof-{SOURCE}-1',
                'digest': 'sha256:' + 'c' * 64, 'size_in_bytes': 648, 'expired': False,
                'created_at': '2026-09-26T00:02:00Z', 'expires_at': '2026-10-26T00:02:00Z',
                'workflow_run': {'id': RUN_ID, 'head_sha': SOURCE, 'head_branch': 'qa',
                                 'repository_id': REPO_ID, 'head_repository_id': REPO_ID}}
    run = {'id': RUN_ID, 'run_attempt': 1, 'head_sha': SOURCE, 'head_branch': 'qa',
           'event': 'push', 'path': baseline.WORKFLOW, 'status': 'completed', 'conclusion': 'success',
           'repository': {'id': REPO_ID, 'full_name': baseline.REPOSITORY},
           'head_repository': {'id': REPO_ID, 'full_name': baseline.REPOSITORY}}
    steps = [
        {'number': 7, 'name': 'Scan every image layer and metadata before registry authentication',
         'conclusion': 'success', 'started_at': '2026-09-26T00:00:00Z',
         'completed_at': '2026-09-26T00:00:20Z'},
        {'number': 8, 'name': 'Require successful verification of this exact QA push before publishing',
         'conclusion': 'success', 'started_at': '2026-09-26T00:00:30Z',
         'completed_at': '2026-09-26T00:00:45Z'},
        {'number': 9, 'name': 'Publish only the checked image and write promotion proof',
         'conclusion': 'success', 'started_at': '2026-09-26T00:01:00Z',
         'completed_at': '2026-09-26T00:01:30Z'},
        {'number': 10, 'name': 'Retain exact digest and CI provenance for promotion review',
         'conclusion': 'success', 'started_at': '2026-09-26T00:01:50Z',
         'completed_at': '2026-09-26T00:02:10Z'},
    ]
    jobs = {'total_count': 2, 'jobs': [
        {'run_id': RUN_ID, 'head_sha': SOURCE, 'name': 'publish',
         'status': 'completed', 'conclusion': 'success', 'steps': steps},
        {'run_id': RUN_ID, 'head_sha': SOURCE, 'name': 'changes',
         'status': 'completed', 'conclusion': 'success', 'steps': []},
    ]}
    return artifact, run, jobs


def api_for(artifact, run, jobs):
    def api(route):
        if route == 'actions/artifacts?per_page=100&page=1':
            return {'total_count': 1, 'artifacts': [artifact]}
        if route == f'actions/runs/{RUN_ID}':
            return run
        if route == f'actions/runs/{RUN_ID}/attempts/1/jobs?per_page=100':
            return jobs
        raise AssertionError(route)
    return api


class WebPublicationBaseTest(unittest.TestCase):
    def test_trusted_success_is_cumulative_base(self):
        artifact, run, jobs = evidence()
        self.assertEqual(baseline.select_base(HEAD, api_for(artifact, run, jobs),
                                              lambda source, head: (source, head) == (SOURCE, HEAD), NOW), SOURCE)

    def test_bounded_artifact_lookup_survives_ci_only_pushes(self):
        artifact, run, jobs = evidence()
        for pushes, expected_pages in ((5, 1), (10, 1), (25, 1), (50, 2)):
            with self.subTest(pushes=pushes):
                # Two unrelated artifacts per QA push, after the last web proof.
                artifacts = [{'name': 'openapi', 'created_at': '2026-09-26T00:03:00Z'}
                             for _ in range(2 + pushes * 2)] + [artifact]
                listings = []
                def api(route):
                    if route.startswith('actions/artifacts?per_page=100&page='):
                        page = int(route.rsplit('=', 1)[1])
                        listings.append(page)
                        return {'total_count': len(artifacts),
                                'artifacts': artifacts[(page - 1) * 100:page * 100]}
                    return api_for(artifact, run, jobs)(route)
                self.assertEqual(baseline.select_base(HEAD, api, lambda *_: True, NOW), SOURCE)
                self.assertEqual(listings, list(range(1, expected_pages + 1)))

        listings = []
        unrelated = [{'name': 'openapi'}] * 501
        def no_proof_api(route):
            page = int(route.rsplit('=', 1)[1])
            listings.append(page)
            return {'total_count': len(unrelated),
                    'artifacts': unrelated[(page - 1) * 100:page * 100]}
        self.assertEqual(baseline.select_base(HEAD, no_proof_api, lambda *_: True, NOW), baseline.ZERO)
        self.assertEqual(listings, [1, 2, 3, 4, 5])

    def test_spoofed_or_incomplete_proof_never_skips_web(self):
        for mutate in (
                lambda a, r, j: a.update(name=f'web-publication-proof-{HEAD}-1'),
                lambda a, r, j: a.update(name=f'web-publication-proof-{SOURCE}-2'),
                lambda a, r, j: a.update(digest='sha256:invalid'),
                lambda a, r, j: a.update(expired=True),
                lambda a, r, j: a['workflow_run'].update(head_repository_id=1),
                lambda a, r, j: r.update(event='pull_request'),
                lambda a, r, j: r.update(path='.github/workflows/new.yml'),
                lambda a, r, j: r['head_repository'].update(full_name='fork/rogichat'),
                lambda a, r, j: j['jobs'][0].update(conclusion='skipped'),
                lambda a, r, j: j['jobs'][0]['steps'][-2].update(conclusion='failure'),
                lambda a, r, j: j['jobs'][0]['steps'][-1].update(conclusion='failure'),
                lambda a, r, j: a.update(created_at='2026-09-25T23:59:59Z'),
        ):
            with self.subTest(mutate=mutate):
                artifact, run, jobs = evidence()
                mutate(artifact, run, jobs)
                self.assertEqual(baseline.select_base(HEAD, api_for(artifact, run, jobs),
                                                      lambda *_: True, NOW), baseline.ZERO)

    def test_nonancestor_or_api_uncertainty_rebuilds_web(self):
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

    def test_failed_middle_web_source_is_reconsidered_after_ci_only_push(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            def git(*args):
                return subprocess.check_output(['git', '-C', temporary, *args], stderr=subprocess.PIPE).decode().strip()
            git('init', '-q')
            git('config', 'user.name', 'Fixture')
            git('config', 'user.email', 'fixture@example.invalid')
            for name, route in [('base', 'apps/web/src/app/page.tsx'),
                                ('web-change', 'apps/web/src/app/new.tsx'),
                                ('ci-only-after-failure', 'tools/release/test_changes.py')]:
                target = root / route
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
                self.assertFalse(web_image_changed(changed_paths(before, head)))
                self.assertTrue(web_image_changed(changed_paths(base, head)))
            finally:
                os.chdir(previous)


if __name__ == '__main__':
    unittest.main()
