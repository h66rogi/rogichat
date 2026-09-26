"""Offline adversarial release contracts; never invokes Docker or a live host."""
import copy
import base64
import json
import io
import importlib.util
import tarfile
import zipfile
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import MagicMock, patch

import web_release as w


def request(environment='qa'):
    value = {'environment': environment, 'source_sha': 'a' * 40,
             'image': 'ghcr.io/h66rogi/rogichat-web@sha256:' + 'b' * 64,
             'artifacts': dict.fromkeys(('compose', 'environment', 'edge', 'site'), 'c' * 64),
             'caddy_sha256': 'd' * 64, 'bootstrap_sha256': 'e' * 64,
             'request_id': '12345678-1234-4234-8234-123456789abc',
             'expires_at': int(time.time()) + 600,
             'verification_runs': dict.fromkeys(w.WORKFLOWS, 123), 'default_room_id': ''}
    if environment == 'production':
        value['completed_qa_sha256'] = 'f' * 64
        value['promotion_sha'] = '1' * 40
        value['promotion_runs'] = dict.fromkeys(w.CHECKS, 124)
    return value


def config(r):
    _, name, _ = w.names(r)
    environment = {'NODE_ENV': 'production', 'NEXT_TELEMETRY_DISABLED': '1', 'HOSTNAME': '0.0.0.0', 'PORT': '3000',
                   'ROGICHAT_WEB_ENV': r['environment'], 'ROGICHAT_DEFAULT_ROOM_ID': r['default_room_id'],
                   'ROGICHAT_API_ORIGIN': 'https://api.qa.rogi.chat' if r['environment'] == 'qa' else 'https://api.rogi.chat'}
    if r['environment'] == 'qa':
        environment['ROGICHAT_MEDIA_STORAGE_ORIGINS'] = w.QA_MEDIA_STORAGE_ORIGINS
    return {'name': name, 'services': {'web': {
        'image': r['image'], 'container_name': name, 'user': '10001:10001', 'read_only': True,
        'networks': {'web': None}, 'cap_drop': ['ALL'], 'security_opt': ['no-new-privileges:true'],
        'environment': environment}},
        'networks': {'web': {'name': name, 'external': True}}}


def image(r):
    return {'Id': 'sha256:' + '1' * 64, 'RepoDigests': [r['image']], 'Os': 'linux', 'Architecture': 'amd64',
            'Config': {'User': '10001:10001', 'Entrypoint': ['node'], 'Cmd': ['server.js'],
                       'Env': ['NODE_ENV=production'], 'Labels': {
                           'org.opencontainers.image.source': w.SOURCE,
                           'org.opencontainers.image.revision': r['source_sha']}}}


