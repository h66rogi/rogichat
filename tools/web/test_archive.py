"""Synthetic verification only: no Docker, credentials, extraction or networking."""
import copy
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

import archive


def zipped_proof(value):
    stream = io.BytesIO()
    with archive.zipfile.ZipFile(stream, 'w') as output:
        output.writestr('web-publication-proof.json', json.dumps(value))
    return stream.getvalue()


def fixture(directory):
    (directory / archive.PROOF_FILE).write_bytes(zipped_proof({}))
    source = 'a' * 40
    layer = b'unit test layer'
    config = {'architecture': 'amd64', 'os': 'linux', 'config': {
        'User': '10001:10001', 'Entrypoint': ['node'], 'Cmd': ['server.js'],
        'WorkingDir': '/app/apps/web', 'ExposedPorts': {'3000/tcp': {}},
        'Env': ['NODE_ENV=production', 'HOSTNAME=0.0.0.0', 'PORT=3000'],
        'Labels': {'org.opencontainers.image.source': archive.core.SOURCE,
                   'org.opencontainers.image.revision': source}},
        'rootfs': {'type': 'layers', 'diff_ids': ['sha256:' + archive.core.sha256(layer)]}}
    raw = json.dumps(config).encode()
    identity = archive.core.sha256(raw)
    docker_manifest = json.dumps([{'Config': identity + '.json', 'RepoTags': None, 'Layers': ['layer/layer.tar']}]).encode()
    with tarfile.open(directory / 'runtime.tar', 'w') as tar:
        for name, data in [(identity + '.json', raw), ('layer/layer.tar', layer), ('manifest.json', docker_manifest)]:
            member = tarfile.TarInfo(name)
            member.size = len(data)
            tar.addfile(member, io.BytesIO(data))
    registry = json.dumps({'schemaVersion': 2, 'mediaType': 'application/vnd.oci.image.manifest.v1+json',
                          'config': {'digest': 'sha256:' + identity}, 'layers': [{}]}).encode()
    (directory / 'runtime.manifest.json').write_bytes(registry)
    descriptor = {'version': 1, 'repository': archive.core.REPOSITORY, 'source_sha': source,
                  'producer': {'sha': 'b' * 40, 'run_id': 100, 'run_attempt': 2,
                               'event': 'workflow_dispatch', 'ref': 'refs/heads/qa'},
                  'verification_runs': {name: i + 1 for i, name in enumerate(sorted(archive.core.WORKFLOWS))},
                  'images': {'runtime': {'image': 'ghcr.io/h66rogi/rogichat-web@sha256:' + archive.core.sha256(registry),
                                         'config_id': 'sha256:' + identity,
                                         'archive_sha256': archive.core.file_hash(directory / 'runtime.tar')}}}
    (directory / 'descriptor.json').write_text(json.dumps(descriptor))
    return descriptor, config


class WebArchiveTests(unittest.TestCase):
    def test_exact_archive_and_raw_manifest_are_bound(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root)
            descriptor, _ = fixture(directory)
            actual, configs = archive.validate_directory(directory)
            self.assertEqual(actual, descriptor)
            self.assertIsNone(configs['runtime']['_archive_manifest'])
            (directory / 'runtime.manifest.json').write_bytes(b'{}')
            with self.assertRaises(ValueError):
                archive.validate_directory(directory)

    def test_backend_repository_and_missing_ci_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            descriptor, _ = fixture(Path(root))
            invalid = copy.deepcopy(descriptor)
            invalid['images']['runtime']['image'] = invalid['images']['runtime']['image'].replace('rogichat-web', 'rogichat-api')
            with self.assertRaises(ValueError):
                archive.validate_descriptor(invalid)
            del descriptor['verification_runs']['web-publish.yml']
            with self.assertRaises(ValueError):
                archive.validate_descriptor(descriptor)

    def test_runtime_contract_and_baked_environment_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            descriptor, config = fixture(Path(root))
            for key, value in [('User', '0'), ('Cmd', ['other.js']), ('WorkingDir', '/tmp'),
                               ('Env', ['NODE_ENV=production', 'PORT=3000', 'HOSTNAME=0.0.0.0', 'ROGICHAT_WEB_ENV=qa'])]:
                invalid = copy.deepcopy(config)
                invalid['config'][key] = value
                with self.assertRaises(ValueError):
                    archive.validate_config(invalid, descriptor['source_sha'])

    def test_provenance_requires_web_export_and_exact_artifact(self):
        with tempfile.TemporaryDirectory() as root:
            descriptor, _ = fixture(Path(root))
            producer = descriptor['producer']
            approval = {'export_sha': producer['sha'], 'export_run': producer['run_id'], 'export_attempt': 2,
                        'artifact_id': 200, 'artifact_sha256': 'sha256:' + 'c' * 64}
            run = {'head_sha': producer['sha'], 'head_branch': 'qa', 'event': 'workflow_dispatch',
                   'status': 'completed', 'conclusion': 'success', 'repository': {'full_name': archive.core.REPOSITORY},
                   'head_repository': {'full_name': archive.core.REPOSITORY}, 'path': '.github/workflows/web-export.yml', 'run_attempt': 2, 'id': 100}
            artifact = {'expired': False, 'digest': approval['artifact_sha256'],
                        'workflow_run': {'id': 100, 'head_sha': producer['sha']},
                        'name': f"web-{descriptor['source_sha']}-100-2"}
            compare = {'status': 'ahead', 'merge_base_commit': {'sha': descriptor['source_sha']}}
            with patch.object(archive.core, 'api', side_effect=[run, artifact, compare]), patch.object(archive.core, 'verify_source') as verify, patch.object(archive, 'verify_publication_proof'):
                archive.verify_provenance(descriptor, approval, publication_proof=zipped_proof({}))
                verify.assert_not_called()
            wrong = {**run, 'path': '.github/workflows/backend-export.yml'}
            with patch.object(archive.core, 'api', return_value=wrong):
                with self.assertRaises(ValueError):
                    archive.verify_provenance(descriptor, approval, publication_proof=zipped_proof({}))
            with patch.object(archive.core, 'api', side_effect=[run, {**artifact, 'digest': 'sha256:' + 'd' * 64}]):
                with self.assertRaises(ValueError):
                    archive.verify_provenance(descriptor, approval, publication_proof=zipped_proof({}))


