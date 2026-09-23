#!/usr/bin/env python3
"""QA-only, schema-unchanged activation. Default verifies; --apply is host-only.

Install independently of candidates. No migration execution, secrets on stdin,
registry credentials, arbitrary paths, production activation or automatic rollback.
"""
from __future__ import annotations
import argparse
import base64
from contextlib import contextmanager
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import stat
import sys
import tempfile
import time
import types
import urllib.request
import uuid

ROOT = Path('/opt/rogichat/automatic')
POLICY = Path('/etc/rogichat/backend-automatic-policy.json')
REQUEST = Path('/etc/rogichat/backend-automatic-request.json')
STATE = Path('/var/lib/rogichat/backend-automatic')
LOCK = Path('/run/lock/rogichat-deploy.lock')
HASH = re.compile(r'[a-f0-9]{64}\Z')
SHA = re.compile(r'[a-f0-9]{40}\Z')
IMAGE = re.compile(r'sha256:[a-f0-9]{64}\Z')
TEMPLATES = {'compose': 'infrastructure/runtime/compose.app.yaml',
             'unit': 'infrastructure/runtime/rogichat-app@.service',
             'caddy': 'infrastructure/runtime/Caddyfile.app',
             'bootstrap': 'infrastructure/runtime/Caddyfile.bootstrap'}
WORKFLOWS = {'backend.yml', 'security.yml', 'infrastructure.yml', 'backend-publish.yml'}


def require(value):
    if not value:
        raise ValueError('automatic release rejected')


def digest(value):
    return hashlib.sha256(value).hexdigest()


def protected(path, mode=None):
    require(path.is_absolute())
    for part in [path, *path.parents]:
        meta = part.lstat()
        require(not stat.S_ISLNK(meta.st_mode) and meta.st_uid == 0 and not meta.st_mode & 0o022)
    meta = path.stat()
    require(stat.S_ISREG(meta.st_mode) and meta.st_nlink == 1)
    require(mode is None or stat.S_IMODE(meta.st_mode) == mode)
    return path.read_bytes()


def pinned_module(name, expected):
    path = ROOT / (name + '.py')
    raw = protected(path)
    require(digest(raw) == expected)
    module = types.ModuleType(name)
    module.__file__ = str(path)
    # Compile checked bytes, never unpinned pycache or candidate imports.
    exec(compile(raw, str(path), 'exec'), module.__dict__)
    return module


def validate_policy(p):
    fields = {'version', 'environment', 'release_helper_sha256', 'archive_helper_sha256',
              'probe_sha256', 'probe_image', 'probe_source_sha', 'schema_sha256', 'migrations',
              'database_host_sha256', 'ca_sha256', 'templates', 'edge_network'}
    require(type(p) is dict and set(p) == fields and type(p['version']) is int and p['version'] == 1
            and p['environment'] == 'qa')
    for key in fields:
        if key.endswith('_sha256'):
            require(type(p[key]) is str and HASH.fullmatch(p[key]))
    require(type(p['probe_image']) is str and IMAGE.fullmatch(p['probe_image']))
    require(type(p['probe_source_sha']) is str and SHA.fullmatch(p['probe_source_sha']))
    require(type(p['edge_network']) is str and re.fullmatch(r'rogichat-qa_[a-z0-9_-]{1,40}', p['edge_network']))
    require(type(p['templates']) is dict and set(p['templates']) == set(TEMPLATES)
            and all(type(v) is str and HASH.fullmatch(v) for v in p['templates'].values()))
    require(type(p['migrations']) is list and 0 < len(p['migrations']) <= 100)
    names = []
    for row in p['migrations']:
        require(type(row) is dict and set(row) == {'name', 'checksum'})
        require(type(row['name']) is str and re.fullmatch(r'[0-9]{14}_[a-z0-9_]{1,80}', row['name'])
                and type(row['checksum']) is str and HASH.fullmatch(row['checksum']))
        names.append(row['name'])
    require(names == sorted(set(names)))
    return p


