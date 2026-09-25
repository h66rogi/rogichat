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
import io
import json
import os
from datetime import datetime
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
FIVE_QA_WORKFLOWS = {'web.yml', 'backend.yml', 'security.yml', 'infrastructure.yml', 'mobile.yml'}
NEW_PUBLICATION_WORKFLOW = 'qa-backend-publication.yml'
NEW_PUBLICATION_NAME = 'QA backend image publication'
NEW_WORKFLOWS = FIVE_QA_WORKFLOWS | {NEW_PUBLICATION_WORKFLOW}
NEW_PUBLICATION_EVENTS = {'workflow_run', 'schedule', 'workflow_dispatch'}
PUBLICATION_JOB = 'Backend publication result'
BACKEND_ROLES = {'runtime': 'rogichat-api', 'migration': 'rogichat-api-migration'}
ROLES = dict(BACKEND_ROLES)
DECODER_ROLE = {'decoder': 'rogichat-media-decoder'}
HEX = re.compile(r'[a-f0-9]{64}\Z')
SHA = re.compile(r'[a-f0-9]{40}\Z')
LIMIT = 8 * 1024**3
FILES = {'descriptor.json', 'runtime.tar', 'migration.tar', 'runtime.manifest.json', 'migration.manifest.json'}
PROOF_LIMIT = 1024**2
PROOF_NAME = 'backend-publication-proof.json'


def descriptor_roles(value):
    # Web uses an isolated module instance and overrides ROLES/FILES. Never add
    # backend roles to that contract, nor accept a v2 web descriptor.
    version = value['version']
    require(type(version) is int and version in (1, 2))
    if version == 2:
        require(ROLES == BACKEND_ROLES)
        return {**ROLES, **DECODER_ROLE}
    return ROLES


def descriptor_files(value):
    descriptor_roles(value)
    return FILES | ({'decoder.tar', 'decoder.manifest.json'} if value['version'] == 2 else set())


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


def verify_publication_run(value, sha, token=None):
    require(value['head_sha'] == sha and value['head_branch'] == 'qa'
            and value['event'] in NEW_PUBLICATION_EVENTS
            and value['status'] == 'completed' and value['conclusion'] == 'success'
            and value['repository']['full_name'] == REPOSITORY
            and value['head_repository']['full_name'] == REPOSITORY
            and value['path'] == '.github/workflows/' + NEW_PUBLICATION_WORKFLOW
            and value['name'] == NEW_PUBLICATION_NAME
            and type(value['id']) is int and value['id'] > 0
            and type(value['run_attempt']) is int and value['run_attempt'] > 0)
    listing = api(f"actions/runs/{value['id']}/attempts/{value['run_attempt']}/jobs?per_page=100", token)
    require(type(listing['total_count']) is int and 0 < listing['total_count'] <= 100
            and type(listing['jobs']) is list and len(listing['jobs']) == listing['total_count'])
    jobs = [job for job in listing['jobs'] if job['name'] == PUBLICATION_JOB]
    require(len(jobs) == 1 and jobs[0]['run_id'] == value['id']
            and jobs[0]['run_attempt'] == value['run_attempt']
            and jobs[0]['status'] == 'completed' and jobs[0]['conclusion'] == 'success')


