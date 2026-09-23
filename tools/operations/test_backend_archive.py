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


def build(directory, version=1, decoder_settings=None):
    directory.mkdir()
    source = 'a' * 40
    layer = b'synthetic layer bytes'
    descriptor = {'version': version, 'repository': archive.REPOSITORY, 'source_sha': source,
                  'producer': {'sha': 'd' * 40, 'run_id': 10, 'run_attempt': 1,
                               'event': 'workflow_dispatch', 'ref': 'refs/heads/qa'},
                  'verification_runs': {workflow: i + 1 for i, workflow in enumerate(sorted(archive.WORKFLOWS))},
                  'images': {}}
    for role, repo in archive.descriptor_roles(descriptor).items():
        config = {'architecture': 'amd64', 'os': 'linux', 'config': {'User': '10001:10001',
                  'Entrypoint': ['node'], 'Labels': {'org.opencontainers.image.source': archive.SOURCE,
                  'org.opencontainers.image.revision': source}, 'Env': ['NODE_ENV=production']},
                  'rootfs': {'type': 'layers', 'diff_ids': ['sha256:' + archive.sha256(layer)]}}
        if role == 'decoder':
            config['config'].update({'Cmd': ['dist/media-decoder-main.js'], 'WorkingDir': '/app/apps/api'})
            config['config'].update(decoder_settings or {})
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


def oci_tar(root, descriptor, *, mutate=None, role='runtime'):
    identity = descriptor['images'][role]['config_id']
    with tarfile.open(root / (role + '.tar')) as tar:
        config = tar.extractfile(identity[7:] + '.json').read()
    layer = gzip.compress(b'synthetic layer bytes')
    config_name = 'blobs/sha256/' + identity[7:]
    layer_name = 'blobs/sha256/' + archive.sha256(layer)
    manifest = {'schemaVersion': 2, 'mediaType': 'application/vnd.oci.image.manifest.v1+json',
                'config': {'mediaType': 'application/vnd.oci.image.config.v1+json', 'digest': identity, 'size': len(config)},
                'layers': [{'mediaType': 'application/vnd.oci.image.layer.v1.tar+gzip',
                            'digest': 'sha256:' + archive.sha256(layer), 'size': len(layer)}]}
    if mutate == 'config':
        manifest['config']['digest'] = 'sha256:' + 'f' * 64
    if mutate == 'layer':
        manifest['layers'][0]['digest'] = 'sha256:' + 'e' * 64
    raw = json.dumps(manifest).encode()
    reference = {'mediaType': manifest['mediaType'], 'digest': 'sha256:' + archive.sha256(raw), 'size': len(raw)}
    index = {'schemaVersion': 2, 'mediaType': 'application/vnd.oci.image.index.v1+json', 'manifests': [reference]}
    if mutate == 'multiple':
        index['manifests'].append(reference)
    if mutate == 'raw_hash':
        raw += b'altered'
    with tarfile.open(root / (role + '.tar'), 'w') as tar:
        for name, data in [(config_name, config), (layer_name, layer), ('index.json', json.dumps(index).encode()),
             ('oci-layout', b'{"imageLayoutVersion":"1.0.0"}'), ('blobs/sha256/' + reference['digest'][7:], raw),
             ('manifest.json', json.dumps([{'Config': config_name, 'Layers': [layer_name], 'RepoTags': None}]).encode())]:
            item = tarfile.TarInfo(name)
            item.size = len(data)
            tar.addfile(item, io.BytesIO(data))
    return reference