def validate_request(r, p, now=None):
    now = time.time() if now is None else now
    require(type(r) is dict and set(r) == {'environment', 'source_sha', 'request_id', 'expires_at',
            'policy_sha256', 'previous_state_sha256', 'verification_runs', 'archive'} and r['environment'] == 'qa')
    require(type(r['source_sha']) is str and SHA.fullmatch(r['source_sha']))
    require(type(r['request_id']) is str and str(uuid.UUID(r['request_id'])) == r['request_id'])
    require(type(r['expires_at']) is int and now < r['expires_at'] <= now + 3600)
    for key in ('policy_sha256', 'previous_state_sha256'):
        require(type(r[key]) is str and HASH.fullmatch(r[key]))
    require(type(r['verification_runs']) is dict and set(r['verification_runs']) == WORKFLOWS
            and all(type(n) is int and n > 0 for n in r['verification_runs'].values()))
    a = r['archive']
    require(type(a) is dict and set(a) == {'export_sha', 'export_run', 'export_attempt', 'artifact_id',
        'artifact_sha256', 'runtime_config_id', 'execution_identity', 'runtime_execution_id'})
    require(type(a['export_sha']) is str and SHA.fullmatch(a['export_sha']))
    require(all(type(a[k]) is int and a[k] > 0 for k in ('export_run', 'export_attempt', 'artifact_id')))
    require(all(type(a[k]) is str and IMAGE.fullmatch(a[k]) for k in ('artifact_sha256', 'runtime_config_id', 'runtime_execution_id')))
    require(a['execution_identity'] in ('config', 'archive-manifest'))
    if a['execution_identity'] == 'config':
        require(a['runtime_execution_id'] == a['runtime_config_id'])
    require(r['policy_sha256'] == digest(json.dumps(p, sort_keys=True, separators=(',', ':')).encode()))
    return r


def fresh(r, archive):
    require(time.time() < r['expires_at'])
    require(archive.api('git/ref/heads/qa')['object']['sha'] == r['source_sha'])
    archive.verify_source(r['source_sha'], r['verification_runs'])


def verify_current(r, p, helper):
    raw = protected(STATE / 'current.json', 0o600)
    require(digest(raw) == r['previous_state_sha256'])
    current = json.loads(raw)
    require(set(current) == {'source_sha', 'runtime_image', 'schema_sha256', 'migrations', 'files'})
    require(type(current['source_sha']) is str and SHA.fullmatch(current['source_sha'])
            and type(current['runtime_image']) is str and IMAGE.fullmatch(current['runtime_image']))
    require(current['schema_sha256'] == p['schema_sha256'] and current['migrations'] == p['migrations'])
    targets = {'compose': helper.APP / 'compose.app.yaml', 'images': helper.IMAGES,
               'unit': helper.UNIT, 'caddy': helper.CADDY}
    require(set(current['files']) == set(targets))
    for key, path in targets.items():
        require(digest(protected(path)) == current['files'][key])
        if key != 'images':
            require(current['files'][key] == p['templates'][key])
    for role in ('api', 'worker'):
        item = json.loads(helper.docker('inspect', 'rogichat-qa-' + role))[0]
        require(item['Image'] == current['runtime_image'] and item['Config']['Image'] == current['runtime_image']
                and item['State']['Running'] and item['State'].get('Health', {}).get('Status') == 'healthy')
    # No pruning/removal: previous immutable image must still be present.
    require(json.loads(helper.docker('image', 'inspect', current['runtime_image']))[0]['Id'] == current['runtime_image'])
    return current, targets


