#!/usr/bin/env python3
"""Fixed-path operator web release; default read-only preflight, no edge setup."""
from __future__ import annotations

import argparse
import base64
import errno
import fcntl
import hashlib
from html.parser import HTMLParser
import importlib.util
import json
import os
from pathlib import Path
import re
import signal
import socket
import ssl
import stat
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import uuid

HOST = Path('/etc/rogichat/web-host.json')
REQUEST = Path('/etc/rogichat/web-release.json')
QA = Path('/etc/rogichat/web-completed-qa.json')
MACHINE = Path('/etc/machine-id')
RELEASES = Path('/opt/rogichat/releases')
ROOT = Path('/opt/rogichat/web')
CURRENT = ROOT / 'current/compose.json'
SITE = ROOT / 'sites/web.caddy'
CADDY = Path('/opt/rogichat/bootstrap/Caddyfile')
BOOTSTRAP = Path('/opt/rogichat/bootstrap/compose.yaml')
LOCK = Path('/run/lock/rogichat-deploy.lock')
RECEIPTS = ROOT / 'receipts'
SOURCE = 'https://github.com/h66rogi/rogichat'
CHECKS = {'web.yml', 'security.yml', 'infrastructure.yml'}
WORKFLOWS = CHECKS | {'backend.yml', 'mobile.yml', 'web-publish.yml'}
SHA = re.compile(r'[a-f0-9]{40}\Z')
HASH = re.compile(r'[a-f0-9]{64}\Z')
IMAGE = re.compile(r'ghcr\.io/h66rogi/rogichat-web@sha256:[a-f0-9]{64}\Z')


class Rejected(ValueError):
    pass


def require(ok, message='web release rejected'):
    if not ok:
        raise Rejected(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def matches(pattern, value):
    return type(value) is str and pattern.fullmatch(value) is not None


def decode(data):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, 'duplicate JSON key')
            result[key] = value
        return result
    return json.loads(data, object_pairs_hook=unique)


def protected(path, mode=None, directory=False, read=True):
    require(path.is_absolute())
    for p in [path, *path.parents]:
        s = p.lstat()
        require(not stat.S_ISLNK(s.st_mode) and s.st_uid == 0 and not s.st_mode & 0o022)
    s = path.lstat()
    require(stat.S_ISDIR(s.st_mode) if directory else stat.S_ISREG(s.st_mode))
    if mode is not None:
        require(stat.S_IMODE(s.st_mode) == mode)
    if not directory:
        require(s.st_nlink == 1 and s.st_size <= (2_000_000 if read else 8 * 1024**3))
        return path.read_bytes() if read else None


def room_id(value):
    require(type(value) is str and (value == '' or str(uuid.UUID(value)) == value))


def validate_host(value, environment, machine, default_room_id):
    require(type(value) is dict and set(value) == {'environment', 'machine_id_sha256', 'default_room_id'})
    room_id(value['default_room_id'])
    require(value['default_room_id'] == default_room_id)
    require(value['environment'] == environment and environment in ('qa', 'production'))
    require(matches(HASH, value['machine_id_sha256']) and value['machine_id_sha256'] == digest(machine.strip()))


def validate_request(value, now=None):
    now = time.time() if now is None else now
    fields = {'environment', 'source_sha', 'image', 'artifacts', 'caddy_sha256',
              'bootstrap_sha256', 'request_id', 'expires_at', 'verification_runs', 'default_room_id'}
    require(type(value) is dict and value.get('environment') in ('qa', 'production'))
    expected = fields | ({'completed_qa_sha256', 'promotion_sha', 'promotion_runs'} if value['environment'] == 'production' else set())
    require(set(value) in (expected, expected | {'archive'}))
    if 'archive' in value:
        validate_archive_request(value['archive'])
    room_id(value['default_room_id'])
    require(matches(SHA, value['source_sha']) and matches(IMAGE, value['image']))
    require(type(value['artifacts']) is dict and set(value['artifacts']) == {'compose', 'environment', 'edge', 'site'})
    require(all(matches(HASH, h) for h in value['artifacts'].values()))
    require(all(matches(HASH, value[k]) for k in ('caddy_sha256', 'bootstrap_sha256')))
    if value['environment'] == 'production':
        require(matches(HASH, value['completed_qa_sha256']) and matches(SHA, value['promotion_sha']))
        require(type(value['promotion_runs']) is dict and set(value['promotion_runs']) == CHECKS)
        require(all(type(v) is int and v > 0 for v in value['promotion_runs'].values()))
    require(type(value['verification_runs']) is dict and set(value['verification_runs']) == WORKFLOWS)
    require(all(type(v) is int and v > 0 for v in value['verification_runs'].values()))
    require(type(value['request_id']) is str and str(uuid.UUID(value['request_id'])) == value['request_id'])
    require(type(value['expires_at']) is int and now < value['expires_at'] <= now + 3600)
    return value


