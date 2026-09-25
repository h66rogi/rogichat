#!/usr/bin/env python3
"""Reviewed root-owned QA deployer; no remote checkout, arbitrary shell or cloud IAM.

Default is validation only. The operator installs a separately reviewed, root-owned
request at the fixed path and explicitly supplies --apply. Migrator JSON is stdin,
never a command argument. This is not an unattended GitHub-triggered deployer.
"""
from __future__ import annotations
import argparse
import fcntl
import hashlib
import importlib.util
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

REQUEST = Path('/etc/rogichat/backend-release.json')
RELEASES = Path('/opt/rogichat/releases')
APP = Path('/opt/rogichat/app')
IMAGES = Path('/etc/rogichat/app-images.env')
FEATURE_COMPOSE = APP / 'compose.features.yaml'
MEDIA_SECRET = Path('/etc/rogichat/media.json')
EMPTY_FEATURES = b'services: {}\n'
CADDY = Path('/opt/rogichat/bootstrap/Caddyfile')
UNIT = Path('/etc/systemd/system/rogichat-app@.service')
LOCK = Path('/run/lock/rogichat-deploy.lock')
RUNTIME_SECRET = Path('/run/rogichat/secrets/database.json')
AUTH_SECRET = Path('/etc/rogichat/auth.json')
CA = Path('/etc/rogichat/rds-global-bundle.pem')
SOURCE = 'https://github.com/h66rogi/rogichat'
SHA = re.compile(r'[a-f0-9]{40}\Z')
HASH = re.compile(r'[a-f0-9]{64}\Z')
ARTIFACTS = {
    'compose': 'infrastructure/runtime/compose.app.yaml',
    'unit': 'infrastructure/runtime/rogichat-app@.service',
    'caddy': 'infrastructure/runtime/Caddyfile.app',
    'bootstrap': 'infrastructure/runtime/Caddyfile.bootstrap',
    'migration_entry': 'tools/operations/migrate_entry.mjs',
}
FEATURE_ARTIFACTS = {'media': 'infrastructure/runtime/compose.media.yaml'}
WORKFLOWS = {'backend.yml', 'security.yml', 'infrastructure.yml', 'backend-publish.yml'}
NEW_WORKFLOWS = {'web.yml', 'backend.yml', 'security.yml', 'infrastructure.yml',
                 'mobile.yml', 'qa-publication.yml'}


class Rejected(ValueError):
    pass


def require(condition):
    if not condition:
        raise Rejected('QA release rejected')


def digest(data):
    return hashlib.sha256(data).hexdigest()


def selected_features(value):
    require(type(value) is list and value in ([], ['media']))
    return value


def artifacts_for(request):
    return {**ARTIFACTS, **{'feature_' + feature: FEATURE_ARTIFACTS[feature]
                           for feature in selected_features(request.get('features', []))}}


def image_roles(request):
    return ('runtime', 'migration', 'decoder') if 'media' in selected_features(request.get('features', [])) else ('runtime', 'migration')


