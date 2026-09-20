#!/usr/bin/env python3
"""Host-bound production promotion; default preflight, --apply consumes approval.

Reuses QA's environment-neutral image/archive, file and process validators. Never
calls the QA deployer, changes its globals, builds images, or executes migrations.
"""
from __future__ import annotations
import argparse
import fcntl
import json
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import sys
import tempfile
import time
import urllib.request
import uuid

import backend_release as shared
from fetch_production_runtime_secret import host_binding, validate_credential, HOST

require = shared.require
protected = shared.protected
digest = shared.digest
docker = shared.docker
run = shared.run
atomic = shared.atomic
REQUEST = Path('/etc/rogichat/prod/backend-release.json')
QA_EVIDENCE = Path('/etc/rogichat/prod/qa-verification.json')
APP = Path('/opt/rogichat/prod/app')
RECEIPTS = Path('/opt/rogichat/prod/releases')
IMAGES = Path('/etc/rogichat/prod/app-images.env')
UNIT = Path('/etc/systemd/system/rogichat-prod-app@.service')
SECRET_UNIT = Path('/etc/systemd/system/rogichat-prod-runtime-secrets.service')
OPERATIONS = Path('/opt/rogichat/operations')
CADDY = Path('/opt/rogichat/bootstrap/Caddyfile')
DATABASE = Path('/run/rogichat-prod/secrets/database.json')
AUTH = Path('/etc/rogichat/prod/auth.json')
CA = Path('/etc/rogichat/prod/rds-global-bundle.pem')
# Shared with the web releaser: both mutate the same Caddy configuration.
LOCK = Path('/run/lock/rogichat-deploy.lock')
PREFIX = 'infrastructure/environments/prod/runtime/'
ARTIFACTS = {
    'compose': PREFIX + 'compose.app.yaml', 'unit': PREFIX + 'rogichat-prod-app@.service',
    'secret_unit': PREFIX + 'rogichat-prod-runtime-secrets.service',
    'caddy': PREFIX + 'Caddyfile.app', 'bootstrap': PREFIX + 'Caddyfile.bootstrap',
    'readiness': 'tools/operations/production_readiness.mjs',
    'secret_helper': 'tools/operations/fetch_production_runtime_secret.py',
    'shared_helper': 'tools/operations/backend_release.py',
    'archive_helper': 'tools/operations/backend_archive.py',
    'production_helper': 'tools/operations/backend_production_release.py',
}


def validate_archive(a):
    require(type(a) is dict and set(a) == {'export_sha', 'export_run', 'export_attempt',
            'artifact_id', 'artifact_sha256', 'runtime_config_id', 'migration_config_id',
            'validator_sha256', 'execution_identity', 'runtime_execution_id', 'migration_execution_id'})
    require(type(a['export_sha']) is str and shared.SHA.fullmatch(a['export_sha']))
    require(all(type(a[k]) is int and a[k] > 0 for k in ('export_run','export_attempt','artifact_id')))
    require(type(a['validator_sha256']) is str and shared.HASH.fullmatch(a['validator_sha256']))
    require(all(type(a[k]) is str and re.fullmatch(r'sha256:[a-f0-9]{64}', a[k]) for k in
                ('artifact_sha256','runtime_config_id','migration_config_id','runtime_execution_id','migration_execution_id')))
    require(a['execution_identity'] in ('config','archive-manifest'))
    if a['execution_identity'] == 'config':
        require(all(a[r+'_execution_id'] == a[r+'_config_id'] for r in ('runtime','migration')))