class ArchiveTests(unittest.TestCase):
    def test_v2_decoder_full_chain_and_closed_roles(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            descriptor = build(root / 'input', version=2)
            digest = zip_directory(root / 'input', root / 'export.zip')
            actual, configs = archive.validate_zip(root / 'export.zip', digest, root / 'verified')
            self.assertEqual(actual, descriptor)
            self.assertEqual(set(configs), {'runtime', 'migration', 'decoder'})
            self.assertEqual(len(archive.descriptor_files(descriptor)), 7)
            for version in [1, True, 3, '2']:
                with self.subTest(version=version), self.assertRaises(ValueError):
                    archive.validate_descriptor({**descriptor, 'version': version})
            for role in ['runtime', 'migration', 'decoder']:
                bad = copy.deepcopy(descriptor)
                del bad['images'][role]
                with self.assertRaises(ValueError):
                    archive.validate_descriptor(bad)
            bad = copy.deepcopy(descriptor)
            bad['images']['decoder']['image'] = bad['images']['runtime']['image']
            with self.assertRaises(ValueError):
                archive.validate_descriptor(bad)

    def test_decoder_oci_execution_identity_is_bound_independently(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / 'input'
            descriptor = build(root, version=2)
            reference = oci_tar(root, descriptor, role='decoder')
            descriptor['images']['decoder']['archive_sha256'] = archive.file_hash(root / 'decoder.tar')
            (root / 'descriptor.json').write_text(json.dumps(descriptor))
            _, configs = archive.validate_directory(root)
            self.assertEqual(configs['decoder']['_archive_manifest'], reference)
            self.assertNotEqual(reference['digest'], descriptor['images']['decoder']['config_id'])

    def test_decoder_tar_manifest_missing_extra_and_execution_contract_rejected(self):
        for attack in ['tar', 'manifest', 'missing', 'extra', 'cmd', 'directory', 'env']:
            with self.subTest(attack=attack), tempfile.TemporaryDirectory() as temp:
                root = Path(temp) / 'input'
                settings = {'cmd': {'Cmd': ['dist/worker.js']}, 'directory': {'WorkingDir': '/workspace'},
                            'env': {'Env': ['DATABASE_URL=fixture']}}.get(attack)
                build(root, version=2, decoder_settings=settings)
                if attack in ('tar', 'manifest'):
                    target = root / ('decoder.tar' if attack == 'tar' else 'decoder.manifest.json')
                    target.write_bytes(target.read_bytes() + b'changed')
                elif attack == 'missing':
                    (root / 'decoder.tar').unlink()
                elif attack == 'extra':
                    (root / 'other.tar').write_bytes(b'extra')
                with self.assertRaises(ValueError):
                    archive.validate_directory(root)

    def test_web_override_remains_v1_with_exact_custom_files(self):
        with patch.object(archive, 'ROLES', {'runtime': 'rogichat-web'}), \
                patch.object(archive, 'FILES', {'descriptor.json', 'runtime.tar', 'runtime.manifest.json', 'publication-proof.zip'}):
            self.assertEqual(archive.descriptor_roles({'version': 1}), {'runtime': 'rogichat-web'})
            self.assertEqual(archive.descriptor_files({'version': 1}), archive.FILES)
            with self.assertRaises(ValueError):
                archive.descriptor_roles({'version': 2})

    def test_backend_defaults_remain_manual_only(self):
        with tempfile.TemporaryDirectory() as temp:
            descriptor = build(Path(temp) / 'archive')
            descriptor['producer']['event'] = 'workflow_run'
            with self.assertRaises(ValueError):
                archive.validate_descriptor(descriptor)
            self.assertEqual(archive.validate_descriptor(descriptor, producer_events=frozenset({'workflow_run'})), descriptor)
            approval = {'export_sha': 'd' * 40, 'export_run': 10, 'export_attempt': 1}
            automatic = {'head_sha': 'd' * 40, 'head_branch': 'qa', 'event': 'workflow_run'}
            with patch.object(archive, 'api', return_value=automatic), self.assertRaises(ValueError):
                archive.verify_provenance(descriptor, approval)
        env = {'EXPORT_SOURCE_SHA': 'a' * 40, 'GITHUB_SHA': 'b' * 40,
               'GITHUB_REPOSITORY': archive.REPOSITORY, 'GITHUB_REF': 'refs/heads/qa',
               'GITHUB_EVENT_NAME': 'workflow_run'}
        with patch.dict(archive.os.environ, env), patch.object(archive, 'api') as api, self.assertRaises(ValueError):
            archive.produce()
        api.assert_not_called()

    def test_supplied_runs_are_independently_verified_before_pull(self):
        env = {'EXPORT_SOURCE_SHA': 'a' * 40, 'GITHUB_SHA': 'b' * 40,
               'GITHUB_REPOSITORY': archive.REPOSITORY, 'GITHUB_REF': 'refs/heads/qa',
               'GITHUB_EVENT_NAME': 'workflow_dispatch', 'GITHUB_TOKEN': 'test-only'}
        runs = {workflow: i + 1 for i, workflow in enumerate(sorted(archive.WORKFLOWS))}
        invalid = {'head_sha': 'c' * 40}
        with patch.dict(archive.os.environ, env), patch.object(archive, 'api', return_value=invalid) as api, patch.object(archive, 'command') as command, self.assertRaises(ValueError):
            archive.produce(verification_runs=runs)
        api.assert_called_once_with('actions/runs/1', 'test-only')
        command.assert_not_called()
        with patch.dict(archive.os.environ, env), self.assertRaises(ValueError):
            archive.produce(expected_event='workflow_run', verification_runs=runs)

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
            reference = oci_tar(root, descriptor)
            config = archive.verify_tar(root / 'runtime.tar', descriptor['images']['runtime']['config_id'], descriptor['source_sha'])
            self.assertEqual(config['_archive_manifest'], reference)

    def test_oci_index_manifest_config_layer_chain_rejects_tampering(self):
        for mutate in ['config', 'layer', 'multiple', 'raw_hash']:
            with self.subTest(mutate=mutate), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary) / 'input'
                descriptor = build(root)
                oci_tar(root, descriptor, mutate=mutate)
                with self.assertRaises(ValueError):
                    archive.verify_tar(root / 'runtime.tar', descriptor['images']['runtime']['config_id'], descriptor['source_sha'])

    def test_typed_containerd_identity_requires_manifest_descriptor_no_fallback(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / 'input'
            descriptor = build(root)
            reference = oci_tar(root, descriptor)
            expected = descriptor['images']['runtime']
            config = archive.verify_tar(root / 'runtime.tar', expected['config_id'], descriptor['source_sha'])
        approval = {'execution_identity': 'archive-manifest', 'runtime_config_id': expected['config_id'],
                    'runtime_execution_id': reference['digest']}
        data = {'Id': reference['digest'], 'Descriptor': reference, 'Architecture': 'amd64', 'Os': 'linux',
                'Config': config['config'], 'RootFS': {'Layers': config['rootfs']['diff_ids']}}
        release.verify_archive_image_data(data, expected, config, descriptor['source_sha'], approval, 'runtime')
        for field, value in [('Id', expected['config_id']), ('Descriptor', None),
                             ('Descriptor', {**reference, 'digest': 'sha256:' + '0' * 64})]:
            with self.assertRaises(ValueError):
                release.verify_archive_image_data({**data, field: value}, expected, config, descriptor['source_sha'], approval, 'runtime')
        with self.assertRaises(ValueError):
            release.verify_archive_image_data(data, expected, config, descriptor['source_sha'],
                                             {**approval, 'execution_identity': 'config'}, 'runtime')

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

    def test_expected_zip_filename_symlink_rejected_with_exact_entry_count(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            build(root / 'input')
            with zipfile.ZipFile(root / 'export.zip', 'w') as zipped:
                for item in (root / 'input').iterdir():
                    if item.name == 'runtime.tar':
                        link = zipfile.ZipInfo(item.name)
                        link.external_attr = 0o120777 << 16
                        zipped.writestr(link, '/etc/passwd')
                    else:
                        zipped.write(item, item.name)
            with self.assertRaises(ValueError):
                archive.validate_zip(root / 'export.zip', 'sha256:' + archive.file_hash(root / 'export.zip'), root / 'output')
            self.assertFalse((root / 'output/runtime.tar').exists())

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
                              'migration_config_id': 'sha256:' + 'e' * 64, 'validator_sha256': 'f' * 64,
                              'execution_identity': 'config', 'runtime_execution_id': 'sha256:' + 'd' * 64,
                              'migration_execution_id': 'sha256:' + 'e' * 64}
        release.validate_request(request)
        self.assertEqual(release.execution_image(request, 'runtime'), 'sha256:' + 'd' * 64)
        with patch.object(release, 'verify_archive_images') as offline, patch.object(release, 'verify_image') as registry:
            release.verify_release_images(request)
            offline.assert_called_once_with(request)
            registry.assert_not_called()
        for field, value in [('export_attempt', True), ('artifact_sha256', 'bad'), ('runtime_config_id', 'latest'),
                             ('execution_identity', 'auto'), ('runtime_execution_id', 'sha256:' + 'c' * 64)]:
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
