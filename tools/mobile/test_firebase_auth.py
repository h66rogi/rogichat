"""Isolated synthetic credentials; no product or cloud access."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from firebase_auth import AccessToken, credentials, environment


class FirebaseAuthTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.path = self.root / 'credentials.json'
        self.value = dict(type='service_account', project_id='distribution-test',
                          client_email='uploader@distribution-test.iam.gserviceaccount.com',
                          token_uri='https://oauth2.googleapis.com/token', private_key='isolated-test-not-a-key')
        self.write()
        self.cfg = {'firebase': {'project_id': 'distribution-test', 'credentials_file': str(self.path)}}

    def write(self):
        self.path.write_text(json.dumps(self.value)); self.path.chmod(0o600)

    def test_missing_identity_never_uses_personal_session(self):
        with patch.dict(os.environ, FIREBASE_TOKEN='personal-fixture', GOOGLE_APPLICATION_CREDENTIALS=str(self.path)):
            with self.assertRaisesRegex(ValueError, 'credentials_file'):
                with environment({'firebase': {'project_id': 'distribution-test'}}, self.root):
                    self.fail('ambient credentials used')

    def test_exact_project_private_service_identity_required(self):
        self.assertEqual(credentials(self.cfg), self.path)
        for key, value in [('type', 'authorized_user'), ('project_id', 'other'),
                           ('client_email', 'uploader@other.iam.gserviceaccount.com'),
                           ('token_uri', 'https://attacker.invalid/token'), ('private_key', '')]:
            old = self.value[key]; self.value[key] = value; self.write()
            with self.subTest(key=key), self.assertRaises(ValueError): credentials(self.cfg)
            self.value[key] = old
        self.write(); self.path.chmod(0o644)
        with self.assertRaisesRegex(ValueError, 'private file'): credentials(self.cfg)

    def test_separate_empty_cli_config_prevents_cached_user_precedence(self):
        personal = self.root / 'personal'; personal.mkdir()
        (personal / 'firebase-tools.json').write_text('personal session stays untouched')
        with patch.dict(os.environ, XDG_CONFIG_HOME=str(personal), FIREBASE_TOKEN='private-test-token',
                        NODE_OPTIONS='--require untrusted', GOOGLE_AUTH_LOGGING_ENABLED='1'):
            with environment(self.cfg, self.root) as env:
                isolated = Path(env['XDG_CONFIG_HOME'])
                self.assertNotEqual(isolated, personal)
                self.assertEqual(list(isolated.iterdir()), [])
                self.assertEqual(isolated.stat().st_mode & 0o777, 0o700)
                self.assertEqual(env['GOOGLE_APPLICATION_CREDENTIALS'], str(self.path))
                for name in ('FIREBASE_TOKEN', 'NODE_OPTIONS', 'GOOGLE_AUTH_LOGGING_ENABLED'):
                    self.assertNotIn(name, env)
            self.assertFalse(isolated.exists())
        self.assertEqual((personal / 'firebase-tools.json').read_text(), 'personal session stays untouched')

    def test_token_is_cached_then_automatically_renewed_before_expiry(self):
        provider = AccessToken(self.cfg, self.root)
        def response(token, expires):
            return subprocess.CompletedProcess([], 0, json.dumps({'access_token': token, 'expiry_date': expires * 1000}), '')
        with patch('firebase_auth.shutil.which', return_value='/installed/firebase'), \
             patch('firebase_auth.subprocess.run', side_effect=[response('first-test', 4600), response('second-test', 8100)]) as run:
            with patch('firebase_auth.time.time', return_value=1000):
                self.assertEqual(provider.get(), 'first-test')
                self.assertEqual(provider.get(), 'first-test')
                self.assertEqual(run.call_count, 1)
            with patch('firebase_auth.time.time', return_value=4500):
                self.assertEqual(provider.get(), 'second-test')
                self.assertEqual(run.call_count, 2)

    def test_failed_exchange_does_not_expose_child_output_or_return_stale_token(self):
        provider = AccessToken(self.cfg, self.root)
        provider.value, provider.expires = 'stale-private-test', 1
        result = subprocess.CompletedProcess([], 1, 'sensitive-test-output', 'sensitive-test-error')
        with patch('firebase_auth.shutil.which', return_value='/installed/firebase'), patch('firebase_auth.subprocess.run', return_value=result):
            with self.assertRaises(RuntimeError) as caught: provider.get()
        self.assertNotIn('sensitive', str(caught.exception)); self.assertNotIn('stale-private', str(caught.exception))

    def test_node_adapter_uses_google_auth_and_never_loads_personal_cli_auth(self):
        root = self.root / 'cli'; (root / 'lib/bin').mkdir(parents=True)
        (root / 'package.json').write_text('{"name":"firebase-tools"}')
        binary = root / 'lib/bin/firebase.js'; binary.write_text('// isolated installation')
        (root / 'lib/auth.js').write_text('throw Error("personal auth must not load")')
        module = root / 'node_modules/google-auth-library'; module.mkdir(parents=True)
        (module / 'index.js').write_text('exports.GoogleAuth=class { constructor(options) { if(options.keyFile !== process.env.GOOGLE_APPLICATION_CREDENTIALS) throw Error("wrong identity"); } async getClient() { return {credentials:{expiry_date:9000000},getAccessToken:async()=>({token:"short-lived-test"})}; } };')
        with environment(self.cfg, self.root) as env:
            result = subprocess.run(['node', str(Path(__file__).with_name('firebase_session.cjs')), str(binary)], env=env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), {'access_token': 'short-lived-test', 'expiry_date': 9000000})


if __name__ == '__main__': unittest.main()
