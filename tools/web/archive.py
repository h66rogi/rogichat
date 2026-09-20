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
core.ROLES = {'runtime': 'rogichat-web'}
core.FILES = {'descriptor.json', 'runtime.tar', 'runtime.manifest.json'}

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
validate_directory = core.validate_directory
validate_zip = core.validate_zip
validate_descriptor = core.validate_descriptor
verify_tar = core.verify_tar
require = core.require


def verify_provenance(descriptor, approval, token=None):
    producer = descriptor['producer']
    require(producer['sha'] == approval['export_sha'] and producer['run_id'] == approval['export_run']
            and producer['run_attempt'] == approval['export_attempt'])
    run = core.api(f"actions/runs/{producer['run_id']}/attempts/{producer['run_attempt']}", token)
    core.verify_run(run, producer['sha'], 'web-export.yml', 'workflow_dispatch')
    require(run['run_attempt'] == producer['run_attempt'])
    artifact = core.api(f"actions/artifacts/{approval['artifact_id']}", token)
    require(not artifact['expired'] and artifact['digest'] == approval['artifact_sha256']
            and artifact['workflow_run']['id'] == producer['run_id']
            and artifact['workflow_run']['head_sha'] == producer['sha']
            and artifact['name'] == f"web-{descriptor['source_sha']}-{producer['run_id']}-{producer['run_attempt']}")
    core.verify_source(descriptor['source_sha'], descriptor['verification_runs'], token)
    verify_publication_proof(descriptor, token)
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
    verify_provenance(descriptor, approval, token)
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
    require(len(data) <= 1024**2 and 'sha256:' + core.sha256(data) == expected_digest)
    with zipfile.ZipFile(io.BytesIO(data)) as zipped:
        entries = zipped.infolist()
        require(len(entries) == 1)
        entry = entries[0]
        require(entry.filename == 'web-publication-proof.json' and not entry.is_dir()
                and not entry.flag_bits & 1 and not stat.S_ISLNK(entry.external_attr >> 16) and entry.file_size <= 65536)
        value = json.loads(zipped.read(entry))
    require(type(value) is dict)
    return value


def download_proof(artifact, token):
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
    return proof_zip(data, artifact['digest'])


def timestamp(value):
    result = datetime.fromisoformat(value.replace('Z', '+00:00'))
    require(result.tzinfo is not None)
    return result


def verify_publication_proof(descriptor, token=None):
    source = descriptor['source_sha']
    publication_id = descriptor['verification_runs']['web-publish.yml']
    run = core.api(f'actions/runs/{publication_id}', token)
    core.verify_run(run, source, 'web-publish.yml')
    attempt = run['run_attempt']
    require(type(attempt) is int and attempt > 0)
    producer = descriptor['producer']
    export = core.api(f"actions/runs/{producer['run_id']}/attempts/{producer['run_attempt']}", token)
    # The producer can still be running while it validates its own archive.
    require(export['head_sha'] == producer['sha'] and export['head_branch'] == 'qa'
            and export['event'] == 'workflow_dispatch' and export['path'] == '.github/workflows/web-export.yml'
            and export['repository']['full_name'] == core.REPOSITORY
            and export['head_repository']['full_name'] == core.REPOSITORY
            and export['run_attempt'] == producer['run_attempt'])
    cutoff = timestamp(export['run_started_at'])
    listing = core.api(f'actions/runs/{publication_id}/artifacts?per_page=100', token)
    require(type(listing['artifacts']) is list and listing['total_count'] <= 100)
    name = f'web-publication-proof-{source}-{attempt}'
    candidates = [item for item in listing['artifacts'] if item['name'] == name]
    require(len(candidates) == 1)
    artifact = candidates[0]
    require(not artifact['expired'] and artifact['workflow_run']['id'] == publication_id
            and artifact['workflow_run']['head_sha'] == source)
    # No schema extension: GitHub's immutable artifact creation time fences the
    # proof to the approved export attempt. Later publisher attempts/replacement
    # uploads cannot silently replace evidence after this export began.
    require(timestamp(run['run_started_at']) <= cutoff and timestamp(artifact['created_at']) <= cutoff)
    proof = download_proof(artifact, token)
    image = descriptor['images']['runtime']
    require(proof['schemaVersion'] == 1 and proof['repository'] == core.REPOSITORY
            and proof['sourceSha'] == source and proof['image'] == image['image']
            and proof['checkedImageId'] == image['config_id'] and proof['platform'] == 'linux/amd64'
            and proof['publicationAttempt'] == attempt
            and proof['publicationRun'] == f'https://github.com/{core.REPOSITORY}/actions/runs/{publication_id}'
            and proof['runtimeEnvironmentsVerified'] == ['qa', 'production'])
    verification = proof['verification']
    require(type(verification) is list and len(verification) == 5)
    expected = {name: identity for name, identity in descriptor['verification_runs'].items() if name != 'web-publish.yml'}
    require({item['workflow']: item['id'] for item in verification} == expected
            and all(item['sha'] == source for item in verification))


def produce():
    # The GitHub token stays in memory; core removes it from subprocess env and
    # destroys its isolated registry config before saving the archive.
    token = os.environ['GITHUB_TOKEN']
    core.produce()
    directory = Path(os.environ['RUNNER_TEMP']) / 'rogichat-export'
    descriptor, _ = validate_directory(directory)
    verify_publication_proof(descriptor, token)
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
