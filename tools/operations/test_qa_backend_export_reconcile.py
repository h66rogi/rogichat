"""Offline checks for the bounded, proof-bound export recovery path."""
import json
from unittest import TestCase

import qa_backend_export_reconcile as recovery


SOURCE = 'a' * 40
HEAD = 'b' * 40
DIGEST = 'sha256:' + 'c' * 64
NOW = '2026-09-25T19:10:00Z'


def proof():
    return {'sourceSha': SOURCE, 'publicationAttempt': 2,
            'publicationRun': 'https://github.com/h66rogi/rogichat/actions/runs/42',
            'images': {role: {'image': 'ghcr.io/h66rogi/' + name + '@sha256:' + digit * 64}
                       for role, name, digit in (
                           ('runtime', 'rogichat-api', '1'),
                           ('migration', 'rogichat-api-migration', '2'),
                           ('decoder', 'rogichat-media-decoder', '3'))}}


def responses():
    return {
        'git/ref/heads/qa': {'object': {'sha': HEAD}},
        'actions/artifacts?name=qa-backend-published-base&per_page=100': {
            'total_count': 1, 'artifacts': [{
                'id': 8, 'name': 'qa-backend-published-base', 'expired': False,
                'digest': DIGEST, 'created_at': NOW,
                'workflow_run': {'id': 42, 'head_sha': SOURCE}}]},
        'actions/runs/42': {'id': 42, 'run_attempt': 2, 'head_sha': SOURCE,
                            'run_started_at': '2026-09-25T19:00:00Z'},
        f'compare/{SOURCE}...{HEAD}': {'status': 'ahead',
                                      'merge_base_commit': {'sha': SOURCE}},
        f'actions/artifacts?name=qa-backend-exported-{SOURCE}&per_page=100': {
            'total_count': 0, 'artifacts': []},
        'actions/workflows/backend-export.yml/runs?branch=qa&status=queued&per_page=100': {
            'total_count': 0, 'workflow_runs': []},
        'actions/workflows/backend-export.yml/runs?branch=qa&status=in_progress&per_page=100': {
            'total_count': 0, 'workflow_runs': []},
    }


def select(values, *, read=None):
    def get(path):
        return read(path) if read else values[path]

    def verify(run, source, token):
        assert run['id'] == 42 and source == SOURCE and token == 'token'

    def proof_reader(source, run, attempt, time, token, *, return_digest):
        assert (source, run, attempt, token, return_digest) == (SOURCE, 42, 2, 'token', True)
        return proof(), DIGEST

    return recovery.select('token', HEAD, get=get, verify=verify, proof_reader=proof_reader)