class PublicationProofTests(unittest.TestCase):
    def proof_fixture(self, directory):
        descriptor, _ = fixture(directory)
        source = descriptor['source_sha']
        publication_id = descriptor['verification_runs']['web-publish.yml']
        run = {'head_sha': source, 'head_branch': 'qa', 'event': 'push', 'status': 'completed',
               'conclusion': 'success', 'repository': {'full_name': archive.core.REPOSITORY},
               'head_repository': {'full_name': archive.core.REPOSITORY},
               'path': '.github/workflows/web-publish.yml', 'run_attempt': 1, 'id': publication_id,
               'run_started_at': '2026-09-20T01:00:00Z'}
        export = {**run, 'id': 100, 'head_sha': descriptor['producer']['sha'], 'event': 'workflow_dispatch',
                  'path': '.github/workflows/web-export.yml', 'run_attempt': 2,
                  'run_started_at': '2026-09-20T02:00:00Z'}
        artifact = {'id': 300, 'name': f'web-publication-proof-{source}-1', 'expired': False,
                    'created_at': '2026-09-20T01:05:00Z',
                    'workflow_run': {'id': publication_id, 'head_sha': source}}
        image = descriptor['images']['runtime']
        proof = {'schemaVersion': 1, 'repository': archive.core.REPOSITORY, 'sourceSha': source,
                 'image': image['image'], 'checkedImageId': image['config_id'], 'platform': 'linux/amd64',
                 'publicationAttempt': 1, 'publicationRun': f'https://github.com/{archive.core.REPOSITORY}/actions/runs/{publication_id}',
                 'runtimeEnvironmentsVerified': ['qa', 'production'],
                 'verification': [{'workflow': name, 'id': identity, 'attempt': 1, 'sha': source}
                                  for name, identity in descriptor['verification_runs'].items() if name != 'web-publish.yml']}
        return descriptor, run, export, artifact, proof

    def verify(self, descriptor, run, export, artifact, proof):
        data = zipped_proof(proof)
        artifact = {'digest': 'sha256:' + archive.core.sha256(data), **artifact}
        listing = {'total_count': 1, 'artifacts': [artifact]}
        with patch.object(archive.core, 'api', side_effect=[run, export, listing] + [{**run, 'id': item['id'], 'run_attempt': item.get('attempt', 1), 'path': '.github/workflows/' + item['workflow']} for item in proof['verification']]) as api, patch.object(archive, 'download_proof', side_effect=AssertionError('host download forbidden')):
            archive.verify_publication_proof(descriptor, publication_proof=data)
            self.assertTrue(all(call.args[1] is None for call in api.call_args_list))

    def test_same_source_other_image_config_or_attempt_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            descriptor, run, export, artifact, proof = self.proof_fixture(Path(root))
            self.verify(descriptor, run, export, artifact, proof)
            for key, value in [('image', 'ghcr.io/h66rogi/rogichat-web@sha256:' + 'f' * 64),
                               ('checkedImageId', 'sha256:' + 'f' * 64), ('publicationAttempt', 2), ('platform', 'linux/arm64')]:
                with self.assertRaises(ValueError):
                    self.verify(descriptor, run, export, artifact, {**proof, key: value})

    def test_later_publication_attempt_or_replaced_artifact_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            descriptor, run, export, artifact, proof = self.proof_fixture(Path(root))
            with self.assertRaises(ValueError):
                self.verify(descriptor, {**run, 'run_attempt': 2, 'run_started_at': '2026-09-20T03:00:00Z'}, export,
                            {**artifact, 'name': artifact['name'][:-1] + '2', 'created_at': '2026-09-20T03:05:00Z'},
                            {**proof, 'publicationAttempt': 2})
            with self.assertRaises(ValueError):
                self.verify(descriptor, run, export, {**artifact, 'created_at': '2026-09-20T03:00:00Z'}, proof)
            with self.assertRaises(ValueError):
                self.verify(descriptor, run, export, {**artifact, 'expired': True}, proof)

    def test_proof_zip_hash_name_and_expansion_are_bounded(self):
        def zipped(name, value):
            stream = io.BytesIO()
            with archive.zipfile.ZipFile(stream, 'w', compression=archive.zipfile.ZIP_DEFLATED) as output:
                output.writestr(name, value)
            data = stream.getvalue()
            return data, 'sha256:' + archive.core.sha256(data)
        data, digest = zipped('web-publication-proof.json', '{}')
        self.assertEqual(archive.proof_zip(data, digest), {})
        with self.assertRaises(ValueError):
            archive.proof_zip(data, 'sha256:' + 'f' * 64)
        for name, value in [('../web-publication-proof.json', '{}'), ('web-publication-proof.json', 'x' * 65537)]:
            data, digest = zipped(name, value)
            with self.assertRaises(ValueError):
                archive.proof_zip(data, digest)

    def test_missing_proof_fails_without_network_or_download(self):
        with patch.object(archive.core, 'api') as api, patch.object(archive, 'download_proof') as download:
            with self.assertRaises(ValueError):
                archive.verify_publication_proof({})
            with self.assertRaises(ValueError):
                archive.verify_provenance({}, {})
            api.assert_not_called()
            download.assert_not_called()

    def test_metadata_digest_and_exact_source_checks_reject_tampering(self):
        with tempfile.TemporaryDirectory() as root:
            descriptor, run, export, artifact, proof = self.proof_fixture(Path(root))
            with self.assertRaises(ValueError):
                self.verify(descriptor, run, export, {**artifact, 'digest': 'sha256:' + '0' * 64}, proof)
            for key, value in [('sourceSha', 'f' * 40), ('publicationRun', 'wrong'),
                               ('verification', proof['verification'][:-1]),
                               ('verification', [{**item, 'sha': 'f' * 40} for item in proof['verification']])]:
                with self.assertRaises(ValueError):
                    self.verify(descriptor, run, export, artifact, {**proof, key: value})

    def test_old_extra_malformed_and_oversized_transport_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root)
            fixture(directory)
            proof = directory / archive.PROOF_FILE
            original = proof.read_bytes()
            proof.unlink()
            with self.assertRaises(ValueError):
                archive.validate_directory(directory)
            proof.write_bytes(original)
            (directory / 'extra').write_bytes(b'')
            with self.assertRaises(ValueError):
                archive.validate_directory(directory)
            (directory / 'extra').unlink()
            for bad in [b'bad ZIP', b'x' * (archive.PROOF_LIMIT + 1)]:
                proof.write_bytes(bad)
                with self.assertRaises((ValueError, archive.zipfile.BadZipFile)):
                    archive.validate_directory(directory)
            stream = io.BytesIO()
            with archive.zipfile.ZipFile(stream, 'w') as zipped:
                zipped.writestr('web-publication-proof.json', '{}')
                zipped.writestr('extra', '{}')
            with self.assertRaises(ValueError):
                archive.parse_proof_zip(stream.getvalue())

    def test_outer_zip_proof_bound_checked_before_extraction(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            bundle = root / 'export.zip'
            with archive.zipfile.ZipFile(bundle, 'w', compression=archive.zipfile.ZIP_DEFLATED) as zipped:
                zipped.writestr(archive.PROOF_FILE, b'x' * (archive.PROOF_LIMIT + 1))
            output = root / 'verified'
            with self.assertRaises(ValueError):
                archive.validate_zip(bundle, 'sha256:' + archive.core.file_hash(bundle), output)
            self.assertFalse(output.exists())

    def test_authenticated_producer_download_returns_original_bytes(self):
        data = zipped_proof({'original': True})
        from unittest.mock import MagicMock
        response = MagicMock()
        response.__enter__.return_value = response
        response.headers = {'Content-Length': str(len(data))}
        response.read.return_value = data
        opener = MagicMock()
        opener.open.return_value = response
        artifact = {'id': 300, 'digest': 'sha256:' + archive.core.sha256(data)}
        with patch.object(archive.urllib.request, 'build_opener', return_value=opener):
            self.assertEqual(archive.download_proof(artifact, 'test-only'), data)
            request = opener.open.call_args.args[0]
            self.assertEqual(request.get_header('Authorization'), 'Bearer test-only')
            response.read.assert_called_once_with(archive.PROOF_LIMIT + 1)
            with self.assertRaises(ValueError):
                archive.download_proof(artifact, None)

    def test_producer_preserves_bytes_and_consumer_policy(self):
        from types import SimpleNamespace
        from unittest.mock import Mock
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root) / 'rogichat-export'
            directory.mkdir()
            descriptor, run, export, artifact, proof = self.proof_fixture(directory)
            data = zipped_proof(proof)
            (directory / archive.PROOF_FILE).unlink()
            producer = SimpleNamespace(produce=Mock())
            loader = SimpleNamespace(exec_module=lambda module: None)
            with patch.dict(archive.os.environ, {'GITHUB_TOKEN': 'test-only', 'RUNNER_TEMP': root, 'GITHUB_OUTPUT': str(Path(root) / 'output')}), patch.object(archive.importlib.util, 'spec_from_file_location', return_value=SimpleNamespace(loader=loader)), patch.object(archive.importlib.util, 'module_from_spec', return_value=producer), patch.object(archive, 'resolve_publication', return_value=(descriptor, data)), patch.object(archive, 'download_proof', return_value=data), patch.object(archive, 'verify_publication_proof') as verify:
                archive.produce()
            self.assertEqual((directory / archive.PROOF_FILE).read_bytes(), data)
            self.assertEqual(producer.FILES, archive.IMAGE_FILES)
            self.assertEqual(archive.core.FILES, archive.IMAGE_FILES | {archive.PROOF_FILE})
            self.assertIs(archive.core.validate_directory, archive.validate_directory)
            verify.assert_called_once_with(descriptor, 'test-only', publication_proof=data)

    def test_redirect_never_forwards_github_authorization_to_storage(self):
        request = archive.urllib.request.Request('https://api.github.com/artifact', headers={'Authorization': 'Bearer unit-test-value'})
        redirected = archive.SafeRedirect().redirect_request(request, None, 302, '', {}, 'https://example.invalid/signed-artifact')
        self.assertFalse(redirected.has_header('Authorization'))
        with self.assertRaises(ValueError):
            archive.SafeRedirect().redirect_request(request, None, 302, '', {}, 'http://example.invalid/artifact')