class ValidationTests(unittest.TestCase):
    def test_previous_qa_web_without_media_origin_is_valid_only_for_explicit_rollback_check(self):
        r = request()
        c = config(r)
        del c['services']['web']['environment']['ROGICHAT_MEDIA_STORAGE_ORIGINS']
        with self.assertRaises(w.Rejected):
            w.validate_compose(c, r)
        self.assertIs(w.validate_compose(c, r, previous_qa_without_media_origin=True), c)
        c['services']['web']['environment']['ROGICHAT_MEDIA_STORAGE_ORIGINS'] = '["https://unapproved.example"]'
        with self.assertRaises(w.Rejected):
            w.validate_compose(c, r, previous_qa_without_media_origin=True)

    def test_valid_environments(self):
        for env in ('qa', 'production'):
            r = request(env)
            self.assertEqual(w.validate_request(r), r)
            self.assertEqual(w.validate_compose(config(r), r), config(r))
            w.verify_image(image(r), r)

    def test_compose_normalized_external_network_preserves_input(self):
        # Sanitized network shape observed with Compose 2.40.3+ds1-0ubuntu1~24.04.1.
        for env in ('qa', 'production'):
            for normalized in (False, True):
                with self.subTest(env=env, normalized=normalized):
                    r = request(env)
                    c = config(r)
                    if normalized:
                        c['networks']['web']['ipam'] = {}
                    before = copy.deepcopy(c)
                    self.assertIs(w.validate_compose(c, r), c)
                    self.assertEqual(c, before)

    def test_compose_network_normalization_rejects_widening(self):
        for env in ('qa', 'production'):
            r = request(env)
            for key, value in [
                    ('ipam', None), ('ipam', []), ('ipam', False), ('ipam', ''),
                    ('ipam', {'driver': 'default'}), ('ipam', {'config': []}),
                    ('ipam', {'config': [{'subnet': '192.0.2.0/24'}]}),
                    ('external', False), ('external', None), ('external', 'true'),
                    ('external', 1), ('external', 1.0), ('external', {}),
                    ('name', 'unrelated-network'),
                    ('name', 'rogichat-prod-web' if env == 'qa' else 'rogichat-qa-web'),
                    ('driver', 'bridge'), ('driver_opts', {}), ('internal', True),
                    ('attachable', True), ('enable_ipv6', True), ('unknown', {})]:
                with self.subTest(env=env, key=key, value=value):
                    c = config(r)
                    c['networks']['web']['ipam'] = {}
                    c['networks']['web'][key] = value
                    with self.assertRaises(w.Rejected):
                        w.validate_compose(c, r)
            for location in ('top-level', 'service'):
                for replacement in (False, True):
                    with self.subTest(env=env, location=location, replacement=replacement):
                        c = config(r)
                        c['networks']['web']['ipam'] = {}
                        networks = c['networks'] if location == 'top-level' else c['services']['web']['networks']
                        networks['other'] = networks['web']
                        if replacement:
                            del networks['web']
                        with self.assertRaises(w.Rejected):
                            w.validate_compose(c, r)
            c = config(r)
            del c['networks']['web']['external']
            with self.assertRaises(w.Rejected):
                w.validate_compose(c, r)

    def test_invalid_requests(self):
        for key, value in [('environment', 'preview'), ('source_sha', '../main'), ('image', 'ghcr.io/h66rogi/rogichat-web:latest'),
                           ('image', 'ghcr.io/attacker/rogichat-web@sha256:' + 'b' * 64),
                           ('expires_at', int(time.time()) - 1), ('expires_at', int(time.time()) + 3601),
                           ('expires_at', True), ('request_id', '../../outside')]:
            with self.subTest(key=key, value=value), self.assertRaises((w.Rejected, ValueError)):
                w.validate_request(dict(request(), **{key: value}))

    def test_unknown_and_missing_fields_rejected(self):
        for transform in (lambda r: r.update(shell='id'), lambda r: r.pop('artifacts'),
                          lambda r: r['artifacts'].update(arbitrary='a' * 64),
                          lambda r: r['verification_runs'].update({'web.yml': True})):
            r = request()
            transform(r)
            with self.assertRaises(w.Rejected):
                w.validate_request(r)

    def test_duplicate_json(self):
        with self.assertRaises(w.Rejected):
            w.decode(b'{"environment":"qa","environment":"production"}')

    def test_host_binding(self):
        h = {'environment': 'qa', 'machine_id_sha256': w.digest(b'machine'), 'default_room_id': ''}
        w.validate_host(h, 'qa', b'machine\n', '')
        for env, machine in [('production', b'machine'), ('qa', b'another')]:
            with self.assertRaises(w.Rejected):
                w.validate_host(h, env, machine, '')

    def test_qa_promotion_same_image_completed_only(self):
        r = request('production')
        qa = {'environment': 'qa', 'source_sha': r['source_sha'], 'image': r['image'], 'status': 'completed',
              'request_id': r['request_id'], 'completed_at': int(time.time()) - 5, 'verification_runs': r['verification_runs'], 'default_room_id': ''}
        w.validate_qa(qa, r)
        for key, value in [('image', r['image'][:-1] + 'a'), ('status', 'attempted'), ('environment', 'production'),
                           ('source_sha', 'f' * 40), ('completed_at', int(time.time()) + 100)]:
            with self.subTest(key=key), self.assertRaises(w.Rejected):
                w.validate_qa(dict(qa, **{key: value}), r)

    def test_image_platform_identity_and_preview_rejected(self):
        r = request()
        for transform in (lambda d: d.update(RepoDigests=[]), lambda d: d.update(Architecture='arm64'),
                          lambda d: d['Config'].update(User='0'), lambda d: d['Config'].update(Cmd=['preview.js']),
                          lambda d: d['Config'].update(Env=['NODE_ENV=production', 'ENABLE_PREVIEW=1']),
                          lambda d: d['Config']['Labels'].update({'org.opencontainers.image.revision': 'f' * 40})):
            d = image(r)
            transform(d)
            with self.assertRaises(w.Rejected):
                w.verify_image(d, r)

    def test_compose_disallows_cross_env_secrets_ports_preview(self):
        r = request()
        for key, value in [('ports', ['3000:3000']), ('volumes', ['/etc:/host']), ('privileged', True),
                           ('command', ['sh']), ('env_file', ['/etc/secret'])]:
            c = config(r)
            c['services']['web'][key] = value
            with self.subTest(key=key), self.assertRaises(w.Rejected):
                w.validate_compose(c, r)
        for key, value in [('ROGICHAT_WEB_ENV', 'preview'), ('ROGICHAT_API_ORIGIN', 'https://api.rogi.chat'),
                           ('ROGICHAT_MEDIA_STORAGE_ORIGINS', '["https://unapproved.example"]'), ('DEMO', '1')]:
            c = config(r)
            c['services']['web']['environment'][key] = value
            with self.subTest(key=key), self.assertRaises(w.Rejected):
                w.validate_compose(c, r)
        c = config(r)
        c['networks']['web'] = {'name': 'rogichat-qa-web', 'driver': 'bridge'}
        with self.assertRaises(w.Rejected):
            w.validate_compose(c, r)

    def test_room_binding_and_invalid_room(self):
        r = request()
        r['default_room_id'] = 'not-a-uuid'
        with self.assertRaises((w.Rejected, ValueError)):
            w.validate_request(r)
        h = {'environment': 'qa', 'machine_id_sha256': w.digest(b'machine'), 'default_room_id': ''}
        with self.assertRaises(w.Rejected):
            w.validate_host(h, 'qa', b'machine', request()['request_id'])

    def test_production_main_ancestor_gate(self):
        r = request('production')
        with patch.object(w, 'github', side_effect=[{'object': {'sha': r['promotion_sha']}},
                           {'status': 'ahead', 'merge_base_commit': {'sha': r['source_sha']}}]):
            w.verify_promotion(r)
        with patch.object(w, 'github', return_value={'object': {'sha': '0' * 40}}):
            with self.assertRaisesRegex(w.Rejected, 'main promotion changed'):
                w.verify_promotion(r)
        with patch.object(w, 'github', side_effect=[{'object': {'sha': r['promotion_sha']}},
                           {'status': 'diverged', 'merge_base_commit': {'sha': '0' * 40}}]):
            with self.assertRaisesRegex(w.Rejected, 'main ancestor'):
                w.verify_promotion(r)

    def test_ci_exact_repo_branch_event_sha(self):
        r = request()
        good = {'head_sha': r['source_sha'], 'head_branch': 'qa', 'event': 'push', 'status': 'completed',
                'conclusion': 'success', 'repository': {'full_name': 'h66rogi/rogichat'},
                'head_repository': {'full_name': 'h66rogi/rogichat'}, 'path': '.github/workflows/web-publish.yml'}
        with patch.object(w, 'github', return_value=good):
            w.verify_runs({'web-publish.yml': 1}, r['source_sha'], 'qa')
        for key, value in [('head_branch', 'main'), ('event', 'pull_request'), ('head_sha', '0' * 40),
                           ('conclusion', 'failure'), ('head_repository', {'full_name': 'fork/rogichat'})]:
            with patch.object(w, 'github', return_value=dict(good, **{key: value})):
                with self.subTest(key=key), self.assertRaises(w.Rejected):
                    w.verify_runs({'web-publish.yml': 1}, r['source_sha'], 'qa')

    def test_event_publication_requires_successful_web_result_and_all_checks(self):
        r = request()
        r['verification_runs'] = dict.fromkeys(w.NEW_WORKFLOWS, 123)
        self.assertIs(w.validate_request(r), r)
        publisher = {'head_sha': r['source_sha'], 'head_branch': 'qa', 'event': 'workflow_run',
                     'status': 'completed', 'conclusion': 'success',
                     'repository': {'full_name': 'h66rogi/rogichat'},
                     'head_repository': {'full_name': 'h66rogi/rogichat'},
                     'path': '.github/workflows/qa-web-publication.yml',
                     'name': 'QA web image publication', 'run_attempt': 1}
        listing = {'total_count': 1, 'jobs': [{'name': 'Web publication result', 'run_id': 123,
                    'run_attempt': 1, 'status': 'completed', 'conclusion': 'success'}]}
        with patch.object(w, 'github', side_effect=[publisher, listing]):
            w.verify_runs({'qa-web-publication.yml': 123}, r['source_sha'], 'qa')
        for change in ('event', 'sha', 'other_component', 'job_name', 'job_attempt', 'job_failure'):
            run = copy.deepcopy(publisher)
            jobs = copy.deepcopy(listing)
            if change == 'event': run['event'] = 'pull_request'
            elif change == 'sha': run['head_sha'] = 'f' * 40
            elif change == 'other_component': run['path'] = '.github/workflows/qa-backend-publication.yml'
            elif change == 'job_name': jobs['jobs'][0]['name'] = 'publish'
            elif change == 'job_attempt': jobs['jobs'][0]['run_attempt'] = 2
            else: jobs['jobs'][0]['conclusion'] = 'failure'
            with self.subTest(change=change), patch.object(w, 'github', side_effect=[run, jobs]), \
                    self.assertRaises(w.Rejected):
                w.verify_runs({'qa-web-publication.yml': 123}, r['source_sha'], 'qa')
        r['verification_runs'].pop('mobile.yml')
        with self.assertRaises(w.Rejected):
            w.validate_request(r)

    def test_no_redirect_health(self):
        with self.assertRaises(w.Rejected):
            w.NoRedirect().redirect_request(None, None, 302, '', {}, 'https://elsewhere.invalid')


