"""Offline failure and recovery cases for proof-bound QA web export repair."""
import json
from unittest import TestCase
from unittest.mock import patch

import qa_web_export_reconcile as recovery


SOURCE = 'a' * 40
HEAD = 'b' * 40
DIGEST = 'sha256:' + 'c' * 64
NOW = '2026-09-25T19:10:00Z'
IMAGE = 'ghcr.io/h66rogi/rogichat-web@sha256:' + '1' * 64


def proof():
    return {'sourceSha': SOURCE, 'publicationAttempt': 2,
            'publicationRun': 'https://github.com/h66rogi/rogichat/actions/runs/42',
            'image': IMAGE}


def responses():
    return {
        'git/ref/heads/qa': {'object': {'sha': HEAD}},
        'actions/artifacts?name=qa-web-published-base&per_page=100': {
            'total_count': 1, 'artifacts': [{
                'id': 8, 'name': 'qa-web-published-base', 'expired': False,
                'digest': DIGEST, 'created_at': NOW,
                'workflow_run': {'id': 42, 'head_sha': SOURCE}}]},
        'actions/runs/42': {'id': 42, 'run_attempt': 2, 'head_sha': SOURCE,
                            'run_started_at': '2026-09-25T19:00:00Z'},
        f'compare/{SOURCE}...{HEAD}': {'status': 'ahead',
                                      'merge_base_commit': {'sha': SOURCE}},
        f'actions/artifacts?name=qa-web-exported-{SOURCE}&per_page=100': {
            'total_count': 0, 'artifacts': []},
        'actions/workflows/web-export.yml/runs?branch=qa&status=queued&per_page=100': {
            'total_count': 0, 'workflow_runs': []},
        'actions/workflows/web-export.yml/runs?branch=qa&status=in_progress&per_page=100': {
            'total_count': 0, 'workflow_runs': []},
    }


def select(values, *, read=None, candidate_proof=None):
    def get(path):
        return read(path) if read else values[path]

    def proof_reader(source, run_id, attempt, cutoff, token):
        assert (source, run_id, attempt, token) == (SOURCE, 42, 2, 'token')
        return proof() if candidate_proof is None else candidate_proof

    return recovery.select('token', HEAD, get=get, proof_reader=proof_reader)


class RecoveryTests(TestCase):
    def test_dispatch_only_uses_exact_publication_image_proof(self):
        inputs = select(responses())
        self.assertEqual(inputs, {'source_sha': SOURCE, 'runtime_digest': '1' * 64,
                                  'publication_run_id': '42', 'publication_attempt': '2'})
        captured = {}

        class Response:
            status = 204

            def __enter__(self):
                return self

            def __exit__(self, *_):
                return False

        def opener(request, *, timeout):
            captured.update(method=request.get_method(), payload=json.loads(request.data),
                            timeout=timeout)
            return Response()

        recovery.dispatch('token', inputs, opener=opener)
        self.assertEqual(captured, {'method': 'POST', 'payload': {'ref': 'qa', 'inputs': inputs},
                                    'timeout': 15})

    def test_completed_export_and_exact_archive_suppress_duplicate(self):
        values = responses()
        values[f'actions/artifacts?name=qa-web-exported-{SOURCE}&per_page=100'] = {
            'total_count': 1, 'artifacts': [{'name': 'qa-web-exported-' + SOURCE,
                'expired': False, 'workflow_run': {'id': 90, 'head_sha': HEAD}}]}
        values['actions/runs/90'] = {'id': 90, 'head_sha': HEAD, 'head_branch': 'qa',
            'path': '.github/workflows/web-export.yml', 'event': 'workflow_dispatch',
            'run_attempt': 1, 'repository': {'full_name': recovery.REPOSITORY},
            'head_repository': {'full_name': recovery.REPOSITORY},
            'status': 'completed', 'conclusion': 'success'}
        values['actions/runs/90/artifacts?per_page=100'] = {'total_count': 1, 'artifacts': [
            {'name': f'web-{SOURCE}-90-1', 'expired': False,
             'workflow_run': {'id': 90, 'head_sha': HEAD}}]}
        self.assertIsNone(select(values))
        values['actions/runs/90/artifacts?per_page=100']['artifacts'][0]['name'] = 'web-other'
        self.assertEqual(select(values)['source_sha'], SOURCE)

    def test_active_export_suppresses_duplicate(self):
        values = responses()
        values['actions/workflows/web-export.yml/runs?branch=qa&status=queued&per_page=100'] = {
            'total_count': 1, 'workflow_runs': [{
                'status': 'queued', 'head_branch': 'qa', 'event': 'workflow_dispatch',
                'head_repository': {'full_name': recovery.REPOSITORY},
                'path': '.github/workflows/web-export.yml',
                'repository': {'full_name': recovery.REPOSITORY},
                'display_title': 'Web export ' + SOURCE}]}
        self.assertIsNone(select(values))

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

    def test_wrong_source_attempt_or_ancestry_rejects(self):
        for changed in ({**proof(), 'sourceSha': HEAD},
                        {**proof(), 'publicationAttempt': 3},
                        {**proof(), 'image': 'ghcr.io/h66rogi/rogichat-web@sha256:bad'}):
            with self.subTest(changed=changed):
                with self.assertRaises(ValueError):
                    select(responses(), candidate_proof=changed)
        values = responses()
        values[f'compare/{SOURCE}...{HEAD}']['merge_base_commit']['sha'] = HEAD
        with self.assertRaises(ValueError):
            select(values)

    def test_incomplete_metadata_listing_rejects(self):
        values = responses()
        values['actions/artifacts?name=qa-web-published-base&per_page=100']['total_count'] = 2
        with self.assertRaises(ValueError):
            select(values)
        values = responses()
        values['actions/workflows/web-export.yml/runs?branch=qa&status=queued&per_page=100'] = {
            'total_count': 101, 'workflow_runs': []}
        with self.assertRaises(ValueError):
            select(values)

    def test_late_older_marker_does_not_hide_newer_publication(self):
        values = responses()
        baseline = values['actions/artifacts?name=qa-web-published-base&per_page=100']
        baseline['artifacts'].append({
            'id': 9, 'name': 'qa-web-published-base', 'expired': False,
            'digest': DIGEST, 'created_at': NOW,
            'workflow_run': {'id': 41, 'head_sha': SOURCE}})
        baseline['total_count'] = 2
        self.assertEqual(recovery.source_marker(lambda path: values[path])[2], 42)