def verify_source(source, runs, token=None, *, publication_attempt=None):
    require(SHA.fullmatch(source) and type(runs) is dict
            and set(runs) in (WORKFLOWS, NEW_WORKFLOWS))
    for workflow, run_id in runs.items():
        require(type(run_id) is int and run_id > 0)
        if workflow == NEW_PUBLICATION_WORKFLOW:
            if publication_attempt is not None:
                require(type(publication_attempt) is int and publication_attempt > 0)
                run = api(f'actions/runs/{run_id}/attempts/{publication_attempt}', token)
                require(run['id'] == run_id and run['run_attempt'] == publication_attempt)
            else:
                run = api(f'actions/runs/{run_id}', token)
            verify_publication_run(run, source, token)
        else:
            run = api(f'actions/runs/{run_id}', token)
            verify_run(run, source, workflow)


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
    raw_hashes = {}
    sizes = {}
    compressed = {}
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
            sizes[member.name] = member.size
            require(total <= LIMIT and member.size <= LIMIT)
            stream = archive.extractfile(member)
            require(stream is not None)
            head = stream.read(2)
            compressed[member.name] = head == b'\x1f\x8b'
            stream.seek(0)
            is_config = member.name in (config_id[7:] + '.json', 'blobs/sha256/' + config_id[7:])
            if is_config or member.name in ('manifest.json', 'index.json', 'oci-layout'):
                require(member.size <= 4 * 1024**2 and head != b'\x1f\x8b')
                raw = stream.read()
                small[member.name] = raw
                hashes[member.name] = sha256(raw)
                raw_hashes[member.name] = hashes[member.name]
            else:
                raw_hashes[member.name] = stream_hash(stream)
                stream.seek(0)
                hashes[member.name] = stream_hash(gzip.GzipFile(fileobj=stream)) if head == b'\x1f\x8b' else raw_hashes[member.name]
            if member.name.startswith('blobs/sha256/'):
                require(member.name == 'blobs/sha256/' + raw_hashes[member.name])
    manifest = json.loads(small['manifest.json'])
    require(type(manifest) is list and len(manifest) == 1)
    entry = manifest[0]
    config_raw = small[entry['Config']]
    require('sha256:' + sha256(config_raw) == config_id)
    config = json.loads(config_raw)
    validate_config(config, source)
    require(["sha256:" + hashes[name] for name in entry['Layers']] == config['rootfs']['diff_ids'])
    # Docker 29 containerd uses the archive manifest digest as local image ID,
    # while classic graph drivers use the config digest. Bind BOTH identities;
    # selecting which one to execute is an explicit reviewed host request.
    config['_archive_manifest'] = None
    if 'index.json' in small or 'oci-layout' in small:
        require(json.loads(small['oci-layout']) == {'imageLayoutVersion': '1.0.0'})
        index = json.loads(small['index.json'])
        require(index['schemaVersion'] == 2 and index['mediaType'] == 'application/vnd.oci.image.index.v1+json'
                and len(index['manifests']) == 1)
        reference = index['manifests'][0]
        require(reference['mediaType'] == 'application/vnd.oci.image.manifest.v1+json'
                and re.fullmatch(r'sha256:[a-f0-9]{64}', reference['digest']))
        name = 'blobs/sha256/' + reference['digest'][7:]
        require(raw_hashes[name] == reference['digest'][7:] and sizes[name] == reference['size']
                and sizes[name] <= 4 * 1024**2)
        with tarfile.open(path, mode='r:') as archive:
            raw_manifest = archive.extractfile(name).read()
        manifest = json.loads(raw_manifest)
        require(manifest['schemaVersion'] == 2 and manifest['mediaType'] == reference['mediaType'])
        require(entry['Config'] == 'blobs/sha256/' + config_id[7:]
                and manifest['config']['digest'] == config_id and manifest['config']['size'] == len(config_raw)
                and manifest['config']['mediaType'] == 'application/vnd.oci.image.config.v1+json')
        require(len(manifest['layers']) == len(entry['Layers']))
        for layer, layer_name in zip(manifest['layers'], entry['Layers']):
            require(layer['digest'] == 'sha256:' + raw_hashes[layer_name] and layer['size'] == sizes[layer_name]
                    and layer_name == 'blobs/sha256/' + layer['digest'][7:]
                    and layer['mediaType'] == ('application/vnd.oci.image.layer.v1.tar+gzip'
                                              if compressed[layer_name] else 'application/vnd.oci.image.layer.v1.tar'))
        config['_archive_manifest'] = {'digest': reference['digest'], 'size': reference['size'],
                                       'mediaType': reference['mediaType']}
    return config


