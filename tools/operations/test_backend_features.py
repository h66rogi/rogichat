"""Explicit optional release features; no host secrets, Docker daemon or providers."""
import copy
import itertools
import json
from pathlib import Path
import shutil
import stat
import subprocess
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import backend_release as release
import backend_production_release as prod
from test_backend_release import fixture
from test_backend_production import request as production_request, evidence

ROOT = Path(__file__).resolve().parents[2]


def selected(make, features):
    r = make(); r['features'] = sorted(features)
    if 'media' in features:
        r['decoder_image'] = 'ghcr.io/h66rogi/rogichat-media-decoder@sha256:' + 'd' * 64
    base = prod.ARTIFACTS if r['environment'] == 'production' else release.ARTIFACTS
    r['artifacts'] = {k: 'a' * 64 for k in release.feature_artifacts(r, base)}
    return r


def compose(r):
    base = prod.ARTIFACTS if r['environment'] == 'production' else release.ARTIFACTS
    files = {k: (ROOT/p).read_bytes() for k, p in release.feature_artifacts(r, base).items()}
    docker = shutil.which('docker')
    cli = [docker, 'compose'] if docker else [str(ROOT/'.tools/compose')]
    def render(*args, **kwargs):
        return subprocess.check_output([*cli, *args[1:]], stderr=subprocess.PIPE)
    with patch.object(release, 'docker', side_effect=render):
        return json.loads(release.render_features(r, files)['compose'])


def running(service, config):
    mounts = []
    for m in service.get('volumes', []):
        mounts.append({'Destination': m['target'], 'Type': m['type'], 'RW': not m.get('read_only', False),
                       **({'Source': m['source']} if m['type'] == 'bind' else {'Name': config['volumes'][m['source']]['name']})})
    return {'Config': {'Env': [k+'='+str(v) for k,v in service.get('environment', {}).items()],
                       'Image': service['image'], 'User': '10001:10001'}, 'Mounts': mounts,
            'HostConfig': {'ReadonlyRootfs': True, 'NetworkMode': 'none', 'PortBindings': {},
                           'Memory': 512*1024*1024, 'PidsLimit': 128, 'NanoCpus': 1000000000,
                           'CapDrop': ['ALL'], 'SecurityOpt': ['no-new-privileges:true'],
                           'Tmpfs': dict(t.split(':',1) for t in service.get('tmpfs', []))},
            'NetworkSettings': {'Networks': {'none': {}}}}