class AutomaticExportTests(unittest.TestCase):
    proof_fixture = PublicationProofTests.proof_fixture

    def setup_case(self, root, event='workflow_run'):
        descriptor, publisher, export, artifact, proof = self.proof_fixture(root)
        descriptor['producer']['event'] = event
        export['event'] = event
        data = zipped_proof(proof)
        artifact['digest'] = 'sha256:' + archive.core.sha256(data)
        approval = {'export_sha': export['head_sha'], 'export_run': 100, 'export_attempt': 2,
                    'artifact_id': 200, 'artifact_sha256': 'sha256:' + 'c' * 64}
        payload = {'action': 'completed', 'repository': {'full_name': archive.core.REPOSITORY},
                   'workflow_run': publisher}
        path = root / 'event.json'
        path.write_text(json.dumps(payload))
        env = {'GITHUB_EVENT_NAME': event, 'GITHUB_REPOSITORY': archive.core.REPOSITORY,
               'GITHUB_REF': 'refs/heads/qa', 'GITHUB_SHA': export['head_sha'], 'GITHUB_RUN_ID': '100',
               'GITHUB_RUN_ATTEMPT': '2', 'GITHUB_EVENT_PATH': str(path),
               'EXPORT_SOURCE_SHA': descriptor['source_sha'],
               'EXPORT_RUNTIME_DIGEST': descriptor['images']['runtime']['image'].split('@sha256:')[1]}
        metadata = {
            f"actions/runs/{publisher['id']}/attempts/1": publisher,
            'actions/runs/100/attempts/2': export,
            f"actions/runs/{publisher['id']}/artifacts?per_page=100": {'total_count': 1, 'artifacts': [artifact]},
            f"compare/{descriptor['source_sha']}...{export['head_sha']}": {
                'status': 'ahead', 'merge_base_commit': {'sha': descriptor['source_sha']}},
            'actions/artifacts/200': {'expired': False, 'digest': approval['artifact_sha256'],
                'workflow_run': {'id': 100, 'head_sha': export['head_sha']},
                'name': f"web-{descriptor['source_sha']}-100-2"},
            f"actions/workflows/web-publish.yml/runs?branch=qa&event=push&head_sha={descriptor['source_sha']}&per_page=20": {'workflow_runs': [publisher]},
        }
        for item in proof['verification']:
            metadata[f"actions/runs/{item['id']}/attempts/1"] = {
                **publisher, 'id': item['id'], 'path': '.github/workflows/' + item['workflow']}
        return descriptor, proof, data, payload, env, metadata, approval

    def test_docs_only_head_exports_original_successful_qa_push(self):
        with tempfile.TemporaryDirectory() as temp:
            d, _, data, _, env, metadata, _ = self.setup_case(Path(temp))
            source, later_head = d['source_sha'], env['GITHUB_SHA']
            self.assertNotEqual(source, later_head)
            # A later docs-only QA push has no publication proof. The completed
            # A publisher and its exact A checks must still produce an export at B.
            calls = []
            def api(path, token):
                calls.append(path)
                return metadata[path]
            with patch.dict(archive.os.environ, env), \
                    patch.object(archive.core, 'api', side_effect=api), \
                    patch.object(archive, 'download_proof', return_value=data):
                expected, original = archive.resolve_publication('test-only')
            self.assertEqual(original, data)
            self.assertEqual(expected['source_sha'], source)
            self.assertEqual(expected['producer']['sha'], later_head)
            self.assertEqual(expected['verification_runs'], d['verification_runs'])
            self.assertIn(f'compare/{source}...{later_head}', calls)
            self.assertFalse(any(f'head_sha={later_head}' in path for path in calls))
            metadata[f'compare/{source}...{later_head}'] = {
                'status': 'diverged', 'merge_base_commit': {'sha': 'f' * 40}}
            with patch.dict(archive.os.environ, env), \
                    patch.object(archive.core, 'api', side_effect=api), \
                    patch.object(archive, 'download_proof', return_value=data), \
                    self.assertRaises(ValueError):
                archive.resolve_publication('test-only')
    def new_publication_case(self, root, event='workflow_run'):
        descriptor, proof, _, payload, env, metadata, approval = self.setup_case(root, event)
        publication_id = descriptor['verification_runs'].pop('web-publish.yml')
        descriptor['verification_runs'][archive.core.NEW_PUBLICATION_WORKFLOW] = publication_id
        publisher = metadata[f'actions/runs/{publication_id}/attempts/1']
        publisher.update(event='workflow_run', path='.github/workflows/qa-web-publication.yml',
                         name='QA web image publication')
        payload['workflow_run'] = publisher
        Path(env['GITHUB_EVENT_PATH']).write_text(json.dumps(payload))
        proof['verification'] = [item for item in proof['verification']
                                 if item['workflow'] in archive.core.FIVE_QA_WORKFLOWS]
        data = zipped_proof(proof)
        metadata[f'actions/runs/{publication_id}/artifacts?per_page=100']['artifacts'][0]['digest'] = (
            'sha256:' + archive.core.sha256(data))
        metadata[f'actions/runs/{publication_id}/attempts/1/jobs?per_page=100'] = {
            'total_count': 1, 'jobs': [{
                'name': archive.core.PUBLICATION_JOB, 'run_id': publication_id,
                'run_attempt': 1, 'status': 'completed', 'conclusion': 'success',
            }]}
        if event == 'workflow_dispatch':
            env['EXPORT_PUBLICATION_RUN_ID'] = str(publication_id)
            env['EXPORT_PUBLICATION_ATTEMPT'] = '1'
        return descriptor, proof, data, payload, env, metadata, approval

    def test_new_publication_auto_and_manual_bind_exact_proof_and_aggregate(self):
        for event in ('workflow_run', 'workflow_dispatch'):
            with self.subTest(event=event), tempfile.TemporaryDirectory() as temp:
                descriptor, proof, data, payload, env, metadata, _ = self.new_publication_case(Path(temp), event)
                self.assertNotEqual(payload['workflow_run']['head_sha'], env['GITHUB_SHA'])
                with patch.dict(archive.os.environ, env), patch.object(archive.core, 'api',
                        side_effect=lambda path, token: metadata[path]) as api, \
                        patch.object(archive, 'download_proof', return_value=data):
                    actual, original = archive.resolve_publication('test-only')
                self.assertEqual(actual['source_sha'], payload['workflow_run']['head_sha'])
                self.assertEqual(actual['producer']['sha'], env['GITHUB_SHA'])
                self.assertEqual(actual['verification_runs'][archive.core.NEW_PUBLICATION_WORKFLOW],
                                 payload['workflow_run']['id'])
                self.assertEqual(actual['verification_runs'], descriptor['verification_runs'])
                self.assertEqual(original, data)
                self.assertEqual(proof['publicationAttempt'], 1)
                self.assertTrue(any(f"compare/{actual['source_sha']}...{env['GITHUB_SHA']}" in call.args[0]
                                    for call in api.call_args_list))
                if event == 'workflow_dispatch':
                    self.assertFalse(any('actions/workflows/web-publish.yml/runs?' in call.args[0]
                                         for call in api.call_args_list))

    def test_new_publication_rejects_wrong_run_and_aggregate_identity(self):
        for change in ('event', 'path', 'sha', 'missing_check', 'job_status', 'job_attempt', 'duplicate_job'):
            with self.subTest(change=change), tempfile.TemporaryDirectory() as temp:
                descriptor, proof, data, payload, env, metadata, _ = self.new_publication_case(Path(temp))
                publication_id = descriptor['verification_runs'][archive.core.NEW_PUBLICATION_WORKFLOW]
                publisher = metadata[f'actions/runs/{publication_id}/attempts/1']
                listing = metadata[f'actions/runs/{publication_id}/attempts/1/jobs?per_page=100']
                if change == 'event': publisher['event'] = 'pull_request'
                elif change == 'path': publisher['path'] = '.github/workflows/qa-backend-publication.yml'
                elif change == 'sha': publisher['head_sha'] = 'f' * 40
                elif change == 'missing_check':
                    proof['verification'].pop()
                    data = zipped_proof(proof)
                    metadata[f'actions/runs/{publication_id}/artifacts?per_page=100']['artifacts'][0]['digest'] = (
                        'sha256:' + archive.core.sha256(data))
                elif change == 'job_status': listing['jobs'][0]['conclusion'] = 'failure'
                elif change == 'job_attempt': listing['jobs'][0]['run_attempt'] = 2
                else:
                    listing['jobs'].append(copy.deepcopy(listing['jobs'][0]))
                    listing['total_count'] = 2
                payload['workflow_run'] = publisher
                Path(env['GITHUB_EVENT_PATH']).write_text(json.dumps(payload))
                with patch.dict(archive.os.environ, env), patch.object(archive.core, 'api',
                        side_effect=lambda path, token: metadata[path]), \
                        patch.object(archive, 'download_proof', return_value=data), self.assertRaises(ValueError):
                    archive.resolve_publication('test-only')

    def test_automatic_and_manual_resolve_original_proof_before_pull(self):
        for event in ('workflow_run', 'workflow_dispatch'):
            with self.subTest(event=event), tempfile.TemporaryDirectory() as temp:
                d, proof, data, payload, env, metadata, _ = self.setup_case(Path(temp), event)
                # Mutable latest attempts and workflow candidates are deliberately newer.
                publication_id = d['verification_runs']['web-publish.yml']
                metadata[f'actions/runs/{publication_id}'] = {'id': publication_id, 'run_attempt': 99}
                listing = metadata[f'actions/runs/{publication_id}/artifacts?per_page=100']
                listing['artifacts'].append({**listing['artifacts'][0], 'id': 301,
                    'name': f"web-publication-proof-{d['source_sha']}-99", 'digest': 'sha256:' + 'f' * 64})
                listing['total_count'] = 2
                with patch.dict(archive.os.environ, env), patch.object(archive.core, 'api', side_effect=lambda path, token: metadata[path]) as api, patch.object(archive, 'download_proof', return_value=data) as download, patch.object(archive.core, 'command', side_effect=AssertionError('no pull before proof')):
                    actual, original = archive.resolve_publication('test-only')
                    self.assertEqual(original, data)
                    self.assertEqual(actual['verification_runs'], d['verification_runs'])
                    self.assertEqual(actual['images']['runtime']['image'], proof['image'])
                    self.assertEqual(actual['images']['runtime']['config_id'], proof['checkedImageId'])
                    self.assertEqual(archive.os.environ['GITHUB_EVENT_NAME'], event)
                    download.assert_called_once()
                    self.assertFalse(any(call.args[0] == f'actions/runs/{publication_id}' for call in api.call_args_list))

    def test_real_producer_preserves_event_four_members_and_tokenfree_save(self):
        import shutil
        from types import SimpleNamespace
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            inputs = root / 'inputs'
            inputs.mkdir()
            d, _, data, _, env, metadata, _ = self.setup_case(inputs)
            env.update(GITHUB_TOKEN='test-only', RUNNER_TEMP=temp, GITHUB_OUTPUT=str(root / 'output'), GITHUB_ACTOR='test-actor')
            real_spec = archive.importlib.util.spec_from_file_location('test_real_producer', archive.spec.origin)
            producer = archive.importlib.util.module_from_spec(real_spec)
            real_spec.loader.exec_module(producer)
            registry = (inputs / 'runtime.manifest.json').read_bytes()
            calls = []
            registry_configs = []
            def command(args, **kwargs):
                calls.append(args)
                self.assertNotIn('GITHUB_TOKEN', archive.os.environ)
                if kwargs.get('env') is not None:
                    self.assertNotIn('GITHUB_TOKEN', kwargs['env'])
                    registry_configs.append(Path(kwargs['env']['DOCKER_CONFIG']))
                if args[:3] == ['docker', 'image', 'inspect']:
                    return json.dumps([{'RepoDigests': [d['images']['runtime']['image']], 'Id': d['images']['runtime']['config_id']}]).encode()
                if args[:2] == ['docker', 'save']:
                    self.assertTrue(all(not path.exists() for path in registry_configs))
                    self.assertIsNone(kwargs.get('env'))
                    shutil.copyfile(inputs / 'runtime.tar', args[3])
                return b''
            def registry_http(request, timeout):
                return io.BytesIO(b'{"token":"isolated-test"}' if '/token?' in request.full_url else registry)
            # Conservative latest-source checks may reject, but never choose replacement IDs.
            latest = {f"actions/runs/{identity}": metadata[f"actions/runs/{identity}/attempts/1"]
                      for identity in d['verification_runs'].values()}
            def api(path, token):
                return (latest if path in latest else metadata)[path]
            fake_spec = SimpleNamespace(loader=SimpleNamespace(exec_module=lambda module: None))
            with patch.dict(archive.os.environ, env), patch.object(archive.core, 'api', side_effect=api), patch.object(producer, 'api', side_effect=api), patch.object(producer, 'command', side_effect=command), patch.object(producer.urllib.request, 'urlopen', side_effect=registry_http), patch.object(archive, 'download_proof', return_value=data), patch.object(archive.importlib.util, 'spec_from_file_location', return_value=fake_spec), patch.object(archive.importlib.util, 'module_from_spec', return_value=producer):
                archive.produce()
                self.assertEqual(archive.os.environ['GITHUB_EVENT_NAME'], 'workflow_run')
            directory = root / 'rogichat-export'
            self.assertEqual({path.name for path in directory.iterdir()}, archive.core.FILES)
            self.assertEqual((directory / archive.PROOF_FILE).read_bytes(), data)
            self.assertEqual((root / 'output').read_text(), 'source_sha=' + d['source_sha'] + '\n')
            actual, _ = archive.validate_directory(directory)
            self.assertEqual(actual, d)
            self.assertEqual(sum(args[:2] == ['docker', 'pull'] for args in calls), 1)
            self.assertEqual(sum(args[:2] == ['docker', 'save'] for args in calls), 1)
            self.assertIs(producer.validate_descriptor, archive.validate_descriptor)

    def test_publisher_payload_and_exact_api_must_both_be_trusted(self):
        changes = [('repository', {'full_name': 'other/repo'}), ('head_repository', {'full_name': 'fork/repo'}),
                   ('head_branch', 'main'), ('path', '.github/workflows/backend-publish.yml'),
                   ('event', 'workflow_dispatch'), ('status', 'in_progress'), ('conclusion', 'failure'),
                   ('id', True), ('run_attempt', True), ('run_attempt', 2), ('head_sha', 'f' * 40)]
        for target in ('payload', 'api'):
            for field, value in changes:
                with self.subTest(target=target, field=field, value=value), tempfile.TemporaryDirectory() as temp:
                    d, _, data, payload, env, metadata, _ = self.setup_case(Path(temp))
                    key = f"actions/runs/{d['verification_runs']['web-publish.yml']}/attempts/1"
                    if target == 'payload':
                        payload['workflow_run'] = {**payload['workflow_run'], field: value}
                        Path(env['GITHUB_EVENT_PATH']).write_text(json.dumps(payload))
                    else:
                        metadata[key] = {**metadata[key], field: value}
                    with patch.dict(archive.os.environ, env), patch.object(archive.core, 'api', side_effect=lambda path, token: metadata[path]), patch.object(archive, 'download_proof', return_value=data), self.assertRaises((ValueError, KeyError)):
                        archive.resolve_publication('test-only')

    def test_exact_ci_attempt_failures_duplicates_missing_and_boolean_ids(self):
        for change in ('missing', 'duplicate', 'boolean_id', 'boolean_attempt', 'failed', 'wrong_attempt', 'wrong_id', 'wrong_source'):
            with self.subTest(change=change), tempfile.TemporaryDirectory() as temp:
                d, proof, _, _, _, metadata, approval = self.setup_case(Path(temp))
                item = proof['verification'][0]
                run = metadata[f"actions/runs/{item['id']}/attempts/1"]
                if change == 'missing': proof['verification'].pop()
                elif change == 'duplicate': proof['verification'][1] = item.copy()
                elif change == 'boolean_id': item['id'] = True
                elif change == 'boolean_attempt': item['attempt'] = True
                elif change == 'failed': run['conclusion'] = 'failure'
                elif change == 'wrong_attempt': run['run_attempt'] = 2
                elif change == 'wrong_id': run['id'] = 999
                elif change == 'wrong_source': run['head_sha'] = 'f' * 40
                data = zipped_proof(proof)
                metadata[f"actions/runs/{d['verification_runs']['web-publish.yml']}/artifacts?per_page=100"]['artifacts'][0]['digest'] = 'sha256:' + archive.core.sha256(data)
                with patch.object(archive.core, 'api', side_effect=lambda path, token: metadata[path]), self.assertRaises(ValueError):
                    archive.verify_provenance(d, approval, publication_proof=data)

    def test_unknown_event_and_metadata_failure_never_fall_back(self):
        with tempfile.TemporaryDirectory() as temp:
            d, _, data, _, env, metadata, approval = self.setup_case(Path(temp))
            for event in ('push', 'pull_request', 'repository_dispatch'):
                with patch.dict(archive.os.environ, {**env, 'GITHUB_EVENT_NAME': event}), patch.object(archive.core, 'api') as api, self.assertRaises(ValueError):
                    archive.resolve_publication('test-only')
                api.assert_not_called()
                invalid = copy.deepcopy(d)
                invalid['producer']['event'] = event
                with self.assertRaises(ValueError):
                    archive.validate_descriptor(invalid)
            with patch.dict(archive.os.environ, env), patch.object(archive.core, 'api', side_effect=RuntimeError('rate limited')), patch.object(archive, 'download_proof') as download, self.assertRaises(RuntimeError):
                archive.resolve_publication('test-only')
            download.assert_not_called()

    def test_consumer_required_event_and_exact_export_attempt(self):
        for event in ('workflow_run', 'workflow_dispatch'):
            with tempfile.TemporaryDirectory() as temp:
                d, _, data, _, _, metadata, approval = self.setup_case(Path(temp), event)
                with patch.object(archive.core, 'api', side_effect=lambda path, token: metadata[path]), patch.object(archive, 'download_proof', side_effect=AssertionError('host ZIP forbidden')), patch.object(archive.core, 'command', side_effect=AssertionError('host credentials forbidden')):
                    archive.verify_provenance(d, approval, publication_proof=data)
                    if event == 'workflow_run':
                        archive.verify_provenance(d, approval, publication_proof=data, required_event='workflow_run')
                    else:
                        with self.assertRaises(ValueError):
                            archive.verify_provenance(d, approval, publication_proof=data, required_event='workflow_run')
                    for field, value in [('id', 101), ('run_attempt', 3), ('event', 'push'), ('conclusion', 'failure')]:
                        old = metadata['actions/runs/100/attempts/2'].copy()
                        metadata['actions/runs/100/attempts/2'][field] = value
                        with self.assertRaises(ValueError):
                            archive.verify_provenance(d, approval, publication_proof=data)
                        metadata['actions/runs/100/attempts/2'] = old

    def test_nonancestor_and_artifact_name_rejected(self):
        for change in ('diverged', 'mergebase', 'name', 'replacement', 'expired', 'listing'):
            with tempfile.TemporaryDirectory() as temp:
                d, _, data, _, _, metadata, approval = self.setup_case(Path(temp))
                compare = metadata[f"compare/{d['source_sha']}...{d['producer']['sha']}"]
                listing = metadata[f"actions/runs/{d['verification_runs']['web-publish.yml']}/artifacts?per_page=100"]
                if change == 'diverged': compare['status'] = 'diverged'
                elif change == 'mergebase': compare['merge_base_commit']['sha'] = 'f' * 40
                elif change == 'name': metadata['actions/artifacts/200']['name'] = 'wrong'
                elif change == 'replacement': listing['artifacts'][0]['created_at'] = '2026-09-20T03:00:00Z'
                elif change == 'expired': listing['artifacts'][0]['expired'] = True
                else: listing['total_count'] = 101
                with patch.object(archive.core, 'api', side_effect=lambda path, token: metadata[path]), self.assertRaises(ValueError):
                    archive.verify_provenance(d, approval, publication_proof=data)