def validate_descriptor(value, *, producer_events=frozenset({'workflow_dispatch', 'workflow_run'})):
    require(type(value) is dict)
    new_publication = (NEW_PUBLICATION_WORKFLOW == 'qa-backend-publication.yml'
                       and set(value.get('verification_runs', {})) == NEW_WORKFLOWS)
    keys = {'version', 'repository', 'source_sha', 'producer', 'verification_runs', 'images'}
    require(set(value) == keys | ({'publication'} if new_publication else set()))
    roles = descriptor_roles(value)
    require(value['repository'] == REPOSITORY and SHA.fullmatch(value['source_sha']))
    producer = value['producer']
    require(set(producer) == {'sha', 'run_id', 'run_attempt', 'event', 'ref'})
    require(SHA.fullmatch(producer['sha']) and type(producer['run_id']) is int and producer['run_id'] > 0
            and type(producer['run_attempt']) is int and producer['run_attempt'] > 0
            and producer['event'] in producer_events and producer['ref'] == 'refs/heads/qa')
    require(set(value['verification_runs']) in (WORKFLOWS, NEW_WORKFLOWS)
            and set(value['images']) == set(roles))
    if new_publication:
        publication = value['publication']
        require(value['version'] == 2 and type(publication) is dict
                and set(publication) == {'attempt', 'proof_digest'}
                and type(publication['attempt']) is int and publication['attempt'] > 0
                and re.fullmatch(r'sha256:[a-f0-9]{64}', publication['proof_digest']))
    for role, repo in roles.items():
        item = value['images'][role]
        require(set(item) == {'image', 'config_id', 'archive_sha256'})
        require(re.fullmatch(r'ghcr\.io/h66rogi/' + repo + r'@sha256:[a-f0-9]{64}', item['image'])
                and re.fullmatch(r'sha256:[a-f0-9]{64}', item['config_id']) and HEX.fullmatch(item['archive_sha256']))
    return value


def validate_directory(directory):
    require(all(item.is_file() and not item.is_symlink() for item in directory.iterdir()))
    require((directory / 'descriptor.json').stat().st_size <= 65536)
    descriptor = validate_descriptor(json.loads((directory / 'descriptor.json').read_bytes()))
    require({item.name for item in directory.iterdir()} == descriptor_files(descriptor))
    configs = {}
    for role in descriptor_roles(descriptor):
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
        if role == 'decoder':
            settings = configs[role]['config']
            require(settings['Cmd'] == ['dist/media-decoder-main.js']
                    and settings['WorkingDir'] == '/app/apps/api')
        require(len(manifest['layers']) == len(configs[role]['rootfs']['diff_ids']))
    return descriptor, configs


def validate_zip(path, expected_digest, directory):
    require(re.fullmatch(r'sha256:[a-f0-9]{64}', expected_digest))
    require('sha256:' + file_hash(path) == expected_digest)
    require(not directory.exists())
    directory.mkdir(mode=0o700)
    with zipfile.ZipFile(path) as archive:
        entries = archive.infolist()
        require(sum(item.filename == 'descriptor.json' for item in entries) == 1)
        require(archive.getinfo('descriptor.json').file_size <= 65536)
        descriptor = validate_descriptor(json.loads(archive.read('descriptor.json')))
        files = descriptor_files(descriptor)
        require(len(entries) == len(files) and {item.filename for item in entries} == files)
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
    validate_descriptor(descriptor)
    producer = descriptor['producer']
    if producer['event'] == 'workflow_run':
        require(set(descriptor['verification_runs']) == NEW_WORKFLOWS)
    require(producer['sha'] == approval['export_sha'] and producer['run_id'] == approval['export_run']
            and producer['run_attempt'] == approval['export_attempt'])
    result = api(f"actions/runs/{producer['run_id']}/attempts/{producer['run_attempt']}", token)
    verify_run(result, producer['sha'], 'backend-export.yml', producer['event'])
    require(result['run_attempt'] == producer['run_attempt'])
    artifact = api(f"actions/artifacts/{approval['artifact_id']}", token)
    require(not artifact['expired'] and artifact['digest'] == approval['artifact_sha256']
            and artifact['workflow_run']['id'] == producer['run_id']
            and artifact['workflow_run']['head_sha'] == producer['sha']
            and artifact['name'] == f"backend-{descriptor['source_sha']}-{producer['run_id']}-{producer['run_attempt']}")
    publication = descriptor.get('publication')
    verify_source(descriptor['source_sha'], descriptor['verification_runs'], token,
                  publication_attempt=publication['attempt'] if publication else None)
    if set(descriptor['verification_runs']) == NEW_WORKFLOWS:
        require(descriptor['version'] == 2)
        publication_id = descriptor['verification_runs'][NEW_PUBLICATION_WORKFLOW]
        proof = publication_proof(descriptor['source_sha'], publication_id,
                                  publication['attempt'], result['run_started_at'], token,
                                  expected_digest=publication['proof_digest'])
        for role in BACKEND_ROLES | DECODER_ROLE:
            image = descriptor['images'][role]
            require(proof['images'][role] == {'image': image['image'],
                                              'checkedImageId': image['config_id']})
    compare = api(f"compare/{descriptor['source_sha']}...{producer['sha']}", token)
    require(compare['status'] in ('ahead', 'identical') and compare['merge_base_commit']['sha'] == descriptor['source_sha'])


