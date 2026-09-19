"""Pure validation tests: no Docker, network, host writes or database access."""
import copy
import time
import unittest
import stat
from types import SimpleNamespace
from unittest.mock import patch

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


class RequestTests(unittest.TestCase):
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