class CandidateBackendTests(unittest.TestCase):
    def containers(self, revision):
        value = {'State': {'Running': True, 'Health': {'Status': 'healthy'}},
                 'Config': {'Labels': {'org.opencontainers.image.revision': revision}}}
        return [json.dumps([value]).encode(), json.dumps([value]).encode()]

    def comparison(self, revision, files):
        return {'status': 'ahead', 'merge_base_commit': {'sha': revision},
                'total_commits': 1, 'files': [{'filename': path, 'status': 'modified'} for path in files]}

    def test_same_backend_source_needs_no_compare(self):
        r = request()
        with patch.object(w, 'docker', side_effect=self.containers(r['source_sha'])) as docker, \
                patch.object(w, 'github') as github:
            w.verify_api_compatibility(r)
        self.assertEqual(docker.call_count, 2)
        github.assert_not_called()

    def test_candidate_with_backend_change_is_rejected(self):
        r = request()
        revision = '1' * 40
        for path in ('apps/api/src/modules/messages/messages-core.service.ts', 'pnpm-lock.yaml',
                     'packages/contracts/index.ts', 'infrastructure/runtime/compose.app.yaml'):
            with self.subTest(path=path), patch.object(w, 'docker', side_effect=self.containers(revision)), \
                    patch.object(w, 'github', return_value=self.comparison(revision, [path])):
                with self.assertRaisesRegex(w.Rejected, 'newer backend'):
                    w.verify_api_compatibility(r)

    def test_web_only_changes_allow_older_backend(self):
        r = request()
        revision = '1' * 40
        files = ['apps/web/src/app/page.tsx', 'infrastructure/runtime/web/compose.qa.yaml']
        with patch.object(w, 'docker', side_effect=self.containers(revision)), \
                patch.object(w, 'github', return_value=self.comparison(revision, files)) as github:
            w.verify_api_compatibility(r)
        github.assert_called_once_with(f"compare/{revision}...{r['source_sha']}")

    def test_reviewed_shard_tests_allow_older_backend_but_other_api_paths_do_not(self):
        r = request()
        revision = '1' * 40
        files = ['apps/api/test/support/shard.mjs', 'apps/api/test/unit/shard.test.mjs']
        with patch.object(w, 'docker', side_effect=self.containers(revision)), \
                patch.object(w, 'github', return_value=self.comparison(revision, files)):
            w.verify_api_compatibility(r)
        for path in ('apps/api/src/main.ts', 'apps/api/Dockerfile',
                     'apps/api/test/unit/new-fixture.test.mjs'):
            with self.subTest(path=path), patch.object(w, 'docker', side_effect=self.containers(revision)), \
                    patch.object(w, 'github', return_value=self.comparison(revision, files + [path])), \
                    self.assertRaisesRegex(w.Rejected, 'newer backend'):
                w.verify_api_compatibility(r)

    def test_incomplete_comparison_and_divergent_backend_fail_closed(self):
        r = request()
        revision = '1' * 40
        for result in [dict(self.comparison(revision, []), files=[{'filename': 'apps/web/x'}] * 300),
                       dict(self.comparison(revision, []), status='diverged'),
                       dict(self.comparison(revision, []), files=[{'filename': 'apps/web/new',
                          'previous_filename': 'apps/api/old', 'status': 'renamed'}]),
                       dict(self.comparison(revision, []), files=[{'filename': 'apps/api/test/support/shard.mjs',
                          'previous_filename': 'apps/api/src/main.ts', 'status': 'renamed'}])]:
            with self.subTest(result=result), patch.object(w, 'docker', side_effect=self.containers(revision)), \
                    patch.object(w, 'github', return_value=result):
                with self.assertRaises(w.Rejected):
                    w.verify_api_compatibility(r)


class CandidatePageTests(unittest.TestCase):
    def source_item(self, identifier):
        source = f"export const CHANNEL_IDENTIFIER = '{identifier}';\n".encode()
        blob = __import__('hashlib').sha1(b'blob ' + str(len(source)).encode() + b'\0' + source).hexdigest()
        return {'path': w.CHANNEL_SOURCE, 'encoding': 'base64',
                'content': base64.b64encode(source).decode(), 'sha': blob}

    def test_source_bound_channel_requires_live_api(self):
        response = MagicMock(status=200)
        response.__enter__.return_value = response
        response.read.return_value = '{"name":"후로기"}'.encode()
        opener = MagicMock()
        opener.open.return_value = response
        with patch.object(w, 'github', return_value=self.source_item('hurogi')) as github, \
                patch.object(w.urllib.request, 'build_opener', return_value=opener):
            self.assertEqual(w.candidate_channel(request()), '후로기')
        github.assert_called_once_with(f'contents/{w.CHANNEL_SOURCE}?ref={request()["source_sha"]}')
        opener.open.assert_called_once_with('https://api.qa.rogi.chat/v1/channel/hurogi', timeout=15)

    def test_missing_channel_blocks_before_activation(self):
        opener = MagicMock()
        opener.open.side_effect = w.urllib.error.HTTPError('https://api.qa.rogi.chat/v1/channel/h66rogi',
                                                           404, 'missing', {}, io.BytesIO())
        with patch.object(w, 'github', return_value=self.source_item('h66rogi')), \
                patch.object(w.urllib.request, 'build_opener', return_value=opener):
            with self.assertRaisesRegex(w.Rejected, 'candidate channel API unavailable'):
                w.candidate_channel(request())

    def test_rendered_page_ignores_stream_scripts_but_rejects_visible_404(self):
        response = MagicMock(status=200)
        response.__enter__.return_value = response
        response.headers.get_content_type.return_value = 'text/html'
        opener = MagicMock()
        opener.open.return_value = response
        with patch.object(w.urllib.request, 'build_opener', return_value=opener):
            response.read.return_value = ('<html><body><h1>후로기</h1><script>페이지를 찾을 수 없어요</script>'
                                          '</body></html>').encode()
            w.candidate_page(request(), '후로기')
            response.read.return_value = '<html><body><h1>페이지를 찾을 수 없어요</h1></body></html>'.encode()
            with self.assertRaisesRegex(w.Rejected, 'did not render'):
                w.candidate_page(request(), '후로기')


