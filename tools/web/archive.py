#!/usr/bin/env python3
"""Trusted web image export using the reviewed backend archive verification core.

The isolated module instance preserves the backend tool's own policy unchanged.
No build, host registry credentials, Docker load, or deployment is performed.
"""
from __future__ import annotations
import argparse
import importlib.util
import json
from pathlib import Path
import subprocess
import sys

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
    core.produce() if args.command == 'produce' else download(args)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Web image export verification failed; no credential or registry response is logged.', file=sys.stderr)
        sys.exit(1)