def validate_request(v):
    fields = {'environment','source_sha','promotion_sha','runtime_image','migration_image','verification_runs',
              'edge_network','host_binding_sha256','qa_evidence_sha256','database_host_sha256',
              'artifacts','previous_caddy_sha256','request_id','expires_at','migration_policy'}
    require(type(v) is dict and set(v) in (fields, fields | {'archive'}))
    require(v['environment'] == 'production' and v['migration_policy'] == 'verify-only'
            and v['edge_network'] == 'rogichat-prod_default')
    require(all(type(v[k]) is str and shared.SHA.fullmatch(v[k]) for k in ('source_sha','promotion_sha')))
    for role, repo in [('runtime','rogichat-api'),('migration','rogichat-api-migration')]:
        require(type(v[role+'_image']) is str and re.fullmatch(r'ghcr\.io/h66rogi/'+repo+r'@sha256:[a-f0-9]{64}',v[role+'_image']))
    for key in ('host_binding_sha256','qa_evidence_sha256','database_host_sha256','previous_caddy_sha256'):
        require(type(v[key]) is str and shared.HASH.fullmatch(v[key]))
    require(type(v['artifacts']) is dict and set(v['artifacts']) == set(ARTIFACTS)
            and all(type(h) is str and shared.HASH.fullmatch(h) for h in v['artifacts'].values()))
    require(type(v['verification_runs']) is dict and set(v['verification_runs']) == shared.WORKFLOWS
            and all(type(n) is int and n > 0 for n in v['verification_runs'].values()))
    require(type(v['request_id']) is str and str(uuid.UUID(v['request_id'])) == v['request_id'])
    require(type(v['expires_at']) is int and time.time() < v['expires_at'] <= time.time()+3600)
    if 'archive' in v:
        validate_archive(v['archive'])
        require(v['archive']['validator_sha256'] == v['artifacts']['archive_helper'])
    return v


def verify_promotion(request):
    def github(path):
        url = 'https://api.github.com/repos/h66rogi/rogichat/'+path
        with urllib.request.urlopen(urllib.request.Request(url,headers={'Accept':'application/vnd.github+json'}),timeout=15) as response:
            return json.load(response)
    validate_promotion(request,github('branches/main'),
                       github('compare/'+request['source_sha']+'...'+request['promotion_sha']))


def validate_promotion(request, main, compare):
    require(main['commit']['sha'] == request['promotion_sha']
            and compare['status'] in ('ahead','identical')
            and compare['merge_base_commit']['sha'] == request['source_sha'])


def verify_qa_evidence(request, evidence):
    fields = {'environment','source_sha','runtime_image','migration_image','verification_runs','request_id','completed'}
    require(type(evidence) is dict and set(evidence) == (fields | ({'archive'} if 'archive' in request else set())))
    require(evidence['environment'] == 'qa' and evidence['completed'] is True
            and type(evidence['request_id']) is str
            and str(uuid.UUID(evidence['request_id'])) == evidence['request_id'])
    for key in ('source_sha','runtime_image','migration_image','verification_runs'):
        require(evidence[key] == request[key])
    if 'archive' in request:
        require(evidence['archive'] == request['archive'])


def secret(path):
    shared.validate_auth_metadata(path.lstat())
    return protected(path, mode=0o440)


def verify_binding(request):
    require(digest(protected(HOST, mode=0o600)) == request['host_binding_sha256'])
    binding = host_binding()
    require(binding['database_host_sha256'] == request['database_host_sha256'])
    raw = protected(QA_EVIDENCE, mode=0o600)
    require(digest(raw) == request['qa_evidence_sha256'])
    verify_qa_evidence(request, json.loads(raw))
    require(run(['/usr/bin/findmnt','--noheadings','--output','FSTYPE','--target',str(DATABASE)]).strip() == b'tmpfs')
    validate_credential(json.loads(secret(DATABASE)), request['database_host_sha256'])
    secret(AUTH)
    protected(CA)