class SourceVerifierTests(unittest.TestCase):
    def test_node_verifier_requires_exact_original_repository_attempt(self):
        import subprocess
        source = Path(archive.__file__).with_name('verify-publication-source.mjs').as_uri()
        script = r"""
        const mode = process.argv[1];
        const workflows = ['web.yml', 'backend.yml', 'security.yml', 'infrastructure.yml', 'mobile.yml'];
        const runs = workflows.map((workflow, index) => {
          const identity = 12 + index;
          return {id: identity, run_attempt: 2, head_sha: 'a'.repeat(40), head_branch: 'qa', event: 'push',
            repository: {full_name: 'h66rogi/rogichat'}, head_repository: {full_name: 'h66rogi/rogichat'},
            path: `.github/workflows/${workflow}`, status: 'completed', conclusion: 'success', html_url: 'https://example.invalid/run'};
        });
        const fetchImpl = async url => {
          if (!url.includes('/attempts/')) return {ok: true, json: async () => ({total_count: runs.length, workflow_runs: runs})};
          const id = Number(url.match(/\/runs\/(\d+)\/attempts/)[1]);
          const value = structuredClone(runs.find(run => run.id === id));
          if (url.includes('/attempts/')) {
            if (mode === 'id') value.id = 99;
            if (mode === 'attempt') value.run_attempt = 3;
            if (mode === 'repo') value.repository.full_name = 'other/repo';
            if (mode === 'fork') value.head_repository.full_name = 'fork/repo';
            if (mode === 'path') value.path = '.github/workflows/wrong.yml';
            if (mode === 'event') value.event = 'pull_request';
            if (mode === 'branch') value.head_branch = 'main';
            if (mode === 'failed') value.conclusion = 'failure';
            if (mode === 'boolean') value.id = true;
            return {ok: true, json: async () => value};
          }
        };
        const {verifyOnce} = await import(SOURCE);
        const evidence = await verifyOnce({sha: 'a'.repeat(40), repository: 'h66rogi/rogichat',
          token: 'test-only', cache: new Map(), fetchImpl});
        if (evidence) {
          const {writeFile} = await import('node:fs/promises');
          await writeFile(process.env.GITHUB_OUTPUT, JSON.stringify(evidence));
        }
        """.replace('SOURCE', json.dumps(source))
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / 'output'
            env = {'PATH': archive.os.environ['PATH'], 'SOURCE_SHA': 'a' * 40,
                   'SOURCE_REPOSITORY': archive.core.REPOSITORY, 'GH_TOKEN': 'test-only', 'GITHUB_OUTPUT': str(output)}
            for mode in ('valid', 'id', 'attempt', 'repo', 'fork', 'path', 'event', 'branch', 'failed', 'boolean'):
                with self.subTest(mode=mode):
                    result = subprocess.run(['node', '--input-type=module', '-e', script, mode], env=env, capture_output=True, timeout=10)
                    self.assertEqual(result.returncode == 0, mode == 'valid', result.stderr.decode())
            evidence = json.loads(output.read_text())
            self.assertEqual(len(evidence), 5)
            self.assertEqual({item['attempt'] for item in evidence}, {2})


if __name__ == '__main__':
    unittest.main()
