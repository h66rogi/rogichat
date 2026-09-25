#!/usr/bin/env python3
"""Recover one missed QA backend export from immutable publication evidence.

This scheduled job only requests the existing verified export workflow. It never
downloads a runtime image to a host or changes a deployment.
"""
from __future__ import annotations

from datetime import datetime, timezone
import json
import os
import re
import sys
import urllib.request

import backend_archive as archive


REPOSITORY = 'h66rogi/rogichat'
PUBLISHED_MARKER = 'qa-backend-published-base'
EXPORTED_PREFIX = 'qa-backend-exported-'
SHA = re.compile(r'[0-9a-f]{40}\Z')
HEX = re.compile(r'[0-9a-f]{64}\Z')


def require(value):
    if not value:
        raise ValueError('QA backend export recovery rejected')


def artifact_page(value):
    require(type(value) is dict and type(value.get('total_count')) is int
            and value['total_count'] >= 0 and type(value.get('artifacts')) is list
            and len(value['artifacts']) == min(value['total_count'], 100))
    return value['artifacts']


def ref_sha(get):
    value = get('git/ref/heads/qa')
    sha = value.get('object', {}).get('sha')
    require(type(sha) is str and SHA.fullmatch(sha))
    return sha


def source_marker(get):
    # Overwrite is per workflow run, so many fixed-name markers coexist. The
    # latest 100 marker uploads cover the 50 concurrent publication cohort;
    # choose the highest originating run ID because older runs can finish late.
    values = artifact_page(get(f'actions/artifacts?name={PUBLISHED_MARKER}&per_page=100'))
    values = [item for item in values if item.get('name') == PUBLISHED_MARKER
              and item.get('expired') is False]
    if not values:
        return None
    require(all(type(item.get('id')) is int and item['id'] > 0
                and type(item.get('workflow_run')) is dict
                and type(item['workflow_run'].get('id')) is int
                and type(item.get('created_at')) is str for item in values)
            and len({item['id'] for item in values}) == len(values))
    values.sort(key=lambda item: item['workflow_run']['id'], reverse=True)
    marker = values[0]
    source = marker.get('workflow_run', {}).get('head_sha')
    run_id = marker.get('workflow_run', {}).get('id')
    require(type(source) is str and SHA.fullmatch(source)
            and marker['name'] == PUBLISHED_MARKER
            and type(run_id) is int and run_id > 0
            and type(marker.get('digest')) is str
            and re.fullmatch(r'sha256:[0-9a-f]{64}', marker['digest']))
    return marker, source, run_id


def exported(get, source):
    name = EXPORTED_PREFIX + source
    values = artifact_page(get(f'actions/artifacts?name={name}&per_page=100'))
    for marker in values:
        if marker.get('name') != name or marker.get('expired') is not False:
            continue
        run_id = marker.get('workflow_run', {}).get('id')
        require(type(run_id) is int and run_id > 0)
        run = get(f'actions/runs/{run_id}')
        require(run.get('id') == run_id and run.get('head_sha') == marker['workflow_run'].get('head_sha')
                and run.get('head_branch') == 'qa' and run.get('path') == '.github/workflows/backend-export.yml'
                and run.get('event') in ('workflow_run', 'workflow_dispatch')
                and run.get('repository', {}).get('full_name') == REPOSITORY
                and run.get('head_repository', {}).get('full_name') == REPOSITORY)
        if run.get('status') == 'completed' and run.get('conclusion') == 'success':
            return True
    return False


def export_in_flight(get, source):
    title = 'Backend export ' + source
    for status in ('queued', 'in_progress'):
        result = get(f'actions/workflows/backend-export.yml/runs?branch=qa&status={status}&per_page=100')
        require(type(result) is dict and type(result.get('total_count')) is int
                and 0 <= result['total_count'] <= 100
                and type(result.get('workflow_runs')) is list
                and len(result['workflow_runs']) == result['total_count'])
        for run in result['workflow_runs']:
            require(type(run) is dict and run.get('status') == status
                    and run.get('head_branch') == 'qa'
                    and run.get('path') == '.github/workflows/backend-export.yml'
                    and run.get('repository', {}).get('full_name') == REPOSITORY)
            if run.get('display_title') == title:
                return True
    return False


