"""Offline adversarial release contracts; never invokes Docker or a live host."""
import copy
import json
import io
import importlib.util
import tarfile
import zipfile
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch

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
    return {'name': name, 'services': {'web': {
        'image': r['image'], 'container_name': name, 'user': '10001:10001', 'read_only': True,
        'networks': {'web': None}, 'cap_drop': ['ALL'], 'security_opt': ['no-new-privileges:true'],
        'environment': {'NODE_ENV': 'production', 'NEXT_TELEMETRY_DISABLED': '1', 'HOSTNAME': '0.0.0.0', 'PORT': '3000',
                        'ROGICHAT_WEB_ENV': r['environment'], 'ROGICHAT_DEFAULT_ROOM_ID': r['default_room_id'],
                        'ROGICHAT_API_ORIGIN': 'https://api.qa.rogi.chat' if r['environment'] == 'qa' else 'https://api.rogi.chat'}}},
        'networks': {'web': {'name': name, 'external': True}}}


def image(r):
    return {'Id': 'sha256:' + '1' * 64, 'RepoDigests': [r['image']], 'Os': 'linux', 'Architecture': 'amd64',
            'Config': {'User': '10001:10001', 'Entrypoint': ['node'], 'Cmd': ['server.js'],
                       'Env': ['NODE_ENV=production'], 'Labels': {
                           'org.opencontainers.image.source': w.SOURCE,
                           'org.opencontainers.image.revision': r['source_sha']}}}


class ValidationTests(unittest.TestCase):
    def test_valid_environments(self):
        for env in ('qa', 'production'):
            r = request(env)
            self.assertEqual(w.validate_request(r), r)
            self.assertEqual(w.validate_compose(config(r), r), config(r))
            w.verify_image(image(r), r)

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
        for key, value in [('ROGICHAT_WEB_ENV', 'preview'), ('ROGICHAT_API_ORIGIN', 'https://api.rogi.chat'), ('DEMO', '1')]:
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

    def test_no_redirect_health(self):
        with self.assertRaises(w.Rejected):
            w.NoRedirect().redirect_request(None, None, 302, '', {}, 'https://elsewhere.invalid')


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
        self.prepared = (self.r, self.paths, dict.fromkeys(self.paths, b'reviewed'), config(self.r), 'image-id', self.edge)
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
                             ('compose', {}), ('healthy', {}), ('external', {}), ('reload_caddy', {})]:
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
