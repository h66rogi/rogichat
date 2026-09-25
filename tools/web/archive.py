#!/usr/bin/env python3
"""Trusted web image export using the reviewed backend archive verification core.

The isolated module instance preserves the backend tool's own policy unchanged.
No build, host registry credentials, Docker load, or deployment is performed.
"""
from __future__ import annotations
import argparse
from datetime import datetime
import io
import importlib.util
import json
import os
import stat
from pathlib import Path
import subprocess
import sys
import urllib.parse
import urllib.request
import zipfile

spec = importlib.util.spec_from_file_location('rogichat_web_archive_core', Path(__file__).resolve().parents[1] / 'operations/backend_archive.py')
core = importlib.util.module_from_spec(spec)
spec.loader.exec_module(core)
core.WORKFLOWS = {'web.yml', 'backend.yml', 'security.yml', 'infrastructure.yml', 'mobile.yml', 'web-publish.yml'}
core.NEW_PUBLICATION_WORKFLOW = 'qa-web-publication.yml'
core.NEW_PUBLICATION_NAME = 'QA web image publication'
core.NEW_WORKFLOWS = core.FIVE_QA_WORKFLOWS | {core.NEW_PUBLICATION_WORKFLOW}
core.PUBLICATION_JOB = 'Web publication result'
core.ROLES = {'runtime': 'rogichat-web'}
IMAGE_FILES = {'descriptor.json', 'runtime.tar', 'runtime.manifest.json'}
PROOF_FILE = 'publication-proof.zip'
PROOF_LIMIT = 1024**2
core.FILES = IMAGE_FILES | {PROOF_FILE}

_original_validate_config = core.validate_config


def validate_config(config, source):
    _original_validate_config(config, source)
    settings = config['config']
    core.require(settings['Cmd'] == ['server.js'] and settings['WorkingDir'] == '/app/apps/web'
                 and '3000/tcp' in settings['ExposedPorts'])
    env = dict(entry.split('=', 1) for entry in settings.get('Env', []))
    core.require(env.get('NODE_ENV') == 'production' and env.get('PORT') == '3000'
                 and env.get('HOSTNAME') == '0.0.0.0')
    core.require(not any(key.startswith('ROGICHAT_') or key.startswith('NEXT_PUBLIC_') for key in env))


core.validate_config = validate_config
# Consumers can verify immutable manifest, config, archive and OCI identities offline.
_validate_directory = core.validate_directory
_validate_descriptor = core.validate_descriptor
PRODUCER_EVENTS = frozenset({'workflow_dispatch', 'workflow_run'})


def validate_descriptor(value):
    result = _validate_descriptor(value, producer_events=PRODUCER_EVENTS)
    require(all(type(identity) is int and identity > 0 for identity in result['verification_runs'].values()))
    require(len(set(result['verification_runs'].values())) == len(core.WORKFLOWS))
    return result


core.validate_descriptor = validate_descriptor
verify_tar = core.verify_tar
require = core.require


def read_proof(directory):
    path = directory / PROOF_FILE
    require(path.is_file() and not path.is_symlink() and path.stat().st_size <= PROOF_LIMIT)
    with path.open('rb') as source:
        data = source.read(PROOF_LIMIT + 1)
    parse_proof_zip(data)
    return data


def validate_directory(directory):
    read_proof(directory)
    return _validate_directory(directory)


# The isolated backend instance resolves this adapter after safe ZIP extraction.
core.validate_directory = validate_directory


def validate_zip(path, expected_digest, directory):
    try:
        with zipfile.ZipFile(path) as zipped:
            entries = [item for item in zipped.infolist() if item.filename == PROOF_FILE]
            require(len(entries) == 1 and entries[0].file_size <= PROOF_LIMIT)
    except zipfile.BadZipFile as error:
        raise ValueError('Invalid web export ZIP') from error
    return core.validate_zip(path, expected_digest, directory)