def validate_archive_request(value):
    require(type(value) is dict and set(value) == {'artifact_id', 'artifact_sha256', 'export_sha', 'export_run',
            'export_attempt', 'descriptor_sha256', 'config_id', 'execution_identity', 'execution_id',
            'validator_sha256', 'web_validator_sha256'})
    require(matches(SHA, value['export_sha']))
    require(all(type(value[k]) is int and value[k] > 0 for k in ('artifact_id', 'export_run', 'export_attempt')))
    require(all(matches(HASH, value[k]) for k in ('descriptor_sha256', 'validator_sha256', 'web_validator_sha256')))
    require(all(type(value[k]) is str and re.fullmatch(r'sha256:[a-f0-9]{64}', value[k])
                for k in ('artifact_sha256', 'config_id', 'execution_id')))
    require(value['execution_identity'] in ('config', 'archive-manifest'))
    if value['execution_identity'] == 'config':
        require(value['execution_id'] == value['config_id'])


def execution(request):
    return request['archive']['execution_id'] if 'archive' in request else request['image']


def validate_qa(value, request):
    require(type(value) is dict and set(value) == {'environment', 'source_sha', 'image', 'status', 'request_id', 'completed_at', 'verification_runs', 'default_room_id'})
    room_id(value['default_room_id'])
    require(value['environment'] == 'qa' and value['status'] == 'completed')
    require(value['source_sha'] == request['source_sha'] and value['image'] == request['image'])
    require(value['verification_runs'] == request['verification_runs'])
    require(type(value['completed_at']) is int and 0 < value['completed_at'] <= time.time())
    require(type(value['request_id']) is str and str(uuid.UUID(value['request_id'])) == value['request_id'])


def run(argv, *, env=None, timeout=60):
    result = subprocess.run(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout,
                            env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'HOME': '/root', **(env or {})})
    require(result.returncode == 0, 'command failed (output suppressed)')
    return result.stdout


def docker(*args, **kwargs):
    return run(['/usr/bin/docker', *args], **kwargs)


def github(path):
    url = 'https://api.github.com/repos/h66rogi/rogichat/' + path
    with urllib.request.urlopen(urllib.request.Request(url, headers={'Accept': 'application/vnd.github+json'}), timeout=15) as response:
        return json.load(response)


def verify_runs(runs, sha, branch):
    for workflow, run_id in runs.items():
        value = github(f'actions/runs/{run_id}')
        require(value['head_sha'] == sha and value['head_branch'] == branch
                and value['event'] == 'push' and value['status'] == 'completed' and value['conclusion'] == 'success'
                and value['repository']['full_name'] == 'h66rogi/rogichat'
                and value['head_repository']['full_name'] == 'h66rogi/rogichat'
                and value['path'] == '.github/workflows/' + workflow)


def verify_promotion(request):
    if request['environment'] == 'production':
        promotion = request['promotion_sha']
        require(github('git/ref/heads/main')['object']['sha'] == promotion, 'main promotion changed')
        comparison = github(f"compare/{request['source_sha']}...{promotion}")
        require(comparison['status'] in ('ahead', 'identical')
                and comparison['merge_base_commit']['sha'] == request['source_sha'], 'QA source must be main ancestor')


def verify_ci(request):
    verify_runs(request['verification_runs'], request['source_sha'], 'qa')
    if request['environment'] == 'production':
        verify_promotion(request)
        verify_runs(request['promotion_runs'], request['promotion_sha'], 'main')


