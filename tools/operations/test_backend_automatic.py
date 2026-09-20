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

    def test_archive_validation_does_not_load_or_execute(self):
        r=request(); helper=MagicMock(); helper.RELEASES=Path('/fixture')
        archive=MagicMock()
        expected={'config_id':r['archive']['runtime_config_id']}
        descriptor={'source_sha':r['source_sha'],'verification_runs':r['verification_runs'],'images':{'runtime':expected}}
        archive.validate_zip.return_value=(descriptor,{'runtime':{'_archive_manifest':None}})
        candidate=auto.verify_candidate(r,helper,archive,Path('/fixture/verified'))
        archive.verify_provenance.assert_called_once_with(descriptor,r['archive'])
        helper.docker.assert_not_called()
        helper.docker.return_value=b'[{}]'
        auto.load_candidate(r,helper,Path('/fixture/verified'),candidate)
        self.assertEqual(helper.docker.call_args_list[0].args,('load','--input','/fixture/verified/runtime.tar'))
        self.assertNotIn('migration',str(helper.docker.call_args_list))
        helper.verify_archive_image_data.assert_called_once()

    def test_bad_archive_manifest_rejected_before_load(self):
        r=request(); r['archive']['execution_identity']='archive-manifest'
        helper=MagicMock(); helper.RELEASES=Path('/fixture'); archive=MagicMock()
        archive.validate_zip.return_value=({'source_sha':r['source_sha'],'verification_runs':r['verification_runs'],
            'images':{'runtime':{'config_id':r['archive']['runtime_config_id']}}}, {'runtime':{'_archive_manifest':None}})
        with self.assertRaises(ValueError): auto.verify_candidate(r,helper,archive,Path('/fixture/out'))
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