class ExternalTests(unittest.TestCase):
    def setUp(self):
        self.now = 100.0
        self.starts = []
        self.response = MagicMock(status=200)
        self.response.__enter__.return_value = self.response
        self.opener = MagicMock()
        for target, kwargs in [
                ('urllib.request.build_opener', {'return_value': self.opener}),
                ('time.monotonic', {'side_effect': lambda: self.now}),
                ('time.sleep', {'side_effect': self.advance}),
                ('signal.getitimer', {'return_value': (0, 0)}),
                ('signal.setitimer', {}), ('signal.signal', {'return_value': w.signal.SIG_DFL})]:
            p = patch('web_release.' + target, **kwargs)
            mock = p.start()
            self.addCleanup(p.stop)
            setattr(self, target.split('.')[-1], mock)

    def advance(self, seconds):
        self.now += seconds

    def test_immediate_success_uses_verified_default_opener(self):
        self.opener.open.return_value = self.response
        w.external(request())
        self.build_opener.assert_called_once_with(w.NoRedirect)
        self.opener.open.assert_called_once_with('https://qa.rogi.chat/healthz', timeout=15)
        self.sleep.assert_not_called()
        self.response.__exit__.assert_called_once()
        self.setitimer.assert_has_calls([
            unittest.mock.call(w.signal.ITIMER_REAL, 90),
            unittest.mock.call(w.signal.ITIMER_REAL, 0)])
        self.assertEqual(self.signal.call_args, unittest.mock.call(w.signal.SIGALRM, w.signal.SIG_DFL))

    def test_transient_connection_dns_handshake_and_gateway_then_success(self):
        handshake = w.ssl.SSLError(1, 'certificate not ready')
        handshake.reason = 'TLSV1_ALERT_INTERNAL_ERROR'
        errors = [ConnectionRefusedError(w.errno.ECONNREFUSED, 'not ready'),
                  ConnectionResetError(w.errno.ECONNRESET, 'reset'), TimeoutError(),
                  w.socket.gaierror(w.socket.EAI_AGAIN, 'temporary DNS'),
                  handshake, w.ssl.SSLEOFError(8, 'handshake EOF')]
        for error in errors:
            for wrapped in (False, True):
                with self.subTest(error=error, wrapped=wrapped):
                    self.opener.open.reset_mock()
                    self.opener.open.side_effect = [w.urllib.error.URLError(error) if wrapped else error,
                                                   self.response]
                    w.external(request())
                    self.assertEqual(self.opener.open.call_count, 2)
        for code in (502, 503, 504):
            body = io.BytesIO(b'unavailable')
            self.opener.open.side_effect = [w.urllib.error.HTTPError('https://qa.rogi.chat/healthz', code,
                                                                  'temporary', {}, body), self.response]
            w.external(request())
            self.assertTrue(body.closed)

    def test_permanent_tls_dns_configuration_errors_are_not_retried(self):
        errors = [w.ssl.SSLCertVerificationError(1, 'untrusted certificate'),
                  w.ssl.SSLCertVerificationError(1, 'hostname mismatch'),
                  w.ssl.SSLError(1, 'wrong protocol'),
                  w.socket.gaierror(w.socket.EAI_NONAME, 'unknown host'),
                  PermissionError(w.errno.EACCES, 'denied'), ValueError('configuration')]
        for error in errors:
            for wrapped in (False, True):
                with self.subTest(error=error, wrapped=wrapped):
                    self.opener.open.reset_mock()
                    self.opener.open.side_effect = w.urllib.error.URLError(error) if wrapped else error
                    with self.assertRaises(type(self.opener.open.side_effect)):
                        w.external(request())
                    self.assertEqual(self.opener.open.call_count, 1)
        self.sleep.assert_not_called()

    def test_redirect_and_unexpected_http_status_fail_immediately(self):
        for code in (201, 204, 301, 302, 307, 308, 400, 401, 403, 404, 429, 500):
            with self.subTest(code=code):
                self.opener.open.reset_mock()
                self.opener.open.side_effect = w.urllib.error.HTTPError('https://qa.rogi.chat/healthz', code,
                                                                      'rejected', {}, io.BytesIO())
                with self.assertRaises(w.Rejected):
                    w.external(request())
                self.assertEqual(self.opener.open.call_count, 1)
        self.opener.open.side_effect = lambda *a, **kw: w.NoRedirect().redirect_request(
            None, None, 302, '', {}, 'https://elsewhere.invalid')
        with self.assertRaisesRegex(w.Rejected, 'redirect rejected'):
            w.external(request())
        self.sleep.assert_not_called()

    def test_non_error_unexpected_response_is_rejected(self):
        self.response.status = 204
        self.opener.open.return_value = self.response
        with self.assertRaises(w.Rejected):
            w.external(request())
        self.sleep.assert_not_called()

    def test_repeated_failure_caps_attempt_timeout_and_sleep_at_deadline(self):
        def failure(url, timeout):
            self.starts.append(self.now)
            self.assertLess(self.now, 190)
            self.assertLessEqual(timeout, min(15, 190 - self.now))
            self.advance(timeout)
            raise TimeoutError()
        self.opener.open.side_effect = failure
        with self.assertRaisesRegex(w.Rejected, 'deadline exceeded'):
            w.external(request())
        self.assertEqual(self.now, 190)
        self.assertEqual(self.starts, [100, 117, 134, 151, 168, 185])
        self.assertEqual(self.opener.open.call_args.kwargs['timeout'], 5)

    def test_fast_failures_stop_without_attempt_at_deadline(self):
        self.opener.open.side_effect = ConnectionRefusedError(w.errno.ECONNREFUSED, 'not ready')
        with self.assertRaisesRegex(w.Rejected, 'deadline exceeded'):
            w.external(request())
        self.assertEqual(self.opener.open.call_count, 45)
        self.assertEqual(self.now, 190)

    def test_final_sleep_is_capped_by_remaining_time(self):
        def failure(*args, **kwargs):
            self.advance(89.5)
            raise TimeoutError()
        self.opener.open.side_effect = failure
        with self.assertRaisesRegex(w.Rejected, 'deadline exceeded'):
            w.external(request())
        self.sleep.assert_called_once_with(0.5)
        self.assertEqual(self.now, 190)
        self.assertEqual(self.opener.open.call_count, 1)

    def test_late_success_is_rejected(self):
        def late(*args, **kwargs):
            self.advance(90)
            return self.response
        self.opener.open.side_effect = late
        with self.assertRaisesRegex(w.Rejected, 'deadline exceeded'):
            w.external(request())
        self.sleep.assert_not_called()

    def test_alarm_interrupts_blocked_probe_and_restores_handler(self):
        def blocked(*args, **kwargs):
            handler = self.signal.call_args_list[0].args[1]
            handler(w.signal.SIGALRM, None)
        self.opener.open.side_effect = blocked
        with self.assertRaisesRegex(w.Rejected, 'deadline exceeded'):
            w.external(request())
        self.setitimer.assert_called_with(w.signal.ITIMER_REAL, 0)
        self.signal.assert_called_with(w.signal.SIGALRM, w.signal.SIG_DFL)
        self.sleep.assert_not_called()

    def test_later_caller_timer_restored_with_elapsed_budget_on_success_and_failure(self):
        for success in (False, True):
            with self.subTest(success=success):
                self.getitimer.return_value = (300, 0)
                def probe(*args, **kwargs):
                    self.advance(7)
                    if success:
                        return self.response
                    raise ValueError('configuration rejected')
                self.opener.open.side_effect = probe
                if success:
                    w.external(request())
                else:
                    with self.assertRaises(ValueError):
                        w.external(request())
                self.setitimer.assert_called_with(w.signal.ITIMER_REAL, 293, 0)
                self.signal.assert_called_with(w.signal.SIGALRM, w.signal.SIG_DFL)

    def test_earlier_caller_deadline_invokes_original_handler(self):
        self.getitimer.return_value = (5, 0)
        original = MagicMock(side_effect=w.Rejected('caller deadline'))
        self.signal.return_value = original
        def blocked(*args, **kwargs):
            self.advance(5)
            self.signal.call_args_list[0].args[1](w.signal.SIGALRM, None)
        self.opener.open.side_effect = blocked
        with self.assertRaisesRegex(w.Rejected, 'caller deadline'):
            w.external(request())
        original.assert_called_once_with(w.signal.SIGALRM, None)
        self.assertEqual(self.setitimer.call_args_list[0], unittest.mock.call(w.signal.ITIMER_REAL, 5))
        self.setitimer.assert_called_with(w.signal.ITIMER_REAL, 0, 0)
        self.signal.assert_called_with(w.signal.SIGALRM, original)
        self.sleep.assert_not_called()

    def test_caller_timer_preserved_after_health_deadline(self):
        self.getitimer.return_value = (300, 0)
        self.opener.open.side_effect = TimeoutError()
        with self.assertRaisesRegex(w.Rejected, 'deadline exceeded'):
            w.external(request())
        self.setitimer.assert_called_with(w.signal.ITIMER_REAL, 210, 0)

    def test_periodic_caller_timer_preserves_interval_and_phase(self):
        self.getitimer.return_value = (5, 10)
        self.signal.return_value = MagicMock()
        def blocked(*args, **kwargs):
            self.advance(6)
            self.signal.call_args_list[0].args[1](w.signal.SIGALRM, None)
        self.opener.open.side_effect = blocked
        with self.assertRaisesRegex(w.Rejected, 'deadline exceeded'):
            w.external(request())
        self.setitimer.assert_called_with(w.signal.ITIMER_REAL, 9, 10)