def verify_image(data, request, *, archive_verified=False):
    cfg = data['Config']
    require((archive_verified or request['image'] in data['RepoDigests']) and data['Os'] == 'linux' and data['Architecture'] == 'amd64')
    require(cfg['User'] == '10001:10001' and cfg['Entrypoint'] == ['node'] and cfg['Cmd'] == ['server.js'])
    require(cfg['Labels'].get('org.opencontainers.image.source') == SOURCE
            and cfg['Labels'].get('org.opencontainers.image.revision') == request['source_sha'])
    env = dict(item.split('=', 1) for item in cfg.get('Env', []))
    require(not any('PREVIEW' in k.upper() or 'DEMO' in k.upper()
                    or re.search(r'(?i)(secret|password|token|credential|database_url|aws_access|aws_session)', k) for k in env))
    require(env.get('NODE_ENV') == 'production')


def verify_archive_identity(data, config, approval, request):
    require(data['Id'] == approval['execution_id'] and data['RootFS']['Layers'] == config['rootfs']['diff_ids'])
    if approval['execution_identity'] == 'config':
        require(data['Id'] == approval['config_id'])
    else:
        require(config['_archive_manifest'] is not None
                and data.get('Descriptor') == config['_archive_manifest']
                and data['Id'] == config['_archive_manifest']['digest'])
    verify_image(data, request, archive_verified=True)