def validate_request(value):
    fields = {'environment', 'source_sha', 'runtime_image', 'migration_image', 'edge_network',
              'database_host_sha256', 'artifacts', 'migrations', 'verification_runs',
              'previous_caddy_sha256', 'request_id', 'expires_at'}
    require(type(value) is dict)
    features = selected_features(value.get('features', []))
    optional = ({'features'} if 'features' in value else set()) | ({'decoder_image'} if 'media' in features else set())
    require(set(value) in (fields | optional, fields | optional | {'archive'}) and value['environment'] == 'qa')
    require(('decoder_image' in value) == ('media' in features))
    if 'archive' in value:
        archive = value['archive']
        require(type(archive) is dict and set(archive) == {'export_sha', 'export_run', 'export_attempt',
                'artifact_id', 'artifact_sha256', 'runtime_config_id', 'migration_config_id', 'validator_sha256',
                'execution_identity', 'runtime_execution_id', 'migration_execution_id'} |
                ({'decoder_config_id', 'decoder_execution_id'} if 'media' in features else set()))
        require(archive['execution_identity'] in ('config', 'archive-manifest'))
        require(type(archive['export_sha']) is str and SHA.fullmatch(archive['export_sha']))
        require(all(type(archive[key]) is int and archive[key] > 0
                    for key in ('export_run', 'export_attempt', 'artifact_id')))
        require(type(archive['validator_sha256']) is str and HASH.fullmatch(archive['validator_sha256']))
        require(all(type(archive[key]) is str and re.fullmatch(r'sha256:[a-f0-9]{64}', archive[key])
                    for key in ('artifact_sha256', *(role + '_config_id' for role in image_roles(value)),
                                *(role + '_execution_id' for role in image_roles(value)))))
        if archive['execution_identity'] == 'config':
            require(all(archive[role + '_execution_id'] == archive[role + '_config_id'] for role in image_roles(value)))
    require('media' not in features or 'archive' in value)
    require(type(value['source_sha']) is str and SHA.fullmatch(value['source_sha']))
    for key, repo in [('runtime_image', 'rogichat-api'), ('migration_image', 'rogichat-api-migration'),
                      *([('decoder_image', 'rogichat-media-decoder')] if 'media' in features else [])]:
        require(type(value[key]) is str and re.fullmatch(r'ghcr\.io/h66rogi/' + repo + r'@sha256:[a-f0-9]{64}', value[key]))
    require(type(value['edge_network']) is str and re.fullmatch(r'rogichat-qa_[a-z0-9_-]{1,40}', value['edge_network']))
    for key in ('database_host_sha256', 'previous_caddy_sha256'):
        require(type(value[key]) is str and HASH.fullmatch(value[key]))
    require(type(value['artifacts']) is dict and set(value['artifacts']) == set(artifacts_for(value)))
    require(all(type(h) is str and HASH.fullmatch(h) for h in value['artifacts'].values()))
    require(type(value['migrations']) is list and 0 < len(value['migrations']) <= 100)
    names = []
    for migration in value['migrations']:
        require(type(migration) is dict and set(migration) == {'name', 'checksum'})
        require(type(migration['name']) is str and re.fullmatch(r'[0-9]{14}_[a-z0-9_]{1,80}', migration['name']))
        require(type(migration['checksum']) is str and HASH.fullmatch(migration['checksum']))
        names.append(migration['name'])
    require(names == sorted(set(names)))
    require(type(value['verification_runs']) is dict
            and set(value['verification_runs']) in (WORKFLOWS, NEW_WORKFLOWS))
    require(all(type(n) is int and n > 0 for n in value['verification_runs'].values()))
    require(type(value['request_id']) is str and str(uuid.UUID(value['request_id'])) == value['request_id'])
    require(type(value['expires_at']) is int and time.time() < value['expires_at'] <= time.time() + 3600)
    return value


def protected(path, *, mode=None, read=True):
    """Every existing parent is root-owned and not group/other writable; no links."""
    require(path.is_absolute())
    for item in [path, *path.parents]:
        metadata = item.lstat()
        require(not stat.S_ISLNK(metadata.st_mode) and metadata.st_uid == 0 and not metadata.st_mode & 0o022)
    require(path.is_file())
    if mode is not None:
        require(stat.S_IMODE(path.stat().st_mode) == mode)
    return path.read_bytes() if read else None


def run(argv, *, timeout=60, data=None):
    # Never include child output, argv or input in an exception/log.
    result = subprocess.run(argv, input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            timeout=timeout, env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'HOME': '/root'})
    require(result.returncode == 0)
    return result.stdout


def docker(*args, **kwargs):
    return run(['/usr/bin/docker', *args], **kwargs)


def github_read(path):
    url = 'https://api.github.com/repos/h66rogi/rogichat/' + path
    with urllib.request.urlopen(urllib.request.Request(url, headers={'Accept': 'application/vnd.github+json'}), timeout=15) as response:
        return json.load(response)


def verify_ci(request):
    for workflow, run_id in request['verification_runs'].items():
        result = github_read(f'actions/runs/{run_id}')
        require(result['head_sha'] == request['source_sha'] and result['head_branch'] == 'qa'
                and result['event'] in ({'workflow_run', 'schedule', 'workflow_dispatch'}
                                        if workflow == 'qa-publication.yml' else {'push'})
                and result['status'] == 'completed'
                and result['conclusion'] == 'success' and result['repository']['full_name'] == 'h66rogi/rogichat'
                and result['head_repository']['full_name'] == 'h66rogi/rogichat'
                and result['path'] == '.github/workflows/' + workflow)
        if workflow == 'qa-publication.yml':
            require(result['name'] == 'QA verified image publication'
                    and type(result['run_attempt']) is int and result['run_attempt'] > 0)
            listing = github_read(f"actions/runs/{run_id}/attempts/{result['run_attempt']}/jobs?per_page=100")
            require(type(listing['total_count']) is int and 0 < listing['total_count'] <= 100
                    and type(listing['jobs']) is list and len(listing['jobs']) == listing['total_count'])
            jobs = [job for job in listing['jobs'] if job['name'] == 'Backend publication result']
            require(len(jobs) == 1 and jobs[0]['run_id'] == run_id
                    and jobs[0]['run_attempt'] == result['run_attempt']
                    and jobs[0]['status'] == 'completed' and jobs[0]['conclusion'] == 'success')


