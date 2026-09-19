"""Synthetic archive/provenance tests; no Docker, credentials, cloud or host writes."""
import copy
import gzip
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch
import zipfile

import backend_archive as archive
import backend_release as release
from test_backend_release import fixture as request_fixture


def build(directory):
    directory.mkdir()
    source = 'a' * 40
    layer = b'synthetic layer bytes'
    descriptor = {'version': 1, 'repository': archive.REPOSITORY, 'source_sha': source,
                  'producer': {'sha': 'd' * 40, 'run_id': 10, 'run_attempt': 1,
                               'event': 'workflow_dispatch', 'ref': 'refs/heads/qa'},
                  'verification_runs': {workflow: i + 1 for i, workflow in enumerate(sorted(archive.WORKFLOWS))},
                  'images': {}}
    for role, repo in archive.ROLES.items():
        config = {'architecture': 'amd64', 'os': 'linux', 'config': {'User': '10001:10001',
                  'Entrypoint': ['node'], 'Labels': {'org.opencontainers.image.source': archive.SOURCE,
                  'org.opencontainers.image.revision': source}, 'Env': ['NODE_ENV=production']},
                  'rootfs': {'type': 'layers', 'diff_ids': ['sha256:' + archive.sha256(layer)]}}
        raw = json.dumps(config).encode()
        identity = archive.sha256(raw)
        docker_manifest = json.dumps([{'Config': identity + '.json', 'RepoTags': None, 'Layers': ['layer/layer.tar']}]).encode()
        with tarfile.open(directory / (role + '.tar'), 'w') as tar:
            for name, data in [(identity + '.json', raw), ('layer/layer.tar', layer), ('manifest.json', docker_manifest)]:
                member = tarfile.TarInfo(name)
                member.size = len(data)
                tar.addfile(member, io.BytesIO(data))
        manifest = json.dumps({'schemaVersion': 2, 'mediaType': 'application/vnd.oci.image.manifest.v1+json',
                               'config': {'digest': 'sha256:' + identity}, 'layers': [{}]}).encode()
        (directory / (role + '.manifest.json')).write_bytes(manifest)
        descriptor['images'][role] = {'image': 'ghcr.io/h66rogi/' + repo + '@sha256:' + archive.sha256(manifest),
                                     'config_id': 'sha256:' + identity,
                                     'archive_sha256': archive.file_hash(directory / (role + '.tar'))}
    (directory / 'descriptor.json').write_text(json.dumps(descriptor))
    return descriptor


def zip_directory(directory, path):
    with zipfile.ZipFile(path, 'w') as zipped:
        for item in directory.iterdir():
            zipped.write(item, item.name)
    return 'sha256:' + archive.file_hash(path)


