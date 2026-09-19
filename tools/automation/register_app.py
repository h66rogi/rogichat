#!/usr/bin/env python3
"""One-shot local GitHub App manifest registration. Never prints credentials."""
import argparse
import hmac
import html
import json
import os
from pathlib import Path
import secrets
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from socketserver import TCPServer
from urllib.parse import parse_qs, urlsplit
from urllib.request import Request, urlopen


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir', type=Path, required=True)
    args = parser.parse_args()
    target = args.output_dir.expanduser().resolve()
    if target.exists():
        raise SystemExit('Output directory must be new and outside Git.')
    if any((p / '.git').exists() for p in [target, *target.parents]):
        raise SystemExit('Refusing credential storage inside a repository.')
    os.umask(0o077)
    target.mkdir(parents=True, mode=0o700)
    state = secrets.token_urlsafe(32)
    entry = '/' + secrets.token_urlsafe(32)
    completed = threading.Event()
    registered = threading.Event()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def page(self, status, body):
            self.send_response(status)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Referrer-Policy', 'no-referrer')
            self.send_header('Content-Security-Policy', "default-src 'none'; form-action https://github.com")
            self.end_headers()
            self.wfile.write(body.encode())

        def do_GET(self):
            parsed = urlsplit(self.path)
            if parsed.path == entry:
                manifest = {
                    'name': 'rogichat-qa-atlantis',
                    'url': 'https://github.com/h66rogi/rogichat',
                    'description': 'QA infrastructure automation for private rogichat-ops only.',
                    'hook_attributes': {'url': 'https://atlantis.qa.rogi.chat/events', 'active': False},
                    'redirect_url': f'http://127.0.0.1:{self.server.server_port}/callback',
                    'public': False,
                    'default_permissions': {'contents': 'read', 'issues': 'read', 'pull_requests': 'write', 'statuses': 'write', 'metadata': 'read'},
                    'default_events': ['pull_request', 'issue_comment', 'pull_request_review', 'push'],
                }
                self.page(200, '<!doctype html><title>Register QA Atlantis</title><form method="post" action="https://github.com/organizations/h66rogi/settings/apps/new?state=' + state + '"><input type="hidden" name="manifest" value="' + html.escape(json.dumps(manifest), quote=True) + '"><button type="submit">Register private QA Atlantis App</button></form>')
                return
            if parsed.path == '/complete':
                if not registered.is_set():
                    self.page(409, 'Registration is not complete')
                    return
                self.page(200, '<!doctype html><title>Registration complete</title>GitHub App registered. Credentials saved locally; no credentials are displayed.')
                completed.set()
                return
            if parsed.path != '/callback':
                self.page(404, 'Not found')
                return
            params = parse_qs(parsed.query)
            if len(params.get('state', [])) != 1 or not hmac.compare_digest(params['state'][0], state) or len(params.get('code', [])) != 1:
                self.page(403, 'Registration rejected')
                return
            code = params['code'][0]
            if not code.isalnum() or len(code) > 200:
                self.page(403, 'Registration rejected')
                return
            try:
                request = Request('https://api.github.com/app-manifests/' + code + '/conversions', data=b'', headers={'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'}, method='POST')
                with urlopen(request, timeout=30) as response:
                    app = json.load(response)
                for name, value in [('github-app.pem', app['pem']), ('webhook-secret', app['webhook_secret'])]:
                    with (target / name).open('x', encoding='utf-8') as output:
                        output.write(value)
                metadata = {key: app[key] for key in ('id', 'slug', 'name', 'owner', 'permissions', 'events', 'html_url')}
                (target / 'app.json').write_text(json.dumps(metadata, indent=2) + '\n')
            except Exception:
                self.page(502, 'Registration exchange failed. Inspect local file presence; credentials are never logged.')
                return
            registered.set()
            self.send_response(303)
            self.send_header('Location', '/complete')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Referrer-Policy', 'no-referrer')
            self.end_headers()

    server = HTTPServer(('127.0.0.1', 0), Handler, bind_and_activate=False)
    TCPServer.server_bind(server)
    server.server_name = 'localhost'
    server.server_port = server.server_address[1]
    server.server_activate()
    server.timeout = 1
    print(f'Registration URL: http://127.0.0.1:{server.server_port}{entry}', flush=True)
    try:
        import time
        deadline = time.monotonic() + 1800
        while not completed.is_set() and time.monotonic() < deadline:
            server.handle_request()
    finally:
        server.server_close()
    print('Registration complete.' if completed.is_set() else 'Registration timed out.', flush=True)


if __name__ == '__main__':
    main()