def verify_image(image, source_sha):
    data = json.loads(docker('image', 'inspect', image))[0]
    labels = data['Config']['Labels']
    require(image in data['RepoDigests'] and data['Architecture'] == 'amd64'
            and data['Os'] == 'linux' and data['Config']['User'] == '10001:10001'
            and data['Config']['Entrypoint'] == ['node']
            and labels.get('org.opencontainers.image.source') == SOURCE
            and labels.get('org.opencontainers.image.revision') == source_sha)


def execution_image(request, role):
    return request['archive'][role + '_execution_id'] if 'archive' in request else request[role + '_image']


def verify_archive_image_data(data, expected, config, source, approval, role):
    identity = approval[role + '_execution_id']
    require(expected['config_id'] == approval[role + '_config_id'])
    if approval['execution_identity'] == 'config':
        require(identity == expected['config_id'])
    else:
        require(approval['execution_identity'] == 'archive-manifest'
                and config['_archive_manifest'] is not None
                and identity == config['_archive_manifest']['digest']
                and data.get('Descriptor') == config['_archive_manifest'])
    require(data['Id'] == identity and data['Architecture'] == 'amd64'
            and data['Os'] == 'linux' and data['Config']['User'] == '10001:10001'
            and data['Config']['Entrypoint'] == ['node']
            and data['Config']['Labels'].get('org.opencontainers.image.source') == SOURCE
            and data['Config']['Labels'].get('org.opencontainers.image.revision') == source
            and data['RootFS']['Layers'] == config['rootfs']['diff_ids'])


