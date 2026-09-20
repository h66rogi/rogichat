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
                   'head_repository': {'full_name': archive.core.REPOSITORY}, 'path': '.github/workflows/web-export.yml', 'run_attempt': 2}
            artifact = {'expired': False, 'digest': approval['artifact_sha256'],
                        'workflow_run': {'id': 100, 'head_sha': producer['sha']},
                        'name': f"web-{descriptor['source_sha']}-100-2"}
            compare = {'status': 'ahead', 'merge_base_commit': {'sha': descriptor['source_sha']}}
            with patch.object(archive.core, 'api', side_effect=[run, artifact, compare]), patch.object(archive.core, 'verify_source') as verify, patch.object(archive, 'verify_publication_proof'):
                archive.verify_provenance(descriptor, approval, publication_proof=zipped_proof({}))
                verify.assert_called_once()
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
               'path': '.github/workflows/web-publish.yml', 'run_attempt': 1,
               'run_started_at': '2026-09-20T01:00:00Z'}
        export = {**run, 'head_sha': descriptor['producer']['sha'], 'event': 'workflow_dispatch',
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
                 'verification': [{'workflow': name, 'id': identity, 'sha': source}
                                  for name, identity in descriptor['verification_runs'].items() if name != 'web-publish.yml']}
        return descriptor, run, export, artifact, proof

    def verify(self, descriptor, run, export, artifact, proof):
        data = zipped_proof(proof)
        artifact = {'digest': 'sha256:' + archive.core.sha256(data), **artifact}
        listing = {'total_count': 1, 'artifacts': [artifact]}
        with patch.object(archive.core, 'api', side_effect=[run, export, listing]) as api, patch.object(archive, 'download_proof', side_effect=AssertionError('host download forbidden')):
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
            with patch.dict(archive.os.environ, {'GITHUB_TOKEN': 'test-only', 'RUNNER_TEMP': root}), patch.object(archive.importlib.util, 'spec_from_file_location', return_value=SimpleNamespace(loader=loader)), patch.object(archive.importlib.util, 'module_from_spec', return_value=producer), patch.object(archive, 'publication_artifact', return_value=(artifact, 1)), patch.object(archive, 'download_proof', return_value=data), patch.object(archive, 'verify_publication_proof') as verify:
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


if __name__ == '__main__':
    unittest.main()
