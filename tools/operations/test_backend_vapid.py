"""No real credentials/network: hosted VAPID preflight and role isolation."""
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import backend_release as release

ROOT = Path(__file__).resolve().parents[2]
COMPOSE = b'  PUSH_VAPID_SECRET_FILE: /run/secrets/push-vapid.json\n'


def metadata(**changes):
    value = dict(st_mode=stat.S_IFREG | 0o400, st_uid=10001, st_gid=10001, st_nlink=1, st_size=256)
    return SimpleNamespace(**(value | changes))


class VapidPreflightTests(unittest.TestCase):
    def test_legacy_compose_is_unchanged_but_malformed_new_binding_rejected(self):
        with patch.object(release, 'docker') as docker:
            release.verify_vapid_secret(b'legacy compose', 'fixture')
            docker.assert_not_called()
        for raw in (COMPOSE * 2, COMPOSE.replace(b'/run/secrets/', b'/tmp/'), b'PUSH_VAPID_PRIVATE_KEY: fixture'):
            with self.subTest(raw=raw), self.assertRaises(release.Rejected):
                release.compose_requires_vapid(raw)

    def test_permissions_ownership_links_and_size_fail_closed(self):
        release.validate_vapid_metadata(metadata())
        release.validate_vapid_metadata(metadata(st_mode=stat.S_IFREG | 0o600))
        for bad in ({'st_mode':stat.S_IFREG | 0o440}, {'st_mode':stat.S_IFREG | 0o4400},
                    {'st_mode':stat.S_IFLNK | 0o400}, {'st_uid':0}, {'st_gid':0},
                    {'st_nlink':2}, {'st_size':0}, {'st_size':4097}):
            with self.subTest(bad=bad), self.assertRaises(release.Rejected):
                release.validate_vapid_metadata(metadata(**bad))

    def test_exact_environment_image_parser_receives_only_vapid_mount(self):
        directory = SimpleNamespace(st_mode=stat.S_IFDIR | 0o755, st_uid=0)
        for env, prefix in [('qa', '/etc/rogichat'), ('production', '/etc/rogichat/prod')]:
            with self.subTest(environment=env), patch.object(Path, 'lstat', side_effect=lambda p=None: metadata()) as ls:
                # lstat() is invoked for the root-owned parents before the UID10001 file.
                path = Path(prefix) / 'push-vapid.json'
                ls.side_effect = [directory] * len(path.parents) + [metadata()]
                with patch.object(release, 'docker') as docker, patch.object(release.subprocess, 'run') as cleanup:
                    release.verify_vapid_secret(COMPOSE, 'fixture-image', env)
                args = docker.call_args.args
                self.assertEqual(args[args.index('--network') + 1], 'none')
                self.assertEqual(args[args.index('--user') + 1], '10001:10001')
                self.assertEqual(args[args.index('--log-driver') + 1], 'none')
                self.assertEqual(args[args.index('--mount') + 1], f'type=bind,src={path},dst=/run/secrets/push-vapid.json,readonly')
                self.assertEqual(args.count('--mount'), 1)
                self.assertIn('readPushConfig', args[-1])
                self.assertIn(json.dumps(env), args[-1])
                self.assertNotIn('auth.json', str(args))
                self.assertNotIn('database.json', str(args))
                self.assertEqual(cleanup.call_args.args[0][-1], args[args.index('--name') + 1])

    def test_parser_failure_cleans_probe_and_propagates_before_activation(self):
        directory = SimpleNamespace(st_mode=stat.S_IFDIR | 0o755, st_uid=0)
        path = Path('/etc/rogichat/push-vapid.json')
        with patch.object(Path, 'lstat', side_effect=[directory] * len(path.parents) + [metadata()]), \
                patch.object(release, 'docker', side_effect=release.Rejected('fixture invalid key')), \
                patch.object(release.subprocess, 'run') as cleanup, self.assertRaises(release.Rejected):
            release.verify_vapid_secret(COMPOSE, 'fixture')
        cleanup.assert_called_once()

    def test_both_real_templates_mount_same_environment_key_api_and_worker(self):
        compose = [shutil.which('docker'), 'compose'] if shutil.which('docker') else [str(ROOT / '.tools/compose')]
        for env, prefix, path in [('qa', '/etc/rogichat', 'infrastructure/runtime/compose.app.yaml'),
                                 ('production', '/etc/rogichat/prod', 'infrastructure/environments/prod/runtime/compose.app.yaml')]:
            with self.subTest(environment=env):
                release.compose_requires_vapid((ROOT/path).read_bytes())
                variables = dict(os.environ, ROGICHAT_API_IMAGE='fixture', ROGICHAT_WORKER_IMAGE='fixture', ROGICHAT_EDGE_NETWORK='fixture')
                data = json.loads(subprocess.check_output([*compose, '-f', str(ROOT/path), 'config', '--format', 'json'], env=variables))
                for role in ('api', 'worker'):
                    service = data['services'][role]
                    self.assertEqual(service['environment']['APP_ENV'], env)
                    self.assertEqual(service['environment']['PUSH_VAPID_SECRET_FILE'], '/run/secrets/push-vapid.json')
                    mounts = {v['target']:v for v in service['volumes']}
                    mount = mounts['/run/secrets/push-vapid.json']
                    self.assertEqual(mount['source'], prefix + '/push-vapid.json')
                    self.assertTrue(mount['read_only'])
                    # Compose versions may omit this false-valued field in rendered JSON.
                    self.assertFalse(mount['bind'].get('create_host_path', False))
                    self.assertEqual('/run/secrets/auth.json' in mounts, role == 'api')

    def test_live_gate_rejects_missing_wrong_writable_or_disagreeing_keys(self):
        import copy
        def container(role):
            return {'Config':{'User':'10001:10001','Env':['APP_ENV=qa','PUSH_VAPID_SECRET_FILE=/run/secrets/push-vapid.json']},
                    'Mounts':[{'Type':'bind','Source':'/etc/rogichat/push-vapid.json','Destination':'/run/secrets/push-vapid.json','RW':False}]}
        for fault in ('none','missing','writable','prod-key','inline','worker-auth','mismatch','invalid-result'):
            api, worker = container('api'), container('worker')
            fingerprints = [b'a'*64, b'a'*64]
            if fault == 'missing': worker['Mounts'] = []
            if fault == 'writable': worker['Mounts'][0]['RW'] = True
            if fault == 'prod-key': worker['Mounts'][0]['Source'] = '/etc/rogichat/prod/push-vapid.json'
            if fault == 'inline': worker['Config']['Env'].append('PUSH_VAPID_PRIVATE_KEY=synthetic')
            if fault == 'worker-auth': worker['Config']['Env'].append('AUTH_SECRET_FILE=/run/secrets/auth.json')
            if fault == 'mismatch': fingerprints[1] = b'b'*64
            if fault == 'invalid-result': fingerprints[1] = b''
            results = [json.dumps([api]).encode(), fingerprints[0], json.dumps([worker]).encode(), fingerprints[1]]
            with self.subTest(fault=fault), patch.object(release,'docker',side_effect=results):
                if fault == 'none': release.verify_live_vapid('qa')
                else:
                    with self.assertRaises(release.Rejected): release.verify_live_vapid('qa')


if __name__ == '__main__':
    unittest.main()
