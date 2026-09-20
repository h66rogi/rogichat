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


def fixture(directory):
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
            with patch.object(archive.core, 'api', side_effect=[run, artifact, compare]), patch.object(archive.core, 'verify_source') as verify:
                archive.verify_provenance(descriptor, approval)
                verify.assert_called_once()
            wrong = {**run, 'path': '.github/workflows/backend-export.yml'}
            with patch.object(archive.core, 'api', return_value=wrong):
                with self.assertRaises(ValueError):
                    archive.verify_provenance(descriptor, approval)
            with patch.object(archive.core, 'api', side_effect=[run, {**artifact, 'digest': 'sha256:' + 'd' * 64}]):
                with self.assertRaises(ValueError):
                    archive.verify_provenance(descriptor, approval)


if __name__ == '__main__':
    unittest.main()