def schema_probe(p, helper):
    script = ROOT / 'backend_schema_readonly.mjs'
    require(digest(protected(script)) == p['probe_sha256'])
    require(digest(protected(helper.CA)) == p['ca_sha256'])
    protected(helper.RUNTIME_SECRET, 0o440)
    item = json.loads(helper.docker('image', 'inspect', p['probe_image']))[0]
    require(item['Id'] == p['probe_image'] and item['Os'] == 'linux' and item['Architecture'] == 'amd64'
            and item['Config']['User'] == '10001:10001'
            and item['Config']['Labels']['org.opencontainers.image.revision'] == p['probe_source_sha']
            and item['Config']['Labels']['org.opencontainers.image.source'] == helper.SOURCE)
    name = 'rogichat-qa-schema-' + str(uuid.uuid4())
    # The root-only full policy cannot be read by uid 10001. Mount a public,
    # exact probe subset from private scratch; no secrets are copied.
    with tempfile.TemporaryDirectory(prefix='rogichat-probe-', dir='/var/tmp') as temporary:
        approval = Path(temporary) / 'policy.json'
        approval.write_text(json.dumps({key: p[key] for key in ('environment', 'database_host_sha256', 'schema_sha256', 'migrations')}))
        approval.chmod(0o444)
        mounts = [(script, '/run/probe/probe.mjs'), (approval, '/run/probe/policy.json'),
                  (helper.RUNTIME_SECRET, '/run/secrets/database.json'), (helper.CA, '/run/secrets/rds-ca.pem')]
        args = ['run', '--rm', '--pull', 'never', '--name', name, '--entrypoint', 'node', '--user', '10001:10001',
                '--network', p['edge_network'], '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
                '--memory', '192m', '--pids-limit', '64', '--log-driver', 'none']
        for source, target in mounts:
            args.extend(['--mount', f'type=bind,src={source},dst={target},readonly'])
        try:
            result = json.loads(helper.docker(*args, p['probe_image'], '/run/probe/probe.mjs', timeout=60))
            require(result == {'schema': 'exact', 'schema_sha256': p['schema_sha256'],
                               'runtime_grants': 'dml-only', 'migrations': p['migrations']})
        finally:
            # A Docker client timeout must not leave runtime credentials mounted.
            # Inspect first; --rm success means there is nothing left to remove.
            ids = helper.docker('ps', '-a', '--filter', 'name=^/' + name + '$', '--format', '{{.ID}}').decode().split()
            require(len(ids) <= 1)
            if ids:
                helper.docker('rm', '-f', name)


def parse_candidate_manifest(raw):
    """Recognize only the reviewed static TS declaration; never eval/import it."""
    require(len(raw) <= 65536)
    text = raw.decode('utf-8')
    text = '\n'.join(line for line in text.splitlines() if not line.lstrip().startswith('//'))
    match = re.fullmatch(r'\s*export\s+const\s+migrationManifest\s*:\s*readonly\s*'
                         r'\{\s*name\s*:\s*string\s*;\s*checksum\s*:\s*string\s*}\s*\[\]'
                         r'\s*=\s*\[(.*)]\s*;\s*', text, re.DOTALL)
    require(match is not None)
    remaining = match[1].strip()
    rows = []
    while remaining:
        row = re.match(r"\{([^{}]*)}\s*(,|$)", remaining)
        require(row is not None)
        fields = row[1].split(',')
        require(len(fields) == 2)
        value = {}
        for field in fields:
            item = re.fullmatch(r"\s*(name|checksum)\s*:\s*(['\"])([a-z0-9_]+)\2\s*", field)
            require(item is not None and item[1] not in value)
            value[item[1]] = item[3]
        require(set(value) == {'name', 'checksum'})
        rows.append(value)
        require(len(rows) <= 100)
        remaining = remaining[row.end():].strip()
    return rows