def command(args, *, data=None, env=None, timeout=300):
    result = subprocess.run(args, input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env, timeout=timeout)
    require(result.returncode == 0)
    return result.stdout


def timestamp(value):
    result = datetime.fromisoformat(value.replace('Z', '+00:00'))
    require(result.tzinfo is not None)
    return result


class SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        target = urllib.parse.urlsplit(new_url)
        require(target.scheme == 'https' and not target.username and not target.password)
        redirected = super().redirect_request(request, response, code, message, headers, new_url)
        if redirected and target.netloc != urllib.parse.urlsplit(request.full_url).netloc:
            redirected.remove_header('Authorization')
        return redirected


def proof_zip(data, digest, source, run_id, attempt):
    require(type(data) is bytes and len(data) <= PROOF_LIMIT
            and digest == 'sha256:' + sha256(data))
    with zipfile.ZipFile(io.BytesIO(data)) as zipped:
        entries = zipped.infolist()
        require(len(entries) == 1)
        entry = entries[0]
        mode = entry.external_attr >> 16
        require(entry.filename == PROOF_NAME and not entry.is_dir()
                and not entry.flag_bits & 1 and not stat.S_ISLNK(mode)
                and (not stat.S_IFMT(mode) or stat.S_ISREG(mode))
                and entry.file_size <= 65536)
        proof = json.loads(zipped.read(entry))
    require(type(proof) is dict and set(proof) == {'schemaVersion', 'repository', 'sourceSha',
            'publicationRun', 'publicationAttempt', 'platform', 'images'}
            and type(proof['schemaVersion']) is int and proof['schemaVersion'] == 1
            and proof['repository'] == REPOSITORY and proof['sourceSha'] == source
            and proof['publicationRun'] == f'https://github.com/{REPOSITORY}/actions/runs/{run_id}'
            and type(proof['publicationAttempt']) is int and proof['publicationAttempt'] == attempt
            and proof['platform'] == 'linux/amd64' and type(proof['images']) is dict
            and set(proof['images']) == set(BACKEND_ROLES | DECODER_ROLE))
    for role, repository in (BACKEND_ROLES | DECODER_ROLE).items():
        item = proof['images'][role]
        require(type(item) is dict and set(item) == {'image', 'checkedImageId'}
                and re.fullmatch(r'ghcr\.io/h66rogi/' + repository + r'@sha256:[a-f0-9]{64}', item['image'])
                and re.fullmatch(r'sha256:[a-f0-9]{64}', item['checkedImageId']))
    return proof


def download_publication_artifact(artifact_id, token):
    require(type(artifact_id) is int and artifact_id > 0 and type(token) is str and bool(token))
    request = urllib.request.Request(
        f'https://api.github.com/repos/{REPOSITORY}/actions/artifacts/{artifact_id}/zip',
        headers={'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json',
                 'X-GitHub-Api-Version': '2022-11-28'})
    with urllib.request.build_opener(SafeRedirect()).open(request, timeout=30) as response:
        if response.headers.get('Content-Length'):
            require(int(response.headers['Content-Length']) <= PROOF_LIMIT)
        data = response.read(PROOF_LIMIT + 1)
    require(len(data) <= PROOF_LIMIT)
    return data