class RecoveryTests(TestCase):
    def test_dispatch_inputs_come_only_from_verified_publication_proof(self):
        inputs = select(responses())
        self.assertEqual(inputs, {'source_sha': SOURCE, 'runtime_digest': '1' * 64,
                                  'migration_digest': '2' * 64, 'decoder_digest': '3' * 64,
                                  'publication_run_id': '42', 'publication_attempt': '2',
                                  'publication_proof_digest': DIGEST})
        captured = {}

        class Response:
            status = 204

            def __enter__(self):
                return self

            def __exit__(self, *_):
                return False

        def opener(request, *, timeout):
            captured['method'] = request.get_method()
            captured['payload'] = json.loads(request.data)
            captured['timeout'] = timeout
            return Response()

        recovery.dispatch('token', inputs, opener=opener)
        self.assertEqual(captured, {'method': 'POST', 'payload': {'ref': 'qa', 'inputs': inputs},
                                    'timeout': 15})

    def test_completed_export_marker_suppresses_duplicate_dispatch(self):
        values = responses()
        values[f'actions/artifacts?name=qa-backend-exported-{SOURCE}&per_page=100'] = {
            'total_count': 1, 'artifacts': [{'name': 'qa-backend-exported-' + SOURCE,
                'expired': False, 'workflow_run': {'id': 90, 'head_sha': HEAD}}]}
        values['actions/runs/90'] = {'id': 90, 'head_sha': HEAD, 'head_branch': 'qa',
            'path': '.github/workflows/backend-export.yml', 'event': 'workflow_dispatch',
            'repository': {'full_name': recovery.REPOSITORY},
            'head_repository': {'full_name': recovery.REPOSITORY},
            'status': 'completed', 'conclusion': 'success'}
        self.assertIsNone(select(values))

    def test_active_export_suppresses_duplicate_dispatch(self):
        values = responses()
        values['actions/workflows/backend-export.yml/runs?branch=qa&status=queued&per_page=100'] = {
            'total_count': 1, 'workflow_runs': [{
                'status': 'queued', 'head_branch': 'qa',
                'path': '.github/workflows/backend-export.yml',
                'repository': {'full_name': recovery.REPOSITORY},
                'display_title': 'Backend export ' + SOURCE}]}
        self.assertIsNone(select(values))

    def test_incomplete_active_export_listing_rejects_dispatch(self):
        values = responses()
        values['actions/workflows/backend-export.yml/runs?branch=qa&status=queued&per_page=100'] = {
            'total_count': 101, 'workflow_runs': []}
        with self.assertRaises(ValueError):
            select(values)

    def test_moving_qa_head_rejects_dispatch(self):
        values = responses()
        count = 0

        def read(path):
            nonlocal count
            if path == 'git/ref/heads/qa':
                count += 1
                return {'object': {'sha': HEAD if count == 1 else 'd' * 40}}
            return values[path]

        with self.assertRaises(ValueError):
            select(values, read=read)

    def test_unrelated_source_or_bad_proof_rejects_recovery(self):
        for mutation in (
            lambda v: v[f'compare/{SOURCE}...{HEAD}']['merge_base_commit'].update(sha=HEAD),
            lambda v: v['actions/artifacts?name=qa-backend-published-base&per_page=100']
                ['artifacts'][0].update(digest='bad'),
            lambda v: v['actions/runs/42'].update(run_started_at='2026-09-25T19:11:00Z'),
        ):
            with self.subTest(mutation=mutation):
                values = responses()
                mutation(values)
                with self.assertRaises(ValueError):
                    select(values)

    def test_incomplete_artifact_listing_rejects_recovery(self):
        values = responses()
        values['actions/artifacts?name=qa-backend-published-base&per_page=100']['total_count'] = 2
        with self.assertRaises(ValueError):
            select(values)

    def test_late_old_baseline_cannot_hide_newer_published_source(self):
        values = responses()
        newer = {'id': 6, 'name': 'qa-backend-published-base', 'expired': False,
                 'digest': DIGEST, 'created_at': NOW,
                 'workflow_run': {'id': 99, 'head_sha': HEAD}}
        values['actions/artifacts?name=qa-backend-published-base&per_page=100']['artifacts'].append(newer)
        values['actions/artifacts?name=qa-backend-published-base&per_page=100']['total_count'] = 2
        _, source, run_id = recovery.source_marker(lambda path: values[path])
        self.assertEqual((source, run_id), (HEAD, 99))

    def test_prior_fixed_baselines_do_not_block_new_publication(self):
        values = responses()
        baseline = values['actions/artifacts?name=qa-backend-published-base&per_page=100']
        baseline['artifacts'].append({
            'id': 5, 'name': 'qa-backend-published-base', 'expired': False,
            'digest': DIGEST, 'created_at': NOW,
            'workflow_run': {'id': 40, 'head_sha': SOURCE}})
        baseline['total_count'] = 2
        _, source, run_id = recovery.source_marker(lambda path: values[path])
        self.assertEqual((source, run_id), (SOURCE, 42))

    def test_fixed_baseline_page_accepts_more_than_100_past_runs(self):
        values = responses()
        baseline = values['actions/artifacts?name=qa-backend-published-base&per_page=100']
        baseline['artifacts'] = [dict(baseline['artifacts'][0], id=index + 100,
                                      workflow_run={'id': index + 1, 'head_sha': SOURCE})
                                 for index in range(100)]
        baseline['total_count'] = 150
        _, source, run_id = recovery.source_marker(lambda path: values[path])
        self.assertEqual((source, run_id), (SOURCE, 100))


if __name__ == '__main__':
    import unittest
    unittest.main()