def verify_candidate_schema(r, p, archive):
    path = 'apps/api/src/infrastructure/database/schema-manifest.ts'
    blob = archive.api('contents/' + path + '?ref=' + r['source_sha'])
    require(blob['type'] == 'file' and blob['path'] == path and blob['encoding'] == 'base64'
            and type(blob['size']) is int and 0 < blob['size'] <= 65536
            and type(blob['sha']) is str and SHA.fullmatch(blob['sha']))
    require(type(blob['content']) is str and len(blob['content']) <= 100000)
    raw = base64.b64decode(''.join(blob['content'].split()), validate=True)
    require(len(raw) == blob['size']
            and hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest() == blob['sha'])
    require(parse_candidate_manifest(raw) == p['migrations'])


def verify_candidate(r, p, helper, archive, output):
    path = helper.RELEASES / r['source_sha'] / 'export.zip'
    helper.protected(path, read=False)
    descriptor, configs = archive.validate_zip(path, r['archive']['artifact_sha256'], output)
    archive.verify_provenance(descriptor, r['archive'])
    require(descriptor['source_sha'] == r['source_sha'] and descriptor['verification_runs'] == r['verification_runs'])
    # Artifact source is now independently verified; inspect its immutable Git
    # source blob, not a checkout or executable candidate/migrator module.
    verify_candidate_schema(r, p, archive)
    expected = descriptor['images']['runtime']
    require(expected['config_id'] == r['archive']['runtime_config_id'])
    config = configs['runtime']
    identity = r['archive']['runtime_execution_id']
    if r['archive']['execution_identity'] == 'archive-manifest':
        require(config['_archive_manifest'] is not None and identity == config['_archive_manifest']['digest'])
    return identity, expected, config


def load_candidate(r, helper, output, candidate):
    identity, expected, config = candidate
    # Entire ZIP already verified. Load only runtime; no migration execution.
    helper.docker('load', '--input', str(output / 'runtime.tar'), timeout=300)
    data = json.loads(helper.docker('image', 'inspect', identity))[0]
    helper.verify_archive_image_data(data, expected, config, r['source_sha'], r['archive'], 'runtime')


def activate(r, p, helper, files, container, targets, candidate, archive, output):
    # The automatic policy has no feature overlay/decoder contract. Never install
    # the manual media-capable unit without staging its required overlay.
    require(b'compose.features.yaml' not in files['unit'])
    identity = candidate[0]
    backup = STATE / ('request-' + r['request_id'])
    require(not backup.exists())
    backup.mkdir(mode=0o700)
    # Consume before mutation, including failure. Retrying requires a new request.
    helper.atomic(backup / 'consumed.json', json.dumps(r).encode(), 0o600)
    helper.atomic(backup / 'previous.json', protected(STATE / 'current.json'), 0o600)
    for key, path in targets.items():
        helper.atomic(backup / key, protected(path), 0o600)
    health_request = {'runtime_image': identity, 'archive': {'runtime_execution_id': identity}, 'edge_network': p['edge_network']}
    sync_directory(backup)
    sync_directory(STATE)
    load_candidate(r, helper, output, candidate)
    helper.verify_auth_secret(files['compose'], identity)
    fresh(r, archive)
    verify_current(r, p, helper)
    try:
        helper.caddy_config(container, files['bootstrap'])
        for role in ('api', 'worker'):
            helper.run(['/usr/bin/systemctl', 'stop', 'rogichat-app@' + role], timeout=40)
        schema_probe(p, helper)
        fresh(r, archive)
        helper.atomic(helper.APP / 'compose.app.yaml', files['compose'])
        helper.atomic(helper.IMAGES, (f'ROGICHAT_API_IMAGE={identity}\nROGICHAT_WORKER_IMAGE={identity}\n'
                                    f"ROGICHAT_EDGE_NETWORK={p['edge_network']}\n").encode(), 0o600)
        helper.atomic(helper.UNIT, files['unit'])
        helper.start_units(files['bootstrap'])
        # Candidate's own /ready + worker schema check must pass too.
        helper.wait_health(health_request)
        schema_probe(p, helper)
        fresh(r, archive)
        require(helper.get_caddy(p['edge_network']) == container)
        helper.caddy_config(container, files['caddy'])
        for route in ('/live', '/ready', '/_infra/health'):
            url = 'https://api.qa.rogi.chat' + route
            with urllib.request.urlopen(url, timeout=10) as response:
                require(response.status == 200 and response.geturl() == url)
        current = {'source_sha': r['source_sha'], 'runtime_image': identity, 'schema_sha256': p['schema_sha256'],
                   'migrations': p['migrations'], 'files': {key: digest(protected(path)) for key, path in targets.items()}}
        helper.atomic(STATE / 'current.json', json.dumps(current, sort_keys=True).encode(), 0o600)
        helper.atomic(backup / 'completed', b'QA schema-unchanged runtime and public routes verified.\n', 0o600)
        sync_directory(backup)
        sync_directory(STATE)
    except BaseException:
        helper.fail_closed(container, files['bootstrap'])
        raise


