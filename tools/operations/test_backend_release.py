"""Pure validation tests: no Docker, network, host writes or database access."""
import copy
import time
import unittest
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
