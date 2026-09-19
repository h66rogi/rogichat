#!/usr/bin/env python3
"""Trusted CI export and fail-closed archive verification; never deploys an app.

No shell evaluation, archive extractall, host registry credentials or PR input.
Management download writes only a new operator-selected directory outside Git.
"""
from __future__ import annotations
import argparse
import base64
import gzip
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import urllib.parse
import urllib.request
import zipfile

REPOSITORY = 'h66rogi/rogichat'
SOURCE = 'https://github.com/' + REPOSITORY
WORKFLOWS = {'backend.yml', 'security.yml', 'infrastructure.yml', 'backend-publish.yml'}
ROLES = {'runtime': 'rogichat-api', 'migration': 'rogichat-api-migration'}
HEX = re.compile(r'[a-f0-9]{64}\Z')
SHA = re.compile(r'[a-f0-9]{40}\Z')
LIMIT = 8 * 1024**3
FILES = {'descriptor.json', 'runtime.tar', 'migration.tar', 'runtime.manifest.json', 'migration.manifest.json'}


def require(value):
    if not value:
        raise ValueError('Image archive verification rejected')


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def stream_hash(stream):
    result = hashlib.sha256()
    total = 0
    while chunk := stream.read(1024 * 1024):
        total += len(chunk)
        require(total <= LIMIT)
        result.update(chunk)
    return result.hexdigest()


def file_hash(path):
    require(path.is_file() and not path.is_symlink() and path.stat().st_size <= LIMIT)
    with path.open('rb') as stream:
        return stream_hash(stream)