class ExternalAlarmTests(unittest.TestCase):
    def test_real_alarm_interrupts_blocking_io_without_network(self):
        previous = w.signal.getsignal(w.signal.SIGALRM)
        opener = MagicMock()
        opener.open.side_effect = lambda *args, **kwargs: time.sleep(1)
        # Leave 20ms for the real Unix timer; no host or network is contacted.
        with patch.object(w.time, 'monotonic', side_effect=[0, 89.98, 89.98]), \
                patch.object(w.urllib.request, 'build_opener', return_value=opener):
            with self.assertRaisesRegex(w.Rejected, 'deadline exceeded'):
                w.external(request())
        self.assertEqual(w.signal.getsignal(w.signal.SIGALRM), previous)
        self.assertEqual(w.signal.getitimer(w.signal.ITIMER_REAL), (0, 0))


class EdgeSnapshotTests(unittest.TestCase):
    def setUp(self):
        self.r = request()
        self.caddyfile = b'import /etc/caddy/sites/*.caddy'
        self.r.update(caddy_sha256=w.digest(self.caddyfile), bootstrap_sha256=w.digest(b'bootstrap'))
        self.caddy = {
            'Id': 'existing-caddy', 'Image': 'existing-image', 'Name': '/caddy',
            'State': {'Running': True}, 'HostConfig': {'ReadonlyRootfs': True},
            'NetworkSettings': {'Networks': {'rogichat-qa-web': {}, 'api-network': {}}},
            'Mounts': [
                {'Type': 'bind', 'Source': str(w.SITE.parent), 'Destination': '/etc/caddy/sites', 'RW': False},
                {'Type': 'bind', 'Source': str(w.CADDY), 'Destination': '/etc/caddy/Caddyfile', 'RW': False},
                {'Type': 'volume', 'Source': '/volumes/data', 'Destination': '/data', 'RW': True,
                 'Name': 'caddy-data', 'Driver': 'local', 'Mode': 'z', 'Propagation': ''},
                {'Type': 'volume', 'Source': '/volumes/config', 'Destination': '/config', 'RW': True}],
        }
        self.network = {'Driver': 'bridge', 'Internal': False, 'Containers': {'caddy': {'Name': 'caddy'}}}

    def snapshot(self, caddy):
        def read(path):
            return self.caddyfile if path == w.CADDY else b'bootstrap'
        with patch.object(w, 'protected', side_effect=read), patch.object(w, 'docker', side_effect=[
                b'caddy', json.dumps([caddy]).encode(), json.dumps([self.network]).encode()]):
            return w.snapshot_edge(self.r)

    def test_mount_order_only_is_accepted_without_dropping_values(self):
        baseline = self.snapshot(self.caddy)
        reordered = copy.deepcopy(self.caddy)
        reordered['Mounts'].reverse()
        w.require(self.snapshot(reordered) == baseline, 'edge changed')
        self.assertEqual(baseline[0]['Mounts'], sorted(self.caddy['Mounts'], key=lambda m: m['Destination']))

    def test_actual_mount_changes_are_rejected(self):
        baseline = self.snapshot(self.caddy)
        for index in (0, 2):
            for key, value in [('Source', '/changed'), ('Type', 'tmpfs'), ('RW', index == 0),
                               ('Destination', '/changed'), ('Mode', 'changed'), ('Driver', 'changed'),
                               ('Propagation', 'changed'), ('Name', 'changed')]:
                changed = copy.deepcopy(self.caddy)
                changed['Mounts'][index][key] = value
                with self.subTest(index=index, key=key), self.assertRaises(w.Rejected):
                    w.require(self.snapshot(changed) == baseline, 'edge changed')

    def test_duplicate_mount_destinations_are_rejected(self):
        for conflicting in (False, True):
            changed = copy.deepcopy(self.caddy)
            duplicate = dict(changed['Mounts'][0])
            if conflicting:
                duplicate.update(Source='/changed', RW=True)
            changed['Mounts'].append(duplicate)
            with self.subTest(conflicting=conflicting), self.assertRaisesRegex(w.Rejected, 'duplicate Caddy mount'):
                self.snapshot(changed)

    def test_identity_host_config_and_network_changes_are_rejected(self):
        baseline = self.snapshot(self.caddy)
        for key, value in [('Id', 'replacement'), ('Image', 'replacement'), ('HostConfig', {}),
                           ('State', {'Running': False}),
                           ('NetworkSettings', {'Networks': {'rogichat-qa-web': {}, 'changed-network': {}}})]:
            changed = dict(self.caddy, **{key: value})
            with self.subTest(key=key), self.assertRaises(w.Rejected):
                w.require(self.snapshot(changed) == baseline, 'edge changed')

    def test_unowned_network_member_is_rejected(self):
        self.network['Containers']['foreign'] = {'Name': 'foreign'}
        with self.assertRaises(w.Rejected):
            self.snapshot(self.caddy)

    def test_qa_media_peers_are_allowed_but_pinned_during_activation(self):
        self.network['Containers']['old-web-id'] = {'Name': 'rogichat-qa-web'}
        self.network['Containers']['media-id'] = {'Name': 'rogichat-qa-media-gateway'}
        self.network['Containers']['overlay-id'] = {'Name': 'rogichat-qa-overlay'}
        baseline = self.snapshot(self.caddy)
        self.assertEqual(baseline[2], (('caddy', 'caddy'),
                                       ('rogichat-qa-media-gateway', 'media-id'),
                                       ('rogichat-qa-overlay', 'overlay-id')))
        self.network['Containers']['new-web-id'] = self.network['Containers'].pop('old-web-id')
        self.assertEqual(self.snapshot(self.caddy), baseline)
        self.network['Containers']['replacement-id'] = self.network['Containers'].pop('media-id')
        self.assertNotEqual(self.snapshot(self.caddy), baseline)

    def test_production_rejects_qa_media_peers(self):
        self.r = request('production')
        self.caddy['NetworkSettings']['Networks'] = {'rogichat-prod-web': {}, 'api-network': {}}
        self.network['Containers']['media-id'] = {'Name': 'rogichat-qa-media-gateway'}
        with self.assertRaises(w.Rejected):
            self.snapshot(self.caddy)


