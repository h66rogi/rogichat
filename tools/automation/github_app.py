"""Minimal GitHub App client; tokens stay in memory and errors omit response bodies."""
import base64
import json
from pathlib import Path
import subprocess
import time
from urllib.error import HTTPError
from urllib.request import HTTPRedirectHandler, Request, build_opener

API = 'https://api.github.com'
REPOSITORY = 'h66rogi/rogichat-ops'


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        return None


def encode(value):
    return base64.urlsafe_b64encode(value).rstrip(b'=')


class GitHubApp:
    def __init__(self, directory):
        self.directory = Path(directory)
        self.metadata = json.loads((self.directory / 'app.json').read_text())

    def jwt(self):
        now = int(time.time())
        payload = encode(json.dumps({'iat': now - 60, 'exp': now + 300, 'iss': str(self.metadata['id'])}).encode())
        message = encode(b'{"alg":"RS256","typ":"JWT"}') + b'.' + payload
        signed = subprocess.run(['openssl', 'dgst', '-sha256', '-sign', str(self.directory / 'github-app.pem')], input=message, capture_output=True, check=False)
        if signed.returncode:
            raise RuntimeError('App signing failed')
        return (message + b'.' + encode(signed.stdout)).decode()

    def request(self, method, path, token, data=None):
        if not path.startswith('/') or path.startswith('//'):
            raise ValueError('Invalid API path')
        body = None if data is None else json.dumps(data).encode()
        request = Request(API + path, data=body, method=method, headers={
            'Accept': 'application/vnd.github+json', 'Authorization': 'Bearer ' + token,
            'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json'})
        try:
            with build_opener(NoRedirect).open(request, timeout=20) as response:
                raw = response.read(2 * 1024 * 1024 + 1)
                if len(raw) > 2 * 1024 * 1024:
                    raise RuntimeError('GitHub response too large')
                return json.loads(raw) if raw else None
        except HTTPError as error:
            raise RuntimeError(f'GitHub request failed ({error.code})') from None

    def installation(self):
        installations = self.request('GET', '/app/installations?per_page=100', self.jwt())
        if len(installations) != 1:
            raise RuntimeError('Expected exactly one installation')
        installation = installations[0]
        if (installation['account']['login'] != 'h66rogi'
                or installation['repository_selection'] != 'selected'
                or installation['suspended_at'] is not None
                or installation['permissions'] != self.metadata['permissions']):
            raise RuntimeError('Installation policy mismatch')
        token = self.request('POST', f'/app/installations/{installation["id"]}/access_tokens', self.jwt(), {})['token']
        repos = self.request('GET', '/installation/repositories?per_page=100', token)
        if repos['total_count'] != 1 or repos['repositories'][0]['full_name'] != REPOSITORY or not repos['repositories'][0]['private']:
            raise RuntimeError('Installation repository policy mismatch')
        return installation['id'], token