def publication_proof(source, run_id, attempt, export_started_at, token, *, expected_digest=None,
                      return_digest=False):
    require(SHA.fullmatch(source) and type(run_id) is int and run_id > 0
            and type(attempt) is int and attempt > 0)
    publication = api(f'actions/runs/{run_id}/attempts/{attempt}', token)
    require(publication['id'] == run_id and publication['run_attempt'] == attempt)
    verify_publication_run(publication, source, token)
    listing = api(f'actions/runs/{run_id}/artifacts?per_page=100', token)
    require(type(listing['total_count']) is int and 0 < listing['total_count'] <= 100
            and type(listing['artifacts']) is list and len(listing['artifacts']) == listing['total_count'])
    name = f'backend-publication-proof-{source}-{attempt}'
    matches = [item for item in listing['artifacts'] if item['name'] == name]
    require(len(matches) == 1)
    artifact = matches[0]
    require(type(artifact['id']) is int and artifact['id'] > 0
            and artifact['expired'] is False
            and re.fullmatch(r'sha256:[a-f0-9]{64}', artifact['digest'])
            and (expected_digest is None or artifact['digest'] == expected_digest)
            and artifact['workflow_run']['id'] == run_id
            and artifact['workflow_run']['head_sha'] == source
            and timestamp(publication['run_started_at']) <= timestamp(artifact['created_at'])
            and timestamp(artifact['created_at']) <= timestamp(export_started_at))
    data = download_publication_artifact(artifact['id'], token)
    proof = proof_zip(data, artifact['digest'], source, run_id, attempt)
    return (proof, artifact['digest']) if return_digest else proof


def resolve_dispatch_publication():
    require(os.environ['GITHUB_EVENT_NAME'] == 'workflow_dispatch'
            and os.environ['GITHUB_REPOSITORY'] == REPOSITORY
            and os.environ['GITHUB_REF'] == 'refs/heads/qa'
            and SHA.fullmatch(os.environ['GITHUB_SHA']))
    source = os.environ['EXPORT_SOURCE_SHA']
    supplied_id = os.environ['EXPORT_PUBLICATION_RUN_ID']
    supplied_attempt = os.environ['EXPORT_PUBLICATION_ATTEMPT']
    digest = os.environ['EXPORT_PUBLICATION_PROOF_DIGEST']
    require(SHA.fullmatch(source) and supplied_id.isdecimal() and supplied_attempt.isdecimal()
            and re.fullmatch(r'sha256:[a-f0-9]{64}', digest))
    run_id, attempt = int(supplied_id), int(supplied_attempt)
    token = os.environ['GITHUB_TOKEN']
    export_id, export_attempt = int(os.environ['GITHUB_RUN_ID']), int(os.environ['GITHUB_RUN_ATTEMPT'])
    export = api(f'actions/runs/{export_id}/attempts/{export_attempt}', token)
    require(export['id'] == export_id and export['run_attempt'] == export_attempt
            and export['head_sha'] == os.environ['GITHUB_SHA'] and export['head_branch'] == 'qa'
            and export['event'] == 'workflow_dispatch' and export['path'] == '.github/workflows/backend-export.yml'
            and export['repository']['full_name'] == REPOSITORY
            and export['head_repository']['full_name'] == REPOSITORY)
    proof = publication_proof(source, run_id, attempt, export['run_started_at'], token,
                              expected_digest=digest)
    for role, item in proof['images'].items():
        require(os.environ['EXPORT_' + role.upper() + '_DIGEST'] == item['image'].split('@sha256:')[1])
    return proof['images']


