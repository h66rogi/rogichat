#!/usr/bin/env python3
"""Request one missing web export from a successful, proof-bound QA publication.

This scheduled job only dispatches the existing export workflow. It never loads
an image on a host or changes a deployment.
"""
from __future__ import annotations

from datetime import datetime, timezone
import importlib.util
import json
import os
from pathlib import Path
import re
import sys
import urllib.request


SPEC = importlib.util.spec_from_file_location(
    'rogichat_qa_web_export_recovery_archive',
    Path(__file__).resolve().parents[1] / 'web/archive.py')
archive = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(archive)

REPOSITORY = 'h66rogi/rogichat'
PUBLISHED_MARKER = 'qa-web-published-base'
EXPORTED_PREFIX = 'qa-web-exported-'
PUBLICATION_WORKFLOW = 'qa-web-publication.yml'
EXPORT_WORKFLOW = 'web-export.yml'
SHA = re.compile(r'[a-f0-9]{40}\Z')
HEX = re.compile(r'[a-f0-9]{64}\Z')
REQUIRED_JOBS = {
    'web.yml': 'Web required checks',
    'backend.yml': 'verify',
    'security.yml': 'Public repository guard',
    'infrastructure.yml': 'validate',
    'mobile.yml': 'Mobile required checks',
}


def require(value):
    if not value:
        raise ValueError('QA web export recovery rejected')


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
    # A fixed-name marker discovers candidates; the run, aggregate job and
    # original proof are verified separately. The first page is a bounded
    # recovery window, not evidence that older pages contain no newer run ID.
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
    marker = max(values, key=lambda item: item['workflow_run']['id'])
    source = marker['workflow_run'].get('head_sha')
    run_id = marker['workflow_run']['id']
    require(type(source) is str and SHA.fullmatch(source)
            and run_id > 0 and type(marker.get('digest')) is str
            and re.fullmatch(r'sha256:[a-f0-9]{64}', marker['digest']))
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
        require(run.get('id') == run_id
                and run.get('head_sha') == marker['workflow_run'].get('head_sha')
                and run.get('head_branch') == 'qa'
                and run.get('path') == f'.github/workflows/{EXPORT_WORKFLOW}'
                and run.get('event') in ('workflow_run', 'workflow_dispatch')
                and run.get('repository', {}).get('full_name') == REPOSITORY
                and run.get('head_repository', {}).get('full_name') == REPOSITORY)
        if run.get('status') != 'completed' or run.get('conclusion') != 'success':
            continue
        attempt = run.get('run_attempt')
        require(type(attempt) is int and attempt > 0)
        artifacts = artifact_page(get(f'actions/runs/{run_id}/artifacts?per_page=100'))
        archive_name = f'web-{source}-{run_id}-{attempt}'
        if any(item.get('name') == archive_name and item.get('expired') is False
               and item.get('workflow_run', {}).get('id') == run_id
               and item.get('workflow_run', {}).get('head_sha') == run['head_sha']
               for item in artifacts):
            return True
    return False


def export_in_flight(get, source):
    title = 'Web export ' + source
    for status in ('queued', 'in_progress'):
        result = get(f'actions/workflows/{EXPORT_WORKFLOW}/runs?branch=qa&status={status}&per_page=100')
        require(type(result) is dict and type(result.get('total_count')) is int
                and 0 <= result['total_count'] <= 100
                and type(result.get('workflow_runs')) is list
                and len(result['workflow_runs']) == result['total_count'])
        for run in result['workflow_runs']:
            require(type(run) is dict and run.get('status') == status
                    and run.get('head_branch') == 'qa'
                    and run.get('path') == f'.github/workflows/{EXPORT_WORKFLOW}'
                    and run.get('repository', {}).get('full_name') == REPOSITORY)
            if run.get('display_title') == title:
                require(run.get('event') in ('workflow_run', 'workflow_dispatch')
                        and run.get('head_repository', {}).get('full_name') == REPOSITORY)
                return True
    return False


