"""Execute the actual helper with isolated command stubs; no Docker/host/DB writes."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

HELPER = Path(__file__).with_name('owner_bootstrap.sh')


class OwnerBootstrapHelperTests(unittest.TestCase):
    def invoke(self, *, metadata=None, uid='0', custody='0', docker_exit='0', args=()):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            capture = root / 'docker.json'
            scripts = {
                'id': '#!/bin/sh\nprintf "%s\\n" "$FIXTURE_UID"\n',
                'python3': '#!/bin/sh\ncat >/dev/null\nexit "$FIXTURE_CUSTODY_EXIT"\n',
                'docker': f'#!{sys.executable}\nimport json, os, sys\n'
                          'with open(os.environ["FIXTURE_CAPTURE"], "w") as out:\n'
                          '    json.dump(sys.argv[1:], out)\n'
                          'sys.exit(int(os.environ["FIXTURE_DOCKER_EXIT"]))\n',
            }
            for name, script in scripts.items():
                path = root / name
                path.write_text(script)
                path.chmod(0o700)
            env = {
                'PATH': str(root) + ':/usr/bin:/bin', 'FIXTURE_UID': uid,
                'FIXTURE_CUSTODY_EXIT': custody, 'FIXTURE_DOCKER_EXIT': docker_exit,
                'FIXTURE_CAPTURE': str(capture), 'BOOTSTRAP_ENVIRONMENT': 'qa',
                'BOOTSTRAP_IMAGE': 'fixture.invalid/isolated/api@sha256:' + 'a' * 64,
                'BOOTSTRAP_NETWORK': 'isolated-test-network',
            }
            env.update(metadata or {})
            result = subprocess.run(['/bin/sh', str(HELPER), *args], env=env,
                                    capture_output=True, text=True, timeout=10)
            command = json.loads(capture.read_text()) if capture.exists() else None
            return result, command

    def test_actual_helper_container_command_and_fixed_config_paths(self):
        result, command = self.invoke()
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout, '')
        self.assertEqual(result.stderr, '')
        self.assertEqual(command, [
            'run', '--rm', '--pull=never', '--read-only', '--cap-drop=ALL',
            '--security-opt=no-new-privileges', '--user', '0:0', '--pids-limit', '64',
            '--memory', '256m', '--cpus', '1', '--log-driver', 'none', '--network',
            'isolated-test-network', '--mount',
            'type=bind,src=/run/rogichat-owner-bootstrap,dst=/run/owner-bootstrap,readonly',
            '--env', 'APP_ENV=qa', '--env', 'NODE_ENV=production', '--env', 'DB_POOL_SIZE=1',
            '--env', 'DATABASE_SECRET_FILE=/run/owner-bootstrap/database.json',
            '--env', 'AUTH_SECRET_FILE=/run/owner-bootstrap/auth.json',
            '--env', 'DB_CA_FILE=/run/owner-bootstrap/ca.pem', '--entrypoint', '/bin/sh',
            'fixture.invalid/isolated/api@sha256:' + 'a' * 64, '-c',
            'exec node /app/apps/api/dist/modules/owner-bootstrap/owner-bootstrap.command.js < /run/owner-bootstrap/request.json',
        ])

    def test_no_docker_on_nonroot_invalid_metadata_or_private_custody_failure(self):
        cases = [dict(uid='10001'), dict(custody='1'), dict(args=('private-marker',))]
        cases += [dict(metadata=patch) for patch in [
            {'BOOTSTRAP_ENVIRONMENT': 'test'}, {'BOOTSTRAP_IMAGE': 'fixture:latest'},
            {'BOOTSTRAP_IMAGE': '-option@sha256:' + 'a' * 64},
            {'BOOTSTRAP_NETWORK': 'host'}, {'BOOTSTRAP_NETWORK': 'none'},
            {'BOOTSTRAP_NETWORK': 'bad; command'},
        ]]
        for options in cases:
            with self.subTest(options=options):
                result, command = self.invoke(**options)
                self.assertNotEqual(result.returncode, 0)
                self.assertIsNone(command)
                self.assertNotIn('private-marker', result.stdout + result.stderr)

    def test_actual_container_nonzero_outcome_is_not_reported_as_success(self):
        result, command = self.invoke(docker_exit='42')
        self.assertIsNotNone(command)
        self.assertEqual(result.returncode, 42)
        self.assertEqual(result.stdout, '')


if __name__ == '__main__':
    unittest.main()
