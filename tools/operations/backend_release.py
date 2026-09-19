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
CADDY = Path('/opt/rogichat/bootstrap/Caddyfile')
UNIT = Path('/etc/systemd/system/rogichat-app@.service')
LOCK = Path('/run/lock/rogichat-deploy.lock')
RUNTIME_SECRET = Path('/run/rogichat/secrets/database.json')
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
WORKFLOWS = {'backend.yml', 'security.yml', 'infrastructure.yml', 'backend-publish.yml'}


class Rejected(ValueError):
    pass


def require(condition):
    if not condition:
        raise Rejected('QA release rejected')


def digest(data):
    return hashlib.sha256(data).hexdigest()


def validate_request(value):
    fields = {'environment', 'source_sha', 'runtime_image', 'migration_image', 'edge_network',
              'database_host_sha256', 'artifacts', 'migrations', 'verification_runs',
              'previous_caddy_sha256', 'request_id', 'expires_at'}
    require(type(value) is dict and set(value) == fields and value['environment'] == 'qa')
    require(type(value['source_sha']) is str and SHA.fullmatch(value['source_sha']))
    for key, repo in [('runtime_image', 'rogichat-api'), ('migration_image', 'rogichat-api-migration')]:
        require(type(value[key]) is str and re.fullmatch(r'ghcr\.io/h66rogi/' + repo + r'@sha256:[a-f0-9]{64}', value[key]))
    require(type(value['edge_network']) is str and re.fullmatch(r'rogichat-qa_[a-z0-9_-]{1,40}', value['edge_network']))
    for key in ('database_host_sha256', 'previous_caddy_sha256'):
        require(type(value[key]) is str and HASH.fullmatch(value[key]))
    require(type(value['artifacts']) is dict and set(value['artifacts']) == set(ARTIFACTS))
    require(all(type(h) is str and HASH.fullmatch(h) for h in value['artifacts'].values()))
    require(type(value['migrations']) is list and 0 < len(value['migrations']) <= 100)
    names = []
    for migration in value['migrations']:
        require(type(migration) is dict and set(migration) == {'name', 'checksum'})
        require(type(migration['name']) is str and re.fullmatch(r'[0-9]{14}_[a-z0-9_]{1,80}', migration['name']))
        require(type(migration['checksum']) is str and HASH.fullmatch(migration['checksum']))
        names.append(migration['name'])
    require(names == sorted(set(names)))
    require(type(value['verification_runs']) is dict and set(value['verification_runs']) == WORKFLOWS)
    require(all(type(n) is int and n > 0 for n in value['verification_runs'].values()))
    require(type(value['request_id']) is str and str(uuid.UUID(value['request_id'])) == value['request_id'])
    require(type(value['expires_at']) is int and time.time() < value['expires_at'] <= time.time() + 3600)
    return value


def protected(path, *, mode=None):
    """Every existing parent is root-owned and not group/other writable; no links."""
    require(path.is_absolute())
    for item in [path, *path.parents]:
        metadata = item.lstat()
        require(not stat.S_ISLNK(metadata.st_mode) and metadata.st_uid == 0 and not metadata.st_mode & 0o022)
    require(path.is_file())
    if mode is not None:
        require(stat.S_IMODE(path.stat().st_mode) == mode)
    return path.read_bytes()


def run(argv, *, timeout=60, data=None):
    # Never include child output, argv or input in an exception/log.
    result = subprocess.run(argv, input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            timeout=timeout, env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'HOME': '/root'})
    require(result.returncode == 0)
    return result.stdout


def docker(*args, **kwargs):
    return run(['/usr/bin/docker', *args], **kwargs)


def verify_ci(request):
    for workflow, run_id in request['verification_runs'].items():
        url = f'https://api.github.com/repos/h66rogi/rogichat/actions/runs/{run_id}'
        with urllib.request.urlopen(urllib.request.Request(url, headers={'Accept': 'application/vnd.github+json'}), timeout=15) as response:
            result = json.load(response)
        require(result['head_sha'] == request['source_sha'] and result['head_branch'] == 'qa'
                and result['event'] == 'push' and result['status'] == 'completed'
                and result['conclusion'] == 'success' and result['repository']['full_name'] == 'h66rogi/rogichat'
                and result['head_repository']['full_name'] == 'h66rogi/rogichat'
                and result['path'] == '.github/workflows/' + workflow)


def verify_image(image, source_sha):
    data = json.loads(docker('image', 'inspect', image))[0]
    labels = data['Config']['Labels']
    require(image in data['RepoDigests'] and data['Architecture'] == 'amd64'
            and data['Os'] == 'linux' and data['Config']['User'] == '10001:10001'
            and data['Config']['Entrypoint'] == ['node']
            and labels.get('org.opencontainers.image.source') == SOURCE
            and labels.get('org.opencontainers.image.revision') == source_sha)


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