def select(token, expected_head, *, get=None, verify=None, proof_reader=None):
    require(type(token) is str and bool(token) and type(expected_head) is str
            and SHA.fullmatch(expected_head))
    get = get or (lambda path: archive.api(path, token))
    verify = verify or archive.verify_publication_run
    proof_reader = proof_reader or archive.publication_proof
    if ref_sha(get) != expected_head:
        return None
    selected = source_marker(get)
    if selected is None:
        return None
    marker, source, run_id = selected
    run = get(f'actions/runs/{run_id}')
    require(run.get('id') == run_id and type(run.get('run_attempt')) is int
            and run['run_attempt'] > 0 and run.get('head_sha') == source
            and archive.timestamp(run['run_started_at']) <= archive.timestamp(marker['created_at']))
    verify(run, source, token)
    comparison = get(f'compare/{source}...{expected_head}')
    require(comparison.get('status') in ('ahead', 'identical')
            and comparison.get('merge_base_commit', {}).get('sha') == source)
    if exported(get, source):
        return None
    if export_in_flight(get, source):
        return None
    now = datetime.now(timezone.utc).isoformat(timespec='microseconds').replace('+00:00', 'Z')
    proof, digest = proof_reader(source, run_id, run['run_attempt'], now, token,
                                 return_digest=True)
    require(proof.get('sourceSha') == source and proof.get('publicationAttempt') == run['run_attempt']
            and proof.get('publicationRun') == f'https://github.com/{REPOSITORY}/actions/runs/{run_id}'
            and type(digest) is str and re.fullmatch(r'sha256:[0-9a-f]{64}', digest)
            and set(proof.get('images', {})) == {'runtime', 'migration', 'decoder'})
    images = {}
    for role, name in [('runtime', 'rogichat-api'), ('migration', 'rogichat-api-migration'),
                       ('decoder', 'rogichat-media-decoder')]:
        image = proof['images'][role].get('image')
        prefix = f'ghcr.io/h66rogi/{name}@sha256:'
        require(type(image) is str and image.startswith(prefix) and HEX.fullmatch(image[len(prefix):]))
        images[role + '_digest'] = image[len(prefix):]
    require(ref_sha(get) == expected_head)
    return {'source_sha': source, **images, 'publication_run_id': str(run_id),
            'publication_attempt': str(run['run_attempt']), 'publication_proof_digest': digest}


def dispatch(token, inputs, *, opener=urllib.request.urlopen):
    require(type(inputs) is dict and set(inputs) == {'source_sha', 'runtime_digest',
            'migration_digest', 'decoder_digest', 'publication_run_id',
            'publication_attempt', 'publication_proof_digest'})
    request = urllib.request.Request(
        f'https://api.github.com/repos/{REPOSITORY}/actions/workflows/backend-export.yml/dispatches',
        data=json.dumps({'ref': 'qa', 'inputs': inputs}, sort_keys=True).encode(),
        headers={'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json',
                 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json'},
        method='POST')
    with opener(request, timeout=15) as response:
        require(response.status == 204)


def main():
    try:
        require(os.environ.get('GITHUB_EVENT_NAME') == 'schedule'
                and os.environ.get('GITHUB_REPOSITORY') == REPOSITORY
                and os.environ.get('GITHUB_REF') == 'refs/heads/qa')
        token = os.environ['GH_TOKEN']
        head = os.environ['GITHUB_SHA']
        inputs = select(token, head)
        if inputs is None:
            print('No unexported verified QA backend publication selected.')
            return 0
        dispatch(token, inputs)
        print('Verified QA backend export recovery requested for ' + inputs['source_sha'][:12] + '.')
        return 0
    except Exception:
        print('QA backend export recovery rejected; no export was requested.', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