def resolve_automatic_publication():
    require(os.environ['GITHUB_EVENT_NAME'] == 'workflow_run'
            and os.environ['GITHUB_REPOSITORY'] == REPOSITORY
            and os.environ['GITHUB_REF'] == 'refs/heads/qa'
            and SHA.fullmatch(os.environ['GITHUB_SHA']))
    path = Path(os.environ['GITHUB_EVENT_PATH'])
    require(path.is_file() and not path.is_symlink() and path.stat().st_size <= PROOF_LIMIT)
    event = json.loads(path.read_bytes())
    require(event['action'] == 'completed' and event['repository']['full_name'] == REPOSITORY)
    supplied = event['workflow_run']
    source = supplied['head_sha']
    require(SHA.fullmatch(source) and type(supplied['id']) is int and supplied['id'] > 0
            and type(supplied['run_attempt']) is int and supplied['run_attempt'] > 0
            and supplied['path'] == '.github/workflows/' + NEW_PUBLICATION_WORKFLOW
            and supplied['name'] == NEW_PUBLICATION_NAME
            and supplied['head_branch'] == 'qa'
            and supplied['event'] in NEW_PUBLICATION_EVENTS
            and supplied['status'] == 'completed' and supplied['conclusion'] == 'success'
            and supplied['repository']['full_name'] == REPOSITORY
            and supplied['head_repository']['full_name'] == REPOSITORY)
    token = os.environ['GITHUB_TOKEN']
    export_id, export_attempt = int(os.environ['GITHUB_RUN_ID']), int(os.environ['GITHUB_RUN_ATTEMPT'])
    export = api(f'actions/runs/{export_id}/attempts/{export_attempt}', token)
    require(export['id'] == export_id and export['run_attempt'] == export_attempt
            and export['head_sha'] == os.environ['GITHUB_SHA'] and export['head_branch'] == 'qa'
            and export['event'] == 'workflow_run' and export['path'] == '.github/workflows/backend-export.yml'
            and export['repository']['full_name'] == REPOSITORY
            and export['head_repository']['full_name'] == REPOSITORY)
    proof, digest = publication_proof(source, supplied['id'], supplied['run_attempt'],
                                      export['run_started_at'], token, return_digest=True)
    os.environ['EXPORT_SOURCE_SHA'] = source
    os.environ['EXPORT_PUBLICATION_RUN_ID'] = str(supplied['id'])
    os.environ['EXPORT_PUBLICATION_ATTEMPT'] = str(supplied['run_attempt'])
    os.environ['EXPORT_PUBLICATION_PROOF_DIGEST'] = digest
    for role, item in proof['images'].items():
        os.environ['EXPORT_' + role.upper() + '_DIGEST'] = item['image'].split('@sha256:')[1]
    return proof['images']


