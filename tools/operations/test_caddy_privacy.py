"""Exercise the real Caddy error logger with synthetic OAuth request material."""
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import unittest
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
CADDY = os.environ.get('CADDY_BINARY', str(ROOT / '.tools/caddy'))


class CaddyPrivacyTests(unittest.TestCase):
    def test_callback_query_and_headers_absent_from_upstream_error_log(self):
        templates = [f'{folder}/{name}'
                     for folder in ('infrastructure/runtime', 'infrastructure/environments/prod/runtime')
                     for name in ('Caddyfile.app', 'Caddyfile.bootstrap')]
        for template in templates:
            with self.subTest(template=template), tempfile.TemporaryDirectory() as directory:
                adapted = json.loads(subprocess.check_output([
                    CADDY, 'adapt', '--config', str(ROOT / template),
                    '--adapter', 'caddyfile'], stderr=subprocess.DEVNULL))
                # Keep a bound, non-listening socket so no other service can take
                # the upstream port; the test reliably exercises a proxy failure.
                with socket.socket() as upstream, socket.socket() as listener:
                    upstream.bind(('127.0.0.1', 0))
                    listener.bind(('127.0.0.1', 0))
                    port = listener.getsockname()[1]
                    listener.close()
                    config = {'admin': {'disabled': True}, 'logging': adapted['logging'],
                              'apps': {'http': {'servers': {'privacy': {
                                  'listen': [f'127.0.0.1:{port}'], 'routes': [{'handle': [{
                                      'handler': 'reverse_proxy',
                                      'transport': {'protocol': 'http', 'dial_timeout': 100000000},
                                      'upstreams': [{
                                          'dial': f'127.0.0.1:{upstream.getsockname()[1]}'}]}]}]}}}}}
                    path = Path(directory) / 'config.json'
                    path.write_text(json.dumps(config))
                    log = Path(directory) / 'runtime.log'
                    with log.open('wb') as output:
                        process = subprocess.Popen([CADDY, 'run', '--config', str(path)],
                            stdout=output, stderr=output,
                            env={**os.environ, 'XDG_CONFIG_HOME': directory, 'XDG_DATA_HOME': directory})
                        try:
                            deadline = time.monotonic() + 10
                            while True:
                                self.assertIsNone(process.poll(), 'Caddy exited before readiness')
                                try:
                                    with socket.create_connection(('127.0.0.1', port), timeout=.1):
                                        break
                                except OSError:
                                    if time.monotonic() >= deadline:
                                        self.fail('Caddy did not listen')
                                    time.sleep(.05)
                            sentinel = 'synthetic-oauth-material-must-not-be-logged'
                            request = urllib.request.Request(
                                f'http://127.0.0.1:{port}/mobile/auth/complete?code={sentinel}&state={sentinel}',
                                headers={'X-Privacy-Test': sentinel, 'Cookie': sentinel})
                            with self.assertRaises(urllib.error.HTTPError) as error:
                                urllib.request.urlopen(request, timeout=3)
                            self.assertEqual(error.exception.code, 502)
                            error.exception.close()
                        finally:
                            process.terminate()
                            try:
                                process.wait(timeout=5)
                            except subprocess.TimeoutExpired:
                                process.kill()
                                process.wait(timeout=5)
                    logs = log.read_text()
                    self.assertNotIn(sentinel, logs)
                    entries = [json.loads(line) for line in logs.splitlines() if line.startswith('{')]
                    failures = [entry for entry in entries if entry.get('logger', '').startswith('http.log.error')]
                    self.assertTrue(failures, 'Must verify an actual upstream error, not an empty log')
                    for failure in failures:
                        self.assertEqual(failure['status'], 502)
                        self.assertNotIn('uri', failure['request'])
                        self.assertNotIn('headers', failure['request'])


if __name__ == '__main__':
    unittest.main()