def publication_proof(source, run_id, attempt, cutoff, token):
    run = archive.exact_run(run_id, attempt, source, PUBLICATION_WORKFLOW, token)
    listing = artifact_page(archive.core.api(f'actions/runs/{run_id}/artifacts?per_page=100', token))
    name = f'web-publication-proof-{source}-{attempt}'
    matches = [item for item in listing if item.get('name') == name]
    require(len(matches) == 1)
    artifact = matches[0]
    require(type(artifact.get('id')) is int and artifact['id'] > 0
            and artifact.get('expired') is False
            and type(artifact.get('digest')) is str
            and re.fullmatch(r'sha256:[a-f0-9]{64}', artifact['digest'])
            and artifact.get('workflow_run', {}).get('id') == run_id
            and artifact['workflow_run'].get('head_sha') == source
            and archive.timestamp(run['run_started_at']) <= archive.timestamp(artifact['created_at'])
            and archive.timestamp(artifact['created_at']) <= archive.timestamp(cutoff))
    proof = archive.proof_zip(archive.download_proof(artifact, token), artifact['digest'])
    image = proof.get('image')
    prefix = 'ghcr.io/h66rogi/rogichat-web@sha256:'
    require(type(proof.get('schemaVersion')) is int and proof['schemaVersion'] == 1
            and proof.get('repository') == REPOSITORY and proof.get('sourceSha') == source
            and proof.get('publicationRun') == f'https://github.com/{REPOSITORY}/actions/runs/{run_id}'
            and type(proof.get('publicationAttempt')) is int
            and proof['publicationAttempt'] == attempt
            and proof.get('platform') == 'linux/amd64'
            and proof.get('runtimeEnvironmentsVerified') == ['qa', 'production']
            and type(image) is str and image.startswith(prefix)
            and HEX.fullmatch(image[len(prefix):])
            and type(proof.get('checkedImageId')) is str
            and re.fullmatch(r'sha256:[a-f0-9]{64}', proof['checkedImageId']))
    evidence = proof.get('verification')
    require(type(evidence) is list and len(evidence) == len(REQUIRED_JOBS)
            and {item.get('workflow') for item in evidence if type(item) is dict} == set(REQUIRED_JOBS))
    for item in evidence:
        workflow = item['workflow']
        required = REQUIRED_JOBS[workflow]
        run_id_check, attempt_check, job_id = item.get('id'), item.get('attempt'), item.get('jobId')
        require(item.get('job') == required and item.get('sha') == source
                and all(type(value) is int and value > 0 for value in
                        (run_id_check, attempt_check, job_id)))
        archive.exact_run(run_id_check, attempt_check, source, workflow, token)
        jobs = archive.core.api(
            f'actions/runs/{run_id_check}/attempts/{attempt_check}/jobs?per_page=100', token)
        require(type(jobs.get('total_count')) is int and 0 < jobs['total_count'] <= 100
                and type(jobs.get('jobs')) is list and len(jobs['jobs']) == jobs['total_count'])
        matches = [job for job in jobs['jobs'] if job.get('name') == required]
        require(len(matches) == 1 and matches[0].get('id') == job_id
                and matches[0].get('run_id') == run_id_check
                and matches[0].get('run_attempt') == attempt_check
                and matches[0].get('status') == 'completed'
                and matches[0].get('conclusion') == 'success')
    return proof


def select(token, expected_head, *, get=None, proof_reader=None):
    require(type(token) is str and bool(token) and type(expected_head) is str
            and SHA.fullmatch(expected_head))
    get = get or (lambda path: archive.core.api(path, token))
    proof_reader = proof_reader or publication_proof
    if ref_sha(get) != expected_head:
        return None
    selected = source_marker(get)
    if selected is None:
        return None
    marker, source, run_id = selected
    run = get(f'actions/runs/{run_id}')
    attempt = run.get('run_attempt')
    require(run.get('id') == run_id and type(attempt) is int and attempt > 0
            and run.get('head_sha') == source
            and archive.timestamp(run['run_started_at']) <= archive.timestamp(marker['created_at']))
    comparison = get(f'compare/{source}...{expected_head}')
    require(comparison.get('status') in ('ahead', 'identical')
            and comparison.get('merge_base_commit', {}).get('sha') == source)
    if exported(get, source) or export_in_flight(get, source):
        return None
    cutoff = datetime.now(timezone.utc).isoformat(timespec='microseconds').replace('+00:00', 'Z')
    proof = proof_reader(source, run_id, attempt, cutoff, token)
    require(type(proof) is dict and proof.get('sourceSha') == source
            and proof.get('publicationAttempt') == attempt
            and proof.get('publicationRun') == f'https://github.com/{REPOSITORY}/actions/runs/{run_id}')
    image = proof.get('image')
    prefix = 'ghcr.io/h66rogi/rogichat-web@sha256:'
    require(type(image) is str and image.startswith(prefix) and HEX.fullmatch(image[len(prefix):]))
    require(ref_sha(get) == expected_head)
    return {'source_sha': source, 'runtime_digest': image[len(prefix):],
            'publication_run_id': str(run_id), 'publication_attempt': str(attempt)}


def dispatch(token, inputs, *, opener=urllib.request.urlopen):
    require(type(inputs) is dict and set(inputs) == {'source_sha', 'runtime_digest',
            'publication_run_id', 'publication_attempt'}
            and SHA.fullmatch(inputs['source_sha'])
            and HEX.fullmatch(inputs['runtime_digest'])
            and inputs['publication_run_id'].isdecimal()
            and inputs['publication_attempt'].isdecimal())
    request = urllib.request.Request(
        f'https://api.github.com/repos/{REPOSITORY}/actions/workflows/{EXPORT_WORKFLOW}/dispatches',
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
            print('No unexported verified QA web publication selected.')
            return 0
        dispatch(token, inputs)
        print('Verified QA web export recovery requested for ' + inputs['source_sha'][:12] + '.')
        return 0
    except Exception:
        print('QA web export recovery rejected; no export was requested.', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