def verify_provenance(descriptor, approval, token=None, *, publication_proof=None, required_event=None):
    require(type(publication_proof) is bytes and len(publication_proof) <= PROOF_LIMIT)
    validate_descriptor(descriptor)
    for field in ('export_run', 'export_attempt', 'artifact_id'):
        positive_id(approval[field])
    producer = descriptor['producer']
    require(required_event is None or required_event in PRODUCER_EVENTS)
    require(required_event is None or producer['event'] == required_event)
    require(producer['sha'] == approval['export_sha'] and producer['run_id'] == approval['export_run']
            and producer['run_attempt'] == approval['export_attempt'])
    run = core.api(f"actions/runs/{producer['run_id']}/attempts/{producer['run_attempt']}", token)
    core.verify_run(run, producer['sha'], 'web-export.yml', producer['event'])
    exact_identity(run, producer['run_id'], producer['run_attempt'])
    artifact = core.api(f"actions/artifacts/{approval['artifact_id']}", token)
    require(not artifact['expired'] and artifact['digest'] == approval['artifact_sha256']
            and type(artifact['workflow_run']['id']) is int and artifact['workflow_run']['id'] == producer['run_id']
            and artifact['workflow_run']['head_sha'] == producer['sha']
            and artifact['name'] == f"web-{descriptor['source_sha']}-{producer['run_id']}-{producer['run_attempt']}")
    verify_publication_proof(descriptor, token, publication_proof=publication_proof)
    compare = core.api(f"compare/{descriptor['source_sha']}...{producer['sha']}", token)
    require(compare['status'] in ('ahead', 'identical') and compare['merge_base_commit']['sha'] == descriptor['source_sha'])


def download(args):
    token = core.command(['gh', 'auth', 'token']).decode().strip()
    require(core.SHA.fullmatch(args.export_sha) and args.run_id > 0 and args.attempt > 0 and args.artifact_id > 0)
    artifact = core.api(f'actions/artifacts/{args.artifact_id}', token)
    approval = {'export_sha': args.export_sha, 'export_run': args.run_id, 'export_attempt': args.attempt,
                'artifact_id': args.artifact_id, 'artifact_sha256': artifact['digest']}
    require(not args.output.exists())
    args.output.mkdir(mode=0o700)
    path = args.output / 'export.zip'
    with path.open('xb') as output:
        result = subprocess.run(['gh', 'api', f'/repos/{core.REPOSITORY}/actions/artifacts/{args.artifact_id}/zip'],
                                stdout=output, stderr=subprocess.PIPE, timeout=1800)
        require(result.returncode == 0)
    descriptor, configs = validate_zip(path, approval['artifact_sha256'], args.output / 'verified')
    verify_provenance(descriptor, approval, token, publication_proof=read_proof(args.output / 'verified'))
    archive_manifest = configs['runtime']['_archive_manifest']
    (args.output / 'archive-approval.json').write_text(json.dumps({**approval,
        'runtime_config_id': descriptor['images']['runtime']['config_id'],
        'runtime_archive_manifest': archive_manifest}, sort_keys=True) + '\n')
    print('Trusted web artifact, registry manifest, image config and rootfs verified; not loaded or deployed.')


class SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        target = urllib.parse.urlsplit(new_url)
        require(target.scheme == 'https' and not target.username and not target.password)
        redirected = super().redirect_request(request, response, code, message, headers, new_url)
        if redirected and target.netloc != urllib.parse.urlsplit(request.full_url).netloc:
            redirected.remove_header('Authorization')
        return redirected


def proof_zip(data, expected_digest):
    require(type(data) is bytes and len(data) <= PROOF_LIMIT
            and 'sha256:' + core.sha256(data) == expected_digest)
    return parse_proof_zip(data)