def api(path, token=None):
    headers = {'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    request = urllib.request.Request('https://api.github.com/repos/' + REPOSITORY + '/' + path, headers=headers)
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def verify_run(value, sha, workflow, event='push'):
    require(value['head_sha'] == sha and value['head_branch'] == 'qa' and value['event'] == event
            and value['status'] == 'completed' and value['conclusion'] == 'success'
            and value['repository']['full_name'] == REPOSITORY
            and value['head_repository']['full_name'] == REPOSITORY
            and value['path'] == '.github/workflows/' + workflow)


def verify_source(source, runs, token=None):
    require(SHA.fullmatch(source) and type(runs) is dict and set(runs) == WORKFLOWS)
    for workflow, run_id in runs.items():
        require(type(run_id) is int and run_id > 0)
        verify_run(api(f'actions/runs/{run_id}', token), source, workflow)


def validate_config(config, source):
    require(config['architecture'] == 'amd64' and config['os'] == 'linux')
    settings = config['config']
    require(settings['User'] == '10001:10001' and settings['Entrypoint'] == ['node']
            and settings['Labels']['org.opencontainers.image.source'] == SOURCE
            and settings['Labels']['org.opencontainers.image.revision'] == source)
    # Operational secrets are runtime mounts, never image environment/history.
    for entry in settings.get('Env', []):
        key = entry.split('=', 1)[0]
        require(not re.search(r'(?i)(secret|password|token|credential|database_url|aws_access|aws_session)', key))
    require(config['rootfs']['type'] == 'layers' and 0 < len(config['rootfs']['diff_ids']) <= 200)
    require(all(re.fullmatch(r'sha256:[a-f0-9]{64}', item) for item in config['rootfs']['diff_ids']))


def safe_name(name):
    path = PurePosixPath(name)
    require(name and not path.is_absolute() and '..' not in path.parts and '\\' not in name
            and '\x00' not in name and str(path) == name.rstrip('/'))


def verify_tar(path, config_id, source):
    """Read Docker save layout without extracting paths or trusting image tags.

    Handles both classic layer.tar and OCI blob storage produced by docker save.
    Every layer is bound to config.rootfs.diff_ids (uncompressed layer digest).
    """
    small = {}
    hashes = {}
    seen = set()
    total = 0
    with tarfile.open(path, mode='r:') as archive:
        for member in archive:
            safe_name(member.name)
            require(member.name not in seen and len(seen) < 10000)
            seen.add(member.name)
            require(member.isdir() or member.isfile())
            if member.isdir():
                continue
            total += member.size
            require(total <= LIMIT and member.size <= LIMIT)
            stream = archive.extractfile(member)
            require(stream is not None)
            head = stream.read(2)
            stream.seek(0)
            is_config = member.name in (config_id[7:] + '.json', 'blobs/sha256/' + config_id[7:])
            if is_config or member.name == 'manifest.json':
                require(member.size <= 4 * 1024**2 and head != b'\x1f\x8b')
                raw = stream.read()
                small[member.name] = raw
                hashes[member.name] = sha256(raw)
            else:
                hashes[member.name] = stream_hash(gzip.GzipFile(fileobj=stream) if head == b'\x1f\x8b' else stream)
    manifest = json.loads(small['manifest.json'])
    require(type(manifest) is list and len(manifest) == 1)
    entry = manifest[0]
    config_raw = small[entry['Config']]
    require('sha256:' + sha256(config_raw) == config_id)
    config = json.loads(config_raw)
    validate_config(config, source)
    require(["sha256:" + hashes[name] for name in entry['Layers']] == config['rootfs']['diff_ids'])
    return config


def validate_descriptor(value):
    require(type(value) is dict and set(value) == {'version', 'repository', 'source_sha', 'producer', 'verification_runs', 'images'})
    require(value['version'] == 1 and value['repository'] == REPOSITORY and SHA.fullmatch(value['source_sha']))
    producer = value['producer']
    require(set(producer) == {'sha', 'run_id', 'run_attempt', 'event', 'ref'})
    require(SHA.fullmatch(producer['sha']) and type(producer['run_id']) is int and producer['run_id'] > 0
            and type(producer['run_attempt']) is int and producer['run_attempt'] > 0
            and producer['event'] == 'workflow_dispatch' and producer['ref'] == 'refs/heads/qa')
    require(set(value['verification_runs']) == WORKFLOWS and set(value['images']) == set(ROLES))
    for role, repo in ROLES.items():
        item = value['images'][role]
        require(set(item) == {'image', 'config_id', 'archive_sha256'})
        require(re.fullmatch(r'ghcr\.io/h66rogi/' + repo + r'@sha256:[a-f0-9]{64}', item['image'])
                and re.fullmatch(r'sha256:[a-f0-9]{64}', item['config_id']) and HEX.fullmatch(item['archive_sha256']))
    return value


def validate_directory(directory):
    require({item.name for item in directory.iterdir()} == FILES)
    require(all(item.is_file() and not item.is_symlink() for item in directory.iterdir()))
    require((directory / 'descriptor.json').stat().st_size <= 65536)
    descriptor = validate_descriptor(json.loads((directory / 'descriptor.json').read_bytes()))
    configs = {}
    for role in ROLES:
        item = descriptor['images'][role]
        raw = (directory / (role + '.manifest.json')).read_bytes()
        require(len(raw) <= 4 * 1024**2 and sha256(raw) == item['image'].split('@sha256:')[1])
        manifest = json.loads(raw)
        require(manifest['schemaVersion'] == 2 and manifest['config']['digest'] == item['config_id']
                and manifest['mediaType'] in ('application/vnd.docker.distribution.manifest.v2+json',
                                              'application/vnd.oci.image.manifest.v1+json'))
        path = directory / (role + '.tar')
        require(file_hash(path) == item['archive_sha256'])
        configs[role] = verify_tar(path, item['config_id'], descriptor['source_sha'])
        require(len(manifest['layers']) == len(configs[role]['rootfs']['diff_ids']))
    return descriptor, configs


def validate_zip(path, expected_digest, directory):
    require(re.fullmatch(r'sha256:[a-f0-9]{64}', expected_digest))
    require('sha256:' + file_hash(path) == expected_digest)
    require(not directory.exists())
    directory.mkdir(mode=0o700)
    with zipfile.ZipFile(path) as archive:
        entries = archive.infolist()
        require(len(entries) == len(FILES) and {item.filename for item in entries} == FILES)
        require(sum(item.file_size for item in entries) <= LIMIT)
        require(shutil.disk_usage(directory).free >= sum(item.file_size for item in entries) + 1024**3)
        for item in entries:
            mode = item.external_attr >> 16
            require(not item.is_dir() and not stat.S_ISLNK(mode) and not item.flag_bits & 1
                    and item.file_size <= LIMIT and (not stat.S_IFMT(mode) or stat.S_ISREG(mode)))
            with archive.open(item) as source, (directory / item.filename).open('xb') as target:
                shutil.copyfileobj(source, target, 1024 * 1024)
    return validate_directory(directory)


def verify_provenance(descriptor, approval, token=None):
    producer = descriptor['producer']
    require(producer['sha'] == approval['export_sha'] and producer['run_id'] == approval['export_run']
            and producer['run_attempt'] == approval['export_attempt'])
    result = api(f"actions/runs/{producer['run_id']}/attempts/{producer['run_attempt']}", token)
    verify_run(result, producer['sha'], 'backend-export.yml', 'workflow_dispatch')
    require(result['run_attempt'] == producer['run_attempt'])
    artifact = api(f"actions/artifacts/{approval['artifact_id']}", token)
    require(not artifact['expired'] and artifact['digest'] == approval['artifact_sha256']
            and artifact['workflow_run']['id'] == producer['run_id']
            and artifact['workflow_run']['head_sha'] == producer['sha']
            and artifact['name'] == f"backend-{descriptor['source_sha']}-{producer['run_id']}-{producer['run_attempt']}")
    verify_source(descriptor['source_sha'], descriptor['verification_runs'], token)
    compare = api(f"compare/{descriptor['source_sha']}...{producer['sha']}", token)
    require(compare['status'] in ('ahead', 'identical') and compare['merge_base_commit']['sha'] == descriptor['source_sha'])


def command(args, *, data=None, env=None, timeout=300):
    result = subprocess.run(args, input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env, timeout=timeout)
    require(result.returncode == 0)
    return result.stdout


def produce():
    source = os.environ['EXPORT_SOURCE_SHA']
    sha = os.environ['GITHUB_SHA']
    require(SHA.fullmatch(source) and SHA.fullmatch(sha) and os.environ['GITHUB_REPOSITORY'] == REPOSITORY
            and os.environ['GITHUB_REF'] == 'refs/heads/qa' and os.environ['GITHUB_EVENT_NAME'] == 'workflow_dispatch')
    token = os.environ.pop('GITHUB_TOKEN')
    runs = {}
    for workflow in sorted(WORKFLOWS):
        candidates = api(f'actions/workflows/{workflow}/runs?branch=qa&event=push&head_sha={source}&per_page=20', token)['workflow_runs']
        require(candidates)
        verify_run(candidates[0], source, workflow)
        runs[workflow] = candidates[0]['id']
    compare = api(f'compare/{source}...{sha}', token)
    require(compare['status'] in ('ahead', 'identical') and compare['merge_base_commit']['sha'] == source)
    print('Exact source CI and reviewed QA ancestry verified.', flush=True)
    directory = Path(os.environ['RUNNER_TEMP']) / 'rogichat-export'
    directory.mkdir(mode=0o700)
    descriptor = {'version': 1, 'repository': REPOSITORY, 'source_sha': source,
                  'producer': {'sha': sha, 'run_id': int(os.environ['GITHUB_RUN_ID']),
                               'run_attempt': int(os.environ['GITHUB_RUN_ATTEMPT']),
                               'event': 'workflow_dispatch', 'ref': 'refs/heads/qa'},
                  'verification_runs': runs, 'images': {}}
    with tempfile.TemporaryDirectory(prefix='rogichat-registry-', dir=os.environ['RUNNER_TEMP']) as config:
        env = {**os.environ, 'DOCKER_CONFIG': config}
        command(['docker', 'login', 'ghcr.io', '--username', os.environ['GITHUB_ACTOR'], '--password-stdin'], data=token.encode(), env=env)
        try:
            for role, repo in ROLES.items():
                value = os.environ['EXPORT_' + role.upper() + '_DIGEST']
                require(HEX.fullmatch(value))
                image = f'ghcr.io/h66rogi/{repo}@sha256:{value}'
                command(['docker', 'pull', '--platform', 'linux/amd64', image], env=env)
                # Fetch original bytes, not a CLI pretty-print/added newline.
                auth = base64.b64encode((os.environ['GITHUB_ACTOR'] + ':' + token).encode()).decode()
                url = 'https://ghcr.io/token?' + urllib.parse.urlencode({'service': 'ghcr.io', 'scope': f'repository:h66rogi/{repo}:pull'})
                with urllib.request.urlopen(urllib.request.Request(url, headers={'Authorization': 'Basic ' + auth}), timeout=30) as response:
                    bearer = json.load(response)['token']
                headers = {'Authorization': 'Bearer ' + bearer, 'Accept': 'application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json'}
                with urllib.request.urlopen(urllib.request.Request(f'https://ghcr.io/v2/h66rogi/{repo}/manifests/sha256:{value}', headers=headers), timeout=30) as response:
                    raw = response.read(4 * 1024**2 + 1)
                require(len(raw) <= 4 * 1024**2 and sha256(raw) == value)
                (directory / (role + '.manifest.json')).write_bytes(raw)
                inspected = json.loads(command(['docker', 'image', 'inspect', image], env=env))[0]
                require(image in inspected['RepoDigests'] and inspected['Id'] == json.loads(raw)['config']['digest'])
                descriptor['images'][role] = {'image': image, 'config_id': inspected['Id']}
                print('Registry manifest and image identity verified: ' + role, flush=True)
        finally:
            command(['docker', 'logout', 'ghcr.io'], env=env)
        del token, auth, bearer, headers
    # No registry token/config exists in the save/verification/upload phase.
    for role in ROLES:
        path = directory / (role + '.tar')
        command(['docker', 'save', '--output', str(path), descriptor['images'][role]['config_id']])
        descriptor['images'][role]['archive_sha256'] = file_hash(path)
        print('Credential-free Docker archive saved: ' + role, flush=True)
    (directory / 'descriptor.json').write_text(json.dumps(descriptor, sort_keys=True) + '\n')
    validate_directory(directory)
    print('Exact published images, raw registry manifests, source and rootfs verified; no deployment performed.')


def download(args):
    # Existing management CLI credential is read into memory only, never argv/log.
    token = command(['gh', 'auth', 'token']).decode().strip()
    require(SHA.fullmatch(args.export_sha) and args.run_id > 0 and args.attempt > 0 and args.artifact_id > 0)
    artifact = api(f'actions/artifacts/{args.artifact_id}', token)
    approval = {'export_sha': args.export_sha, 'export_run': args.run_id, 'export_attempt': args.attempt,
                'artifact_id': args.artifact_id, 'artifact_sha256': artifact['digest']}
    require(not args.output.exists())
    args.output.mkdir(mode=0o700)
    path = args.output / 'export.zip'
    # gh handles the signed redirect without exposing its URL or auth header.
    with path.open('xb') as output:
        result = subprocess.run(['gh', 'api', f'/repos/{REPOSITORY}/actions/artifacts/{args.artifact_id}/zip'],
                                stdout=output, stderr=subprocess.PIPE, timeout=600)
        require(result.returncode == 0)
    descriptor, _ = validate_zip(path, approval['artifact_sha256'], args.output / 'verified')
    verify_provenance(descriptor, approval, token)
    (args.output / 'archive-approval.json').write_text(json.dumps({**approval,
        'runtime_config_id': descriptor['images']['runtime']['config_id'],
        'migration_config_id': descriptor['images']['migration']['config_id']}, sort_keys=True) + '\n')
    print('GitHub artifact ZIP, trusted producer, registry manifests and Docker rootfs verified; not loaded or deployed.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('produce')
    get = commands.add_parser('download')
    get.add_argument('--export-sha', required=True)
    get.add_argument('--run-id', type=int, required=True)
    get.add_argument('--attempt', type=int, required=True)
    get.add_argument('--artifact-id', type=int, required=True)
    get.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    produce() if args.command == 'produce' else download(args)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Image export/archive verification failed; no credential or registry response is logged.', file=sys.stderr)
        sys.exit(1)
