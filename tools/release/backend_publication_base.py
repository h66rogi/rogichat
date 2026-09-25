#!/usr/bin/env python3
"""Find the last proven QA backend publication for cumulative change detection.

An uncertain lookup returns the all-zero base. changes.py treats that as an
unknown comparison and rebuilds the backend; it never skips an uncertain source.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
import json
import os
import re
import subprocess
import sys
from urllib.request import Request, urlopen


REPOSITORY = 'h66rogi/rogichat'
WORKFLOW = '.github/workflows/backend-publish.yml'
ARTIFACT = 'backend-published'
ZERO = '0' * 40
SHA = re.compile(r'[a-f0-9]{40}\Z')
MAX_VERIFIED = 3  # One artifact listing plus at most six run/job requests.


def timestamp(value: object) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError:
        return None
    return parsed if parsed.tzinfo is not None else None


def trusted_artifact(artifact: object, now: datetime) -> tuple[int, str, datetime] | None:
    if not isinstance(artifact, dict) or artifact.get('name') != ARTIFACT or artifact.get('expired') is not False:
        return None
    if type(artifact.get('id')) is not int or artifact['id'] <= 0:
        return None
    if type(artifact.get('size_in_bytes')) is not int or not 0 < artifact['size_in_bytes'] <= 65536:
        return None
    created, expires = timestamp(artifact.get('created_at')), timestamp(artifact.get('expires_at'))
    if created is None or expires is None or not created <= now < expires:
        return None
    linked = artifact.get('workflow_run')
    if not isinstance(linked, dict) or linked.get('head_branch') != 'qa':
        return None
    if (type(linked.get('repository_id')) is not int or linked['repository_id'] <= 0
            or linked.get('head_repository_id') != linked['repository_id']):
        return None
    if type(linked.get('id')) is not int or linked['id'] <= 0:
        return None
    source = linked.get('head_sha')
    if not isinstance(source, str) or SHA.fullmatch(source) is None:
        return None
    return linked['id'], source, created


def valid_run(run: object, run_id: int, source: str, repository_id: int) -> int | None:
    if not isinstance(run, dict):
        return None
    if not (run.get('id') == run_id and run.get('head_sha') == source
            and run.get('head_branch') == 'qa' and run.get('event') == 'push'
            and run.get('path') == WORKFLOW and run.get('status') == 'completed'
            and run.get('conclusion') == 'success'):
        return None
    for key in ('repository', 'head_repository'):
        value = run.get(key)
        if not isinstance(value, dict) or value.get('id') != repository_id or value.get('full_name') != REPOSITORY:
            return None
    attempt = run.get('run_attempt')
    return attempt if type(attempt) is int and attempt > 0 else None


def valid_publish_job(data: object, run_id: int, source: str, artifact_created: datetime) -> bool:
    if not isinstance(data, dict) or not isinstance(data.get('jobs'), list):
        return False
    jobs = data['jobs']
    if data.get('total_count') != len(jobs) or len(jobs) > 100:
        return False
    matches = [job for job in jobs if isinstance(job, dict) and job.get('name') == 'publish']
    if len(matches) != 1:
        return False
    job = matches[0]
    if not (job.get('run_id') == run_id and job.get('head_sha') == source
            and job.get('status') == 'completed' and job.get('conclusion') == 'success'):
        return False
    steps = job.get('steps')
    if not isinstance(steps, list):
        return False
    names = ('Publish only the checked images', 'Retain successfully published backend source',
             'Upload successful backend publication marker')
    selected = []
    for name in names:
        matches = [step for step in steps if isinstance(step, dict) and step.get('name') == name]
        if len(matches) != 1 or matches[0].get('conclusion') != 'success':
            return False
        selected.append(matches[0])
    pushed, recorded, uploaded = selected
    numbers = [step.get('number') for step in selected]
    if not all(type(number) is int for number in numbers) or numbers != sorted(numbers) or len(set(numbers)) != 3:
        return False
    push_finished = timestamp(pushed.get('completed_at'))
    record_started = timestamp(recorded.get('started_at'))
    upload_started = timestamp(uploaded.get('started_at'))
    upload_finished = timestamp(uploaded.get('completed_at'))
    return (push_finished is not None and record_started is not None and upload_started is not None
            and upload_finished is not None and push_finished <= record_started <= upload_started
            and upload_started <= artifact_created <= upload_finished + timedelta(minutes=2))


def select_base(head: str, api, is_ancestor, now: datetime) -> str:
    if SHA.fullmatch(head) is None:
        raise ValueError('Invalid exact QA source')
    listing = api(f'actions/artifacts?name={ARTIFACT}&per_page=100')
    if not isinstance(listing, dict) or not isinstance(listing.get('artifacts'), list):
        return ZERO
    artifacts = listing['artifacts']
    if len(artifacts) > 100 or type(listing.get('total_count')) is not int:
        return ZERO
    candidates = sorted(artifacts, key=lambda a: a.get('created_at', '') if isinstance(a, dict) else '', reverse=True)
    verified = 0
    for artifact in candidates:
        linked = trusted_artifact(artifact, now)
        if linked is None:
            continue
        run_id, source, created = linked
        if verified >= MAX_VERIFIED:
            break
        verified += 1
        run = api(f'actions/runs/{run_id}')
        attempt = valid_run(run, run_id, source, artifact['workflow_run']['repository_id'])
        if attempt is None:
            continue
        jobs = api(f'actions/runs/{run_id}/attempts/{attempt}/jobs?per_page=100')
        if valid_publish_job(jobs, run_id, source, created) and is_ancestor(source, head):
            return source
    return ZERO


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--head', required=True)
    args = parser.parse_args()
    if SHA.fullmatch(args.head) is None:
        raise SystemExit('Invalid exact QA source')
    if os.getenv('GITHUB_EVENT_NAME') != 'push' or os.getenv('GITHUB_REF') != 'refs/heads/qa':
        raise SystemExit('Backend publication baseline is only for a trusted QA push')
    if os.getenv('GITHUB_REPOSITORY') != REPOSITORY or os.getenv('GITHUB_SHA') != args.head:
        raise SystemExit('Repository or checkout source mismatch')
    token = os.getenv('GH_TOKEN', '')
    if not token:
        raise SystemExit('Actions read token missing')

    def api(path: str):
        request = Request(f'https://api.github.com/repos/{REPOSITORY}/{path}', headers={
            'Authorization': f'Bearer {token}', 'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28'})
        with urlopen(request, timeout=15) as response:
            return json.load(response)

    def is_ancestor(base: str, head: str) -> bool:
        return subprocess.run(['git', 'merge-base', '--is-ancestor', base, head], check=False).returncode == 0

    try:
        base = select_base(args.head, api, is_ancestor, datetime.now(timezone.utc))
    except (OSError, ValueError, TypeError) as error:
        # A read-only metadata failure may cost one additional build, never a skip.
        print(f'Publication baseline unavailable ({type(error).__name__}); rebuilding backend', file=sys.stderr)
        base = ZERO
    output = os.getenv('GITHUB_OUTPUT')
    if output:
        with open(output, 'a', encoding='utf-8') as stream:
            stream.write(f'base={base}\n')
    print(f'Backend publication baseline: {base}')


if __name__ == '__main__':
    main()
