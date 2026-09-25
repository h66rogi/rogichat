"""Synthetic temporary files only; no Docker, network, host configuration or DB."""
import copy
from contextlib import ExitStack, redirect_stderr, redirect_stdout
import io
import json
from pathlib import Path
import subprocess
import tempfile
import time
import unittest
import stat
from types import SimpleNamespace
from unittest.mock import ANY, patch

import backend_release as release


def fixture():
    return {
        'environment': 'qa', 'source_sha': 'a' * 40,
        'runtime_image': 'ghcr.io/h66rogi/rogichat-api@sha256:' + 'b' * 64,
        'migration_image': 'ghcr.io/h66rogi/rogichat-api-migration@sha256:' + 'c' * 64,
        'edge_network': 'rogichat-qa_default', 'database_host_sha256': 'd' * 64,
        'previous_caddy_sha256': 'e' * 64,
        'artifacts': {key: 'f' * 64 for key in release.ARTIFACTS},
        'migrations': [{'name': '20260919171609_m02_foundation', 'checksum': '1' * 64}],
        'verification_runs': {key: 1 for key in release.WORKFLOWS},
        'request_id': 'e0cad8e6-b2f9-418e-9a7c-b01a0e377c91', 'expires_at': int(time.time()) + 300,
    }


def media_fixture():
    value = fixture()
    value['features'] = ['media']
    value['decoder_image'] = 'ghcr.io/h66rogi/rogichat-media-decoder@sha256:' + '2' * 64
    value['artifacts']['feature_media'] = '3' * 64
    value['archive'] = {
        'export_sha': value['source_sha'], 'export_run': 1, 'export_attempt': 1,
        'artifact_id': 1, 'artifact_sha256': 'sha256:' + '4' * 64,
        'runtime_config_id': 'sha256:' + '5' * 64,
        'migration_config_id': 'sha256:' + '6' * 64,
        'decoder_config_id': 'sha256:' + '7' * 64,
        'runtime_execution_id': 'sha256:' + '5' * 64,
        'migration_execution_id': 'sha256:' + '6' * 64,
        'decoder_execution_id': 'sha256:' + '7' * 64,
        'validator_sha256': '8' * 64, 'execution_identity': 'config',
    }
    return value


def no_ddl_fixture():
    value = media_fixture()
    value.update(migration_policy='verify-only', schema_sha256='9' * 64,
                 probe_sha256='a' * 64, ca_sha256='b' * 64,
                 previous={'source_sha': 'c' * 40,
                           'runtime_id': 'sha256:' + 'd' * 64,
                           'decoder_id': 'sha256:' + 'e' * 64})
    value['artifacts']['schema_manifest'] = 'f' * 64
    return value


def ready_container(role='api'):
    request = fixture()
    return {'Name': '/rogichat-qa-' + role, 'Config': {'Image': request['runtime_image']},
            'Image': request['runtime_image'],
            'HostConfig': {'PortBindings': {}, 'PublishAllPorts': False, 'NetworkMode': request['edge_network']},
            'NetworkSettings': {'Networks': {request['edge_network']: {}}},
            'State': {'Status': 'running', 'Running': True, 'Paused': False, 'OOMKilled': False,
                      'Health': {'Status': 'healthy'}}}