def verify_archive_images(request):
    approval = request['archive']
    module_path = Path(__file__).absolute().parent / 'backend_archive.py'
    require(digest(protected(module_path)) == approval['validator_sha256'])
    spec = importlib.util.spec_from_file_location('approved_backend_archive', module_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    archive_path = RELEASES / request['source_sha'] / 'export.zip'
    protected(archive_path, read=False)
    # Private scratch contains public image bytes only; deleted after validation.
    # ZIP/tars are streamed, never buffered into RAM or extractall'd as paths.
    with tempfile.TemporaryDirectory(prefix='rogichat-verify-', dir='/var/tmp') as temporary:
        descriptor, configs = module.validate_zip(archive_path, approval['artifact_sha256'], Path(temporary) / 'verified')
        module.verify_provenance(descriptor, approval)
        require(descriptor['source_sha'] == request['source_sha']
                and descriptor['verification_runs'] == request['verification_runs'])
        require(descriptor['version'] == (2 if 'media' in selected_features(request.get('features', [])) else 1))
        require(set(descriptor['images']) == set(image_roles(request)))
        for role in image_roles(request):
            expected = descriptor['images'][role]
            require(expected['image'] == request[role + '_image']
                    and expected['config_id'] == approval[role + '_config_id'])
            data = json.loads(docker('image', 'inspect', execution_image(request, role)))[0]
            verify_archive_image_data(data, expected, configs[role], request['source_sha'], approval, role)


def verify_release_images(request):
    if 'archive' in request:
        verify_archive_images(request)
    else:
        require('media' not in selected_features(request.get('features', [])))
        for key in ('runtime_image', 'migration_image'):
            verify_image(request[key], request['source_sha'])


def verify_media_secret(request):
    if 'media' not in selected_features(request.get('features', [])):
        return
    raw = protected(MEDIA_SECRET, mode=0o440)
    metadata = MEDIA_SECRET.stat()
    require(metadata.st_gid == 10001 and 0 < len(raw) <= 4096)
    value = json.loads(raw)
    require(type(value) is dict and set(value) == {'accountId', 'bucket', 'accessKeyId', 'secretAccessKey'})
    require(type(value['accountId']) is str and re.fullmatch(r'[a-f0-9]{32}', value['accountId']))
    require(type(value['bucket']) is str and re.fullmatch(r'[a-z0-9][a-z0-9-]{1,61}[a-z0-9]', value['bucket']))
    require(type(value['accessKeyId']) is str and re.fullmatch(r'[A-Za-z0-9]{20,128}', value['accessKeyId']))
    require(type(value['secretAccessKey']) is str and re.fullmatch(r'[A-Za-z0-9/+=]{32,128}', value['secretAccessKey']))


def compose_requires_auth(compose):
    if b'AUTH_SECRET_FILE' not in compose:
        return False
    # These are reviewed hash-pinned templates, not arbitrary caller YAML. Fail
    # closed on a changed spelling/path instead of silently skipping preflight.
    require(compose.count(b'AUTH_SECRET_FILE') == 1
            and re.search(rb'^      AUTH_SECRET_FILE: /run/secrets/auth\.json$', compose, re.MULTILINE))
    return True


def validate_auth_metadata(metadata):
    require(stat.S_ISREG(metadata.st_mode) and stat.S_IMODE(metadata.st_mode) == 0o440
            and metadata.st_uid == 0 and metadata.st_gid == 10001 and metadata.st_nlink == 1
            and 0 < metadata.st_size <= 8192)


def verify_auth_secret(compose, image):
    if not compose_requires_auth(compose):
        return
    # Check size/type before reading. protected() additionally checks every parent
    # and rejects symlinks/group/other writes. No key generation or file mutation.
    validate_auth_metadata(AUTH_SECRET.lstat())
    protected(AUTH_SECRET, mode=0o440)
    name = 'rogichat-qa-auth-preflight-' + str(uuid.uuid4())
    code = ("try{const{readAuthConfig}=await import('./dist/infrastructure/config/auth-config.js');"
            "readAuthConfig({environment:'qa'});process.exit(0)}catch{process.exit(1)}")
    try:
        docker('run', '--rm', '--pull', 'never', '--name', name, '--network', 'none', '--read-only',
               '--user', '10001:10001', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
               '--memory', '128m', '--pids-limit', '64', '--log-driver', 'none',
               '--mount', 'type=bind,src=/etc/rogichat/auth.json,dst=/run/secrets/auth.json,readonly',
               '--env', 'AUTH_SECRET_FILE=/run/secrets/auth.json',
               image, '--input-type=module', '-e', code, timeout=20)
    finally:
        # A timed-out Docker client must not leave a container with auth mounted.
        subprocess.run(['/usr/bin/docker', 'rm', '-f', name], stdout=subprocess.DEVNULL,
                       stderr=subprocess.DEVNULL, timeout=30)


def compose_requires_vapid(compose):
    if b'PUSH_VAPID' not in compose:
        return False
    require(compose.count(b'PUSH_VAPID_SECRET_FILE') == 1
            and re.search(rb'^  PUSH_VAPID_SECRET_FILE: /run/secrets/push-vapid\.json$', compose, re.MULTILINE))
    return True


def validate_vapid_metadata(metadata):
    require(stat.S_ISREG(metadata.st_mode) and stat.S_IMODE(metadata.st_mode) in (0o400, 0o600)
            and metadata.st_uid == 10001 and metadata.st_gid == 10001 and metadata.st_nlink == 1
            and 0 < metadata.st_size <= 4096)


def verify_vapid_secret(compose, image, environment='qa'):
    require(environment in ('qa', 'production'))
    if not compose_requires_vapid(compose):
        return
    path = Path('/etc/rogichat' if environment == 'qa' else '/etc/rogichat/prod') / 'push-vapid.json'
    for parent in path.parents:
        metadata = parent.lstat()
        require(stat.S_ISDIR(metadata.st_mode) and metadata.st_uid == 0 and not metadata.st_mode & 0o022)
    validate_vapid_metadata(path.lstat())
    name = 'rogichat-' + environment + '-vapid-preflight-' + str(uuid.uuid4())
    code = ("try{const{readPushConfig}=await import('./dist/modules/notifications/push-config.js');"
            "const c=readPushConfig({APP_ENV:" + json.dumps(environment) + ","
            "PUSH_VAPID_SECRET_FILE:'/run/secrets/push-vapid.json'});"
            "process.exit(c.vapid?0:1)}catch{process.exit(1)}")
    try:
        docker('run', '--rm', '--pull', 'never', '--name', name, '--network', 'none', '--read-only',
               '--user', '10001:10001', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
               '--memory', '128m', '--pids-limit', '64', '--log-driver', 'none',
               '--mount', f'type=bind,src={path},dst=/run/secrets/push-vapid.json,readonly',
               image, '--input-type=module', '-e', code, timeout=20)
    finally:
        subprocess.run(['/usr/bin/docker', 'rm', '-f', name], stdout=subprocess.DEVNULL,
                       stderr=subprocess.DEVNULL, timeout=30)


def verify_live_vapid(environment):
    require(environment in ('qa', 'production'))
    label = 'qa' if environment == 'qa' else 'prod'
    source = '/etc/rogichat' + ('' if environment == 'qa' else '/prod') + '/push-vapid.json'
    fingerprints = []
    code = ("try{const{readPushConfig}=await import('./dist/modules/notifications/push-config.js');"
            "const{createHash}=await import('node:crypto');const c=readPushConfig();"
            "if(!c.vapid)process.exit(1);process.stdout.write(createHash('sha256').update(c.vapid.publicKey).digest('hex'));"
            "}catch{process.exit(1)}")
    for role in ('api', 'worker'):
        name = 'rogichat-' + label + '-' + role
        item = json.loads(docker('inspect', name))[0]
        env = dict(v.split('=', 1) for v in item['Config']['Env'])
        require(item['Config']['User'] == '10001:10001' and env.get('APP_ENV') == environment
                and {k: v for k, v in env.items() if 'VAPID' in k} == {'PUSH_VAPID_SECRET_FILE': '/run/secrets/push-vapid.json'})
        mounts = {m['Destination']: m for m in item['Mounts']}
        mount = mounts.get('/run/secrets/push-vapid.json', {})
        require(mount.get('Type') == 'bind' and mount.get('Source') == source and mount.get('RW') is False)
        if role == 'worker':
            require('AUTH_SECRET_FILE' not in env and '/run/secrets/auth.json' not in mounts)
        fingerprint = docker('exec', name, 'node', '--input-type=module', '-e', code, timeout=20).decode()
        require(HASH.fullmatch(fingerprint))
        fingerprints.append(fingerprint)
    require(len(set(fingerprints)) == 1)


def get_caddy(network):
    ids = docker('ps', '--filter', 'label=com.docker.compose.project=rogichat-qa',
                 '--filter', 'label=com.docker.compose.service=caddy', '--format', '{{.ID}}').decode().split()
    require(len(ids) == 1 and re.fullmatch(r'[0-9a-f]{12,64}', ids[0]))
    current = json.loads(docker('inspect', ids[0]))[0]
    require(network in current['NetworkSettings']['Networks'])
    mounts = {entry['Destination']: entry for entry in current['Mounts']}
    require(mounts['/etc/caddy/Caddyfile']['Source'] == str(CADDY)
            and mounts['/etc/caddy/Caddyfile']['RW'] is False
            and mounts['/data']['Type'] == 'volume' and mounts['/config']['Type'] == 'volume')
    peers = json.loads(docker('network', 'inspect', network))[0]['Containers']
    allowed = {current['Name'].removeprefix('/'), 'rogichat-qa-api'}
    require(all(peer['Name'] in allowed for peer in peers.values()))
    for peer in peers.values():
        if peer['Name'] == 'rogichat-qa-api':
            api = json.loads(docker('inspect', 'rogichat-qa-api'))[0]
            validate_api_ingress(api, network)
    return ids[0]


def validate_api_ingress(api, network):
    require(not api['HostConfig'].get('PortBindings')
            and not api['HostConfig'].get('PublishAllPorts')
            and api['HostConfig']['NetworkMode'] != 'host'
            and set(api['NetworkSettings']['Networks']) == {network})


def atomic(path, data, mode=0o644):
    for parent in reversed([path.parent, *path.parent.parents]):
        if not parent.exists():
            parent.mkdir(mode=0o755)
        metadata = parent.lstat()
        require(stat.S_ISDIR(metadata.st_mode) and metadata.st_uid == 0
                and not metadata.st_mode & 0o022)
    if path.exists():
        protected(path)
    fd, name = tempfile.mkstemp(prefix='.release-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            os.fchmod(stream.fileno(), mode)
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def caddy_config(container, data):
    # Preserve the bind-mounted inode; atomic replacement would leave the live
    # container viewing the old file. Host deployment lock protects this write.
    protected(CADDY)
    with CADDY.open('r+b') as stream:
        stream.write(data)
        stream.truncate()
        stream.flush()
        os.fsync(stream.fileno())
    docker('exec', container, 'caddy', 'adapt', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile', '--validate')
    docker('exec', container, 'caddy', 'reload', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile')


def inspect_starting_container(role, timeout):
    require(role in ('api', 'worker', 'decoder') and 0 < timeout <= 10)
    name = 'rogichat-qa-' + role
    result = subprocess.run(['/usr/bin/docker', 'container', 'inspect', name],
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout,
                            env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'HOME': '/root'})
    if result.returncode == 1 and result.stderr.strip() == ('Error response from daemon: No such container: ' + name).encode():
        # Type=simple systemd readiness precedes Compose's Docker create/start.
        # Only this exact missing owned container is transient; daemon/auth/API
        # failures remain immediate rejection and never bypass identity checks.
        return None
    require(result.returncode == 0)
    items = json.loads(result.stdout)
    require(type(items) is list and len(items) == 1 and items[0]['Name'] == '/' + name)
    return items[0]


def wait_health(request):
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        healthy = True
        for role in ('api', 'worker', *(['decoder'] if 'media' in selected_features(request.get('features', [])) else [])):
            remaining = deadline - time.monotonic()
            require(remaining > 0)
            item = inspect_starting_container(role, min(10, remaining))
            if item is None:
                healthy = False
                continue
            image_role = 'decoder' if role == 'decoder' else 'runtime'
            require(item['Config']['Image'] == execution_image(request, image_role))
            if 'archive' in request:
                require(item['Image'] == execution_image(request, image_role))
            state = item['State']
            require(state['Status'] in ('created', 'running') and not state.get('Paused')
                    and not state.get('OOMKilled') and not state.get('Error'))
            if 'media' in selected_features(request.get('features', [])):
                env = dict(entry.split('=', 1) for entry in item['Config']['Env'])
                mounts = item['Mounts']
                if role == 'decoder':
                    require(env.get('DECODER_ISOLATED') == 'true'
                            and not any(key in env for key in ('DATABASE_SECRET_FILE', 'AUTH_SECRET_FILE', 'MEDIA_SECRET_FILE')))
                    socket = [mount for mount in mounts if mount['Destination'] == '/run/decoder']
                    require(len(socket) == 1 and socket[0]['Type'] == 'volume' and socket[0]['RW'])
                else:
                    require(env.get('MEDIA_ENABLED') == 'true'
                            and env.get('MEDIA_SECRET_FILE') == '/run/secrets/media.json'
                            and env.get('MEDIA_SCRATCH_DIR') == '/media-scratch')
                    secret = [mount for mount in mounts if mount['Destination'] == '/run/secrets/media.json']
                    require(len(secret) == 1 and secret[0]['Type'] == 'bind'
                            and secret[0]['Source'] == str(MEDIA_SECRET) and not secret[0]['RW'])
                    if role == 'worker':
                        require(env.get('MEDIA_DECODER_SOCKET') == '/run/decoder/image.sock')
                        socket = [mount for mount in mounts if mount['Destination'] == '/run/decoder']
                        require(len(socket) == 1 and socket[0]['Type'] == 'volume' and not socket[0]['RW'])
            if role == 'decoder':
                require(item['HostConfig']['NetworkMode'] == 'none'
                        and item['HostConfig']['ReadonlyRootfs']
                        and not item['HostConfig'].get('PortBindings'))
                require(all(mount['Destination'] not in ('/run/secrets', '/etc/rogichat') for mount in item['Mounts']))
            if role == 'api':
                if state['Status'] == 'created' and not state['Running']:
                    # Docker may not have attached NetworkingConfig yet. No
                    # host port/host network/other network is ever permitted.
                    require(not item['HostConfig'].get('PortBindings') and not item['HostConfig'].get('PublishAllPorts')
                            and item['HostConfig']['NetworkMode'] == request['edge_network']
                            and set(item['NetworkSettings']['Networks']) in (set(), {request['edge_network']}))
                else:
                    validate_api_ingress(item, request['edge_network'])
            if not state['Running'] or state.get('Health', {}).get('Status') != 'healthy':
                healthy = False
        if healthy:
            return
        time.sleep(min(2, max(0, deadline - time.monotonic())))
    raise Rejected('health gate failed')


def compose_args():
    return ('--env-file', str(IMAGES), '-f', str(APP / 'compose.app.yaml'), '-f', str(FEATURE_COMPOSE))


def service_roles(request=None):
    return ('decoder', 'worker', 'api') if request and 'media' in selected_features(request.get('features', [])) else ('api', 'worker')


def prepare_containers(bootstrap, request=None):
    # Never recreate a live/foreign service. Drain/stop precedes this call; no
    # down, prune, remove-orphans, volume deletion or Caddy project operation.
    require(protected(CADDY) == bootstrap)
    for role in service_roles(request):
        state = run(['/usr/bin/systemctl', 'show', 'rogichat-app@' + role,
                     '--property=ActiveState', '--value']).strip()
        require(state in (b'inactive', b'failed'))
        item = inspect_starting_container(role, 10)
        if item is not None:
            labels = item['Config'].get('Labels', {})
            require(item['Name'] == '/rogichat-qa-' + role
                    and labels.get('com.docker.compose.project') == 'rogichat-qa-app'
                    and labels.get('com.docker.compose.service') == role
                    and not item['State']['Running'] and not item['State'].get('Restarting')
                    and not item['State'].get('Paused') and item['State']['Status'] in ('created', 'exited'))
    docker('compose', *compose_args(), 'create', '--force-recreate', '--no-build', '--pull', 'never',
           *service_roles(request), timeout=90)


def start_units(bootstrap, request=None):
    run(['/usr/bin/systemctl', 'daemon-reload'])
    # Synchronously create desired stopped containers before asynchronous unit
    # start, so health never observes a previous release's exited/image state.
    prepare_containers(bootstrap, request)
    for role in service_roles(request):
        run(['/usr/bin/systemctl', 'reset-failed', 'rogichat-app@' + role])
        run(['/usr/bin/systemctl', 'enable', '--now', 'rogichat-app@' + role], timeout=90)


def fail_closed(container, bootstrap, request=None):
    failed = False
    try:
        caddy_config(container, bootstrap)
    except Exception:
        failed = True
    # A Caddy reload error must not skip shutting down a newly exposed API.
    if (APP / 'compose.app.yaml').exists():
        for role in service_roles(request):
            try:
                run(['/usr/bin/systemctl', 'stop', 'rogichat-app@' + role], timeout=40)
            except Exception:
                failed = True
    require(not failed)


def cleanup_migration(name, secret_path):
    """Unlink the temporary credential even when Docker cleanup is unverified."""
    try:
        require(re.fullmatch(r'rogichat-qa-migration-[a-f0-9-]{36}', name))
        try:
            result = subprocess.run(['/usr/bin/docker', 'rm', '-f', name], stdout=subprocess.DEVNULL,
                                    stderr=subprocess.PIPE, timeout=30,
                                    env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'HOME': '/root'})
        except (OSError, subprocess.TimeoutExpired):
            raise Rejected('Migration container cleanup unverified') from None
        # --rm normally already removed a successful migration container.
        missing = ('Error response from daemon: No such container: ' + name).encode()
        require(result.returncode == 0 or (result.returncode == 1 and result.stderr.strip() == missing))
    finally:
        if secret_path is not None:
            secret_path.unlink(missing_ok=True)


def deploy(request, files, container):
    backup = RELEASES / ('backup-' + request['request_id'])
    backup.mkdir(mode=0o700)
    previous_media = FEATURE_COMPOSE.exists() and b'\n  decoder:' in protected(FEATURE_COMPOSE)
    targets = {'compose': APP / 'compose.app.yaml', 'feature_compose': FEATURE_COMPOSE,
               'images': IMAGES, 'unit': UNIT, 'caddy': CADDY}
    for name, path in targets.items():
        if path.exists():
            atomic(backup / name, protected(path), 0o600)
    # Request consumption survives a partial failure; retry needs fresh approval.
    atomic(backup / 'consumed.json', json.dumps(request).encode(), 0o600)
    name = 'rogichat-qa-migration-' + request['request_id']
    require(not docker('ps', '-a', '--filter', 'name=^/' + name + '$', '--format', '{{.ID}}').strip())
    secret_path = None
    cleanup_completed = False
    try:
        caddy_config(container, files['bootstrap'])
        for role in ('api', 'worker', 'decoder'):
            if (APP / 'compose.app.yaml').exists():
                run(['/usr/bin/systemctl', 'stop', 'rogichat-app@' + role], timeout=40)
        if previous_media and 'media' not in selected_features(request.get('features', [])):
            run(['/usr/bin/systemctl', 'disable', 'rogichat-app@decoder'], timeout=40)
        # Input is an operator-owned secret transport, never a repository field.
        secret = sys.stdin.buffer.read(16385)
        require(0 < len(secret) <= 16384)
        json.loads(secret)
        fd, path = tempfile.mkstemp(prefix='migration-', dir='/run/rogichat/secrets')
        secret_path = Path(path)
        with os.fdopen(fd, 'wb') as output:
            os.fchmod(output.fileno(), 0o440)
            os.fchown(output.fileno(), 0, 10001)
            output.write(secret)
        del secret
        approval_path = backup / 'migration-approval.json'
        atomic(approval_path, json.dumps({'database_host_sha256': request['database_host_sha256'],
                                         'migrations': request['migrations']}).encode())
        mounts = [(secret_path, '/run/release/migrator.json'), (approval_path, '/run/release/approval.json'),
                  (RELEASES / request['source_sha'] / ARTIFACTS['migration_entry'], '/run/release/migrate_entry.mjs'),
                  (RUNTIME_SECRET, '/run/secrets/database.json'), (CA, '/run/secrets/rds-ca.pem')]
        args = ['run', '--rm', '--name', name, '--user', '10001:10001', '--read-only', '--init',
                '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--memory', '512m',
                '--pids-limit', '128', '--network', request['edge_network'], '--log-driver', 'none',
                '--tmpfs', '/tmp:rw,noexec,nosuid,nodev,size=16777216,mode=1777']
        for source, target in mounts:
            args.extend(['--mount', f'type=bind,src={source},dst={target},readonly'])
        docker(*args, execution_image(request, 'migration'), '/run/release/migrate_entry.mjs', timeout=360)
        # Cleanup is a gate BEFORE app activation and the completion marker.
        # Its own finally owns unlinking, even if Docker removal raises.
        cleanup_migration(name, secret_path)
        cleanup_completed = True
        secret_path = None
        print('QA migration manifest, TLS and scoped grants verified.', flush=True)
        atomic(APP / 'compose.app.yaml', files['compose'])
        atomic(FEATURE_COMPOSE, files.get('feature_media', EMPTY_FEATURES))
        image_env = (f"ROGICHAT_API_IMAGE={execution_image(request, 'runtime')}\n"
                     f"ROGICHAT_WORKER_IMAGE={execution_image(request, 'runtime')}\n"
                     f"ROGICHAT_EDGE_NETWORK={request['edge_network']}\n")
        if 'media' in selected_features(request.get('features', [])):
            image_env += f"ROGICHAT_DECODER_IMAGE={execution_image(request, 'decoder')}\n"
        atomic(IMAGES, image_env.encode(), 0o600)
        atomic(UNIT, files['unit'])
        start_units(files['bootstrap'], request)
        print('QA app units requested; waiting for bounded container startup and health.', flush=True)
        wait_health(request)
        if compose_requires_vapid(files['compose']):
            verify_live_vapid('qa')
        require(get_caddy(request['edge_network']) == container)
        caddy_config(container, files['caddy'])
        for route in ('/live', '/ready', '/_infra/health'):
            with urllib.request.urlopen('https://api.qa.rogi.chat' + route, timeout=10) as response:
                require(response.status == 200 and response.geturl() == 'https://api.qa.rogi.chat' + route)
        atomic(backup / 'completed', b'QA runtime health and public route verified.\n', 0o600)
    except BaseException:
        # A changed schema may be incompatible with the previous image. Do not
        # restart M01 or run down migrations. Preserve old artifacts for review.
        fail_closed(container, files['bootstrap'], request)
        raise
    finally:
        # Exact generated container only. Killing it prevents a timeout orphan
        # from retaining migration credentials after the host wrapper exits.
        if not cleanup_completed:
            cleanup_migration(name, secret_path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    require(os.geteuid() == 0)
    protected(Path(__file__).absolute())
    request = validate_request(json.loads(protected(REQUEST, mode=0o600)))
    release = RELEASES / request['source_sha']
    files = {key: protected(release / relative) for key, relative in artifacts_for(request).items()}
    require(all(digest(files[key]) == expected for key, expected in request['artifacts'].items()))
    require(digest(protected(CADDY)) == request['previous_caddy_sha256'])
    protected(RUNTIME_SECRET, mode=0o440)
    protected(CA)
    verify_ci(request)
    # Pull registry digests or load validated archives separately; no credentials.
    verify_release_images(request)
    verify_media_secret(request)
    verify_auth_secret(files['compose'], execution_image(request, 'runtime'))
    verify_vapid_secret(files['compose'], execution_image(request, 'runtime'))
    container = get_caddy(request['edge_network'])
    require(not (RELEASES / ('backup-' + request['request_id'])).exists())
    if not args.apply:
        print('QA release preflight verified; no app, DB or configuration changes made.')
        return
    fd = os.open(LOCK, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as lock:
        metadata = os.fstat(lock.fileno())
        require(metadata.st_uid == 0 and stat.S_ISREG(metadata.st_mode)
                and stat.S_IMODE(metadata.st_mode) == 0o600)
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        require(time.time() < request['expires_at'])
        require(digest(protected(CADDY)) == request['previous_caddy_sha256'])
        verify_auth_secret(files['compose'], execution_image(request, 'runtime'))
        verify_vapid_secret(files['compose'], execution_image(request, 'runtime'))
        verify_media_secret(request)
        def interrupt(*_):
            raise Rejected('interrupted')
        for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
            signal.signal(sig, interrupt)
        deploy(request, files, container)
    print('QA API and worker release verified; migration and public route gates passed.')


if __name__ == '__main__':
    try:
        main()
    except (Exception, KeyboardInterrupt):
        print('QA release rejected or failed; inspect private operational state before retry.', file=sys.stderr)
        sys.exit(1)
