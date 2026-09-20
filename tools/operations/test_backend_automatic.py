"""No host/network/DB access. Included by the existing backend CI test glob."""
import subprocess
import unittest
from pathlib import Path


class ProbeTests(unittest.TestCase):
    def test_node_probe_boundaries(self):
        subprocess.run(['node', '--test', str(Path(__file__).with_name('test_backend_schema_readonly.mjs'))], check=True)

import copy
import json
import tempfile
import time
from unittest.mock import MagicMock, patch
import backend_automatic_release as auto


def policy():
    return {'version': 1, 'environment': 'qa', 'release_helper_sha256': 'a'*64,
        'archive_helper_sha256': 'b'*64, 'probe_sha256': 'c'*64, 'probe_image': 'sha256:'+'d'*64,
        'probe_source_sha': 'e'*40, 'schema_sha256': 'f'*64, 'database_host_sha256': 'a'*64,
        'ca_sha256': 'b'*64, 'edge_network': 'rogichat-qa_edge',
        'templates': {key:'c'*64 for key in auto.TEMPLATES},
        'migrations': [{'name':'20260101000000_fixture','checksum':'d'*64}]}


def request():
    return {'environment':'qa', 'source_sha':'a'*40, 'request_id':'11111111-1111-4111-8111-111111111111',
        'expires_at':int(time.time())+300, 'policy_sha256':auto.digest(json.dumps(policy(),sort_keys=True,separators=(',',':')).encode()),
        'previous_state_sha256':'b'*64, 'verification_runs':{key:1 for key in auto.WORKFLOWS},
        'archive':{'export_sha':'c'*40,'export_run':1,'export_attempt':1,'artifact_id':1,
                   'artifact_sha256':'sha256:'+'d'*64,'runtime_config_id':'sha256:'+'e'*64,
                   'execution_identity':'config','runtime_execution_id':'sha256:'+'e'*64}}