class RequestTests(unittest.TestCase):
    def test_no_ddl_request_is_manual_legacy_media_only_and_fully_pinned(self):
        value = no_ddl_fixture()
        self.assertIs(release.validate_request(value), value)
        for change in ('missing_schema', 'missing_probe', 'missing_previous', 'wrong_workflows',
                       'no_media', 'no_archive', 'unknown_mode', 'missing_manifest'):
            bad = copy.deepcopy(value)
            if change == 'missing_schema':
                del bad['schema_sha256']
            elif change == 'missing_probe':
                del bad['probe_sha256']
            elif change == 'missing_previous':
                del bad['previous']['decoder_id']
            elif change == 'wrong_workflows':
                bad['verification_runs'] = {name: 1 for name in release.NEW_WORKFLOWS}
            elif change == 'no_media':
                bad['features'] = []
            elif change == 'no_archive':
                del bad['archive']
            elif change == 'unknown_mode':
                bad['migration_policy'] = 'deploy'
            else:
                del bad['artifacts']['schema_manifest']
            with self.subTest(change=change), self.assertRaises((ValueError, KeyError)):
                release.validate_request(bad)

    def test_no_ddl_schema_manifest_rejects_code_and_migration_drift(self):
        manifest = (Path(__file__).parents[2] /
                    release.SCHEMA_MANIFEST).read_bytes()
        rows = release.parse_schema_manifest(manifest)
        self.assertEqual(len(rows), 48)
        for candidate in (manifest + b'\nprocess.exit(0)',
                          manifest.replace(rows[0]['checksum'].encode(), b'0' * 64, 1),
                          b'export const migrationManifest = []'):
            if candidate == manifest:
                continue
            with self.subTest(candidate=candidate[:40]), self.assertRaises((ValueError, UnicodeDecodeError)):
                if candidate.startswith(b'export const migrationManifest = []'):
                    release.parse_schema_manifest(candidate)
                else:
                    parsed = release.parse_schema_manifest(candidate)
                    release.require(parsed == rows)

    def test_no_ddl_activation_uses_existing_media_health_without_migrator(self):
        value = no_ddl_fixture()
        files = {'bootstrap': b'bootstrap', 'compose': b'compose',
                 'feature_media': b'media', 'unit': b'unit', 'caddy': b'caddy'}

        class Response:
            status = 200
            def __init__(self, url): self.url = url
            def __enter__(self): return self
            def __exit__(self, *_): return False
            def geturl(self): return self.url

        class ForbiddenInput:
            def read(self, *_): raise AssertionError('migrator stdin read')

        with tempfile.TemporaryDirectory() as root, ExitStack() as stack:
            events = []
            stack.enter_context(patch.object(release, 'RELEASES', Path(root)))
            stack.enter_context(patch.object(release, 'verify_no_ddl_candidate'))
            head = stack.enter_context(patch.object(release, 'verify_qa_head'))
            stack.enter_context(patch.object(release, 'verify_previous_runtime'))
            probe = stack.enter_context(patch.object(release, 'readonly_schema_probe'))
            stack.enter_context(patch.object(release, 'protected', return_value=b'previous'))
            written = stack.enter_context(patch.object(release, 'atomic'))
            sync = stack.enter_context(patch.object(release, 'fsync_directory'))
            caddy = stack.enter_context(patch.object(release, 'caddy_config'))
            stops = stack.enter_context(patch.object(release, 'run'))
            start = stack.enter_context(patch.object(release, 'start_units'))
            health = stack.enter_context(patch.object(release, 'wait_health'))
            stack.enter_context(patch.object(release, 'compose_requires_vapid', return_value=False))
            stack.enter_context(patch.object(release, 'get_caddy', return_value='caddy-id'))
            stack.enter_context(patch.object(release.urllib.request, 'urlopen', side_effect=lambda url, timeout: Response(url)))
            stack.enter_context(patch.object(release, 'cleanup_migration', side_effect=AssertionError('migrator cleanup')))
            stack.enter_context(patch.object(release, 'docker', side_effect=AssertionError('migrator or image mutation')))
            stack.enter_context(patch.object(release.sys, 'stdin', SimpleNamespace(buffer=ForbiddenInput())))
            written.side_effect = lambda path, *_: events.append('consumed' if path.name == 'consumed.json' else 'write')
            sync.side_effect = lambda *_: events.append('fsync')
            head.side_effect = lambda *_: events.append('head')
            caddy.side_effect = lambda *_: events.append('caddy')
            release.deploy_no_ddl(value, files, 'caddy-id')
            self.assertEqual(events[events.index('consumed'):events.index('caddy') + 1],
                             ['consumed', 'fsync', 'fsync', 'head', 'caddy'])
            self.assertEqual([call.args[0] for call in sync.call_args_list],
                             [Path(root) / ('backup-' + value['request_id']), Path(root)])
            self.assertEqual(probe.call_count, 2)
            self.assertEqual(head.call_count, 2)
            self.assertEqual([call.args[0][-1] for call in stops.call_args_list],
                             ['rogichat-app@decoder', 'rogichat-app@worker', 'rogichat-app@api'])
            start.assert_called_once_with(b'bootstrap', value)
            health.assert_called_once_with(value)

    def test_no_ddl_baseline_rejects_stale_env_and_inactive_unit(self):
        value = no_ddl_fixture()
        previous = value['previous']
        expected = (f"ROGICHAT_API_IMAGE={previous['runtime_id']}\n"
                    f"ROGICHAT_WORKER_IMAGE={previous['runtime_id']}\n"
                    f"ROGICHAT_EDGE_NETWORK={value['edge_network']}\n"
                    f"ROGICHAT_DECODER_IMAGE={previous['decoder_id']}\n").encode()

        def inspect(*args):
            if args[0] == 'inspect':
                role = args[1].removeprefix('rogichat-qa-')
                image = previous['decoder_id'] if role == 'decoder' else previous['runtime_id']
                return json.dumps([{'Name': '/' + args[1], 'Image': image,
                    'Config': {'Image': image, 'Labels': {
                        'org.opencontainers.image.revision': previous['source_sha'],
                        'org.opencontainers.image.source': release.SOURCE}}}]).encode()
            image = args[2]
            return json.dumps([{'Id': image, 'Os': 'linux', 'Architecture': 'amd64',
                'Config': {'User': '10001:10001', 'Labels': {
                    'org.opencontainers.image.revision': previous['source_sha']}}}]).encode()

        with patch.object(release, 'protected', return_value=expected), \
                patch.object(release, 'run', return_value=b'active\n'), \
                patch.object(release, 'wait_health') as health, \
                patch.object(release, 'docker', side_effect=inspect):
            release.verify_previous_runtime(value)
            baseline = health.call_args.args[0]
            self.assertEqual(baseline['archive']['runtime_execution_id'], previous['runtime_id'])
            self.assertEqual(baseline['archive']['decoder_execution_id'], previous['decoder_id'])
        with patch.object(release, 'protected', return_value=expected + b'EXTRA=1\n'), \
                patch.object(release, 'run', side_effect=AssertionError('unit check after bad env')), \
                self.assertRaises(release.Rejected):
            release.verify_previous_runtime(value)
        with patch.object(release, 'protected', return_value=expected), \
                patch.object(release, 'run', side_effect=[b'active\n', b'inactive\n']), \
                patch.object(release, 'wait_health', side_effect=AssertionError('health after inactive')), \
                self.assertRaises(release.Rejected):
            release.verify_previous_runtime(value)

    def test_no_ddl_post_activation_schema_drift_fails_closed(self):
        value = no_ddl_fixture()
        files = {'bootstrap': b'bootstrap', 'compose': b'compose',
                 'feature_media': b'media', 'unit': b'unit', 'caddy': b'caddy'}
        with tempfile.TemporaryDirectory() as root, ExitStack() as stack:
            stack.enter_context(patch.object(release, 'RELEASES', Path(root)))
            stack.enter_context(patch.object(release, 'verify_no_ddl_candidate'))
            stack.enter_context(patch.object(release, 'verify_qa_head'))
            stack.enter_context(patch.object(release, 'verify_previous_runtime'))
            stack.enter_context(patch.object(release, 'readonly_schema_probe',
                                       side_effect=[None, release.Rejected('drift')]))
            stack.enter_context(patch.object(release, 'protected', return_value=b'previous'))
            stack.enter_context(patch.object(release, 'atomic'))
            stack.enter_context(patch.object(release, 'fsync_directory'))
            stack.enter_context(patch.object(release, 'caddy_config'))
            stack.enter_context(patch.object(release, 'run'))
            stack.enter_context(patch.object(release, 'start_units'))
            stack.enter_context(patch.object(release, 'wait_health'))
            stack.enter_context(patch.object(release, 'compose_requires_vapid', return_value=False))
            stack.enter_context(patch.object(release, 'get_caddy', return_value='caddy-id'))
            closed = stack.enter_context(patch.object(release, 'fail_closed'))
            with self.assertRaises(release.Rejected):
                release.deploy_no_ddl(value, files, 'caddy-id')
            closed.assert_called_once_with('caddy-id', b'bootstrap', value)

    def test_no_ddl_head_move_before_drain_consumes_request_but_keeps_incumbent(self):
        value = no_ddl_fixture()
        files = {'bootstrap': b'bootstrap', 'compose': b'compose',
                 'feature_media': b'media', 'unit': b'unit', 'caddy': b'caddy'}
        with tempfile.TemporaryDirectory() as root, ExitStack() as stack:
            stack.enter_context(patch.object(release, 'RELEASES', Path(root)))
            stack.enter_context(patch.object(release, 'verify_no_ddl_candidate'))
            stack.enter_context(patch.object(release, 'verify_previous_runtime'))
            stack.enter_context(patch.object(release, 'readonly_schema_probe'))
            stack.enter_context(patch.object(release, 'protected', return_value=b'previous'))
            writes = stack.enter_context(patch.object(release, 'atomic'))
            stack.enter_context(patch.object(release, 'fsync_directory'))
            stack.enter_context(patch.object(release, 'verify_qa_head', side_effect=release.Rejected('head moved')))
            caddy = stack.enter_context(patch.object(release, 'caddy_config'))
            stop = stack.enter_context(patch.object(release, 'run'))
            closed = stack.enter_context(patch.object(release, 'fail_closed'))
            with self.assertRaises(release.Rejected):
                release.deploy_no_ddl(value, files, 'caddy-id')
            self.assertTrue(any(call.args[0].name == 'consumed.json' for call in writes.call_args_list))
            caddy.assert_not_called()
            stop.assert_not_called()
            closed.assert_not_called()

    def test_event_publication_verification_requires_exact_aggregate(self):
        value = fixture()
        value['verification_runs'] = {name: index for index, name in enumerate(sorted(release.NEW_WORKFLOWS), 1)}
        self.assertIs(release.validate_request(value), value)
        publication_id = value['verification_runs']['qa-backend-publication.yml']
        responses = {f'actions/runs/{identity}': {
            'head_sha': value['source_sha'], 'head_branch': 'qa',
            'event': 'workflow_run' if name == 'qa-backend-publication.yml' else 'push',
            'status': 'completed', 'conclusion': 'success',
            'repository': {'full_name': 'h66rogi/rogichat'},
            'head_repository': {'full_name': 'h66rogi/rogichat'},
            'path': '.github/workflows/' + name,
            'name': 'QA backend image publication' if name == 'qa-backend-publication.yml' else name,
            'run_attempt': 2,
        } for name, identity in value['verification_runs'].items()}
        job_path = f'actions/runs/{publication_id}/attempts/2/jobs?per_page=100'
        responses[job_path] = {'total_count': 1, 'jobs': [{
            'name': 'Backend publication result', 'run_id': publication_id,
            'run_attempt': 2, 'status': 'completed', 'conclusion': 'success'}]}
        with patch.object(release, 'github_read', side_effect=lambda path: responses[path]):
            release.verify_ci(value)
            for change in ('wrong_event', 'wrong_sha', 'other_component', 'failed_job', 'wrong_attempt'):
                altered = copy.deepcopy(responses)
                if change == 'wrong_event':
                    altered[f'actions/runs/{publication_id}']['event'] = 'pull_request'
                elif change == 'wrong_sha':
                    altered[f'actions/runs/{publication_id}']['head_sha'] = 'f' * 40
                elif change == 'other_component':
                    altered[f'actions/runs/{publication_id}']['path'] = '.github/workflows/qa-web-publication.yml'
                elif change == 'failed_job':
                    altered[job_path]['jobs'][0]['conclusion'] = 'failure'
                else:
                    altered[job_path]['jobs'][0]['run_attempt'] = 1
                with self.subTest(change=change), patch.object(release, 'github_read',
                        side_effect=lambda path: altered[path]), self.assertRaises(release.Rejected):
                    release.verify_ci(value)

    def test_media_request_requires_exact_decoder_and_overlay(self):
        value = media_fixture()
        self.assertIs(release.validate_request(value), value)
        self.assertEqual(release.image_roles(value), ('runtime', 'migration', 'decoder'))
        self.assertEqual(release.service_roles(value), ('decoder', 'worker', 'api'))
        for remove in ('decoder_image', 'archive'):
            bad = copy.deepcopy(value)
            del bad[remove]
            with self.subTest(remove=remove), self.assertRaises(ValueError):
                release.validate_request(bad)
        for features in (['media', 'media'], ['native_push'], ['deletion'], ['Media']):
            bad = copy.deepcopy(value)
            bad['features'] = features
            with self.subTest(features=features), self.assertRaises(ValueError):
                release.validate_request(bad)
        bad = copy.deepcopy(value)
        del bad['artifacts']['feature_media']
        with self.assertRaises(ValueError):
            release.validate_request(bad)

    def test_media_secret_custody_and_shape_are_required(self):
        value = media_fixture()
        valid = {'accountId': 'a' * 32, 'bucket': 'rogichat-qa-media',
                 'accessKeyId': 'b' * 20, 'secretAccessKey': 'c' * 32}
        with patch.object(release, 'protected', return_value=json.dumps(valid).encode()) as protected, \
                patch.object(release, 'MEDIA_SECRET', SimpleNamespace(stat=lambda: SimpleNamespace(st_gid=10001))):
            release.verify_media_secret(value)
            protected.assert_called_once()
        for bad in ({**valid, 'bucket': 'not/qa'}, {**valid, 'secretAccessKey': 'short'}):
            with patch.object(release, 'protected', return_value=json.dumps(bad).encode()), \
                    patch.object(release, 'MEDIA_SECRET', SimpleNamespace(stat=lambda: SimpleNamespace(st_gid=10001))), \
                    self.assertRaises(ValueError):
                release.verify_media_secret(value)
        with patch.object(release, 'protected', return_value=json.dumps(valid).encode()), \
                patch.object(release, 'MEDIA_SECRET', SimpleNamespace(stat=lambda: SimpleNamespace(st_gid=0))), \
                self.assertRaises(ValueError):
            release.verify_media_secret(value)

    def test_media_failure_closes_decoder_with_api_and_worker(self):
        with patch.object(release, 'caddy_config', side_effect=release.Rejected()), \
                patch.object(release.Path, 'exists', return_value=True), \
                patch.object(release, 'run') as run, self.assertRaises(ValueError):
            release.fail_closed('fixture-container', b'fixture bootstrap', media_fixture())
        self.assertEqual([call.args[0][-1] for call in run.call_args_list],
                         ['rogichat-app@decoder', 'rogichat-app@worker', 'rogichat-app@api'])

    def test_media_health_requires_isolated_decoder_and_readonly_worker_socket(self):
        value = media_fixture()
        containers = {role: ready_container(role) for role in ('api', 'worker', 'decoder')}
        for role, item in containers.items():
            image = value['archive'][('decoder' if role == 'decoder' else 'runtime') + '_execution_id']
            item['Config']['Image'] = image
            item['Image'] = image
            if role == 'decoder':
                item['Config']['Env'] = ['DECODER_ISOLATED=true']
                item['HostConfig'].update(NetworkMode='none', ReadonlyRootfs=True)
                item['NetworkSettings']['Networks'] = {}
                item['Mounts'] = [{'Destination': '/run/decoder', 'Type': 'volume', 'RW': True}]
            else:
                item['Config']['Env'] = ['MEDIA_ENABLED=true', 'MEDIA_SECRET_FILE=/run/secrets/media.json',
                                         'MEDIA_SCRATCH_DIR=/media-scratch']
                item['Mounts'] = [{'Destination': '/run/secrets/media.json', 'Type': 'bind',
                                   'Source': str(release.MEDIA_SECRET), 'RW': False}]
                if role == 'worker':
                    item['Config']['Env'].append('MEDIA_DECODER_SOCKET=/run/decoder/image.sock')
                    item['Mounts'].append({'Destination': '/run/decoder', 'Type': 'volume', 'RW': False})
        with patch.object(release, 'inspect_starting_container', side_effect=lambda role, _: containers[role]):
            release.wait_health(value)
        containers['worker']['Mounts'][-1]['RW'] = True
        with patch.object(release, 'inspect_starting_container', side_effect=lambda role, _: containers[role]), \
                self.assertRaises(ValueError):
            release.wait_health(value)

    def test_migration_cleanup_failures_always_unlink_without_reflecting_details(self):
        name = 'rogichat-qa-migration-' + fixture()['request_id']
        detail = b'synthetic-private-diagnostic-do-not-print'
        failures = [subprocess.TimeoutExpired(['fixture'], 30, stderr=detail), OSError(detail.decode()),
                    SimpleNamespace(returncode=1, stderr=detail),
                    SimpleNamespace(returncode=2, stderr=('Error response from daemon: No such container: ' + name).encode()),
                    SimpleNamespace(returncode=1, stderr=b'Error response from daemon: No such container: unrelated'),
                    SimpleNamespace(returncode=1, stderr=('Error response from daemon: No such container: ' + name).encode() + b'\n' + detail)]
        for failure in failures:
            with self.subTest(failure=type(failure).__name__), tempfile.TemporaryDirectory() as directory:
                secret = Path(directory) / 'migration-fixture'
                secret.write_bytes(b'{}')
                output, error_output = io.StringIO(), io.StringIO()
                kwargs = {'side_effect': failure} if isinstance(failure, Exception) else {'return_value': failure}
                with patch.object(release.subprocess, 'run', **kwargs) as cleanup, \
                        redirect_stdout(output), redirect_stderr(error_output), self.assertRaises(release.Rejected) as error:
                    release.cleanup_migration(name, secret)
                self.assertFalse(secret.exists())
                self.assertNotIn(detail.decode(), str(error.exception) + output.getvalue() + error_output.getvalue())
                self.assertEqual(cleanup.call_args.args[0], ['/usr/bin/docker', 'rm', '-f', name])
                self.assertEqual(cleanup.call_args.kwargs['timeout'], 30)

    def test_migration_cleanup_accepts_success_or_only_exact_missing_and_is_idempotent(self):
        name = 'rogichat-qa-migration-' + fixture()['request_id']
        for result in [SimpleNamespace(returncode=0, stderr=b''), SimpleNamespace(returncode=1,
                       stderr=('Error response from daemon: No such container: ' + name + '\n').encode())]:
            with tempfile.TemporaryDirectory() as directory, patch.object(release.subprocess, 'run', return_value=result):
                secret = Path(directory) / 'migration-fixture'
                secret.write_bytes(b'{}')
                release.cleanup_migration(name, secret)
                release.cleanup_migration(name, secret)
                self.assertFalse(secret.exists())

    def test_cleanup_failure_blocks_activation_even_when_migration_or_rollback_fails(self):
        real_mkstemp = tempfile.mkstemp
        failures = [subprocess.TimeoutExpired(['fixture'], 30), OSError('fixture daemon unavailable'),
                    SimpleNamespace(returncode=1, stderr=b'fixture daemon unavailable')]
        cases = [(stage, failure) for stage in ('success', 'migration-failed', 'rollback-failed') for failure in failures]
        for stage, failure in cases:
            with self.subTest(stage=stage, failure=type(failure).__name__), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                kwargs = {'side_effect': failure} if isinstance(failure, Exception) else {'return_value': failure}
                migration = b'' if stage == 'success' else release.Rejected('fixture migration rejected')
                with patch.object(release, 'RELEASES', root), patch.object(release, 'APP', root / 'app'), \
                        patch.object(release, 'IMAGES', root / 'images'), patch.object(release, 'UNIT', root / 'unit'), \
                        patch.object(release, 'CADDY', root / 'caddy'), patch.object(release, 'atomic') as atomic, \
                        patch.object(release, 'caddy_config'), patch.object(release, 'docker', side_effect=[b'', migration]), \
                        patch.object(release, 'start_units') as start, patch.object(release, 'wait_health') as health, \
                        patch.object(release, 'fail_closed', side_effect=release.Rejected() if stage == 'rollback-failed' else None) as fail_closed, \
                        patch.object(release.sys, 'stdin', SimpleNamespace(buffer=io.BytesIO(b'{}'))), \
                        patch.object(release.tempfile, 'mkstemp', side_effect=lambda **_: real_mkstemp(prefix='migration-', dir=directory)), \
                        patch.object(release.os, 'fchown'), patch.object(release.subprocess, 'run', **kwargs) as cleanup, \
                        redirect_stdout(io.StringIO()) as output, self.assertRaises(release.Rejected):
                    release.deploy(fixture(), {'bootstrap': b'fixture'}, 'fixture-caddy')
                self.assertEqual(list(root.glob('migration-*')), [])
                self.assertEqual(cleanup.call_count, 2 if stage == 'success' else 1)
                fail_closed.assert_called_once_with('fixture-caddy', b'fixture', ANY)
                start.assert_not_called()
                health.assert_not_called()
                self.assertFalse(any(call.args[0].name == 'completed' for call in atomic.call_args_list))
                self.assertNotIn('verified', output.getvalue())

    def test_cancel_before_cleanup_entry_still_unlinks_and_prevents_activation(self):
        real_mkstemp = tempfile.mkstemp
        real_cleanup = release.cleanup_migration
        attempts = []
        def interrupted(name, secret):
            attempts.append(name)
            if len(attempts) == 1:
                raise release.Rejected('interrupted before cleanup entry')
            return real_cleanup(name, secret)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch.object(release, 'RELEASES', root), patch.object(release, 'APP', root / 'app'), \
                    patch.object(release, 'IMAGES', root / 'images'), patch.object(release, 'UNIT', root / 'unit'), \
                    patch.object(release, 'CADDY', root / 'caddy'), patch.object(release, 'atomic') as atomic, \
                    patch.object(release, 'caddy_config'), patch.object(release, 'docker', return_value=b''), \
                    patch.object(release, 'start_units') as start, patch.object(release, 'wait_health') as health, \
                    patch.object(release, 'fail_closed') as fail_closed, \
                    patch.object(release, 'cleanup_migration', side_effect=interrupted), \
                    patch.object(release.sys, 'stdin', SimpleNamespace(buffer=io.BytesIO(b'{}'))), \
                    patch.object(release.tempfile, 'mkstemp', side_effect=lambda **_: real_mkstemp(prefix='migration-', dir=directory)), \
                    patch.object(release.os, 'fchown'), patch.object(release.subprocess, 'run', return_value=SimpleNamespace(returncode=0, stderr=b'')), \
                    redirect_stdout(io.StringIO()), self.assertRaises(release.Rejected):
                release.deploy(fixture(), {'bootstrap': b'fixture'}, 'fixture-caddy')
            self.assertEqual(len(attempts), 2)
            self.assertEqual(list(root.glob('migration-*')), [])
            fail_closed.assert_called_once()
            start.assert_not_called()
            health.assert_not_called()
            self.assertFalse(any(call.args[0].name == 'completed' for call in atomic.call_args_list))

    def test_owned_stopped_desired_containers_created_before_unit_start(self):
        events = []
        def run(args, **_):
            events.append(args)
            return b'inactive\n' if '--property=ActiveState' in args else b''
        def container(role, _):
            item = ready_container(role)
            item['State'] = {'Status': 'exited', 'Running': False}
            item['Config']['Labels'] = {'com.docker.compose.project': 'rogichat-qa-app', 'com.docker.compose.service': role}
            return item
        with patch.object(release, 'protected', return_value=b'bootstrap'), patch.object(release, 'run', side_effect=run), \
                patch.object(release, 'inspect_starting_container', side_effect=container), \
                patch.object(release, 'docker', side_effect=lambda *args, **_: events.append(list(args))):
            release.start_units(b'bootstrap')
        create = next(i for i, args in enumerate(events) if 'create' in args)
        enable = [i for i, args in enumerate(events) if 'enable' in args]
        self.assertEqual(len(enable), 2)
        self.assertTrue(all(create < index for index in enable))
        reset = [i for i, args in enumerate(events) if 'reset-failed' in args]
        self.assertEqual([events[i][-1] for i in reset], ['rogichat-app@api', 'rogichat-app@worker'])
        for reset_index, enable_index in zip(reset, enable):
            self.assertTrue(create < reset_index < enable_index)
            self.assertEqual(events[reset_index][-1], events[enable_index][-1])
        self.assertEqual(events[create][-7:], ['create', '--force-recreate', '--no-build', '--pull', 'never', 'api', 'worker'])
        self.assertNotIn('--remove-orphans', events[create])
        self.assertNotIn('--renew-anon-volumes', events[create])

    def test_prepare_rejects_live_foreign_or_undrained_containers(self):
        for mutate in ('running', 'project', 'role', 'unit', 'caddy'):
            item = ready_container()
            item['State'] = {'Status': 'exited', 'Running': False}
            item['Config']['Labels'] = {'com.docker.compose.project': 'rogichat-qa-app', 'com.docker.compose.service': 'api'}
            if mutate == 'running':
                item['State'] = {'Status': 'running', 'Running': True}
            elif mutate == 'project':
                item['Config']['Labels']['com.docker.compose.project'] = 'rogichat-qa'
            elif mutate == 'role':
                item['Config']['Labels']['com.docker.compose.service'] = 'caddy'
            with self.subTest(mutate=mutate), patch.object(release, 'protected', return_value=b'other' if mutate == 'caddy' else b'bootstrap'), \
                    patch.object(release, 'run', return_value=b'active' if mutate == 'unit' else b'failed'), \
                    patch.object(release, 'inspect_starting_container', return_value=item), \
                    patch.object(release, 'docker') as docker, self.assertRaises(ValueError):
                release.prepare_containers(b'bootstrap')
            docker.assert_not_called()

    def test_only_exact_missing_owned_container_is_transient(self):
        result = SimpleNamespace(returncode=1, stdout=b'[]',
                                 stderr=b'Error response from daemon: No such container: rogichat-qa-api\n')
        with patch.object(release.subprocess, 'run', return_value=result):
            self.assertIsNone(release.inspect_starting_container('api', 10))
        for error in [b'permission denied', b'Cannot connect to Docker daemon',
                      b'Error response from daemon: No such container: unrelated']:
            result.stderr = error
            with patch.object(release.subprocess, 'run', return_value=result), self.assertRaises(ValueError):
                release.inspect_starting_container('api', 10)
        result = SimpleNamespace(returncode=0, stdout=json.dumps([ready_container()]).encode(), stderr=b'')
        with patch.object(release.subprocess, 'run', return_value=result):
            self.assertEqual(release.inspect_starting_container('api', 10)['Name'], '/rogichat-qa-api')
        result.stdout = json.dumps([ready_container('decoder')]).encode()
        with patch.object(release.subprocess, 'run', return_value=result):
            self.assertEqual(release.inspect_starting_container('decoder', 10)['Name'], '/rogichat-qa-decoder')

    def test_systemd_started_before_compose_create_waits_for_both_healthy(self):
        with patch.object(release, 'inspect_starting_container', side_effect=[ready_container(), None,
                          ready_container(), ready_container('worker')]) as inspect, patch.object(release.time, 'sleep') as sleep:
            release.wait_health(fixture())
            self.assertEqual(inspect.call_count, 4)
            sleep.assert_called_once()

    def test_created_container_without_attached_network_is_not_ready(self):
        created = ready_container()
        created['State'] = {'Status': 'created', 'Running': False}
        created['NetworkSettings']['Networks'] = {}
        with patch.object(release, 'inspect_starting_container', side_effect=[created, ready_container('worker'),
                          ready_container(), ready_container('worker')]), patch.object(release.time, 'sleep') as sleep:
            release.wait_health(fixture())
            sleep.assert_called_once()

    def test_startup_never_relaxes_image_ports_network_or_failed_container(self):
        for mutate in ('image', 'ports', 'network', 'exited', 'paused', 'oom', 'error'):
            bad = ready_container()
            if mutate == 'image':
                bad['Config']['Image'] = 'unapproved'
            elif mutate == 'ports':
                bad['State'] = {'Status': 'created', 'Running': False}
                bad['HostConfig']['PortBindings'] = {'3000/tcp': [{'HostPort': '3000'}]}
            elif mutate == 'network':
                bad['NetworkSettings']['Networks']['other'] = {}
            elif mutate == 'exited':
                bad['State'] = {'Status': 'exited', 'Running': False}
            elif mutate == 'paused':
                bad['State']['Paused'] = True
            elif mutate == 'oom':
                bad['State']['OOMKilled'] = True
            else:
                bad['State'] = {'Status': 'created', 'Running': False, 'Error': 'runtime create failed'}
            with self.subTest(mutate=mutate), patch.object(release, 'inspect_starting_container', return_value=bad), self.assertRaises(ValueError):
                release.wait_health(fixture())

    def test_missing_containers_still_fail_at_original_90_second_deadline(self):
        with patch.object(release.time, 'monotonic', side_effect=[0, 1, 2, 3, 4, 95]), \
                patch.object(release.time, 'sleep'), patch.object(release, 'inspect_starting_container', return_value=None) as inspect, \
                self.assertRaises(ValueError):
            release.wait_health(fixture())
        self.assertEqual(inspect.call_count, 2)

    def test_m02_auth_file_is_not_required_or_read(self):
        with patch.object(release, 'AUTH_SECRET') as secret, patch.object(release, 'docker') as docker:
            release.verify_auth_secret(b'services:\n  api:\n    image: fixture\n', fixture()['runtime_image'])
            secret.lstat.assert_not_called()
            docker.assert_not_called()

    def test_auth_marker_is_closed_to_wrong_path_or_duplicate(self):
        good = b'      AUTH_SECRET_FILE: /run/secrets/auth.json\n'
        self.assertTrue(release.compose_requires_auth(good))
        for bad in [good.replace(b'/run/secrets/', b'/tmp/'), good + good, b'AUTH_SECRET_FILE: /other']:
            with self.assertRaises(ValueError):
                release.compose_requires_auth(bad)

    def test_auth_metadata_requires_root_gid_mode_single_link_bounded_file(self):
        values = dict(st_mode=stat.S_IFREG | 0o440, st_uid=0, st_gid=10001, st_nlink=1, st_size=100)
        release.validate_auth_metadata(SimpleNamespace(**values))
        for field, value in [('st_uid', 10001), ('st_gid', 0), ('st_nlink', 2), ('st_size', 8193),
                             ('st_size', 0), ('st_mode', stat.S_IFREG | 0o644), ('st_mode', stat.S_IFLNK | 0o440)]:
            with self.subTest(field=field, value=value):
                with self.assertRaises(ValueError):
                    release.validate_auth_metadata(SimpleNamespace(**{**values, field: value}))

    def test_auth_preflight_mounts_only_auth_and_uses_approved_image_without_network(self):
        metadata = SimpleNamespace(st_mode=stat.S_IFREG | 0o440, st_uid=0, st_gid=10001, st_nlink=1, st_size=100)
        with patch.object(release, 'AUTH_SECRET') as secret, patch.object(release, 'protected') as protected, \
                patch.object(release, 'docker') as docker, patch.object(release.subprocess, 'run') as cleanup:
            secret.lstat.return_value = metadata
            release.verify_auth_secret(b'      AUTH_SECRET_FILE: /run/secrets/auth.json\n', fixture()['runtime_image'])
            protected.assert_called_once_with(secret, mode=0o440)
            args = docker.call_args.args
            self.assertEqual(args[args.index('--network') + 1], 'none')
            self.assertEqual(args[args.index('--memory') + 1], '128m')
            self.assertEqual(args.count('--mount'), 1)
            self.assertEqual(args[args.index('--mount') + 1],
                             'type=bind,src=/etc/rogichat/auth.json,dst=/run/secrets/auth.json,readonly')
            self.assertEqual(args[args.index('--env') + 1], 'AUTH_SECRET_FILE=/run/secrets/auth.json')
            self.assertIn(fixture()['runtime_image'], args)
            self.assertIn('--read-only', args)
            self.assertEqual(args[args.index('--cap-drop') + 1], 'ALL')
            self.assertIn("readAuthConfig({environment:'qa'})", args[-1])
            self.assertIn("import('./dist/infrastructure/config/auth-config.js')", args[-1])
            self.assertNotIn("import('./dist/auth-config.js')", args[-1])
            self.assertNotIn('DATABASE_URL', ' '.join(args))
            self.assertEqual(cleanup.call_args.args[0][-1], args[args.index('--name') + 1])

    def test_invalid_auth_file_blocks_before_running_container(self):
        with patch.object(release, 'AUTH_SECRET') as secret, patch.object(release, 'docker') as docker:
            secret.lstat.side_effect = FileNotFoundError()
            with self.assertRaises(FileNotFoundError):
                release.verify_auth_secret(b'      AUTH_SECRET_FILE: /run/secrets/auth.json\n', fixture()['runtime_image'])
            docker.assert_not_called()

    def test_auth_image_parser_failure_propagates_and_cleans_up(self):
        metadata = SimpleNamespace(st_mode=stat.S_IFREG | 0o440, st_uid=0, st_gid=10001, st_nlink=1, st_size=100)
        with patch.object(release, 'AUTH_SECRET') as secret, patch.object(release, 'protected'), \
                patch.object(release, 'docker', side_effect=release.Rejected()), \
                patch.object(release.subprocess, 'run') as cleanup:
            secret.lstat.return_value = metadata
            with self.assertRaises(ValueError):
                release.verify_auth_secret(b'      AUTH_SECRET_FILE: /run/secrets/auth.json\n', fixture()['runtime_image'])
            cleanup.assert_called_once()

    def test_failed_caddy_rollback_still_stops_both_roles(self):
        with patch.object(release, 'caddy_config', side_effect=release.Rejected()), \
                patch.object(release.Path, 'exists', return_value=True), \
                patch.object(release, 'run') as run:
            with self.assertRaises(ValueError):
                release.fail_closed('fixture-container', b'fixture bootstrap')
            self.assertEqual([call.args[0][-1] for call in run.call_args_list],
                             ['rogichat-app@api', 'rogichat-app@worker'])

    def test_only_single_caddy_ingress(self):
        api = {'HostConfig': {'PortBindings': {}, 'PublishAllPorts': False, 'NetworkMode': 'rogichat-qa_default'},
               'NetworkSettings': {'Networks': {'rogichat-qa_default': {}}}}
        release.validate_api_ingress(api, 'rogichat-qa_default')
        for field, value in [('PortBindings', {'3000/tcp': [{'HostPort': '3000'}]}),
                             ('PublishAllPorts', True), ('NetworkMode', 'host')]:
            bad = copy.deepcopy(api)
            bad['HostConfig'][field] = value
            with self.assertRaises(ValueError):
                release.validate_api_ingress(bad, 'rogichat-qa_default')
        api['NetworkSettings']['Networks']['another'] = {}
        with self.assertRaises(ValueError):
            release.validate_api_ingress(api, 'rogichat-qa_default')

    def test_valid_request(self):
        self.assertEqual(release.validate_request(fixture())['environment'], 'qa')

    def test_closed_schema_and_identity(self):
        for field, value in [('environment', 'production'), ('source_sha', 'a' * 7),
                             ('runtime_image', 'ghcr.io/h66rogi/rogichat-api:latest'),
                             ('migration_image', 'ghcr.io/other/rogichat-api-migration@sha256:' + 'c' * 64),
                             ('edge_network', 'rogichat-qa_default\nEVIL=yes'),
                             ('expires_at', int(time.time()) - 1), ('expires_at', int(time.time()) + 7200),
                             ('request_id', '../other'), ('verification_runs', {'backend.yml': True}),
                             ('artifacts', {'migration_entry': 'f' * 64})]:
            with self.subTest(field=field, value=value):
                item = fixture()
                item[field] = value
                with self.assertRaises((ValueError, TypeError)):
                    release.validate_request(item)
        item = fixture()
        item['shell'] = 'anything'
        with self.assertRaises(ValueError):
            release.validate_request(item)

    def test_history_request_unique_ordered_hashes(self):
        item = fixture()
        item['migrations'] *= 2
        with self.assertRaises(ValueError):
            release.validate_request(item)
        item = fixture()
        item['migrations'][0]['checksum'] = 'wrong'
        with self.assertRaises(ValueError):
            release.validate_request(item)

    def test_image_label_digest_user_architecture(self):
        import json
        request = fixture()
        item = {'RepoDigests': [request['runtime_image']], 'Architecture': 'amd64', 'Os': 'linux',
                'Config': {'User': '10001:10001', 'Entrypoint': ['node'], 'Labels': {
                    'org.opencontainers.image.source': release.SOURCE,
                    'org.opencontainers.image.revision': request['source_sha']}}}
        with patch.object(release, 'docker', return_value=json.dumps([item]).encode()):
            release.verify_image(request['runtime_image'], request['source_sha'])
        for field, value in [('Architecture', 'arm64'), ('RepoDigests', [])]:
            bad = copy.deepcopy(item)
            bad[field] = value
            with patch.object(release, 'docker', return_value=json.dumps([bad]).encode()):
                with self.assertRaises(ValueError):
                    release.verify_image(request['runtime_image'], request['source_sha'])
        item['Config']['Labels']['org.opencontainers.image.revision'] = 'f' * 40
        with patch.object(release, 'docker', return_value=json.dumps([item]).encode()):
            with self.assertRaises(ValueError):
                release.verify_image(request['runtime_image'], request['source_sha'])


if __name__ == '__main__':
    unittest.main()
