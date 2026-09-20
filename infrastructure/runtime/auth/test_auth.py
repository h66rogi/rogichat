"""Local-only validation with real pinned proxies; no ACME or Tailnet traffic."""
import contextlib
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import threading
import time
import unittest

from render import render, TAILNET

ROOT = Path(__file__).resolve().parents[3]
CADDY = str(ROOT / '.tools/caddy')
NGINX = os.environ.get('NGINX_BINARY', str(ROOT / '.tools/nginx/sbin/nginx'))
NODE, PROD = str(TAILNET[10]), str(TAILNET[20])
PREFIX = '/v1/platform/oauth/rogichat/'
SENTINEL = 'synthetic-oauth-private-query'


def port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


@contextlib.contextmanager
def running(command, listener, directory):
    with (directory / 'process.log').open('ab') as log:
        process = subprocess.Popen(command, stdout=log, stderr=log,
            env={**os.environ, 'XDG_DATA_HOME': str(directory), 'XDG_CONFIG_HOME': str(directory)})
        try:
            deadline = time.monotonic() + 5
            while True:
                if process.poll() is not None:
                    raise AssertionError('Proxy exited: ' + (directory / 'process.log').read_text())
                try:
                    with socket.create_connection(('127.0.0.1', listener), timeout=.1):
                        break
                except OSError:
                    if time.monotonic() > deadline:
                        raise AssertionError('Proxy failed readiness')
                    time.sleep(.02)
            yield
        finally:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)


def request(listener, method, path, host='auth.rogi.chat', body=None):
    client = http.client.HTTPConnection('127.0.0.1', listener, timeout=4)
    try:
        client.request(method, path, body=body, headers={'Host': host,
            'Forwarded': 'for=untrusted', 'X-Forwarded-Host': 'untrusted.invalid',
            'X-Forwarded-For': 'untrusted', 'X-Forwarded-Proto': 'http',
            'Authorization': SENTINEL, 'Cookie': SENTINEL})
        response = client.getresponse()
        result = response.status, dict(response.getheaders()), response.read()
        return result
    finally:
        client.close()


class Broker(BaseHTTPRequestHandler):
    received = []

    def do_GET(self):
        self.received.append((self.path, dict(self.headers)))
        self.send_response(200)
        self.send_header('Cache-Control', 'public, max-age=999')
        self.end_headers()
        self.wfile.write(b'{}')

    def do_POST(self):
        self.rfile.read(int(self.headers.get('Content-Length', 0)))
        self.do_GET()

    def log_message(self, *args):
        pass


