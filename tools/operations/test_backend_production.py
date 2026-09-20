"""Production promotion boundaries. No cloud, host mutations or DB connection."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
from types import SimpleNamespace
import subprocess
import tempfile
import time
import unittest
from unittest.mock import patch
import uuid

import backend_production_release as prod
import fetch_production_runtime_secret as secrets

ROOT = Path(__file__).resolve().parents[2]


def request():
    return {'environment':'production','source_sha':'a'*40,'promotion_sha':'b'*40,
        'runtime_image':'ghcr.io/h66rogi/rogichat-api@sha256:'+'b'*64,
        'migration_image':'ghcr.io/h66rogi/rogichat-api-migration@sha256:'+'c'*64,
        'verification_runs':{k:1 for k in prod.shared.WORKFLOWS},
        'edge_network':'rogichat-prod_default','host_binding_sha256':'d'*64,
        'qa_evidence_sha256':'e'*64,'database_host_sha256':'f'*64,
        'artifacts':{k:'a'*64 for k in prod.ARTIFACTS},'previous_caddy_sha256':'b'*64,
        'request_id':str(uuid.uuid4()),'expires_at':int(time.time())+600,'migration_policy':'verify-only'}


def evidence(r):
    return {**{k:r[k] for k in ('source_sha','runtime_image','migration_image','verification_runs')},
            'environment':'qa','request_id':str(uuid.uuid4()),'completed':True}


class ProductionBoundaries(unittest.TestCase):
    def test_exact_request_and_qa_evidence(self):
        r=request()
        self.assertIs(prod.validate_request(r),r)
        prod.verify_qa_evidence(r,evidence(r))

    def test_cross_environment_and_migration_refused(self):
        for key,value in [('environment','qa'),('environment','prod'),('edge_network','rogichat-qa_default'),
                          ('migration_policy','deploy'),('migration_policy','approved'),
                          ('runtime_image','ghcr.io/h66rogi/rogichat-api:qa'),('expires_at',0),
                          ('expires_at',int(time.time())+7200),('source_sha','main'),('promotion_sha','qa'),('host_binding_sha256','')]:
            with self.subTest(key=key,value=value):
                r=request();r[key]=value
                with self.assertRaises(ValueError): prod.validate_request(r)
        r=request();r['migrator_secret']='not-permitted'
        with self.assertRaises(ValueError): prod.validate_request(r)

    def test_qa_evidence_rejects_rebuild_or_unverified_release(self):
        for key,value in [('environment','production'),('completed',False),('runtime_image','different'),
                          ('migration_image','different'),('source_sha','b'*40),('verification_runs',{})]:
            r=request();e=evidence(r);e[key]=value
            with self.subTest(key=key),self.assertRaises(ValueError): prod.verify_qa_evidence(r,e)

    def test_main_promotion_requires_source_ancestry(self):
        r=request();main={'commit':{'sha':r['promotion_sha']}}
        compare={'status':'ahead','merge_base_commit':{'sha':r['source_sha']}}
        prod.validate_promotion(r,main,compare)
        for m,c in [({'commit':{'sha':'c'*40}},compare),
                    (main,{**compare,'status':'diverged'}),
                    (main,{**compare,'merge_base_commit':{'sha':'d'*40}})]:
            with self.assertRaises(ValueError): prod.validate_promotion(r,m,c)

    def test_default_mode_never_activates(self):
        with tempfile.TemporaryDirectory() as tmp:
            with patch.object(prod,'LOCK',Path(tmp)/'lock'),patch.object(prod.os,'geteuid',return_value=0), \
                 patch.object(prod.os,'fstat',return_value=SimpleNamespace(st_uid=0,st_mode=stat.S_IFREG|0o600)), \
                 patch.object(prod,'protected'),patch.object(prod,'preflight',return_value=(request(),{},'edge')) as preflight, \
                 patch.object(prod,'deploy') as deploy,patch.object(prod.sys,'argv',['release']):
                prod.main()
                preflight.assert_called_once()
                deploy.assert_not_called()

    def test_qa_deployer_remains_qa_only(self):
        with self.assertRaises(ValueError): prod.shared.validate_request(request())

    def test_archive_execution_identity_rejected_when_unbound(self):
        a={'export_sha':'a'*40,'export_run':1,'export_attempt':1,'artifact_id':1,
           'artifact_sha256':'sha256:'+'b'*64,'validator_sha256':'a'*64,'execution_identity':'config',
           **{k:'sha256:'+'c'*64 for k in ('runtime_config_id','migration_config_id','runtime_execution_id','migration_execution_id')}}
        prod.validate_archive(a)
        a['runtime_execution_id']='sha256:'+'d'*64
        with self.assertRaises(ValueError): prod.validate_archive(a)
        a['execution_identity']='tag'
        with self.assertRaises(ValueError): prod.validate_archive(a)

    def test_archive_evidence_requires_exact_qa_archive(self):
        r=request();r['archive']={'artifact_id':1}
        e=evidence(r);e['archive']={'artifact_id':2}
        with self.assertRaises(ValueError): prod.verify_qa_evidence(r,e)

    def test_database_secret_cross_environment_rejected(self):
        v={'host':'rogichat-prod.cluster-fixture.ap-northeast-2.rds.amazonaws.com','port':3306,
           'database':'rogichatprod','username':'rogichat_app','password':'synthetic-fixture-'*3}
        h=hashlib.sha256(v['host'].encode()).hexdigest()
        secrets.validate_credential(v,h)
        for key,value in [('host',v['host'].replace('prod','qa')),('database','rogichatqa'),
                          ('username','rogichat_migrator'),('username','admin'),('port',3307)]:
            bad={**v,key:value}
            with self.subTest(key=key),self.assertRaises(ValueError): secrets.validate_credential(bad,h)
        with self.assertRaises(ValueError): secrets.validate_credential(v,'0'*64)
        self.assertEqual(secrets.SECRET_ID,'rogichat/prod/database/runtime')

    def test_wrong_machine_or_environment_binding_rejected(self):
        value={'environment':'production','machine_id_sha256':prod.digest(b'host-a'),'database_host_sha256':'a'*64}
        with patch.object(secrets,'protected',side_effect=[json.dumps(value).encode(),b'host-b']),self.assertRaises(ValueError):
            secrets.host_binding()
        value['environment']='qa'
        with patch.object(secrets,'protected',return_value=json.dumps(value).encode()),self.assertRaises(ValueError):
            secrets.host_binding()

    def test_auth_and_readiness_mount_separation(self):
        with patch.object(prod,'probe') as probe:
            prod.verify_runtime(request(),Path('/release'))
        auth,db=probe.call_args_list
        self.assertEqual(auth.kwargs['network'],'none')
        self.assertEqual(auth.kwargs['mounts'],[(prod.AUTH,'/run/secrets/auth.json')])
        self.assertNotIn('auth.json',str(db.kwargs['mounts']))
        self.assertNotIn('migrator',str(db.kwargs))
        self.assertEqual(json.loads(db.kwargs['data'])['migration_policy'],'verify-only')
        self.assertEqual(db.kwargs['command'],['/run/release/readiness.mjs'])

    def test_probe_timeout_removes_exact_container(self):
        with patch.object(prod,'docker',side_effect=TimeoutError),patch.object(prod.subprocess,'run') as cleanup:
            with self.assertRaises(TimeoutError):
                prod.probe(request(),'runtime',network='none',mounts=[],command=['-e','process.exit(0)'])
        argv=cleanup.call_args.args[0]
        self.assertEqual(argv[:3],['/usr/bin/docker','rm','-f'])
        self.assertTrue(argv[3].startswith('rogichat-prod-preflight-'))

    def test_activation_failure_consumes_request_and_stops_both_units(self):
        with tempfile.TemporaryDirectory() as tmp:
            receipt=Path(tmp)/'receipts'
            def atomic(path,data,*_):
                path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(data)
            with patch.object(prod,'RECEIPTS',receipt),patch.object(prod,'CADDY',Path(tmp)/'Caddyfile'),\
                 patch.object(prod,'APP',Path(tmp)/'app'),patch.object(prod,'IMAGES',Path(tmp)/'images'),\
                 patch.object(prod,'UNIT',Path(tmp)/'unit'),patch.object(prod,'atomic',side_effect=atomic),\
                 patch.object(prod,'caddy_config',side_effect=RuntimeError),patch.object(prod.subprocess,'run') as stop:
                r=request()
                with self.assertRaises(RuntimeError): prod.deploy(r,{'bootstrap':b'bootstrap'},'edge')
                self.assertTrue((receipt/('receipt-'+r['request_id'])/'consumed.json').exists())
                self.assertFalse((receipt/('receipt-'+r['request_id'])/'completed.json').exists())
                self.assertEqual([c.args[0][-1] for c in stop.call_args_list],['rogichat-prod-app@api','rogichat-prod-app@worker'])
                with self.assertRaises(ValueError): prod.deploy(r,{'bootstrap':b'bootstrap'},'edge')

    def test_readiness_node_contracts(self):
        subprocess.run(['node','--test','tools/operations/test_production_readiness.mjs'],cwd=ROOT,check=True,capture_output=True)

    def test_compose_render_and_isolation(self):
        docker=shutil.which('docker')
        compose=[docker,'compose'] if docker else [str(ROOT/'.tools/compose')]
        # CI provides Docker; local validation uses checksum-verified standalone Compose.
        self.assertTrue(docker or (ROOT/'.tools/compose').exists(),'Docker Compose required for runtime validation')
        env={**os.environ,'ROGICHAT_API_IMAGE':request()['runtime_image'],
             'ROGICHAT_WORKER_IMAGE':request()['runtime_image'],'ROGICHAT_EDGE_NETWORK':'rogichat-prod_default'}
        result=subprocess.run([*compose,'-f',str(ROOT/prod.ARTIFACTS['compose']),'config','--format','json'],env=env,check=True,capture_output=True)
        data=json.loads(result.stdout)
        self.assertEqual(data['name'],'rogichat-prod-app')
        for role,service in data['services'].items():
            self.assertEqual(service['environment']['APP_ENV'],'production')
            self.assertEqual(service['environment']['DB_TLS_MODE'],'required')
            self.assertEqual(service['restart'],'no')
            self.assertNotIn('ports',service)
            mounts={m['target']:m for m in service['volumes']}
            self.assertEqual(mounts['/run/secrets/database.json']['source'],str(prod.DATABASE))
            self.assertTrue(all(m['read_only'] and not m['bind'].get('create_host_path',False) for m in mounts.values()))
            self.assertEqual('/run/secrets/auth.json' in mounts,role=='api')
        self.assertEqual(set(data['services']['api']['networks']),{'edge'})
        self.assertEqual(set(data['services']['worker']['networks']),{'jobs'})

    def test_caddy_validation(self):
        local=ROOT/'.tools/caddy'
        for key in ('caddy','bootstrap'):
            raw=(ROOT/prod.ARTIFACTS[key]).read_bytes()
            self.assertIn(b'import /etc/caddy/sites/*.caddy',raw)
            self.assertNotIn(b'rogi.chat,',raw)
            if local.exists():
                args=[str(local),'adapt','--config','-','--adapter','caddyfile','--validate']
            else:
                args=['docker','run','--rm','-i','--network','none',
                      'caddy:2.11.4-alpine@sha256:de23def33b17fb5d1290b0f6c2add1d70780e52341896c00a4c8a2a2fe9d355e',
                      'caddy','adapt','--config','-','--adapter','caddyfile','--validate']
            subprocess.run(args,input=raw,check=True,capture_output=True)

    def test_boot_order_and_no_qa_paths(self):
        unit=(ROOT/prod.ARTIFACTS['unit']).read_text()
        self.assertIn('Requires=docker.service rogichat-prod-runtime-secrets.service',unit)
        self.assertIn('BindsTo=rogichat-prod-runtime-secrets.service',unit)
        for key in ('unit','secret_unit','compose','caddy'):
            text=(ROOT/prod.ARTIFACTS[key]).read_text()
            self.assertNotIn('rogichat-qa',text)
            self.assertNotIn('APP_ENV: qa',text)


if __name__ == '__main__': unittest.main()