def wait_health(request):
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        healthy = True
        for role in ('api', 'worker'):
            item = json.loads(docker('inspect', 'rogichat-qa-' + role))[0]
            require(item['Config']['Image'] == request['runtime_image'])
            if role == 'api':
                validate_api_ingress(item, request['edge_network'])
            if not item['State']['Running'] or item['State'].get('Health', {}).get('Status') != 'healthy':
                healthy = False
        if healthy:
            return
        time.sleep(2)
    raise Rejected('health gate failed')


def fail_closed(container, bootstrap):
    failed = False
    try:
        caddy_config(container, bootstrap)
    except Exception:
        failed = True
    # A Caddy reload error must not skip shutting down a newly exposed API.
    if (APP / 'compose.app.yaml').exists():
        for role in ('api', 'worker'):
            try:
                run(['/usr/bin/systemctl', 'stop', 'rogichat-app@' + role], timeout=40)
            except Exception:
                failed = True
    require(not failed)


def deploy(request, files, container):
    backup = RELEASES / ('backup-' + request['request_id'])
    backup.mkdir(mode=0o700)
    targets = {'compose': APP / 'compose.app.yaml', 'images': IMAGES, 'unit': UNIT, 'caddy': CADDY}
    for name, path in targets.items():
        if path.exists():
            atomic(backup / name, protected(path), 0o600)
    # Request consumption survives a partial failure; retry needs fresh approval.
    atomic(backup / 'consumed.json', json.dumps(request).encode(), 0o600)
    name = 'rogichat-qa-migration-' + request['request_id']
    require(not docker('ps', '-a', '--filter', 'name=^/' + name + '$', '--format', '{{.ID}}').strip())
    secret_path = None
    try:
        caddy_config(container, files['bootstrap'])
        for role in ('api', 'worker'):
            if (APP / 'compose.app.yaml').exists():
                run(['/usr/bin/systemctl', 'stop', 'rogichat-app@' + role], timeout=40)
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
        docker(*args, request['migration_image'], '/run/release/migrate_entry.mjs', timeout=360)
        secret_path.unlink()
        secret_path = None
        atomic(APP / 'compose.app.yaml', files['compose'])
        atomic(IMAGES, (f"ROGICHAT_API_IMAGE={request['runtime_image']}\n"
                        f"ROGICHAT_WORKER_IMAGE={request['runtime_image']}\n"
                        f"ROGICHAT_EDGE_NETWORK={request['edge_network']}\n").encode(), 0o600)
        atomic(UNIT, files['unit'])
        run(['/usr/bin/systemctl', 'daemon-reload'])
        for role in ('api', 'worker'):
            run(['/usr/bin/systemctl', 'enable', '--now', 'rogichat-app@' + role], timeout=90)
        wait_health(request)
        require(get_caddy(request['edge_network']) == container)
        caddy_config(container, files['caddy'])
        for route in ('/live', '/ready', '/_infra/health'):
            with urllib.request.urlopen('https://api.qa.rogi.chat' + route, timeout=10) as response:
                require(response.status == 200 and response.geturl() == 'https://api.qa.rogi.chat' + route)
        atomic(backup / 'completed', b'QA runtime health and public route verified.\n', 0o600)
    except BaseException:
        # A changed schema may be incompatible with the previous image. Do not
        # restart M01 or run down migrations. Preserve old artifacts for review.
        fail_closed(container, files['bootstrap'])
        raise
    finally:
        # Exact generated container only. Killing it prevents a timeout orphan
        # from retaining migration credentials after the host wrapper exits.
        subprocess.run(['/usr/bin/docker', 'rm', '-f', name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30)
        if secret_path is not None and secret_path.exists():
            secret_path.unlink()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    require(os.geteuid() == 0)
    protected(Path(__file__).absolute())
    request = validate_request(json.loads(protected(REQUEST, mode=0o600)))
    release = RELEASES / request['source_sha']
    files = {key: protected(release / relative) for key, relative in ARTIFACTS.items()}
    require(all(digest(files[key]) == expected for key, expected in request['artifacts'].items()))
    require(digest(protected(CADDY)) == request['previous_caddy_sha256'])
    protected(RUNTIME_SECRET, mode=0o440)
    protected(CA)
    verify_ci(request)
    for key in ('runtime_image', 'migration_image'):
        # Pull explicitly approved digests separately before invoking this helper.
        verify_image(request[key], request['source_sha'])
    container = get_caddy(request['edge_network'])
    require(not (RELEASES / ('backup-' + request['request_id'])).exists())
    if not args.apply:
        print('QA release request, files, CI, images and host contract verified; no changes made.')
        return
    fd = os.open(LOCK, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as lock:
        metadata = os.fstat(lock.fileno())
        require(metadata.st_uid == 0 and stat.S_ISREG(metadata.st_mode)
                and stat.S_IMODE(metadata.st_mode) == 0o600)
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        require(time.time() < request['expires_at'])
        require(digest(protected(CADDY)) == request['previous_caddy_sha256'])
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