def load_archive_validator(approval):
    core_path = Path(__file__).absolute().parent / 'backend_archive.py'
    module_path = core_path.parent.parent / 'web/archive.py'
    require(digest(protected(core_path)) == approval['validator_sha256'])
    require(digest(protected(module_path)) == approval['web_validator_sha256'])
    spec = importlib.util.spec_from_file_location('reviewed_web_archive_validator', module_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def verify_archive(request, image):
    approval = request['archive']
    module = load_archive_validator(approval)
    archive = RELEASES / request['source_sha'] / 'web-export/export.zip'
    protected(archive, read=False)
    # Reuse the publisher's bounded ZIP/tar verifier and exact export provenance
    # policy. Only fixed members are extracted into a private temporary directory.
    with tempfile.TemporaryDirectory(prefix='rogichat-web-verify-', dir='/var/tmp') as temporary:
        directory = Path(temporary) / 'verified'
        descriptor, configs = module.validate_zip(archive, approval['artifact_sha256'], directory)
        require(digest((directory / 'descriptor.json').read_bytes()) == approval['descriptor_sha256'])
        module.verify_provenance(descriptor, approval, publication_proof=module.read_proof(directory))
        require(descriptor['source_sha'] == request['source_sha']
                and descriptor['verification_runs'] == request['verification_runs'])
        item = descriptor['images']['runtime']
        require(item['image'] == request['image'] and item['config_id'] == approval['config_id'])
        verify_archive_identity(image, configs['runtime'], approval, request)


def names(request):
    short = 'qa' if request['environment'] == 'qa' else 'prod'
    return short, f'rogichat-{short}-web', 'https://qa.rogi.chat' if short == 'qa' else 'https://rogi.chat'


CHANNEL_SOURCE = 'apps/web/src/features/channel/content/feature-page.tsx'


def candidate_channel(request):
    """Check the candidate's source-bound channel against the running API before activation."""
    item = github(f"contents/{CHANNEL_SOURCE}?ref={request['source_sha']}")
    require(type(item) is dict and item.get('path') == CHANNEL_SOURCE and item.get('encoding') == 'base64')
    source = base64.b64decode(item['content'], validate=False)
    require(len(source) <= 100_000)
    blob = hashlib.sha1(b'blob ' + str(len(source)).encode() + b'\0' + source).hexdigest()
    require(item.get('sha') == blob, 'channel source blob changed')
    identifiers = re.findall(rb"^export const CHANNEL_IDENTIFIER = '([a-z0-9_-]{1,64})';$", source, re.MULTILINE)
    require(len(identifiers) == 1, 'candidate channel identifier unavailable')
    identifier = identifiers[0].decode('ascii')
    origin = 'https://api.qa.rogi.chat' if request['environment'] == 'qa' else 'https://api.rogi.chat'
    opener = urllib.request.build_opener(NoRedirect)
    try:
        with opener.open(origin + '/v1/channel/' + identifier, timeout=15) as response:
            require(response.status == 200, 'candidate channel API unavailable')
            name_data = response.read(262_145)
            require(len(name_data) <= 262_144, 'candidate channel API response too large')
    except urllib.error.HTTPError as error:
        error.close()
        raise Rejected('candidate channel API unavailable') from None
    channel = decode(name_data)
    require(type(channel) is dict and type(channel.get('name')) is str
            and 0 < len(channel['name']) <= 128, 'candidate channel API response invalid')
    return channel['name']


class VisibleHeadings(HTMLParser):
    def __init__(self):
        super().__init__()
        self.hidden = 0
        self.heading = 0
        self.headings = []

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style', 'template', 'noscript'):
            self.hidden += 1
        elif tag == 'h1' and not self.hidden:
            self.heading += 1
            self.headings.append('')

    def handle_endtag(self, tag):
        if tag in ('script', 'style', 'template', 'noscript'):
            self.hidden = max(0, self.hidden - 1)
        elif tag == 'h1' and not self.hidden:
            self.heading = max(0, self.heading - 1)

    def handle_data(self, data):
        if self.heading and not self.hidden:
            self.headings[-1] += data


def candidate_page(request, channel_name):
    """Require the activated candidate to render its real channel page."""
    _, _, origin = names(request)
    opener = urllib.request.build_opener(NoRedirect)
    try:
        with opener.open(origin + '/', timeout=20) as response:
            require(response.status == 200 and response.headers.get_content_type() == 'text/html',
                    'candidate channel page unavailable')
            page = response.read(1_000_001)
            require(len(page) <= 1_000_000, 'candidate channel page too large')
    except urllib.error.HTTPError as error:
        error.close()
        raise Rejected('candidate channel page unavailable') from None
    headings = VisibleHeadings()
    headings.feed(page.decode('utf-8', 'replace'))
    require(channel_name in (heading.strip() for heading in headings.headings),
            'candidate channel page did not render')


QA_MEDIA_STORAGE_ORIGINS = '["https://36875e4c357ab3a6fcfabe48f617dfb7.r2.cloudflarestorage.com"]'
PREVIOUS_QA_IMAGE_WITHOUT_MEDIA_ORIGIN = 'ghcr.io/h66rogi/rogichat-web@sha256:d568a8069d37875d301d3c036bbef7727ebf0948924a77f3df52fb23c0221b46'


def validate_compose(config, request, *, previous_qa_without_media_origin=False):
    _, name, _ = names(request)
    require(set(config.get('services', {})) == {'web'} and config.get('name') == name)
    service = config['services']['web']
    require(service['image'] == execution(request) and service['container_name'] == name)
    require(service.get('user') == '10001:10001' and service.get('read_only') is True)
    require(not any(service.get(k) for k in ('ports', 'volumes', 'build', 'env_file', 'privileged', 'devices', 'secrets', 'configs', 'entrypoint', 'command', 'network_mode', 'pid', 'ipc')))
    require(set(service.get('networks', {})) == {'web'} and set(config.get('networks', {})) == {'web'})
    require(config['networks']['web']['name'] == name)
    expected = {'NODE_ENV': 'production', 'NEXT_TELEMETRY_DISABLED': '1', 'HOSTNAME': '0.0.0.0', 'PORT': '3000',
                'ROGICHAT_WEB_ENV': request['environment'], 'ROGICHAT_DEFAULT_ROOM_ID': request['default_room_id'],
                'ROGICHAT_API_ORIGIN': 'https://api.qa.rogi.chat' if request['environment'] == 'qa' else 'https://api.rogi.chat'}
    if request['environment'] == 'qa' and not previous_qa_without_media_origin:
        expected['ROGICHAT_MEDIA_STORAGE_ORIGINS'] = QA_MEDIA_STORAGE_ORIGINS
    require(not previous_qa_without_media_origin or request['environment'] == 'qa')
    require(service.get('environment') == expected)
    require(service.get('cap_drop') == ['ALL'] and 'no-new-privileges:true' in service.get('security_opt', []))
    network = config['networks']['web']
    # Compose 2.40.3 emits an empty IPAM object for this external network.
    require(network.get('external') is True and network in (
        {'name': name, 'external': True},
        {'name': name, 'external': True, 'ipam': {}},
    ))
    return config


def snapshot_edge(request):
    require(digest(protected(CADDY)) == request['caddy_sha256'], 'main Caddy changed')
    require(digest(protected(BOOTSTRAP)) == request['bootstrap_sha256'], 'bootstrap changed')
    require(b'import /etc/caddy/sites/*.caddy' in protected(CADDY), 'initial edge preparation required')
    _, network, _ = names(request)
    ids = docker('ps', '-q', '--filter', 'label=com.docker.compose.service=caddy').decode().split()
    require(len(ids) == 1, 'exactly one existing Caddy required')
    caddy = decode(docker('inspect', ids[0]))[0]
    require(caddy['State']['Running'])
    destinations = [m['Destination'] for m in caddy['Mounts']]
    require(len(destinations) == len(set(destinations)), 'duplicate Caddy mount destination')
    # Docker inspect may reorder mounts between reads; retain every mount value.
    caddy['Mounts'] = sorted(caddy['Mounts'], key=lambda m: m['Destination'])
    nets = set(caddy['NetworkSettings']['Networks'])
    require(network in nets and len(nets) == 2, 'prepared Caddy requires web and existing API network')
    require(any(m['Type'] == 'bind' and m['Source'] == str(SITE.parent) and m['Destination'] == '/etc/caddy/sites' and not m['RW'] for m in caddy['Mounts']))
    require(any(m['Type'] == 'bind' and m['Source'] == str(CADDY) and m['Destination'] == '/etc/caddy/Caddyfile' and not m['RW'] for m in caddy['Mounts']))
    require({'/data', '/config'} <= {m['Destination'] for m in caddy['Mounts']})
    members = decode(docker('network', 'inspect', network))[0]
    require(members['Driver'] == 'bridge' and not members['Internal'])
    allowed = {caddy['Name'].lstrip('/'), network}
    if request['environment'] == 'qa':
        allowed.update(('rogichat-qa-media-gateway', 'rogichat-qa-overlay'))
    containers = members.get('Containers') or {}
    require(all(value['Name'] in allowed for value in containers.values()))
    # The web container is recreated during activation; every other peer must
    # retain its Docker identity throughout the release.
    stable_peers = tuple(sorted((value['Name'], container_id) for container_id, value in containers.items()
                                if value['Name'] != network))
    require(len({name for name, _ in stable_peers}) == len(stable_peers))
    return {k: caddy[k] for k in ('Id', 'Image', 'Mounts', 'HostConfig')}, nets, stable_peers


def preflight():
    request = validate_request(decode(protected(REQUEST, 0o600)))
    validate_host(decode(protected(HOST, 0o600)), request['environment'], protected(MACHINE), request['default_room_id'])
    if request['environment'] == 'production':
        qa = protected(QA, 0o600)
        require(digest(qa) == request['completed_qa_sha256'])
        validate_qa(decode(qa), request)
    for directory in (ROOT, CURRENT.parent, SITE.parent, RECEIPTS):
        protected(directory, directory=True)
    require(not (RECEIPTS / request['request_id']).exists(), 'request already attempted')
    short, _, _ = names(request)
    source = RELEASES / request.get('promotion_sha', request['source_sha']) / 'infrastructure/runtime/web'
    paths = {'compose': source / 'compose.yaml', 'environment': source / f'compose.{short}.yaml',
             'edge': source / f'edge.{short}.yaml', 'site': source / f'Caddyfile.{short}'}
    artifacts = {key: protected(path) for key, path in paths.items()}
    require(all(digest(value) == request['artifacts'][key] for key, value in artifacts.items()))
    config = decode(docker('compose', '--env-file', '/dev/null', '-f', str(paths['compose']), '-f', str(paths['environment']),
                           'config', '--format', 'json', env={'ROGICHAT_WEB_IMAGE': execution(request), 'ROGICHAT_DEFAULT_ROOM_ID': request['default_room_id']}))
    config = validate_compose(config, request)
    image = decode(docker('image', 'inspect', execution(request)))[0]
    if 'archive' in request:
        verify_archive(request, image)
    else:
        verify_image(image, request)
    config['x-rogichat-release'] = {'image': request['image'], 'execution_image': execution(request)}
    verify_ci(request)
    channel_name = candidate_channel(request)
    edge = snapshot_edge(request)
    _, name, _ = names(request)
    existing = docker('ps', '-aq', '--filter', f'name=^/{name}$').decode().split()
    require(not existing or CURRENT.exists(), 'unmanaged existing web container')
    if existing:
        require(len(existing) == 1)
        labels = decode(docker('inspect', existing[0]))[0]['Config']['Labels']
        require(labels.get('com.docker.compose.project') == name and labels.get('com.docker.compose.service') == 'web')
    return request, paths, artifacts, config, image['Id'], edge, channel_name


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def atomic(path, data):
    protected(path.parent, directory=True)
    if path.exists() or path.is_symlink():
        protected(path)
    fd, temporary = tempfile.mkstemp(prefix='.web-release-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.chmod(temporary, 0o600 if path != SITE else 0o644)
        os.replace(temporary, path)
        sync_directory(path.parent)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def compose(*args):
    return docker('compose', '--env-file', '/dev/null', '-f', str(CURRENT), *args, timeout=180)


def reload_caddy(caddy_id):
    docker('exec', caddy_id, 'caddy', 'validate', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile')
    docker('exec', caddy_id, 'caddy', 'reload', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile')


def healthy(request, image_id, *, previous_qa_without_media_origin=False):
    _, name, _ = names(request)
    deadline = time.monotonic() + 120
    while time.monotonic() < deadline:
        value = decode(docker('inspect', name))[0]
        require(value['Image'] == image_id and value['Config']['Image'] == execution(request))
        require(value['Config']['User'] == '10001:10001' and set(value['NetworkSettings']['Networks']) == {name})
        require(not any(value['NetworkSettings'].get('Ports', {}).values()))
        env = dict(v.split('=', 1) for v in value['Config']['Env'])
        require(env.get('ROGICHAT_DEFAULT_ROOM_ID') == request['default_room_id'])
        require(env.get('ROGICHAT_WEB_ENV') == request['environment'])
        require(env.get('ROGICHAT_API_ORIGIN') == ('https://api.qa.rogi.chat' if request['environment'] == 'qa' else 'https://api.rogi.chat'))
        require(env.get('ROGICHAT_MEDIA_STORAGE_ORIGINS') == (QA_MEDIA_STORAGE_ORIGINS if request['environment'] == 'qa' and not previous_qa_without_media_origin else None))
        if value['State']['Running'] and value['State'].get('Health', {}).get('Status') == 'healthy':
            return
        time.sleep(2)
    raise Rejected('web health deadline exceeded')


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise Rejected('health redirect rejected')


def external(request):
    # Caddy obtains its first certificate asynchronously. Allow at most 90s,
    # with 15s socket timeouts and 2s backoff, all capped by the remaining time.
    # The Linux operator runs on the main thread: an alarm also bounds DNS and
    # multi-stage socket operations, which urlopen's timeout alone cannot bound.
    _, _, origin = names(request)
    previous_timer = signal.getitimer(signal.ITIMER_REAL)
    started = time.monotonic()
    deadline = started + 90
    caller_fired = False
    def expired(*args):
        raise Rejected('external web health deadline exceeded')

    def alarm(signum, frame):
        nonlocal caller_fired
        if caller_first:
            caller_fired = True
            if callable(previous_handler):
                previous_handler(signum, frame)
            elif previous_handler == signal.SIG_DFL:
                signal.signal(signal.SIGALRM, previous_handler)
                signal.raise_signal(signal.SIGALRM)
        expired()

    def transient(error):
        if isinstance(error, ssl.SSLCertVerificationError):
            return False
        if isinstance(error, ssl.SSLError):
            # Caddy can send internal_error while no certificate is available.
            # Protocol/cipher/hostname/trust failures are never retried.
            return isinstance(error, ssl.SSLEOFError) or getattr(error, 'reason', None) == 'TLSV1_ALERT_INTERNAL_ERROR'
        if isinstance(error, socket.gaierror):
            return error.errno == socket.EAI_AGAIN
        return isinstance(error, OSError) and error.errno in {
            errno.ECONNREFUSED, errno.ECONNRESET, errno.ECONNABORTED, errno.ETIMEDOUT,
        } or isinstance(error, TimeoutError)

    caller_first = 0 < previous_timer[0] <= 90
    previous_handler = signal.signal(signal.SIGALRM, alarm)
    try:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            expired()
        alarm_remaining = min(remaining, previous_timer[0] - (90 - remaining)) if caller_first else remaining
        if alarm_remaining <= 0:
            alarm(signal.SIGALRM, None)
        signal.setitimer(signal.ITIMER_REAL, alarm_remaining)
        opener = urllib.request.build_opener(NoRedirect)
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                expired()
            try:
                with opener.open(origin + '/healthz', timeout=min(15, remaining)) as response:
                    require(time.monotonic() < deadline, 'external web health deadline exceeded')
                    if response.status == 200:
                        return
                    require(response.status in {502, 503, 504}, 'unexpected external health status')
            except urllib.error.HTTPError as error:
                # Only temporary gateway/upstream unavailability is retryable.
                error.close()
                require(error.code in {502, 503, 504}, 'unexpected external health status')
            except urllib.error.URLError as error:
                if not transient(error.reason):
                    raise
            except OSError as error:
                if not transient(error):
                    raise
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                expired()
            time.sleep(min(2, remaining))
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous_handler)
        # Preserve the caller's absolute deadline, never restart its full budget.
        if previous_timer[0] > 0:
            remaining = previous_timer[0] - (time.monotonic() - started)
            if remaining <= 0 and not caller_fired:
                # Do not discard an outer timeout that became due during cleanup.
                remaining = 0.000001
            elif remaining <= 0 and previous_timer[1] > 0:
                remaining %= previous_timer[1]
                remaining = remaining or previous_timer[1]
            signal.setitimer(signal.ITIMER_REAL, max(0, remaining), previous_timer[1])


def apply(prepared):
    request, paths, artifacts, config, image_id, edge, channel_name = prepared
    previous = protected(CURRENT) if CURRENT.exists() else None
    previous_site = protected(SITE) if SITE.exists() else None
    require((previous is None) == (previous_site is None), 'inconsistent previous web release')
    if previous is not None:
        old_config = decode(previous)
        old_request = dict(request, image=old_config.get('x-rogichat-release', {}).get('image', old_config['services']['web']['image']),
                           default_room_id=old_config['services']['web']['environment']['ROGICHAT_DEFAULT_ROOM_ID'])
        old_request.pop('archive', None)
        old_execution = old_config['services']['web']['image']
        if old_execution != old_request['image']:
            require(type(old_execution) is str and re.fullmatch(r'sha256:[a-f0-9]{64}', old_execution))
            require(old_config['x-rogichat-release']['execution_image'] == old_execution)
            old_request['archive'] = {'execution_id': old_execution}
        require(matches(IMAGE, old_request['image']))
        previous_qa_without_media_origin = (old_request['environment'] == 'qa' and
            old_request['image'] == PREVIOUS_QA_IMAGE_WITHOUT_MEDIA_ORIGIN and
            'ROGICHAT_MEDIA_STORAGE_ORIGINS' not in old_config['services']['web']['environment'])
        validate_compose(old_config, old_request, previous_qa_without_media_origin=previous_qa_without_media_origin)
        old_image = decode(docker('image', 'inspect', execution(old_request)))[0]['Id']
        healthy(old_request, old_image, previous_qa_without_media_origin=previous_qa_without_media_origin)
        external(old_request)
    # Recheck all bindings after slow network checks and before any activation.
    require(validate_request(decode(protected(REQUEST, 0o600))) == request)
    validate_host(decode(protected(HOST, 0o600)), request['environment'], protected(MACHINE), request['default_room_id'])
    verify_promotion(request)
    if request['environment'] == 'production':
        require(digest(protected(QA, 0o600)) == request['completed_qa_sha256'])
    require(all(protected(paths[k]) == v for k, v in artifacts.items()), 'release artifacts changed')
    require(snapshot_edge(request) == edge, 'edge changed during request')
    receipt = RECEIPTS / request['request_id']
    fd = os.open(receipt, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as f:
        f.write('attempted\n')
        f.flush()
        os.fsync(f.fileno())
    sync_directory(receipt.parent)
    caddy_id = edge[0]['Id']
    try:
        atomic(CURRENT, json.dumps(config).encode())
        compose('up', '-d', '--no-deps', '--no-build', '--pull', 'never', 'web')
        healthy(request, image_id)
        require(snapshot_edge(request) == edge, 'edge changed during activation')
        atomic(SITE, artifacts['site'])
        reload_caddy(caddy_id)
        external(request)
        candidate_page(request, channel_name)
        require(all(protected(paths[k]) == v for k, v in artifacts.items()), 'release artifacts changed during activation')
        require(protected(SITE) == artifacts['site'], 'web site changed during activation')
        verify_promotion(request)
        require(snapshot_edge(request) == edge, 'edge changed during verification')
        evidence = {'environment': request['environment'], 'source_sha': request['source_sha'], 'image': request['image'],
                    'status': 'completed', 'request_id': request['request_id'], 'completed_at': int(time.time()),
                    'verification_runs': request['verification_runs'], 'default_room_id': request['default_room_id']}
        atomic(receipt, json.dumps(evidence, sort_keys=True).encode())
    except Exception:
        # Never overwrite the main Caddy/API config, even when another operator
        # changes it. The lock must also be held by every other deployment tool.
        try:
            if previous_site is None:
                SITE.unlink(missing_ok=True)
            else:
                atomic(SITE, previous_site)
            if previous is None:
                compose('rm', '-s', '-f', 'web')
                CURRENT.unlink(missing_ok=True)
            else:
                atomic(CURRENT, previous)
                compose('up', '-d', '--no-deps', '--no-build', '--pull', 'never', 'web')
                healthy(old_request, old_image, previous_qa_without_media_origin=previous_qa_without_media_origin)
            require(snapshot_edge(request) == edge, 'edge changed; restored web files but reload requires operator review')
            reload_caddy(caddy_id)
            if previous is not None:
                external(old_request)
        except Exception:
            raise Rejected('release failed; rollback incomplete, operator recovery required') from None
        raise Rejected('release failed; previous web state restored') from None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', help='explicit trusted operator activation')
    args = parser.parse_args()
    require(os.geteuid() == 0, 'root required')
    protected(Path(__file__).absolute())
    def interrupted(signum, frame):
        raise Rejected('operator interrupted release')
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    # Ubuntu /run/lock may be root-owned sticky 1777. Validate the inode
    # opened with O_NOFOLLOW, rather than rejecting the standard lock directory.
    protected(LOCK.parent.parent, directory=True)
    parent = LOCK.parent.lstat()
    require(stat.S_ISDIR(parent.st_mode) and parent.st_uid == 0
            and (not parent.st_mode & 0o022 or parent.st_mode & stat.S_ISVTX))
    fd = os.open(LOCK, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'r+') as lock:
        metadata = os.fstat(lock.fileno())
        require(stat.S_ISREG(metadata.st_mode) and metadata.st_uid == 0
                and stat.S_IMODE(metadata.st_mode) == 0o600 and metadata.st_nlink == 1)
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        prepared = preflight()
        if args.apply:
            apply(prepared)
        print('web activation verified' if args.apply else 'web preflight passed; no activation performed')


if __name__ == '__main__':
    try:
        main()
    except Rejected as error:
        print(str(error), file=__import__('sys').stderr)
        raise SystemExit(1)
    except Exception:
        # Remote command output and request contents never escape to logs.
        print('web release rejected or failed; inspect protected state with operator', file=__import__('sys').stderr)
        raise SystemExit(1)