class AuthTests(unittest.TestCase):
    def test_bindings_and_default_unavailable(self):
        for bad in ['', '127.0.0.1', '0.0.0.0', '192.0.2.1', '::1',
                    str(TAILNET.network_address), str(TAILNET.broadcast_address),
                    NODE + '/32', NODE + ':8310', NODE + '\nallow all;', 'example.invalid']:
            for node, prod in [(bad, PROD), (NODE, bad)]:
                with self.subTest(value=bad), self.assertRaises(ValueError):
                    render(node, prod)
        with self.assertRaises(ValueError):
            render(NODE, NODE)
        for enabled in (False, True):
            files = render(NODE, PROD, enabled)
            self.assertNotIn('@NODE_', ''.join(files.values()))
            self.assertEqual('proxy_pass' in files['nginx.conf'], enabled)
            self.assertEqual('reverse_proxy' in files['Caddyfile'], enabled)

    def test_real_proxy_syntax_routes_headers_and_privacy(self):
        self.assertTrue(subprocess.check_output([CADDY, 'version'], text=True).startswith('v2.11.4 '))
        self.assertIn('nginx/1.28.3', subprocess.check_output([NGINX, '-v'], stderr=subprocess.STDOUT, text=True))
        for enabled in (False, True):
            with self.subTest(enabled=enabled), tempfile.TemporaryDirectory() as temporary:
                directory = Path(temporary)
                files = render(NODE, PROD, enabled)
                caddyfile = directory / 'Caddyfile'
                caddyfile.write_text(files['Caddyfile'])
                adapted = json.loads(subprocess.check_output([CADDY, 'adapt', '--config', str(caddyfile),
                    '--adapter', 'caddyfile', '--validate'], stderr=subprocess.DEVNULL))
                (directory / "logs").mkdir()
                # Nginx -t binds on macOS, so validate the listener on loopback.
                snippet = files['nginx.conf'].replace('/var/log/nginx/rogichat-auth-access.log', str(directory / 'access.log'))
                wrapper = 'daemon off; master_process off; error_log /dev/null; pid ' + str(directory / 'nginx.pid') + '; events {} http {\n' + snippet + '\n}'
                conf = directory / 'nginx.conf'
                conf.write_text(wrapper)
                # Runtime isolation changes addresses/ports only, never route/log policy.
                nginx_port, caddy_port = port(), port()
                Broker.received = []
                broker = ThreadingHTTPServer(('127.0.0.1', 0), Broker)
                thread = threading.Thread(target=broker.serve_forever, daemon=True)
                thread.start()
                wrapper = wrapper.replace(NODE + ':8310', f'127.0.0.1:{nginx_port}').replace(PROD, '127.0.0.1')
                wrapper = wrapper.replace('127.0.0.1:3100', f'127.0.0.1:{broker.server_port}')
                conf.write_text(wrapper)
                subprocess.run([NGINX, '-t', '-p', str(directory), '-c', str(conf)], check=True, capture_output=True)
                server = next(iter(adapted['apps']['http']['servers'].values()))
                server['listen'] = [f'127.0.0.1:{caddy_port}']
                server.pop('tls_connection_policies', None)
                server['automatic_https'] = {'disable': True}
                adapted['apps'] = {'http': {'servers': {'test': server}}}
                config = directory / 'caddy.json'
                config.write_text(json.dumps(adapted).replace(NODE + ':8310', f'127.0.0.1:{nginx_port}'))
                try:
                    with running([NGINX, '-p', str(directory), '-c', str(conf)], nginx_port, directory), running(
                            [CADDY, 'run', '--config', str(config)], caddy_port, directory):
                        for listener in (nginx_port, caddy_port):
                            for method, endpoint in [('POST', 'requests'), ('POST', 'exchange'), ('GET', 'authorize'), ('GET', 'callback')]:
                                status, headers, _ = request(listener, method, PREFIX + endpoint + '?code=' + SENTINEL)
                                self.assertEqual(status, 200 if enabled else 503)
                                self.assertEqual(headers.get('Cache-Control'), 'no-store')
                            for method, path in [('GET', PREFIX + 'requests'), ('POST', PREFIX + 'callback'),
                                                 ('HEAD', PREFIX + 'authorize'), ('OPTIONS', PREFIX + 'exchange'),
                                                 ('GET', '/'), ('GET', '/v1/platform/oauth/legacy/callback'),
                                                 ('GET', PREFIX + 'callback/'), ('GET', PREFIX + '%63allback'),
                                                 ('GET', PREFIX + 'x/../callback'), ('GET', PREFIX + '/callback')]:
                                self.assertEqual(request(listener, method, path)[0], 404)
                            self.assertEqual(request(listener, 'GET', PREFIX + 'callback', 'untrusted.invalid')[0], 404)
                        if enabled:
                            self.assertEqual(len(Broker.received), 8)
                            for path, headers in Broker.received:
                                self.assertIn(SENTINEL, path)
                                self.assertEqual(headers['Host'], 'auth.rogi.chat')
                                self.assertEqual(headers['X-Forwarded-Proto'], 'https')
                                self.assertEqual(headers['X-Forwarded-Host'], 'auth.rogi.chat')
                                self.assertEqual(headers['X-Forwarded-For'], '127.0.0.1')
                                self.assertNotIn('Forwarded', headers)
                                self.assertEqual(headers['Authorization'], SENTINEL)
                            self.assertEqual(request(caddy_port, 'POST', PREFIX + 'requests', body=b'x' * 17000)[0], 413)
                            broker.shutdown()
                            broker.server_close()
                            self.assertEqual(request(caddy_port, 'GET', PREFIX + 'callback?code=' + SENTINEL)[0], 502)
                finally:
                    broker.shutdown()
                    broker.server_close()
                    thread.join(timeout=3)
                # A socket peer outside the single production source is rejected,
                # even when the caller spoofs all forwarding headers.
                conf.write_text(wrapper.replace('if ($remote_addr != 127.0.0.1)',
                                                'if ($remote_addr != ' + PROD + ')'))
                with running([NGINX, '-p', str(directory), '-c', str(conf)], nginx_port, directory):
                    self.assertEqual(request(nginx_port, 'GET', PREFIX + 'callback')[0], 404)
                for name in ('access.log', 'process.log'):
                    logs = (directory / name).read_text()
                    self.assertNotIn(SENTINEL, logs)
                entries = [json.loads(line) for line in (directory / 'access.log').read_text().splitlines()]
                self.assertTrue(entries)
                self.assertTrue(all(set(entry) == {'time', 'status', 'duration'} for entry in entries))


if __name__ == '__main__':
    unittest.main()