class FeatureTests(unittest.TestCase):
    def test_explicit_request_features_and_pinned_artifact_set(self):
        for make, validate in [(fixture, release.validate_request), (production_request, prod.validate_request)]:
            validate(make())
            validate(selected(make, release.FEATURES))
            for features in [['deletion'], ['native_push','media'], ['media','media'], ['other'], 'media']:
                r = selected(make, [])
                r['features'] = features
                with self.subTest(features=features), self.assertRaises(ValueError): validate(r)
            for mutation in ('missing_overlay', 'unused_overlay', 'missing_decoder', 'tag_decoder', 'unused_decoder'):
                r = selected(make, ['media'])
                if mutation == 'missing_overlay': del r['artifacts']['feature_media']
                if mutation == 'unused_overlay': r['artifacts']['feature_native_push'] = 'a'*64
                if mutation == 'missing_decoder': del r['decoder_image']
                if mutation == 'tag_decoder': r['decoder_image'] = 'ghcr.io/h66rogi/rogichat-media-decoder:latest'
                if mutation == 'unused_decoder': r['features'] = []
                with self.subTest(mutation=mutation), self.assertRaises(ValueError): validate(r)

    def test_optional_archive_decoder_identity_is_exact(self):
        for make, validate in [(fixture, release.validate_request), (production_request, prod.validate_request)]:
            r = selected(make, ['media'])
            r['archive'] = {'export_sha':'a'*40, 'export_run':1, 'export_attempt':1, 'artifact_id':1,
                            'artifact_sha256':'sha256:'+'a'*64, 'validator_sha256':'a'*64, 'execution_identity':'config',
                            **{role+suffix:'sha256:'+'b'*64 for role in ('runtime','migration','decoder')
                               for suffix in ('_config_id','_execution_id')}}
            validate(r)
            for field in ('decoder_config_id','decoder_execution_id'):
                bad=copy.deepcopy(r); del bad['archive'][field]
                with self.assertRaises((ValueError, KeyError)): validate(bad)
            bad=copy.deepcopy(r); bad['archive']['decoder_execution_id']='sha256:'+'c'*64
            with self.assertRaises(ValueError): validate(bad)
            bad=copy.deepcopy(r); bad['features']=[]; del bad['decoder_image']; del bad['artifacts']['feature_media']
            with self.assertRaises(ValueError): validate(bad)

    def test_production_evidence_binds_exact_features_and_decoder(self):
        r=selected(production_request, ['media','native_push'])
        e={**evidence(r), 'features':r['features'], 'decoder_image':r['decoder_image']}
        prod.verify_qa_evidence(r,e)
        for key,value in [('features',['media']), ('decoder_image','different')]:
            with self.assertRaises(ValueError): prod.verify_qa_evidence(r,{**e,key:value})
        with self.assertRaises(ValueError): prod.verify_qa_evidence(r,evidence(r))

    def test_all_feature_compositions_preserve_role_isolation(self):
        for make in (fixture, production_request):
            for bits in itertools.product((False,True), repeat=4):
                features=[f for f,on in zip(sorted(release.FEATURES),bits) if on]
                if not features or ('deletion' in features and 'media' not in features): continue
                r=selected(make,features); data=compose(r)
                with self.subTest(environment=r['environment'],features=features):
                    self.assertEqual(set(data['services']), {'api','worker','decoder'} if 'media' in features else {'api','worker'})
                    self.assertTrue(release.compose_requires_push(json.dumps(data).encode()))
                    for role in ('api','worker'):
                        service=data['services'][role]; env=service['environment']
                        mounts={m['target']:m for m in service['volumes']}
                        self.assertEqual('AUTH_SECRET_FILE' in env,role=='api' or 'apple_auth' in features)
                        for feature,(variable,name,_) in release.FEATURE_FILES.items():
                            self.assertEqual(variable in env,feature in features)
                            self.assertEqual('/run/secrets/'+name+'.json' in mounts,feature in features)
                        self.assertTrue(all(m['read_only'] and not m.get('bind',{}).get('create_host_path',False)
                                            for m in mounts.values()))
                        self.assertEqual('/run/decoder' in mounts,role=='worker' and 'media' in features)
                        release.validate_feature_running(running(service,data),role,data)
                    if 'media' in features:
                        decoder=data['services']['decoder']
                        self.assertEqual(decoder['environment'], {'DECODER_ISOLATED':'true'})
                        self.assertEqual(decoder['network_mode'],'none')
                        self.assertEqual([m['target'] for m in decoder['volumes']],['/run/decoder'])
                        self.assertIn('size=134217728',decoder['tmpfs'][0])
                        self.assertNotIn('connect',str(decoder['healthcheck']))
                        release.validate_feature_running(running(decoder,data),'decoder',data)

    def test_feature_live_state_rejects_extra_credentials_network_or_writable_socket(self):
        data=compose(selected(fixture,release.FEATURES))
        for role in ('api','worker','decoder'):
            good=running(data['services'][role],data)
            bad=copy.deepcopy(good); bad['Mounts'].append({'Destination':'/run/secrets/unselected.json'})
            with self.assertRaises(ValueError): release.validate_feature_running(bad,role,data)
            bad=copy.deepcopy(good); bad['Config']['Env'].append('PUSH_NATIVE_SECRET_FILE=/other')
            with self.assertRaises(ValueError): release.validate_feature_running(bad,role,data)
            bad=copy.deepcopy(good); bad['HostConfig']['Tmpfs']={}
            with self.assertRaises(ValueError): release.validate_feature_running(bad,role,data)
        bad=running(data['services']['worker'],data)
        next(m for m in bad['Mounts'] if m['Destination']=='/run/decoder')['RW']=True
        with self.assertRaises(ValueError): release.validate_feature_running(bad,'worker',data)
        bad=running(data['services']['decoder'],data); bad['HostConfig']['NetworkMode']='host'
        with self.assertRaises(ValueError): release.validate_feature_running(bad,'decoder',data)

    def test_absent_features_touch_no_provider_and_selected_probe_is_offline(self):
        with patch.object(release.Path,'lstat') as metadata, patch.object(release,'docker') as docker:
            release.verify_feature_secrets(fixture()); metadata.assert_not_called(); docker.assert_not_called()
        r=selected(fixture,['native_push'])
        file=SimpleNamespace(st_mode=stat.S_IFREG|0o400,st_uid=10001,st_nlink=1,st_size=100)
        parent=SimpleNamespace(st_mode=stat.S_IFDIR|0o755,st_uid=0)
        with patch.object(release.Path,'lstat',side_effect=[file,parent,parent,parent]), \
                patch.object(release,'docker') as docker, \
                patch.object(release.subprocess,'run',return_value=SimpleNamespace(returncode=0)) as cleanup:
            release.verify_feature_secrets(r)
        args=docker.call_args.args
        self.assertEqual(args[args.index('--network')+1],'none')
        self.assertEqual(args.count('--mount'),1)
        self.assertIn('type=bind,src=/etc/rogichat/push-native.json,dst=/run/secrets/push-native.json,readonly',args)
        self.assertNotIn('AUTH_SECRET_FILE=', ' '.join(args[:-1]))
        self.assertIn('readNativePushConfig',args[-1]); self.assertNotIn('console',args[-1])
        self.assertEqual(docker.call_args.kwargs['timeout'],30)
        cleanup.assert_called_once()

    def test_decoder_socket_volume_rejects_existing_foreign_or_disk_backing(self):
        data=compose(selected(fixture,['media']))
        expected=data['volumes']['decoder-socket']
        good={'Name':expected['name'],'Driver':'local','Options':expected['driver_opts'],
              'Labels':{'com.docker.compose.project':data['name'],'com.docker.compose.volume':'decoder-socket'}}
        with patch.object(release,'docker',return_value=json.dumps([good]).encode()):
            release.verify_decoder_volume(data)
        for key,value in [('Driver','other'),('Options',{}),('Labels',{})]:
            with patch.object(release,'docker',return_value=json.dumps([{**good,key:value}]).encode()), self.assertRaises(ValueError):
                release.verify_decoder_volume(data)
        with patch.object(release,'docker') as docker:
            release.verify_decoder_volume(None); docker.assert_not_called()

    def test_decoder_deactivation_removes_only_owned_stopped_container_without_volumes(self):
        for environment,short in [('qa','qa'),('production','prod')]:
            item={'Name':'/rogichat-'+short+'-decoder','Config':{'Labels':{
                'com.docker.compose.project':'rogichat-'+short+'-app','com.docker.compose.service':'decoder'}},
                'State':{'Running':False,'Status':'exited'}}
            with patch.object(release,'docker') as docker:
                release.remove_stopped_decoder(item,environment)
                docker.assert_called_once_with('rm','rogichat-'+short+'-decoder')
            for mutate in ('running','foreign'):
                bad=copy.deepcopy(item)
                if mutate=='running':bad['State']['Running']=True
                else:bad['Config']['Labels']['com.docker.compose.project']='foreign'
                with patch.object(release,'docker') as docker, self.assertRaises(ValueError):
                    release.remove_stopped_decoder(bad,environment)
                docker.assert_not_called()

    def test_deactivation_stops_and_disables_existing_decoder_before_config_replacement(self):
        with patch.object(release,'app_roles',return_value=('decoder','api','worker')), patch.object(prod,'run') as run:
            prod.stop_units()
        self.assertEqual([c.args[0][1:] for c in run.call_args_list], [
            ['stop','rogichat-prod-app@decoder'], ['disable','rogichat-prod-app@decoder'],
            ['stop','rogichat-prod-app@api'], ['stop','rogichat-prod-app@worker']])


if __name__ == '__main__': unittest.main()