@contextmanager
def deployment_lock():
    # /run/lock is commonly root-owned sticky 1777. Its existing root-owned
    # 0600 inode is safe under sticky semantics; never replace/create it here.
    for parent in LOCK.parents:
        metadata = parent.lstat()
        require(stat.S_ISDIR(metadata.st_mode) and metadata.st_uid == 0
                and (not metadata.st_mode & 0o022 or bool(metadata.st_mode & stat.S_ISVTX)))
    fd = os.open(LOCK, os.O_RDWR | os.O_NOFOLLOW)
    with os.fdopen(fd, 'r+') as lock:
        metadata = os.fstat(lock.fileno())
        require(stat.S_ISREG(metadata.st_mode) and metadata.st_uid == 0
                and stat.S_IMODE(metadata.st_mode) == 0o600 and metadata.st_nlink == 1
                and metadata.st_ino == LOCK.lstat().st_ino)
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    require(os.geteuid() == 0)
    require(Path(__file__).absolute() == ROOT / 'backend_automatic_release.py')
    protected(Path(__file__).absolute())
    p = validate_policy(json.loads(protected(POLICY, 0o600)))
    r = validate_request(json.loads(protected(REQUEST, 0o600)), p)
    helper = pinned_module('backend_release', p['release_helper_sha256'])
    archive = pinned_module('backend_archive', p['archive_helper_sha256'])
    # Lock is preinstalled root-owned 0600; no symlink/parent traversal or new
    # inode on concurrent invocations. The manual deployer uses the same lock.
    with deployment_lock():
        for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
            signal.signal(sig, lambda *_: (_ for _ in ()).throw(ValueError('interrupted')))
        require(json.loads(protected(POLICY, 0o600)) == p and json.loads(protected(REQUEST, 0o600)) == r)
        fresh(r, archive)
        require(not (STATE / ('request-' + r['request_id'])).exists())
        _, targets = verify_current(r, p, helper)
        files = {key: protected(helper.RELEASES / r['source_sha'] / relative) for key, relative in TEMPLATES.items()}
        require(all(digest(files[key]) == p['templates'][key] for key in files))
        require(b'compose.features.yaml' not in files['unit'])
        container = helper.get_caddy(p['edge_network'])
        schema_probe(p, helper)
        with tempfile.TemporaryDirectory(prefix='rogichat-auto-', dir='/var/tmp') as temporary:
            output = Path(temporary) / 'verified'
            candidate = verify_candidate(r, p, helper, archive, output)
            if not args.apply:
                print('QA artifact/schema verified; activation and candidate health not performed.')
                return
            fresh(r, archive)
            verify_current(r, p, helper)
            activate(r, p, helper, files, container, targets, candidate, archive, output)
    print('QA schema-unchanged release and public routes verified.')


if __name__ == '__main__':
    try:
        main()
    except (Exception, KeyboardInterrupt):
        print('QA automatic release rejected or failed; inspect private state before retry.', file=sys.stderr)
        sys.exit(1)