def produce(*, expected_event='workflow_dispatch', verification_runs=None, expected_images=None,
            publication_attempt=None):
    source = os.environ['EXPORT_SOURCE_SHA']
    sha = os.environ['GITHUB_SHA']
    require(SHA.fullmatch(source) and SHA.fullmatch(sha) and os.environ['GITHUB_REPOSITORY'] == REPOSITORY
            and expected_event in ('workflow_dispatch', 'workflow_run')
            and os.environ['GITHUB_REF'] == 'refs/heads/qa' and os.environ['GITHUB_EVENT_NAME'] == expected_event)
    token = os.environ.pop('GITHUB_TOKEN')
    runs = {}
    if verification_runs is None:
        supplied_id = os.environ.get('EXPORT_PUBLICATION_RUN_ID', '')
        supplied_attempt = os.environ.get('EXPORT_PUBLICATION_ATTEMPT', '')
        if supplied_id or supplied_attempt:
            require(supplied_id.isdecimal() and supplied_attempt.isdecimal())
            publication_id, attempt = int(supplied_id), int(supplied_attempt)
            require(publication_id > 0 and attempt > 0)
            workflows = FIVE_QA_WORKFLOWS
        else:
            publication_id = attempt = None
            workflows = WORKFLOWS
        for workflow in sorted(workflows - {NEW_PUBLICATION_WORKFLOW, 'backend-publish.yml'}):
            candidates = api(f'actions/workflows/{workflow}/runs?branch=qa&event=push&head_sha={source}&per_page=20', token)['workflow_runs']
            require(candidates)
            verify_run(candidates[0], source, workflow)
            runs[workflow] = candidates[0]['id']
        if publication_id is None:
            candidates = api(f'actions/workflows/backend-publish.yml/runs?branch=qa&event=push&head_sha={source}&per_page=20', token)['workflow_runs']
            require(candidates)
            verify_run(candidates[0], source, 'backend-publish.yml')
            runs['backend-publish.yml'] = candidates[0]['id']
        else:
            publication = api(f'actions/runs/{publication_id}/attempts/{attempt}', token)
            require(publication['id'] == publication_id and publication['run_attempt'] == attempt)
            verify_publication_run(publication, source, token)
            runs[NEW_PUBLICATION_WORKFLOW] = publication_id
    else:
        require(type(verification_runs) is dict)
        runs = dict(verification_runs)
        # Supplied identities never bypass independent exact-source verification.
        verify_source(source, runs, token, publication_attempt=publication_attempt)
    compare = api(f'compare/{source}...{sha}', token)
    require(compare['status'] in ('ahead', 'identical') and compare['merge_base_commit']['sha'] == source)
    print('Exact source CI and reviewed QA ancestry verified.', flush=True)
    directory = Path(os.environ['RUNNER_TEMP']) / 'rogichat-export'
    directory.mkdir(mode=0o700)
    version = 2 if os.environ.get('EXPORT_DECODER_DIGEST') else 1
    roles = descriptor_roles({'version': version})
    descriptor = {'version': version, 'repository': REPOSITORY, 'source_sha': source,
                  'producer': {'sha': sha, 'run_id': int(os.environ['GITHUB_RUN_ID']),
                               'run_attempt': int(os.environ['GITHUB_RUN_ATTEMPT']),
                               'event': expected_event, 'ref': 'refs/heads/qa'},
                  'verification_runs': runs, 'images': {}}
    if NEW_PUBLICATION_WORKFLOW == 'qa-backend-publication.yml' and NEW_PUBLICATION_WORKFLOW in runs:
        digest = os.environ.get('EXPORT_PUBLICATION_PROOF_DIGEST', '')
        supplied_attempt = os.environ.get('EXPORT_PUBLICATION_ATTEMPT', '')
        require(supplied_attempt.isdecimal() and int(supplied_attempt) > 0
                and re.fullmatch(r'sha256:[a-f0-9]{64}', digest))
        descriptor['publication'] = {'attempt': int(supplied_attempt), 'proof_digest': digest}
    with tempfile.TemporaryDirectory(prefix='rogichat-registry-', dir=os.environ['RUNNER_TEMP']) as config:
        env = {**os.environ, 'DOCKER_CONFIG': config}
        command(['docker', 'login', 'ghcr.io', '--username', os.environ['GITHUB_ACTOR'], '--password-stdin'], data=token.encode(), env=env)
        try:
            for role, repo in roles.items():
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
                if expected_images is not None:
                    require(set(expected_images) == set(roles)
                            and expected_images[role] == {'image': image, 'checkedImageId': inspected['Id']})
                print('Registry manifest and image identity verified: ' + role, flush=True)
        finally:
            command(['docker', 'logout', 'ghcr.io'], env=env)
        del token, auth, bearer, headers
    # No registry token/config exists in the save/verification/upload phase.
    for role in roles:
        path = directory / (role + '.tar')
        command(['docker', 'save', '--output', str(path), descriptor['images'][role]['config_id']])
        descriptor['images'][role]['archive_sha256'] = file_hash(path)
        print('Credential-free Docker archive saved: ' + role, flush=True)
    (directory / 'descriptor.json').write_text(json.dumps(descriptor, sort_keys=True) + '\n')
    validate_directory(directory)
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a', encoding='utf-8') as output:
            output.write(f'source_sha={source}\n')
            if os.environ.get('EXPORT_PUBLICATION_RUN_ID') and os.environ.get('EXPORT_PUBLICATION_ATTEMPT'):
                output.write(f"publication_run_id={os.environ['EXPORT_PUBLICATION_RUN_ID']}\n")
                output.write(f"publication_attempt={os.environ['EXPORT_PUBLICATION_ATTEMPT']}\n")
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
                                stdout=output, stderr=subprocess.PIPE, timeout=1800)
        require(result.returncode == 0)
    descriptor, _ = validate_zip(path, approval['artifact_sha256'], args.output / 'verified')
    verify_provenance(descriptor, approval, token)
    (args.output / 'archive-approval.json').write_text(json.dumps({**approval,
        'runtime_config_id': descriptor['images']['runtime']['config_id'],
        'migration_config_id': descriptor['images']['migration']['config_id'],
        **({'decoder_config_id': descriptor['images']['decoder']['config_id']} if descriptor['version'] == 2 else {})}, sort_keys=True) + '\n')
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
    if args.command == 'produce':
        if os.environ.get('GITHUB_EVENT_NAME') == 'workflow_run':
            images = resolve_automatic_publication()
            produce(expected_event='workflow_run', expected_images=images)
        elif os.environ.get('EXPORT_PUBLICATION_RUN_ID') or os.environ.get('EXPORT_PUBLICATION_ATTEMPT'):
            images = resolve_dispatch_publication()
            produce(expected_event='workflow_dispatch', expected_images=images)
        else:
            produce()
    else:
        download(args)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Image export/archive verification failed; no credential or registry response is logged.', file=sys.stderr)
        sys.exit(1)