class ArchiveTests(unittest.TestCase):
    def test_complete_crypto_chain(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary)
            descriptor = build(path / 'input')
            digest = zip_directory(path / 'input', path / 'export.zip')
            actual, configs = archive.validate_zip(path / 'export.zip', digest, path / 'verified')
            self.assertEqual(actual, descriptor)
            self.assertEqual(configs['runtime']['config']['User'], '10001:10001')

    def test_oci_blob_layout_with_compressed_layer(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / 'input'
            descriptor = build(root)
            identity = descriptor['images']['runtime']['config_id']
            with tarfile.open(root / 'runtime.tar') as tar:
                config = tar.extractfile(identity[7:] + '.json').read()
            layer = gzip.compress(b'synthetic layer bytes')
            config_name = 'blobs/sha256/' + identity[7:]
            layer_name = 'blobs/sha256/' + archive.sha256(layer)
            with tarfile.open(root / 'runtime.tar', 'w') as tar:
                for name, data in [(config_name, config), (layer_name, layer), ('manifest.json',
                     json.dumps([{'Config': config_name, 'Layers': [layer_name], 'RepoTags': None}]).encode())]:
                    item = tarfile.TarInfo(name)
                    item.size = len(data)
                    tar.addfile(item, io.BytesIO(data))
            archive.verify_tar(root / 'runtime.tar', identity, descriptor['source_sha'])

    def test_changed_layer_rejected_even_with_valid_tar_container(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / 'input'
            descriptor = build(root)
            path = root / 'runtime.tar'
            path.write_bytes(path.read_bytes().replace(b'synthetic layer bytes', b'malicious layer bytes'))
            with self.assertRaises(ValueError):
                archive.verify_tar(path, descriptor['images']['runtime']['config_id'], descriptor['source_sha'])

    def test_artifact_digest_mismatch_rejected_before_extract(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary)
            build(path / 'input')
            zip_directory(path / 'input', path / 'export.zip')
            with self.assertRaises(ValueError):
                archive.validate_zip(path / 'export.zip', 'sha256:' + '0' * 64, path / 'verified')
            self.assertFalse((path / 'verified').exists())

    def test_registry_manifest_archive_or_config_tamper_rejected(self):
        for target in ['runtime.tar', 'runtime.manifest.json']:
            with self.subTest(target=target), tempfile.TemporaryDirectory() as temporary:
                path = Path(temporary) / 'input'
                build(path)
                with (path / target).open('ab') as output:
                    output.write(b'altered')
                with self.assertRaises(ValueError):
                    archive.validate_directory(path)

    def test_config_label_environment_and_layer_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'input'
            descriptor = build(path)
            _, configs = archive.validate_directory(path)
            for mutate in ['source', 'env', 'architecture']:
                bad = copy.deepcopy(configs['runtime'])
                if mutate == 'source':
                    bad['config']['Labels']['org.opencontainers.image.revision'] = 'f' * 40
                elif mutate == 'env':
                    bad['config']['Env'].append('DATABASE_URL=fixture')
                else:
                    bad['architecture'] = 'arm64'
                with self.assertRaises(ValueError):
                    archive.validate_config(bad, descriptor['source_sha'])

    def test_zip_paths_symlinks_duplicates_rejected(self):
        for attack in ['path', 'link', 'duplicate']:
            with self.subTest(attack=attack), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                build(root / 'input')
                zip_directory(root / 'input', root / 'export.zip')
                with zipfile.ZipFile(root / 'export.zip', 'a') as zipped:
                    if attack == 'path':
                        zipped.writestr('../escape', 'bad')
                    elif attack == 'link':
                        item = zipfile.ZipInfo('link')
                        item.external_attr = 0o120777 << 16
                        zipped.writestr(item, '/etc/passwd')
                    else:
                        zipped.writestr('descriptor.json', '{}')
                with self.assertRaises(ValueError):
                    archive.validate_zip(root / 'export.zip', 'sha256:' + archive.file_hash(root / 'export.zip'), root / 'output')

    def test_tar_link_and_layer_hash_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / 'input'
            descriptor = build(root)
            with tarfile.open(root / 'runtime.tar', 'a') as tar:
                item = tarfile.TarInfo('link')
                item.type = tarfile.SYMTYPE
                item.linkname = '/etc/passwd'
                tar.addfile(item)
            with self.assertRaises(ValueError):
                archive.verify_tar(root / 'runtime.tar', descriptor['images']['runtime']['config_id'], descriptor['source_sha'])

    def test_exact_trusted_run_only(self):
        good = {'head_sha': 'a' * 40, 'head_branch': 'qa', 'event': 'workflow_dispatch', 'status': 'completed',
                'conclusion': 'success', 'repository': {'full_name': archive.REPOSITORY},
                'head_repository': {'full_name': archive.REPOSITORY}, 'path': '.github/workflows/backend-export.yml'}
        archive.verify_run(good, 'a' * 40, 'backend-export.yml', 'workflow_dispatch')
        for field, value in [('event', 'pull_request'), ('head_sha', 'b' * 40), ('conclusion', 'failure'),
                             ('head_branch', 'main'), ('path', '.github/workflows/other.yml')]:
            with self.assertRaises(ValueError):
                archive.verify_run({**good, field: value}, 'a' * 40, 'backend-export.yml', 'workflow_dispatch')

    def test_provenance_binds_exact_artifact_attempt_and_ancestry(self):
        with tempfile.TemporaryDirectory() as temporary:
            descriptor = build(Path(temporary) / 'input')
        approval = {'export_sha': 'd' * 40, 'export_run': 10, 'export_attempt': 1,
                    'artifact_id': 20, 'artifact_sha256': 'sha256:' + 'e' * 64}
        run = {'head_sha': 'd' * 40, 'head_branch': 'qa', 'event': 'workflow_dispatch', 'status': 'completed',
               'conclusion': 'success', 'repository': {'full_name': archive.REPOSITORY}, 'run_attempt': 1,
               'head_repository': {'full_name': archive.REPOSITORY}, 'path': '.github/workflows/backend-export.yml'}
        artifact = {'expired': False, 'digest': approval['artifact_sha256'],
                    'workflow_run': {'id': 10, 'head_sha': 'd' * 40}, 'name': 'backend-' + 'a' * 40 + '-10-1'}
        compare = {'status': 'ahead', 'merge_base_commit': {'sha': 'a' * 40}}
        with patch.object(archive, 'api', side_effect=[run, artifact, compare]), patch.object(archive, 'verify_source'):
            archive.verify_provenance(descriptor, approval)
        for field, value in [('expired', True), ('digest', 'sha256:' + 'f' * 64), ('name', 'other')]:
            with patch.object(archive, 'api', side_effect=[run, {**artifact, field: value}, compare]), \
                    patch.object(archive, 'verify_source'), self.assertRaises(ValueError):
                archive.verify_provenance(descriptor, approval)
        with patch.object(archive, 'api', side_effect=[{**run, 'run_attempt': 2}]), \
                patch.object(archive, 'verify_source'), self.assertRaises(ValueError):
            archive.verify_provenance(descriptor, approval)

    def test_archive_request_explicit_and_closed(self):
        request = request_fixture()
        request['archive'] = {'export_sha': 'b' * 40, 'export_run': 10, 'export_attempt': 1, 'artifact_id': 20,
                              'artifact_sha256': 'sha256:' + 'c' * 64, 'runtime_config_id': 'sha256:' + 'd' * 64,
                              'migration_config_id': 'sha256:' + 'e' * 64, 'validator_sha256': 'f' * 64}
        release.validate_request(request)
        self.assertEqual(release.execution_image(request, 'runtime'), 'sha256:' + 'd' * 64)
        with patch.object(release, 'verify_archive_images') as offline, patch.object(release, 'verify_image') as registry:
            release.verify_release_images(request)
            offline.assert_called_once_with(request)
            registry.assert_not_called()
        for field, value in [('export_attempt', True), ('artifact_sha256', 'bad'), ('runtime_config_id', 'latest')]:
            broken = copy.deepcopy(request)
            broken['archive'][field] = value
            with self.assertRaises(ValueError):
                release.validate_request(broken)

    def test_registry_mode_preserved_without_archive_fallback(self):
        request = request_fixture()
        self.assertEqual(release.execution_image(request, 'runtime'), request['runtime_image'])
        with patch.object(release, 'verify_image', side_effect=release.Rejected()), \
                patch.object(release, 'verify_archive_images') as fallback:
            with self.assertRaises(ValueError):
                release.verify_release_images(request)
            fallback.assert_not_called()


if __name__ == '__main__':
    unittest.main()
