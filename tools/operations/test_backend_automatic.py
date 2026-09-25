"""No host/network/DB access. Included by the existing backend CI test glob."""
import subprocess
import unittest
from pathlib import Path


class ProbeTests(unittest.TestCase):
    def test_node_probe_boundaries(self):
        subprocess.run(['node', '--test', str(Path(__file__).with_name('test_backend_schema_readonly.mjs'))], check=True)

import copy
import json
import sys
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
    def test_unattended_entry_requires_injected_client_before_host_access(self):
        with patch.object(sys, 'argv', ['backend_automatic_release.py']), \
             patch.object(auto, 'protected') as protected:
            with self.assertRaises(ValueError):
                auto.main()
            protected.assert_not_called()

    def test_app_client_routes_all_pinned_metadata_and_proof_reads(self):
        client = MagicMock()
        client.fresh.side_effect = lambda path: (
            {'id': auto.REPOSITORY_ID, 'full_name': auto.REPOSITORY,
             'private': False, 'fork': False} if path == '' else {'path': path})
        client.artifact_zip.return_value = b'proof zip bytes'
        helper, archive = MagicMock(), MagicMock()
        auto.bind_metadata_client(helper, archive, client)
        self.assertEqual(archive.api('git/ref/heads/qa'), {'path': 'git/ref/heads/qa'})
        self.assertEqual(archive.api('actions/runs/7', None), {'path': 'actions/runs/7'})
        self.assertEqual(helper.github_read('actions/runs/7'), {'path': 'actions/runs/7'})
        self.assertEqual(archive.download_publication_artifact(7, None), b'proof zip bytes')
        client.artifact_zip.assert_called_once_with(7)
        with self.assertRaises(ValueError):
            archive.api('actions/runs/7', 'untrusted-token')
        with self.assertRaises(ValueError):
            archive.download_publication_artifact(7, 'untrusted-token')

    def test_app_client_rejects_wrong_repo_failure_and_oversized_proof(self):
        helper, archive = MagicMock(), MagicMock()
        client = MagicMock()
        client.fresh.return_value = {'id': auto.REPOSITORY_ID + 1,
                                     'full_name': auto.REPOSITORY, 'private': False, 'fork': False}
        with self.assertRaises(ValueError):
            auto.bind_metadata_client(helper, archive, client)
        client.fresh.side_effect = lambda path: (
            {'id': auto.REPOSITORY_ID, 'full_name': auto.REPOSITORY,
             'private': False, 'fork': False} if path == '' else (_ for _ in ()).throw(OSError('secret')))
        auto.bind_metadata_client(helper, archive, client)
        with self.assertRaisesRegex(ValueError, '^automatic release rejected$'):
            archive.api('actions/runs/7')
        client.artifact_zip.return_value = b'x' * (auto.MAX_PROOF_ZIP + 1)
        with self.assertRaises(ValueError):
            archive.download_publication_artifact(7)

    def test_manual_media_unit_cannot_enter_automatic_activation(self):
        files = {key: key.encode() for key in auto.TEMPLATES}
        files['unit'] = b'ExecStart=-f /opt/rogichat/app/compose.features.yaml'
        helper = MagicMock()
        with self.assertRaises(ValueError):
            auto.activate(request(), policy(), helper, files, 'edge', {},
                          ('sha256:' + 'e' * 64, None, None), MagicMock(), Path('/fixture'))
        helper.atomic.assert_not_called()

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

    def test_fresh_exact_source_requires_current_qa_checks(self):
        archive=MagicMock()
        head='a'*40
        def api(path):
            if path=='git/ref/heads/qa':
                return {'ref':'refs/heads/qa','object':{'sha':head}}
            if path.startswith('actions/workflows/'):
                return {'total_count':1,'workflow_runs':[{'id':1}]}
            self.fail(path)
        archive.api.side_effect=api
        auto.fresh(request(),archive)
        archive.verify_source.assert_called_once_with(head,request()['verification_runs'])
        self.assertEqual(archive.verify_run.call_count,5)

    def backend_tree(self, *, changed=None, added=None, truncated=False, mode='100644'):
        paths=auto.BACKEND_REQUIRED_INPUTS | {'apps/api/src/main.ts', 'patches/driver.patch',
            'infrastructure/runtime/Caddyfile.app', '.github/workflows/security.yml',
            'tools/security/check.py', 'packages/common/index.ts',
            'apps/web/src/main.ts', 'apps/ios/Sources/App.swift', 'docs/release.md'}
        entries=[{'path':path,'type':'blob','mode':mode,
                  'sha':('b'*40 if path==changed else 'a'*40)} for path in sorted(paths)]
        if added:
            entries.append({'path':added,'type':'blob','mode':'100644','sha':'c'*40})
        return {'truncated':truncated,'tree':entries}

    def test_backend_ancestor_uses_complete_immutable_input_tree(self):
        source='a'*40; head='b'*40
        old=self.backend_tree()
        new=self.backend_tree(changed='apps/ios/Sources/App.swift',added='apps/web/src/extra.ts')
        def api(path):
            if path=='git/trees/'+source+'?recursive=1': return old
            if path=='git/trees/'+head+'?recursive=1': return new
            if path=='compare/'+source+'...'+head:
                return {'status':'ahead','merge_base_commit':{'sha':source},
                        'files':[{'filename':'apps/api/src/main.ts'}], 'total_commits':400}
            self.fail(path)
        auto.equivalent_backend_source(api,source,head)
        # Compare's file list may be truncated after 300 paths. We never read it.
        for important in ('apps/api/src/main.ts','patches/driver.patch','package.json',
                          'pnpm-lock.yaml','tools/security/check.py',
                          'tools/release/changes.py','infrastructure/runtime/Caddyfile.app',
                          '.github/workflows/security.yml','packages/common/index.ts'):
            with self.subTest(important=important), self.assertRaises(ValueError):
                auto.equivalent_backend_source(lambda path: (
                    self.backend_tree(changed=important) if path.endswith(head+'?recursive=1')
                    else old if path.endswith(source+'?recursive=1') else api(path)), source, head)

    def test_ancestor_rejects_divergence_unknown_tree_and_unsafe_entries(self):
        source='a'*40; head='b'*40
        old=self.backend_tree()
        def api(path):
            if path=='git/trees/'+source+'?recursive=1': return old
            if path=='git/trees/'+head+'?recursive=1': return self.backend_tree()
            return {'status':'diverged','merge_base_commit':{'sha':'c'*40}}
        with self.assertRaises(ValueError): auto.equivalent_backend_source(api,source,head)
        for bad in (self.backend_tree(truncated=True),
                    self.backend_tree(added='apps/api/unknown.ts',mode='120000'),
                    {'truncated':False,'tree':[entry for entry in self.backend_tree()['tree']
                                               if entry['path']!='package.json']}):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                auto.backend_inputs(lambda _:bad,source)

    def test_fresh_ancestor_fails_if_latest_check_fails_or_qa_moves(self):
        source='a'*40; head='b'*40
        old=self.backend_tree()
        for fail in ('check','moving'):
            with self.subTest(fail=fail):
                archive=MagicMock(); refs=0
                def api(path):
                    nonlocal refs
                    if path=='git/ref/heads/qa':
                        refs+=1
                        return {'ref':'refs/heads/qa','object':{'sha':
                            'c'*40 if fail=='moving' and refs==2 else head}}
                    if path.startswith('git/trees/'): return old
                    if path=='compare/'+source+'...'+head:
                        return {'status':'ahead','merge_base_commit':{'sha':source}}
                    if path.startswith('actions/workflows/'):
                        return {'total_count':1,'workflow_runs':[{'id':1}]}
                    self.fail(path)
                archive.api.side_effect=api
                if fail=='check': archive.verify_run.side_effect=ValueError('failed current check')
                with self.assertRaises(ValueError): auto.fresh(request(),archive)

    def test_fresh_rejects_main_ref_and_metadata_failure(self):
        archive=MagicMock()
        archive.api.return_value={'ref':'refs/heads/main','object':{'sha':'a'*40}}
        with self.assertRaises(ValueError): auto.fresh(request(),archive)
        archive.verify_source.assert_not_called()
        archive.api.side_effect=OSError('unavailable')
        with self.assertRaises(OSError): auto.fresh(request(),archive)
        archive.verify_source.assert_not_called()

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
                auto.activate(request(),policy(),helper,files,'edge',{},('sha256:'+'e'*64,None,None),MagicMock(),Path(directory))
            self.assertTrue((Path(directory)/('request-'+request()['request_id'])).is_dir())
            self.assertEqual(helper.atomic.call_args_list[0].args[0].name,'consumed.json')
            helper.fail_closed.assert_called_once_with('edge',files['bootstrap'])
            self.assertEqual(probe.call_count,1)
            self.assertNotIn(files['caddy'],[call.args[1] for call in helper.caddy_config.call_args_list])
            # A consumed failed request cannot be activated again.
            with self.assertRaises(ValueError):
                auto.activate(request(),policy(),helper,files,'edge',{},('sha256:'+'e'*64,None,None),MagicMock(),Path(directory))

    def test_failed_schema_prevents_start(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(auto,'STATE',Path(directory)), \
             patch.object(auto,'protected',return_value=b'{}'), patch.object(auto,'load_candidate'), \
             patch.object(auto,'fresh'), patch.object(auto,'verify_current'), \
             patch.object(auto,'schema_probe',side_effect=ValueError('drift')):
            helper=MagicMock(); files={key:key.encode() for key in auto.TEMPLATES}
            with self.assertRaises(ValueError):
                auto.activate(request(),policy(),helper,files,'edge',{},('sha256:'+'e'*64,None,None),MagicMock(),Path(directory))
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