class ArchiveTests(unittest.TestCase):
    def approval(self):
        return {'artifact_id': 1, 'artifact_sha256': 'sha256:' + 'a' * 64, 'export_sha': 'a' * 40,
                'export_run': 123, 'export_attempt': 1, 'descriptor_sha256': 'b' * 64,
                'config_id': 'sha256:' + 'e' * 64, 'execution_identity': 'config',
                'execution_id': 'sha256:' + 'e' * 64, 'validator_sha256': 'f' * 64, 'web_validator_sha256': 'd' * 64}

    def test_complete_archive_crypto_chain_and_tamper(self):
        self.check_archive_crypto_chain('workflow_dispatch')

    def test_automatic_archive_crypto_chain_and_tamper(self):
        self.check_archive_crypto_chain('workflow_run')

    def check_archive_crypto_chain(self, event):
        # Isolated instance of the real reused archive core, configured like the
        # publisher. Only HTTP metadata is stubbed; the full verifier chain is real.
        spec = importlib.util.spec_from_file_location('test_web_archive_core', Path(w.__file__).parent.parent / 'web/archive.py')
        validator = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(validator)
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            r = request()
            r['verification_runs'] = {name: i + 10 for i, name in enumerate(sorted(w.WORKFLOWS))}
            a = self.approval()
            r['archive'] = a
            folder = root / r['source_sha'] / 'web-export'
            folder.mkdir(parents=True)
            d = image(r)
            d['Config'].update(WorkingDir='/app/apps/web', ExposedPorts={'3000/tcp': {}},
                               Env=['NODE_ENV=production', 'PORT=3000', 'HOSTNAME=0.0.0.0'])
            layer = b'synthetic layer'
            c = {'architecture': 'amd64', 'os': 'linux', 'config': d['Config'],
                 'rootfs': {'type': 'layers', 'diff_ids': ['sha256:' + w.digest(layer)]}}
            raw = json.dumps(c).encode()
            a['config_id'] = a['execution_id'] = 'sha256:' + w.digest(raw)
            config_name = w.digest(raw) + '.json'
            with tarfile.open(folder / 'runtime.tar', 'w') as tar:
                for name, data in [(config_name, raw), ('layer/layer.tar', layer),
                                   ('manifest.json', json.dumps([{'Config': config_name, 'RepoTags': [], 'Layers': ['layer/layer.tar']}]).encode())]:
                    member = tarfile.TarInfo(name)
                    member.size = len(data)
                    tar.addfile(member, io.BytesIO(data))
            manifest = {'schemaVersion': 2, 'mediaType': 'application/vnd.oci.image.manifest.v1+json',
                        'config': {'digest': a['config_id']}, 'layers': [{}]}
            raw_manifest = json.dumps(manifest).encode()
            r['image'] = 'ghcr.io/h66rogi/rogichat-web@sha256:' + w.digest(raw_manifest)
            (folder / 'runtime.manifest.json').write_bytes(raw_manifest)
            descriptor = {'version': 1, 'repository': 'h66rogi/rogichat', 'source_sha': r['source_sha'],
                          'producer': {'sha': a['export_sha'], 'run_id': a['export_run'], 'run_attempt': a['export_attempt'],
                                       'event': event, 'ref': 'refs/heads/qa'},
                          'verification_runs': r['verification_runs'], 'images': {'runtime': {
                              'image': r['image'], 'config_id': a['config_id'],
                              'archive_sha256': validator.core.file_hash(folder / 'runtime.tar')}}}
            (folder / 'descriptor.json').write_text(json.dumps(descriptor))
            a['descriptor_sha256'] = w.digest((folder / 'descriptor.json').read_bytes())
            publication_id = r['verification_runs']['web-publish.yml']
            proof_value = {'schemaVersion': 1, 'repository': validator.core.REPOSITORY,
                           'sourceSha': r['source_sha'], 'image': r['image'], 'checkedImageId': a['config_id'],
                           'platform': 'linux/amd64', 'publicationAttempt': 1,
                           'publicationRun': f'https://github.com/{validator.core.REPOSITORY}/actions/runs/{publication_id}',
                           'runtimeEnvironmentsVerified': ['qa', 'production'],
                           'verification': [{'workflow': name, 'id': identity, 'attempt': 1, 'sha': r['source_sha']}
                                            for name, identity in r['verification_runs'].items() if name != 'web-publish.yml']}
            with zipfile.ZipFile(folder / 'publication-proof.zip', 'w') as proof:
                proof.writestr('web-publication-proof.json', json.dumps(proof_value))
            proof_bytes = (folder / 'publication-proof.zip').read_bytes()
            with zipfile.ZipFile(folder / 'export.zip', 'w') as bundle:
                for filename in validator.core.FILES:
                    bundle.write(folder / filename, filename)
            a['artifact_sha256'] = 'sha256:' + validator.core.file_hash(folder / 'export.zip')
            d.update(Id=a['execution_id'], RepoDigests=[], RootFS={'Layers': c['rootfs']['diff_ids']})
            def read(path, mode=None, directory=False, read=True):
                return path.read_bytes() if read else None
            run = {'head_sha': r['source_sha'], 'head_branch': 'qa', 'event': 'push',
                   'status': 'completed', 'conclusion': 'success', 'run_attempt': 1,
                   'run_started_at': '2026-09-20T01:00:00Z',
                   'repository': {'full_name': validator.core.REPOSITORY},
                   'head_repository': {'full_name': validator.core.REPOSITORY}}
            metadata = {f'actions/runs/{identity}/attempts/1': {**run, 'id': identity, 'path': '.github/workflows/' + name}
                        for name, identity in r['verification_runs'].items()}
            metadata[f"actions/runs/{a['export_run']}/attempts/{a['export_attempt']}"] = {
                **run, 'id': a['export_run'], 'head_sha': a['export_sha'], 'event': event,
                'path': '.github/workflows/web-export.yml', 'run_started_at': '2026-09-20T02:00:00Z'}
            metadata[f"actions/artifacts/{a['artifact_id']}"] = {
                'expired': False, 'digest': a['artifact_sha256'],
                'workflow_run': {'id': a['export_run'], 'head_sha': a['export_sha']},
                'name': f"web-{r['source_sha']}-{a['export_run']}-{a['export_attempt']}"}
            metadata[f'actions/runs/{publication_id}/artifacts?per_page=100'] = {
                'total_count': 1, 'artifacts': [{'id': 300, 'expired': False,
                    'digest': 'sha256:' + w.digest(proof_bytes),
                    'name': f"web-publication-proof-{r['source_sha']}-1",
                    'created_at': '2026-09-20T01:05:00Z',
                    'workflow_run': {'id': publication_id, 'head_sha': r['source_sha']}}]}
            metadata[f"compare/{r['source_sha']}...{a['export_sha']}"] = {
                'status': 'identical', 'merge_base_commit': {'sha': r['source_sha']}}
            def public_metadata(http_request, timeout):
                self.assertFalse(http_request.has_header('Authorization'))
                self.assertNotIn('/zip', http_request.full_url)
                key = http_request.full_url.split('/repos/' + validator.core.REPOSITORY + '/')[1]
                return io.BytesIO(json.dumps(metadata[key]).encode())
            with patch.object(w, 'RELEASES', root), patch.object(w, 'protected', side_effect=read), patch.object(w, 'load_archive_validator', return_value=validator), patch.object(validator.core.urllib.request, 'urlopen', side_effect=public_metadata) as http, patch.object(validator, 'download_proof', side_effect=AssertionError('host ZIP download forbidden')), patch.object(validator.core, 'command', side_effect=AssertionError('host credential command forbidden')):
                w.verify_archive(r, d)
                self.assertEqual(http.call_count, 11)
                (folder / 'export.zip').write_bytes(b'tampered')
                with self.assertRaises(ValueError):
                    w.verify_archive(r, d)

    def test_explicit_archive_schema(self):
        r = request()
        r['archive'] = self.approval()
        w.validate_request(r)
        for key, value in [('execution_identity', 'auto'), ('execution_id', 'sha256:' + '0' * 64),
                           ('artifact_id', True), ('artifact_sha256', 'a' * 64)]:
            bad = copy.deepcopy(r)
            bad['archive'][key] = value
            with self.subTest(key=key), self.assertRaises(w.Rejected):
                w.validate_request(bad)

    def test_no_repo_digest_fallback(self):
        r = request()
        d = image(r)
        d['RepoDigests'] = []
        with self.assertRaises(w.Rejected):
            w.verify_image(d, r)

    def test_typed_execution_identity_and_rootfs(self):
        r = request()
        a = self.approval()
        d = image(r)
        d.update(Id=a['execution_id'], RepoDigests=[], RootFS={'Layers': ['sha256:' + '1' * 64]})
        c = {'rootfs': {'diff_ids': d['RootFS']['Layers']}, '_archive_manifest': None}
        w.verify_archive_identity(d, c, a, r)
        bad = copy.deepcopy(d)
        bad['RootFS']['Layers'] = ['sha256:' + '2' * 64]
        with self.assertRaises(w.Rejected):
            w.verify_archive_identity(bad, c, a, r)
        a.update(execution_identity='archive-manifest', execution_id='sha256:' + '3' * 64)
        descriptor = {'digest': a['execution_id'], 'mediaType': 'application/vnd.oci.image.manifest.v1+json', 'size': 123}
        c['_archive_manifest'] = descriptor
        d.update(Id=a['execution_id'], Descriptor=descriptor)
        w.verify_archive_identity(d, c, a, r)
        d['Descriptor'] = dict(descriptor, size=124)
        with self.assertRaises(w.Rejected):
            w.verify_archive_identity(d, c, a, r)

    def test_rendered_execution_id_is_explicit(self):
        r = request()
        c = config(r)
        r['archive'] = self.approval()
        with self.assertRaises(w.Rejected):
            w.validate_compose(c, r)
        c['services']['web']['image'] = w.execution(r)
        w.validate_compose(c, r)