def parse_proof_zip(data):
    require(type(data) is bytes and len(data) <= PROOF_LIMIT)
    with zipfile.ZipFile(io.BytesIO(data)) as zipped:
        entries = zipped.infolist()
        require(len(entries) == 1)
        entry = entries[0]
        require(entry.filename == 'web-publication-proof.json' and not entry.is_dir()
                and not entry.flag_bits & 1 and not stat.S_ISLNK(entry.external_attr >> 16)
                and (not stat.S_IFMT(entry.external_attr >> 16) or stat.S_ISREG(entry.external_attr >> 16))
                and entry.file_size <= 65536)
        value = json.loads(zipped.read(entry))
    require(type(value) is dict)
    return value


def download_proof(artifact, token):
    require(type(token) is str and bool(token))
    artifact_id = artifact['id']
    require(type(artifact_id) is int and artifact_id > 0)
    headers = {'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    request = urllib.request.Request(f'https://api.github.com/repos/{core.REPOSITORY}/actions/artifacts/{artifact_id}/zip', headers=headers)
    with urllib.request.build_opener(SafeRedirect()).open(request, timeout=30) as response:
        if response.headers.get('Content-Length'):
            require(int(response.headers['Content-Length']) <= 1024**2)
        data = response.read(1024**2 + 1)
    proof_zip(data, artifact['digest'])
    return data


def timestamp(value):
    result = datetime.fromisoformat(value.replace('Z', '+00:00'))
    require(result.tzinfo is not None)
    return result


def positive_id(value):
    require(type(value) is int and value > 0)
    return value


def exact_identity(run, identity, attempt):
    positive_id(identity)
    positive_id(attempt)
    require(type(run['id']) is int and run['id'] == identity
            and type(run['run_attempt']) is int and run['run_attempt'] == attempt)


def exact_run(identity, attempt, source, workflow, token=None):
    positive_id(identity)
    positive_id(attempt)
    run = core.api(f'actions/runs/{identity}/attempts/{attempt}', token)
    exact_identity(run, identity, attempt)
    if workflow == core.NEW_PUBLICATION_WORKFLOW:
        core.verify_publication_run(run, source, token)
    else:
        core.verify_run(run, source, workflow)
    return run


def publication_workflow(descriptor):
    runs = descriptor['verification_runs']
    if set(runs) in ({'web-publish.yml'}, core.WORKFLOWS):
        return 'web-publish.yml'
    require(set(runs) in ({core.NEW_PUBLICATION_WORKFLOW}, core.NEW_WORKFLOWS))
    return core.NEW_PUBLICATION_WORKFLOW


def export_attempt(producer, token=None):
    positive_id(producer['run_id'])
    positive_id(producer['run_attempt'])
    require(producer['event'] in PRODUCER_EVENTS)
    export = core.api(f"actions/runs/{producer['run_id']}/attempts/{producer['run_attempt']}", token)
    exact_identity(export, producer['run_id'], producer['run_attempt'])
    # A producer verifies itself while still running; consumers separately require success.
    require(export['head_sha'] == producer['sha'] and export['head_branch'] == 'qa'
            and export['event'] == producer['event'] and export['path'] == '.github/workflows/web-export.yml'
            and export['repository']['full_name'] == core.REPOSITORY
            and export['head_repository']['full_name'] == core.REPOSITORY)
    return export


def publication_artifact(descriptor, token=None, *, attempt):
    source = descriptor['source_sha']
    workflow = publication_workflow(descriptor)
    publication_id = descriptor['verification_runs'][workflow]
    run = exact_run(publication_id, attempt, source, workflow, token)
    export = export_attempt(descriptor['producer'], token)
    cutoff = timestamp(export['run_started_at'])
    listing = core.api(f'actions/runs/{publication_id}/artifacts?per_page=100', token)
    require(type(listing['artifacts']) is list and type(listing['total_count']) is int
            and 0 <= listing['total_count'] <= 100 and len(listing['artifacts']) == listing['total_count'])
    name = f'web-publication-proof-{source}-{attempt}'
    candidates = [item for item in listing['artifacts'] if item['name'] == name]
    require(len(candidates) == 1)
    artifact = candidates[0]
    positive_id(artifact['id'])
    require(not artifact['expired'] and type(artifact['workflow_run']['id']) is int
            and artifact['workflow_run']['id'] == publication_id
            and artifact['workflow_run']['head_sha'] == source)
    # Exact historical attempts remain valid, but replacement proof uploads do not.
    require(timestamp(run['run_started_at']) <= cutoff and timestamp(artifact['created_at']) <= cutoff)
    return artifact, attempt


def verify_publication_proof(descriptor, token=None, *, publication_proof=None):
    require(type(publication_proof) is bytes and len(publication_proof) <= PROOF_LIMIT)
    proof = parse_proof_zip(publication_proof)
    attempt = positive_id(proof['publicationAttempt'])
    artifact, _ = publication_artifact(descriptor, token, attempt=attempt)
    proof_zip(publication_proof, artifact['digest'])
    source = descriptor['source_sha']
    workflow = publication_workflow(descriptor)
    publication_id = descriptor['verification_runs'][workflow]
    image = descriptor['images']['runtime']
    require(type(proof['schemaVersion']) is int and proof['schemaVersion'] == 1
            and proof['repository'] == core.REPOSITORY
            and proof['sourceSha'] == source and proof['image'] == image['image']
            and proof['checkedImageId'] == image['config_id'] and proof['platform'] == 'linux/amd64'
            and proof['publicationRun'] == f'https://github.com/{core.REPOSITORY}/actions/runs/{publication_id}'
            and proof['runtimeEnvironmentsVerified'] == ['qa', 'production'])
    verification = proof['verification']
    require(type(verification) is list and len(verification) == 5)
    expected = {name: identity for name, identity in descriptor['verification_runs'].items() if name != workflow}
    require(set(expected) == core.FIVE_QA_WORKFLOWS
            and {item['workflow'] for item in verification} == set(expected)
            and len({positive_id(item['id']) for item in verification}) == 5)
    for item in verification:
        require(item['id'] == expected[item['workflow']] and item['sha'] == source)
        exact_run(item['id'], item['attempt'], source, item['workflow'], token)
    return proof


def resolve_publication(token):
    event = os.environ['GITHUB_EVENT_NAME']
    require(event in PRODUCER_EVENTS and os.environ['GITHUB_REPOSITORY'] == core.REPOSITORY
            and os.environ['GITHUB_REF'] == 'refs/heads/qa')
    producer = {'sha': os.environ['GITHUB_SHA'], 'run_id': int(os.environ['GITHUB_RUN_ID']),
                'run_attempt': int(os.environ['GITHUB_RUN_ATTEMPT']), 'event': event, 'ref': 'refs/heads/qa'}
    require(core.SHA.fullmatch(producer['sha']))
    if event == 'workflow_run':
        path = Path(os.environ['GITHUB_EVENT_PATH'])
        require(path.stat().st_size <= 1024**2)
        payload = json.loads(path.read_bytes())
        require(payload['action'] == 'completed' and payload['repository']['full_name'] == core.REPOSITORY)
        supplied = payload['workflow_run']
        source = supplied['head_sha']
        require(core.SHA.fullmatch(source))
        workflow = supplied['path'].removeprefix('.github/workflows/')
        require(workflow in {'web-publish.yml', core.NEW_PUBLICATION_WORKFLOW})
        if workflow == core.NEW_PUBLICATION_WORKFLOW:
            core.verify_publication_run(supplied, source, token)
        else:
            core.verify_run(supplied, source, workflow)
        identity, attempt = positive_id(supplied['id']), positive_id(supplied['run_attempt'])
    else:
        source = os.environ['EXPORT_SOURCE_SHA']
        require(core.SHA.fullmatch(source) and core.HEX.fullmatch(os.environ['EXPORT_RUNTIME_DIGEST']))
        supplied_id = os.environ.get('EXPORT_PUBLICATION_RUN_ID', '')
        supplied_attempt = os.environ.get('EXPORT_PUBLICATION_ATTEMPT', '')
        if supplied_id or supplied_attempt:
            require(supplied_id.isdecimal() and supplied_attempt.isdecimal())
            identity, attempt = positive_id(int(supplied_id)), positive_id(int(supplied_attempt))
            workflow = core.NEW_PUBLICATION_WORKFLOW
            exact_run(identity, attempt, source, workflow, token)
        else:
            workflow = 'web-publish.yml'
            candidates = core.api(f'actions/workflows/web-publish.yml/runs?branch=qa&event=push&head_sha={source}&per_page=20', token)['workflow_runs']
            require(type(candidates) is list and 0 < len(candidates) <= 20)
            selected = candidates[0]
            core.verify_run(selected, source, workflow)
            identity, attempt = positive_id(selected['id']), positive_id(selected['run_attempt'])
    descriptor = {'version': 1, 'repository': core.REPOSITORY, 'source_sha': source,
                  'producer': producer, 'verification_runs': {workflow: identity}, 'images': {}}
    artifact, _ = publication_artifact(descriptor, token, attempt=attempt)
    data = download_proof(artifact, token)
    proof = proof_zip(data, artifact['digest'])
    require(type(proof['verification']) is list and len(proof['verification']) == 5)
    descriptor['verification_runs'].update({item['workflow']: positive_id(item['id']) for item in proof['verification']})
    descriptor['images']['runtime'] = {'image': proof['image'], 'config_id': proof['checkedImageId'], 'archive_sha256': '0' * 64}
    validate_descriptor(descriptor)
    require(proof['publicationAttempt'] == attempt)
    verify_publication_proof(descriptor, token, publication_proof=data)
    compare = core.api(f"compare/{source}...{producer['sha']}", token)
    require(compare['status'] in ('ahead', 'identical') and compare['merge_base_commit']['sha'] == source)
    if event == 'workflow_dispatch':
        require(proof['image'].split('@sha256:')[1] == os.environ['EXPORT_RUNTIME_DIGEST'])
    return descriptor, data


def produce():
    # Resolve and validate the original proof and all exact attempts BEFORE any pull.
    token = os.environ['GITHUB_TOKEN']
    expected, publication_proof = resolve_publication(token)
    os.environ['EXPORT_SOURCE_SHA'] = expected['source_sha']
    os.environ['EXPORT_RUNTIME_DIGEST'] = expected['images']['runtime']['image'].split('@sha256:')[1]
    producer_spec = importlib.util.spec_from_file_location('rogichat_web_image_producer', spec.origin)
    producer_core = importlib.util.module_from_spec(producer_spec)
    producer_spec.loader.exec_module(producer_core)
    producer_core.WORKFLOWS = core.WORKFLOWS.copy()
    producer_core.PUBLICATION_JOB = core.PUBLICATION_JOB
    producer_core.ROLES = core.ROLES.copy()
    producer_core.FILES = IMAGE_FILES.copy()
    producer_core.validate_config = validate_config
    producer_core.validate_descriptor = validate_descriptor
    producer_core.produce(expected_event=expected['producer']['event'], verification_runs=expected['verification_runs'])
    directory = Path(os.environ['RUNNER_TEMP']) / 'rogichat-export'
    descriptor = validate_descriptor(json.loads((directory / 'descriptor.json').read_bytes()))
    require(descriptor['source_sha'] == expected['source_sha'] and descriptor['producer'] == expected['producer']
            and descriptor['verification_runs'] == expected['verification_runs'])
    verify_publication_proof(descriptor, token, publication_proof=publication_proof)
    with (directory / PROOF_FILE).open('xb') as output:
        output.write(publication_proof)
    validate_directory(directory)
    with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
        output.write(f"source_sha={descriptor['source_sha']}\n")
    del token
    print('Archive digest and config match the exact pre-existing trusted publication proof.')


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
        print('Web image export verification failed; no credential or registry response is logged.', file=sys.stderr)
        sys.exit(1)