class PublicationProofTests(TestCase):
    def test_exact_attempt_proof_and_all_five_required_jobs_are_rechecked(self):
        evidence = []
        api_values = {
            'actions/runs/42/artifacts?per_page=100': {'total_count': 1, 'artifacts': [{
                'id': 77, 'name': f'web-publication-proof-{SOURCE}-2', 'expired': False,
                'digest': DIGEST, 'created_at': NOW,
                'workflow_run': {'id': 42, 'head_sha': SOURCE}}]},
        }
        for index, (workflow, job_name) in enumerate(recovery.REQUIRED_JOBS.items(), 1):
            evidence.append({'workflow': workflow, 'job': job_name, 'id': index,
                             'attempt': 1, 'jobId': index + 100, 'sha': SOURCE})
            api_values[f'actions/runs/{index}/attempts/1/jobs?per_page=100'] = {
                'total_count': 1, 'jobs': [{'id': index + 100, 'name': job_name,
                    'run_id': index, 'run_attempt': 1, 'status': 'completed',
                    'conclusion': 'success'}]}
        full_proof = {**proof(), 'schemaVersion': 1, 'repository': recovery.REPOSITORY,
                      'checkedImageId': 'sha256:' + '2' * 64, 'platform': 'linux/amd64',
                      'runtimeEnvironmentsVerified': ['qa', 'production'],
                      'verification': evidence}
        publication = {'id': 42, 'run_started_at': '2026-09-25T19:00:00Z'}

        def exact_run(run_id, attempt, source, workflow, token):
            self.assertEqual((source, token), (SOURCE, 'token'))
            self.assertEqual(attempt, 2 if run_id == 42 else 1)
            return publication if run_id == 42 else {'id': run_id}

        def api(path, token):
            self.assertEqual(token, 'token')
            return api_values[path]

        with patch.object(recovery.archive, 'exact_run', side_effect=exact_run), \
             patch.object(recovery.archive.core, 'api', side_effect=api), \
             patch.object(recovery.archive, 'download_proof', return_value=b'zip'), \
             patch.object(recovery.archive, 'proof_zip', return_value=full_proof):
            self.assertEqual(recovery.publication_proof(SOURCE, 42, 2,
                             '2026-09-25T19:11:00Z', 'token'), full_proof)
            api_values['actions/runs/3/attempts/1/jobs?per_page=100']['jobs'][0]['jobId'] = 999
            api_values['actions/runs/3/attempts/1/jobs?per_page=100']['jobs'][0]['id'] = 999
            with self.assertRaises(ValueError):
                recovery.publication_proof(SOURCE, 42, 2, '2026-09-25T19:11:00Z', 'token')


if __name__ == '__main__':
    import unittest
    unittest.main()