def probe(request, role, *, network, mounts, command, data=None):
    name = 'rogichat-prod-preflight-' + str(uuid.uuid4())
    args = ['run','--rm','--pull','never','--name',name,'--network',network,'--read-only',
            '--user','10001:10001','--cap-drop','ALL','--security-opt','no-new-privileges',
            '--memory','256m','--pids-limit','64','--log-driver','none','-i']
    for source, target in mounts:
        args += ['--mount',f'type=bind,src={source},dst={target},readonly']
    try:
        docker(*args,shared.execution_image(request,role),*command,timeout=45,data=data)
    finally:
        subprocess.run(['/usr/bin/docker','rm','-f',name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=30)


def verify_runtime(request, release):
    # API auth configuration is parsed by the exact QA-verified runtime image.
    code = ("try{const{readAuthConfig}=await import('./dist/infrastructure/config/auth-config.js');"
            "const c=readAuthConfig({environment:'production'},{AUTH_SECRET_FILE:'/run/secrets/auth.json'});"
            "if(!c.broker)process.exit(1);process.exit(0)}catch{process.exit(1)}")
    probe(request,'runtime',network='none',mounts=[(AUTH,'/run/secrets/auth.json')],
          command=['--input-type=module','-e',code])
    # Migration image supplies mysql2 + schema manifest; only SELECT/SHOW code is
    # mounted and only the DML-scoped runtime credential is ever available.
    probe(request,'migration',network=request['edge_network'],mounts=[
        (DATABASE,'/run/secrets/database.json'),(CA,'/run/secrets/rds-ca.pem'),
        (release/ARTIFACTS['readiness'],'/run/release/readiness.mjs')],
        command=['/run/release/readiness.mjs'],data=json.dumps({k:request[k] for k in
            ('environment','migration_policy','database_host_sha256')}).encode())


def get_caddy(network):
    ids = docker('ps','--filter','label=com.docker.compose.project=rogichat-prod',
                 '--filter','label=com.docker.compose.service=caddy','--format','{{.ID}}').decode().split()
    require(len(ids) == 1 and re.fullmatch(r'[a-f0-9]{12,64}',ids[0]))
    c = json.loads(docker('inspect',ids[0]))[0]
    require(network in c['NetworkSettings']['Networks']
            and c['Config']['Image'] == 'caddy:2.11.4-alpine@sha256:de23def33b17fb5d1290b0f6c2add1d70780e52341896c00a4c8a2a2fe9d355e')
    mounts = {m['Destination']:m for m in c['Mounts']}
    require(mounts['/etc/caddy/Caddyfile']['Source'] == str(CADDY) and not mounts['/etc/caddy/Caddyfile']['RW']
            and mounts['/data']['Type'] == mounts['/config']['Type'] == 'volume')
    peers = json.loads(docker('network','inspect',network))[0]['Containers']
    require(all(p['Name'] in {c['Name'].removeprefix('/'),'rogichat-prod-api'} for p in peers.values()))
    for peer in peers.values():
        if peer['Name'] == 'rogichat-prod-api':
            shared.validate_api_ingress(inspect_container('api'),network)
    return ids[0]


def caddy_config(container, data):
    protected(CADDY)
    # Keep the inode: Caddy uses a file bind mount.
    with CADDY.open('r+b') as stream:
        stream.write(data); stream.truncate(); stream.flush(); os.fsync(stream.fileno())
    docker('exec',container,'caddy','adapt','--config','/etc/caddy/Caddyfile','--adapter','caddyfile','--validate')
    docker('exec',container,'caddy','reload','--config','/etc/caddy/Caddyfile','--adapter','caddyfile')


def inspect_container(role):
    name = 'rogichat-prod-'+role
    # List first so only absence of the exact owned name is considered transient.
    if not docker('ps','-a','--filter','name=^/'+name+'$','--format','{{.ID}}').strip():
        return None
    item = json.loads(docker('inspect',name))[0]
    labels = item['Config'].get('Labels',{})
    require(item['Name'] == '/'+name and labels.get('com.docker.compose.project') == 'rogichat-prod-app'
            and labels.get('com.docker.compose.service') == role)
    return item


def validate_running(item, role, request):
    require(item['Config']['Image'] == shared.execution_image(request,'runtime'))
    if 'archive' in request:
        require(item['Image'] == shared.execution_image(request,'runtime'))
    env = dict(entry.split('=',1) for entry in item['Config']['Env'])
    require(env.get('APP_ENV') == 'production' and env.get('DB_TLS_MODE') == 'required')
    require(not item['HostConfig'].get('PortBindings') and not item['HostConfig'].get('PublishAllPorts')
            and item['HostConfig']['NetworkMode'] != 'host')
    mounts = {m['Destination']:m for m in item['Mounts']}
    require(mounts['/run/secrets/database.json']['Source'] == str(DATABASE)
            and not mounts['/run/secrets/database.json']['RW'])
    if role == 'api':
        shared.validate_api_ingress(item,request['edge_network'])
        require(mounts['/run/secrets/auth.json']['Source'] == str(AUTH) and not mounts['/run/secrets/auth.json']['RW'])
    else:
        require('/run/secrets/auth.json' not in mounts and 'AUTH_SECRET_FILE' not in env
                and set(item['NetworkSettings']['Networks']) == {'rogichat-prod-app_jobs'})
    state = item['State']
    require(state['Status'] == 'running' and not state.get('OOMKilled') and not state.get('Error'))
    return state.get('Health',{}).get('Status') == 'healthy'


def wait_health(request):
    deadline = time.monotonic()+90
    while time.monotonic() < deadline:
        healthy = True
        for role in ('api','worker'):
            item = inspect_container(role)
            if item is None or item['State']['Status'] == 'created':
                healthy = False
            else:
                healthy = validate_running(item,role,request) and healthy
        if healthy:
            return
        time.sleep(2)
    raise ValueError('production health gate failed')


def verify_routes(routes):
    for route in routes:
        url = 'https://api.rogi.chat'+route
        with urllib.request.urlopen(url,timeout=10) as response:
            require(response.status == 200 and response.geturl() == url)


def compose_args():
    return ('compose','--env-file',str(IMAGES),'-f',str(APP/'compose.app.yaml'))


def stop_units():
    for role in ('api','worker'):
        run(['/usr/bin/systemctl','stop','rogichat-prod-app@'+role],timeout=40)


def stop_after_failure():
    # Best effort after an already-failed release; always try both, even when a
    # systemctl client times out. No completion marker is written on this path.
    for role in ('api','worker'):
        try:
            subprocess.run(['/usr/bin/systemctl','stop','rogichat-prod-app@'+role],
                           stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=40)
        except Exception:
            pass


def deploy(request, files, container):
    receipt = RECEIPTS / ('receipt-'+request['request_id'])
    require(not receipt.exists())
    atomic(receipt/'consumed.json',json.dumps(request,sort_keys=True).encode(),0o600)
    for name,path in {'compose':APP/'compose.app.yaml','images':IMAGES,'unit':UNIT,'caddy':CADDY}.items():
        if path.exists():
            atomic(receipt/('previous-'+name),protected(path),0o600)
    try:
        caddy_config(container,files['bootstrap'])
        if UNIT.exists():
            stop_units()
        for role in ('api','worker'):
            item = inspect_container(role)
            require(item is None or (not item['State']['Running'] and item['State']['Status'] in ('created','exited')))
        atomic(APP/'compose.app.yaml',files['compose'])
        image = shared.execution_image(request,'runtime')
        atomic(IMAGES,(f'ROGICHAT_API_IMAGE={image}\nROGICHAT_WORKER_IMAGE={image}\n'
                       f"ROGICHAT_EDGE_NETWORK={request['edge_network']}\n").encode(),0o600)
        atomic(UNIT,files['unit'])
        run(['/usr/bin/systemctl','daemon-reload'])
        require(run(['/usr/bin/systemctl','is-active','rogichat-prod-runtime-secrets.service']).strip() == b'active')
        docker(*compose_args(),'config','--quiet')
        docker(*compose_args(),'create','--force-recreate','--no-build','--pull','never','api','worker',timeout=90)
        for role in ('api','worker'):
            run(['/usr/bin/systemctl','enable','--now','rogichat-prod-app@'+role],timeout=90)
        wait_health(request)
        require(get_caddy(request['edge_network']) == container)
        caddy_config(container,files['caddy'])
        verify_routes(('/live','/ready','/_infra/health'))
        result = {k:request[k] for k in ('environment','source_sha','promotion_sha','runtime_image','migration_image','request_id')}
        result.update(completed=True,request_sha256=digest(protected(REQUEST,mode=0o600)),
                      runtime_execution_id=image,verified_at=int(time.time()),migration_executed=False)
        atomic(receipt/'completed.json',json.dumps(result,sort_keys=True).encode(),0o600)
    except BaseException:
        try:
            caddy_config(container,files['bootstrap'])
        finally:
            stop_after_failure()
        raise


def validate_templates(request, release, files, container):
    # Temporary public image bindings only; no credentials or installed config changes.
    image = shared.execution_image(request,'runtime')
    with tempfile.NamedTemporaryFile(prefix='rogichat-prod-compose-',dir='/var/tmp') as env:
        env.write((f'ROGICHAT_API_IMAGE={image}\nROGICHAT_WORKER_IMAGE={image}\n'
                   f"ROGICHAT_EDGE_NETWORK={request['edge_network']}\n").encode())
        env.flush()
        docker('compose','--env-file',env.name,'-f',str(release/ARTIFACTS['compose']),'config','--quiet')
    for key in ('bootstrap','caddy'):
        docker('exec','-i',container,'caddy','adapt','--config','-','--adapter','caddyfile','--validate',data=files[key])


def preflight():
    request = validate_request(json.loads(protected(REQUEST,mode=0o600)))
    verify_binding(request)
    require(run(['/usr/bin/systemctl','is-active','rogichat-prod-runtime-secrets.service']).strip() == b'active')
    release = shared.RELEASES/request['promotion_sha']
    files = {k:protected(release/p) for k,p in ARTIFACTS.items()}
    require(all(digest(files[k]) == request['artifacts'][k] for k in ARTIFACTS))
    # Reviewed installed helper versions must match the exact staged source bytes.
    for key in ('secret_helper','shared_helper','archive_helper','production_helper'):
        require(protected(OPERATIONS/Path(ARTIFACTS[key]).name) == files[key])
    require(Path(__file__).absolute() == OPERATIONS/'backend_production_release.py')
    require(protected(SECRET_UNIT) == files['secret_unit'])
    require(digest(protected(CADDY)) == request['previous_caddy_sha256'])
    require(not (RECEIPTS/('receipt-'+request['request_id'])).exists())
    verify_promotion(request)
    shared.verify_ci(request)
    shared.verify_release_images(request)
    container = get_caddy(request['edge_network'])
    for role in ('api','worker'):
        inspect_container(role)  # Reject foreign name ownership before draining.
    validate_templates(request,release,files,container)
    verify_runtime(request,release)
    require(get_caddy(request['edge_network']) == container)
    verify_routes(('/_infra/health',))
    return request,files,container


def activation_gate(request):
    # Slow image/schema probes may outlive the reviewed main head or binding.
    # Recheck authorization under the common host lock immediately before drain.
    verify_promotion(request)
    verify_binding(request)
    require(time.time() < request['expires_at']
            and json.loads(protected(REQUEST,mode=0o600)) == request
            and digest(protected(CADDY)) == request['previous_caddy_sha256'])


def validate_lock(metadata):
    require(metadata.st_uid == 0 and stat.S_ISREG(metadata.st_mode)
            and stat.S_IMODE(metadata.st_mode) == 0o600 and metadata.st_nlink == 1)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply',action='store_true')
    args = parser.parse_args()
    require(os.geteuid() == 0)
    protected(Path(__file__).absolute())
    fd = os.open(LOCK,os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'w') as lock:
        metadata = os.fstat(lock.fileno())
        validate_lock(metadata)
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        request,files,container = preflight()
        if not args.apply:
            print('Production preflight passed; no application/configuration changes or migrations executed.')
            return
        activation_gate(request)
        def interrupt(*_):
            raise ValueError('interrupted')
        for sig in (signal.SIGTERM,signal.SIGINT,signal.SIGHUP):
            signal.signal(sig,interrupt)
        deploy(request,files,container)
    print('Production API and worker health/TLS verified; no migration executed.')


if __name__ == '__main__':
    try:
        main()
    except (Exception,KeyboardInterrupt):
        print('Production release rejected or failed; inspect private state before a fresh request.',file=sys.stderr)
        sys.exit(1)