class AutomaticTests(unittest.TestCase):
    def test_valid_contract(self):
        auto.validate_policy(policy())
        auto.validate_request(request(), policy())

    def test_policy_cannot_widen_environment_baseline_or_templates(self):
        for key,value in [('environment','prod'),('version',True),('probe_image','latest'),
                          ('migrations',[]),('migrations',policy()['migrations']*2),
                          ('templates',{}),('schema_sha256','')]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                auto.validate_policy({**policy(),key:value})

    def test_untrusted_request_fields_and_expiry(self):
        for key,value in [('environment','prod'),('expires_at',0),('expires_at',True),
                          ('expires_at',int(time.time())+7200),('source_sha','../qa'),
                          ('policy_sha256','0'*64),('verification_runs',{})]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                auto.validate_request({**request(),key:value},policy())
        with self.assertRaises(ValueError):
            auto.validate_request({**request(),'migration_image':'unwanted'},policy())

    def test_archive_identity_is_typed_and_exact(self):
        for key,value in [('execution_identity','auto'),('runtime_execution_id','latest'),
                          ('runtime_execution_id','sha256:'+'f'*64),('export_attempt',True)]:
            r=request(); r['archive'][key]=value
            with self.assertRaises(ValueError): auto.validate_request(r,policy())

    def test_source_must_still_be_current_qa(self):
        archive=MagicMock(); archive.api.return_value={'object':{'sha':'b'*40}}
        with self.assertRaises(ValueError): auto.fresh(request(),archive)
        archive.verify_source.assert_not_called()
        archive.api.return_value={'object':{'sha':'a'*40}}
        auto.fresh(request(),archive)
        archive.verify_source.assert_called_once()

    @patch.object(auto,'protected',return_value=b'print("never execute")')
    def test_import_rejects_unpinned_helper(self,_):
        with self.assertRaises(ValueError): auto.pinned_module('backend_release','0'*64)

    @patch.object(auto,'verify_candidate_schema')
    def test_archive_validation_does_not_load_or_execute(self,schema):
        r=request(); helper=MagicMock(); helper.RELEASES=Path('/fixture')
        archive=MagicMock()
        expected={'config_id':r['archive']['runtime_config_id']}
        descriptor={'source_sha':r['source_sha'],'verification_runs':r['verification_runs'],'images':{'runtime':expected}}
        archive.validate_zip.return_value=(descriptor,{'runtime':{'_archive_manifest':None}})
        candidate=auto.verify_candidate(r,policy(),helper,archive,Path('/fixture/verified'))
        archive.verify_provenance.assert_called_once_with(descriptor,r['archive'])
        schema.assert_called_once_with(r,policy(),archive)
        helper.docker.assert_not_called()
        helper.docker.return_value=b'[{}]'
        auto.load_candidate(r,helper,Path('/fixture/verified'),candidate)
        self.assertEqual(helper.docker.call_args_list[0].args,('load','--input','/fixture/verified/runtime.tar'))
        self.assertNotIn('migration',str(helper.docker.call_args_list))
        helper.verify_archive_image_data.assert_called_once()

    @patch.object(auto,'verify_candidate_schema')
    def test_bad_archive_manifest_rejected_before_load(self,_):
        r=request(); r['archive']['execution_identity']='archive-manifest'
        helper=MagicMock(); helper.RELEASES=Path('/fixture'); archive=MagicMock()
        archive.validate_zip.return_value=({'source_sha':r['source_sha'],'verification_runs':r['verification_runs'],
            'images':{'runtime':{'config_id':r['archive']['runtime_config_id']}}}, {'runtime':{'_archive_manifest':None}})
        with self.assertRaises(ValueError): auto.verify_candidate(r,policy(),helper,archive,Path('/fixture/out'))
        helper.docker.assert_not_called()

    def test_failed_candidate_health_consumes_and_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(auto,'STATE',Path(directory)), \
             patch.object(auto,'protected',return_value=b'{}'), patch.object(auto,'load_candidate'), \
             patch.object(auto,'fresh'), patch.object(auto,'verify_current'), patch.object(auto,'schema_probe') as probe:
            helper=MagicMock(); helper.APP=Path('/fixture/app'); helper.IMAGES=Path('/fixture/images'); helper.UNIT=Path('/fixture/unit')
            helper.wait_health.side_effect=ValueError('schema mismatch')
            files={key:key.encode() for key in auto.TEMPLATES}
            with self.assertRaises(ValueError):
                auto.activate(request(),policy(),helper,files,'edge',{},('sha256:'+'e'*64,None,None),MagicMock(),Path(directory),helper.snapshot_edge.return_value)
            self.assertTrue((Path(directory)/('request-'+request()['request_id'])).is_dir())
            self.assertEqual(helper.atomic.call_args_list[0].args[0].name,'consumed.json')
            helper.fail_closed.assert_called_once_with('edge',files['bootstrap'])
            self.assertEqual(probe.call_count,1)
            self.assertNotIn(files['caddy'],[call.args[1] for call in helper.caddy_config.call_args_list])
            # A consumed failed request cannot be activated again.
            with self.assertRaises(ValueError):
                auto.activate(request(),policy(),helper,files,'edge',{},('sha256:'+'e'*64,None,None),MagicMock(),Path(directory),helper.snapshot_edge.return_value)

    def test_failed_schema_prevents_start(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(auto,'STATE',Path(directory)), \
             patch.object(auto,'protected',return_value=b'{}'), patch.object(auto,'load_candidate'), \
             patch.object(auto,'fresh'), patch.object(auto,'verify_current'), \
             patch.object(auto,'schema_probe',side_effect=ValueError('drift')):
            helper=MagicMock(); files={key:key.encode() for key in auto.TEMPLATES}
            with self.assertRaises(ValueError):
                auto.activate(request(),policy(),helper,files,'edge',{},('sha256:'+'e'*64,None,None),MagicMock(),Path(directory),helper.snapshot_edge.return_value)
            helper.start_units.assert_not_called()
            helper.fail_closed.assert_called_once()

    def test_symlink_protected_input_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            target=Path(directory)/'file'; target.write_text('fixture')
            link=Path(directory)/'link'; link.symlink_to(target)
            with self.assertRaises(ValueError): auto.protected(link)

    def test_same_manual_lock_refuses_concurrent_owner(self):
        import fcntl
        import os
        self.assertEqual(auto.LOCK,Path('/run/lock/rogichat-deploy.lock'))
        with tempfile.TemporaryDirectory() as directory:
            path=(Path(directory)/'lock').resolve(); path.write_bytes(b''); path.chmod(0o600)
            real_lstat=Path.lstat; real_fstat=os.fstat
            def root_stat(value):
                fields=list(value); fields[4]=0
                return os.stat_result(fields)
            with path.open('r+') as first:
                fcntl.flock(first,fcntl.LOCK_EX|fcntl.LOCK_NB)
                with patch.object(auto,'LOCK',path), \
                     patch.object(Path,'lstat',lambda item:root_stat(real_lstat(item))), \
                     patch.object(auto.os,'fstat',lambda fd:root_stat(real_fstat(fd))):
                    with self.assertRaises(BlockingIOError):
                        with auto.deployment_lock(): self.fail('must not enter')

    def test_probe_uses_only_policy_image_and_runtime_readonly_mounts(self):
        helper=MagicMock()
        helper.CA=Path('/fixture/ca'); helper.RUNTIME_SECRET=Path('/fixture/runtime.json')
        helper.SOURCE='https://github.com/h66rogi/rogichat'
        p=policy(); p['probe_sha256']=auto.digest(b'probe'); p['ca_sha256']=auto.digest(b'ca')
        inspected={'Id':p['probe_image'],'Os':'linux','Architecture':'amd64',
            'Config':{'User':'10001:10001','Labels':{'org.opencontainers.image.revision':p['probe_source_sha'],
                'org.opencontainers.image.source':helper.SOURCE}}}
        response={'schema':'exact','schema_sha256':p['schema_sha256'],'runtime_grants':'dml-only','migrations':p['migrations']}
        helper.docker.side_effect=[json.dumps([inspected]).encode(),json.dumps(response).encode(),b'']
        temporary_directory = tempfile.TemporaryDirectory
        with patch.object(auto,'protected',side_effect=[b'probe',b'ca',b'runtime']), \
             patch.object(auto.tempfile,'TemporaryDirectory',side_effect=lambda **_:temporary_directory()):
            auto.schema_probe(p,helper)
        args=helper.docker.call_args_list[1].args
        self.assertEqual(args[-2:],(p['probe_image'],'/run/probe/probe.mjs'))
        self.assertIn('--read-only',args)
        self.assertIn('--pull',args)
        self.assertTrue(all(arg.endswith(',readonly') for arg in args if arg.startswith('type=bind,')))
        self.assertNotIn('migrator',str(args))
        self.assertNotIn('migration',str(args))

    def manifest(self, rows):
        return ('export const migrationManifest: readonly { name: string; checksum: string }[] = [' + ','.join(
            "{name:'"+row['name']+"',checksum:'"+row['checksum']+"'}" for row in rows)+'];').encode()

    def blob(self, raw):
        import base64, hashlib
        return {'type':'file','path':'apps/api/src/infrastructure/database/schema-manifest.ts',
            'encoding':'base64','size':len(raw),'content':base64.b64encode(raw).decode(),
            'sha':hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()}

    def test_candidate_manifest_exact_before_load(self):
        archive=MagicMock(); archive.api.return_value=self.blob(self.manifest(policy()['migrations']))
        auto.verify_candidate_schema(request(),policy(),archive)
        self.assertTrue(archive.api.call_args.args[0].endswith('?ref='+request()['source_sha']))
        for rows in [[], policy()['migrations']*2,
                     [{'name':'20260101000001_extra','checksum':'d'*64}],
                     [{'name':policy()['migrations'][0]['name'],'checksum':'e'*64}]]:
            archive.api.return_value=self.blob(self.manifest(rows))
            with self.assertRaises(ValueError): auto.verify_candidate_schema(request(),policy(),archive)

    def test_candidate_name_order_and_untrusted_blob_rejected(self):
        p=policy(); p['migrations'].append({'name':'20260101000001_second','checksum':'e'*64})
        archive=MagicMock(); archive.api.return_value=self.blob(self.manifest(list(reversed(p['migrations']))))
        with self.assertRaises(ValueError): auto.verify_candidate_schema(request(),p,archive)
        archive.api.return_value={**self.blob(self.manifest(policy()['migrations'])),'sha':'0'*40}
        with self.assertRaises(ValueError): auto.verify_candidate_schema(request(),policy(),archive)
        for suffix in [b'console.log("execute")', b'process.exit(0)']:
            with self.assertRaises(ValueError): auto.parse_candidate_manifest(self.manifest(policy()['migrations'])+suffix)

    def test_manifest_property_order_is_semantic(self):
        raw=("// reviewed header\nexport const migrationManifest: readonly { name: string; checksum: string }[] = ["
             "{checksum:'"+'d'*64+"',name:'20260101000000_fixture'},];").encode()
        self.assertEqual(auto.parse_candidate_manifest(raw),policy()['migrations'])
        actual=Path(__file__).resolve().parents[2]/'apps/api/src/infrastructure/database/schema-manifest.ts'
        self.assertTrue(auto.parse_candidate_manifest(actual.read_bytes()))

    def test_candidate_retrieval_size_and_syntax_fail_closed(self):
        archive=MagicMock(); archive.api.side_effect=OSError('offline')
        with self.assertRaises(OSError): auto.verify_candidate_schema(request(),policy(),archive)
        archive.api.side_effect=None
        archive.api.return_value={**self.blob(self.manifest(policy()['migrations'])),'size':65537}
        with self.assertRaises(ValueError): auto.verify_candidate_schema(request(),policy(),archive)
        for raw in [b'x'*65537,b'export const migrationManifest = dynamic();',
                    self.manifest(policy()['migrations']).replace(b"name:",b"unknown:")]:
            with self.assertRaises(ValueError): auto.parse_candidate_manifest(raw)


class AutomaticEdgeTests(unittest.TestCase):
    def harness(self):
        from contextlib import ExitStack
        stack = ExitStack()
        self.addCleanup(stack.close)
        directory = Path(stack.enter_context(tempfile.TemporaryDirectory()))
        stack.enter_context(patch.object(auto, 'STATE', directory))
        stack.enter_context(patch.object(auto, 'protected', return_value=b'{}'))
        for name in ('fresh', 'verify_current', 'schema_probe', 'sync_directory'):
            stack.enter_context(patch.object(auto, name))
        load = stack.enter_context(patch.object(auto, 'load_candidate'))
        response = MagicMock(status=200)
        response.__enter__.return_value = response
        response.geturl.side_effect = ['https://api.qa.rogi.chat' + route for route in ('/live', '/ready', '/_infra/health')]
        stack.enter_context(patch.object(auto.urllib.request, 'urlopen', return_value=response))
        helper = MagicMock()
        helper.APP = directory
        helper.IMAGES = directory / 'images'
        helper.UNIT = directory / 'unit'
        helper.get_caddy.return_value = 'edge'
        helper.WEB_NETWORK = 'rogichat-qa-web'
        edge = {'Id': 'edge-full-id', 'networks': {helper.WEB_NETWORK: 'fixture-network'},
                'web': {'Id': 'fixture-web'}, 'sites': {'web.caddy': 'fixture-hash'}}
        helper.snapshot_edge.return_value = copy.deepcopy(edge)
        files = {key: key.encode() + b'\nimport /etc/caddy/sites/*.caddy\n' for key in auto.TEMPLATES}
        helper.files = files
        def activate():
            auto.activate(request(), policy(), helper, files, 'edge', {},
                          ('sha256:' + 'e'*64, None, None), MagicMock(), directory, edge)
        return stack, directory, helper, edge, load, activate

    def assert_not_completed(self, helper):
        names = [call.args[0].name for call in helper.atomic.call_args_list]
        self.assertNotIn('current.json', names)
        self.assertNotIn('completed', names)

    def test_preparation_to_activation_mutation_prevents_consumption(self):
        _, directory, helper, _, load, activate = self.harness()
        helper.snapshot_edge.return_value = {'web': None}
        with self.assertRaises(ValueError):
            activate()
        self.assertEqual(list(directory.iterdir()), [])
        helper.atomic.assert_not_called()
        load.assert_not_called()

    def test_missing_old_helper_capabilities_reject_before_consumption(self):
        _, directory, helper, _, load, activate = self.harness()
        for name in ('snapshot_edge', 'verify_web'):
            with self.subTest(name=name), patch.object(helper, name, None), self.assertRaises(ValueError):
                activate()
        self.assertEqual(list(directory.iterdir()), [])
        load.assert_not_called()

    def test_real_helper_rejects_unexpected_network_and_rw_mount(self):
        import backend_release as release
        for change in ('network', 'rw'):
            with self.subTest(change=change):
                stack, directory, helper, _, load, activate = self.harness()
                networks = {policy()['edge_network']: {'NetworkID': 'a'*64},
                            release.WEB_NETWORK: {'NetworkID': 'b'*64}}
                if change == 'network':
                    networks['unexpected'] = {'NetworkID': 'c'*64}
                caddy = {'Id': 'd'*64, 'Image': 'sha256:'+'e'*64, 'HostConfig': {},
                         'State': {'Running': True}, 'NetworkSettings': {'Networks': networks},
                         'Mounts': [{'Destination': '/etc/caddy/sites', 'Type': 'bind',
                                     'Source': str(release.WEB_SITES), 'RW': change == 'rw'}]}
                stack.enter_context(patch.object(release, 'get_caddy', return_value='edge'))
                stack.enter_context(patch.object(release, 'docker', return_value=json.dumps([caddy]).encode()))
                stack.enter_context(patch.object(release, 'protected', return_value=b'fixture'))
                helper.snapshot_edge.side_effect = release.snapshot_edge
                with self.assertRaises(release.Rejected):
                    activate()
                self.assertEqual(list(directory.iterdir()), [])
                load.assert_not_called()

    def test_health_and_final_gate_failures_never_complete(self):
        for phase in ('health', 'final', 'during-web'):
            with self.subTest(phase=phase):
                _, _, helper, edge, _, activate = self.harness()
                if phase == 'during-web':
                    def web(_):
                        helper.snapshot_edge.return_value = {'changed': True}
                    helper.verify_web.side_effect = web
                else:
                    helper.verify_web.side_effect = [None, ValueError('route failed'), None] if phase == 'health' else [None, None, ValueError('route failed'), None]
                with self.assertRaises(ValueError):
                    activate()
                self.assert_not_completed(helper)
                if phase != 'during-web':
                    helper.fail_closed.assert_called_once()

    def test_real_fail_closed_stops_both_apps_despite_caddy_reload_failure(self):
        import backend_release as release
        def shutdown(*args):
            with patch.object(release.Path, 'exists', return_value=True):
                release.fail_closed(*args)
        stack, _, helper, _, _, activate = self.harness()
        helper.wait_health.side_effect = ValueError('unhealthy')
        stack.enter_context(patch.object(release, 'caddy_config', side_effect=ValueError('reload failed')))
        run = stack.enter_context(patch.object(release, 'run'))
        helper.fail_closed.side_effect = shutdown
        with self.assertRaises(release.Rejected):
            activate()
        self.assertEqual([call.args[0][-1] for call in run.call_args_list],
                         ['rogichat-app@api', 'rogichat-app@worker'])
        self.assertEqual(helper.verify_web.call_count, 2)
        self.assert_not_completed(helper)

    def test_normal_success_and_prepared_empty_do_not_fabricate_web_proof(self):
        import backend_release as release
        for commissioned in (True, False):
            with self.subTest(commissioned=commissioned):
                stack, _, helper, edge, load, activate = self.harness()
                if not commissioned:
                    edge['web'] = None
                    helper.snapshot_edge.return_value = copy.deepcopy(edge)
                helper.verify_web.side_effect = release.verify_web
                route = stack.enter_context(patch.object(release, 'web_route', side_effect=lambda path:
                    b'<script src="/_next/static/app.js"></script>' if path == '/' else b'ok'))
                activate()
                self.assertEqual(route.call_count, 9 if commissioned else 0)
                self.assertEqual(helper.snapshot_edge.call_count, 6)
                load.assert_called_once()
                helper.fail_closed.assert_not_called()
                self.assertEqual([call.args[0].name for call in helper.atomic.call_args_list][-2:], ['current.json', 'completed'])

    def test_activation_topology_mutation_shuts_down_without_completion(self):
        _, _, helper, _, _, activate = self.harness()
        def mutate(_):
            helper.snapshot_edge.return_value = {'networks': {'unexpected': 'fixture'}}
        helper.wait_health.side_effect = mutate
        with self.assertRaises(ValueError):
            activate()
        helper.fail_closed.assert_called_once()
        self.assert_not_completed(helper)

    def test_missing_sites_import_or_stale_caddy_rejects_before_mutation(self):
        for failure in ('caddy', 'bootstrap', 'container'):
            with self.subTest(failure=failure):
                _, directory, helper, edge, load, activate = self.harness()
                if failure == 'container':
                    edge['Id'] = 'another-container'
                    helper.snapshot_edge.return_value = copy.deepcopy(edge)
                else:
                    helper.files[failure] = b'no sites import'
                with self.assertRaises(ValueError):
                    activate()
                self.assertEqual(list(directory.iterdir()), [])
                helper.atomic.assert_not_called()
                helper.run.assert_not_called()
                helper.caddy_config.assert_not_called()
                helper.start_units.assert_not_called()
                load.assert_not_called()