class ApplyTests(unittest.TestCase):
    def setUp(self):
        self.real_external = w.external
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.current = root / 'current/compose.json'
        self.site = root / 'sites/web.caddy'
        self.receipts = root / 'receipts'
        for p in (self.current.parent, self.site.parent, self.receipts):
            p.mkdir()
        self.r = request()
        self.paths = {k: root / k for k in self.r['artifacts']}
        for p in self.paths.values():
            p.write_bytes(b'reviewed')
        self.edge = ({'Id': 'existing-caddy'}, {'api-network', 'rogichat-qa-web'})
        self.prepared = (self.r, self.paths, dict.fromkeys(self.paths, b'reviewed'), config(self.r), 'image-id', self.edge, '후로기')
        def read(path, mode=None, directory=False):
            if path == w.REQUEST:
                return json.dumps(self.r).encode()
            if path == w.HOST:
                return json.dumps({'environment': 'qa', 'machine_id_sha256': w.digest(b'machine'), 'default_room_id': ''}).encode()
            if path == w.MACHINE:
                return b'machine'
            return None if directory else path.read_bytes()
        for name, value in [('CURRENT', self.current), ('SITE', self.site), ('RECEIPTS', self.receipts)]:
            p = patch.object(w, name, value)
            p.start()
            self.addCleanup(p.stop)
        for name, kwargs in [('protected', {'side_effect': read}), ('snapshot_edge', {'return_value': self.edge}),
                             ('compose', {}), ('healthy', {}), ('external', {}), ('candidate_page', {}),
                             ('verify_api_compatibility', {}), ('reload_caddy', {})]:
            p = patch.object(w, name, **kwargs)
            setattr(self, name, p.start())
            self.addCleanup(p.stop)

    def test_first_release_failed_health_removes_only_web(self):
        self.healthy.side_effect = w.Rejected('unhealthy')
        with self.assertRaisesRegex(w.Rejected, 'previous web state restored'):
            w.apply(self.prepared)
        self.assertFalse(self.current.exists())
        self.assertFalse(self.site.exists())
        self.assertIn(unittest.mock.call('rm', '-s', '-f', 'web'), self.compose.call_args_list)
        self.assertEqual((self.receipts / self.r['request_id']).read_text(), 'attempted\n')

    def test_external_retry_exhaustion_rolls_back_first_activation(self):
        self.external.side_effect = self.real_external
        opener = MagicMock()
        opener.open.side_effect = w.urllib.error.HTTPError('https://qa.rogi.chat/healthz', 503,
                                                        'not ready', {}, io.BytesIO())
        with patch.object(w.urllib.request, 'build_opener', return_value=opener), \
                patch.object(w.time, 'monotonic', side_effect=[0, 0, 0, 90]):
            with self.assertRaisesRegex(w.Rejected, 'previous web state restored'):
                w.apply(self.prepared)
        self.assertFalse(self.current.exists())
        self.assertFalse(self.site.exists())
        self.assertIn(unittest.mock.call('rm', '-s', '-f', 'web'), self.compose.call_args_list)
        self.assertEqual(self.reload_caddy.call_count, 2)
        self.assertEqual((self.receipts / self.r['request_id']).read_text(), 'attempted\n')

    def test_failed_external_restores_previous_web_and_site(self):
        old = copy.deepcopy(config(self.r))
        old['services']['web']['image'] = 'ghcr.io/h66rogi/rogichat-web@sha256:' + '9' * 64
        original = json.dumps(old).encode()
        self.current.write_bytes(original)
        self.site.write_bytes(b'previous-site')
        self.external.side_effect = [None, w.Rejected('external failed'), None]
        with patch.object(w, 'docker', return_value=b'[{"Id":"old-image"}]'):
            with self.assertRaisesRegex(w.Rejected, 'previous web state restored'):
                w.apply(self.prepared)
        self.assertEqual(self.current.read_bytes(), original)
        self.assertEqual(self.site.read_bytes(), b'previous-site')
        self.assertEqual(self.reload_caddy.call_count, 2)

    def test_source_changes_abort_before_activation(self):
        self.paths['compose'].write_bytes(b'changed')
        with self.assertRaisesRegex(w.Rejected, 'artifacts changed'):
            w.apply(self.prepared)
        self.compose.assert_not_called()
        self.assertFalse(list(self.receipts.iterdir()))

    def test_caddy_changes_abort_before_activation(self):
        self.snapshot_edge.return_value = ({'Id': 'replacement'}, set())
        with self.assertRaisesRegex(w.Rejected, 'edge changed'):
            w.apply(self.prepared)
        self.compose.assert_not_called()

    def test_request_replay_cannot_reactivate(self):
        (self.receipts / self.r['request_id']).write_text('attempted\n')
        with self.assertRaises(FileExistsError):
            w.apply(self.prepared)
        self.compose.assert_not_called()

    def test_success_writes_completed_receipt_only_after_verification(self):
        w.apply(self.prepared)
        evidence = json.loads((self.receipts / self.r['request_id']).read_text())
        self.assertEqual(evidence['status'], 'completed')
        self.assertEqual(evidence['image'], self.r['image'])
        self.external.assert_called_once()
        self.candidate_page.assert_called_once_with(self.r, '후로기')

    def test_candidate_page_failure_rolls_back_existing_web(self):
        old = copy.deepcopy(config(self.r))
        old['services']['web']['image'] = 'ghcr.io/h66rogi/rogichat-web@sha256:' + '9' * 64
        original = json.dumps(old).encode()
        self.current.write_bytes(original)
        self.site.write_bytes(b'previous-site')
        self.candidate_page.side_effect = w.Rejected('candidate channel page did not render')
        with patch.object(w, 'docker', return_value=b'[{"Id":"old-image"}]'):
            with self.assertRaisesRegex(w.Rejected, 'previous web state restored'):
                w.apply(self.prepared)
        self.assertEqual(self.current.read_bytes(), original)
        self.assertEqual(self.site.read_bytes(), b'previous-site')
        self.assertEqual(self.external.call_count, 3)

    def test_receipt_write_failure_rolls_back_activation(self):
        original_atomic = w.atomic
        def fail_receipt(path, data):
            if path == self.receipts / self.r['request_id']:
                raise OSError('simulated disk failure')
            original_atomic(path, data)
        with patch.object(w, 'atomic', side_effect=fail_receipt):
            with self.assertRaisesRegex(w.Rejected, 'previous web state restored'):
                w.apply(self.prepared)
        self.assertFalse(self.current.exists())
        self.assertFalse(self.site.exists())
        self.assertEqual((self.receipts / self.r['request_id']).read_text(), 'attempted\n')

    def test_failed_cleanup_is_explicit(self):
        self.healthy.side_effect = w.Rejected('unhealthy')
        self.compose.side_effect = [None, w.Rejected('cleanup failed')]
        with self.assertRaisesRegex(w.Rejected, 'rollback incomplete'):
            w.apply(self.prepared)


if __name__ == '__main__':
    unittest.main()
