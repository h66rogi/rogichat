#!/usr/bin/env python3
"""Fail-closed webhook gateway. Bootstrap supports only `atlantis version`.

No repository checkout, Terraform execution, approval grant, or cloud mutation is
implemented here. Enabling plan/apply requires a separately reviewed worker.
"""
import argparse
import hashlib
import hmac
import json
import re
import threading
from socketserver import ThreadingMixIn
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.request import Request, urlopen

from github_app import GitHubApp
from guard import ApprovalStore, Denied, REPOSITORY, require, valid_uuid

MAX_BODY = 512 * 1024
EVENTS = {'ping', 'issue_comment', 'pull_request', 'pull_request_review', 'push'}


def classify(body, signature, event, delivery, secret, installation_id):
    require(len(body) <= MAX_BODY)
    require(type(signature) is str and re.fullmatch(r'sha256=[0-9a-f]{64}', signature))
    require(hmac.compare_digest(signature, 'sha256=' + hmac.new(secret, body, hashlib.sha256).hexdigest()))
    require(event in EVENTS and valid_uuid(delivery))
    payload = json.loads(body)
    require(type(payload) is dict)
    if event == 'ping':
        require(payload.get('hook', {}).get('type') == 'App')
        return 'ignore', payload
    require(payload.get('installation', {}).get('id') == installation_id)
    repo = payload.get('repository', {})
    require(repo.get('full_name') == REPOSITORY and repo.get('private') is True and repo.get('fork') is False)
    if event != 'issue_comment' or payload.get('action') != 'created':
        return 'ignore', payload
    comment = payload.get('comment', {})
    command = comment.get('body', '')
    require(type(command) is str)
    # Do not parse or echo arbitrary CLI text, flags, multiline or alternate commands.
    require(command == 'atlantis version')
    require(payload.get('issue', {}).get('pull_request') is not None)
    require(type(payload['issue'].get('number')) is int and payload['issue']['number'] > 0)
    sender = payload.get('sender', {})
    require(sender.get('type') == 'User' and sender.get('id') == comment.get('user', {}).get('id'))
    require(type(sender.get('login')) is str and re.fullmatch(r'[A-Za-z0-9-]{1,39}', sender['login']))
    return 'version', payload


def check_actor_and_pr(app, payload):
    installation_id, token = app.installation()
    require(installation_id == payload['installation']['id'])
    actor = payload['sender']['login']
    permission = app.request('GET', '/repos/' + REPOSITORY + '/collaborators/' + actor + '/permission', token)
    require(permission['permission'] in ('admin', 'maintain', 'write'))
    pr = app.request('GET', '/repos/' + REPOSITORY + '/pulls/' + str(payload['issue']['number']), token)
    require(pr['state'] == 'open' and not pr['draft'])
    require(pr['base']['ref'] == 'qa' and pr['base']['repo']['full_name'] == REPOSITORY and pr['base']['repo']['private'])
    require(pr['head']['repo']['full_name'] == REPOSITORY and not pr['head']['repo']['fork'])


class BoundedServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True
    request_queue_size = 16

    def __init__(self, *args, **kwargs):
        self.slots = threading.BoundedSemaphore(8)
        super().__init__(*args, **kwargs)

    def process_request(self, request, client_address):
        if not self.slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except BaseException:
            self.slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.slots.release()


def serve(credentials, database, port):
    app = GitHubApp(credentials)
    installation = json.loads((credentials / 'installation.json').read_text())['id']
    secret = (credentials / 'webhook-secret').read_bytes().strip()
    require(len(secret) >= 20)

    class Handler(BaseHTTPRequestHandler):
        server_version = 'WebhookGateway'
        sys_version = ''

        def log_message(self, *_):
            pass  # Never log attacker input, payloads, tokens or upstream output.

        def setup(self):
            super().setup()
            self.connection.settimeout(10)

        def respond(self, status, body):
            self.send_response(status)
            self.send_header('Content-Type', 'text/plain')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Connection', 'close')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            self.close_connection = True

        def do_GET(self):
            self.respond(200 if self.path == '/healthz' else 404, b'ok\n' if self.path == '/healthz' else b'not found\n')

        def do_POST(self):
            if self.path != '/events':
                self.respond(404, b'not found\n')
                return
            try:
                required = ['Content-Length', 'Content-Type', 'X-Hub-Signature-256', 'X-GitHub-Event', 'X-GitHub-Delivery']
                require(all(len(self.headers.get_all(k, [])) == 1 for k in required))
                require(not self.headers.get_all('Transfer-Encoding'))
                require(self.headers['Content-Type'].split(';')[0].strip() == 'application/json')
                size = self.headers['Content-Length']
                require(re.fullmatch(r'[0-9]{1,7}', size) and 0 < int(size) <= MAX_BODY)
                body = self.rfile.read(int(size))
                require(len(body) == int(size))
                signature, event, delivery = [self.headers[k] for k in required[2:]]
                action, payload = classify(body, signature, event, delivery, secret, installation)
                store = ApprovalStore(database)
                try:
                    store.accept_delivery(delivery, hashlib.sha256(body).hexdigest())
                finally:
                    store.db.close()
                if action == 'version':
                    check_actor_and_pr(app, payload)
                    request = Request('http://127.0.0.1:4141/events', data=body, headers={
                        'Content-Type': 'application/json', 'X-Hub-Signature-256': signature,
                        'X-GitHub-Event': event, 'X-GitHub-Delivery': delivery}, method='POST')
                    with urlopen(request, timeout=20) as response:
                        require(response.status == 200)
                self.respond(200, b'accepted\n')
            except (Denied, ValueError, KeyError, TypeError, AttributeError):
                self.respond(403, b'rejected\n')
            except Exception:
                self.respond(503, b'unavailable\n')

    # Bind literal loopback without a DNS lookup; Caddy is the sole public ingress.
    server = BoundedServer(('127.0.0.1', port), Handler, bind_and_activate=False)
    server.socket.bind(server.server_address)
    server.server_address = server.socket.getsockname()
    server.server_name, server.server_port = 'localhost', port
    server.server_activate()
    server.serve_forever()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--credentials', type=Path, required=True)
    parser.add_argument('--database', required=True)
    parser.add_argument('--port', type=int, default=4142)
    args = parser.parse_args()
    serve(args.credentials, args.database, args.port)
