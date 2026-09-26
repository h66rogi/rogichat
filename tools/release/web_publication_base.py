#!/usr/bin/env python3
"""Find the last proven QA web publication for cumulative image inputs.

An uncertain lookup returns the all-zero base. The image selector then rebuilds
instead of overlooking a web change whose earlier publication failed.
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
WORKFLOW = '.github/workflows/web-publish.yml'
ZERO = '0' * 40
SHA = re.compile(r'[a-f0-9]{40}\Z')
PROOF_NAME = re.compile(r'web-publication-proof-([a-f0-9]{40})-([1-9][0-9]*)\Z')
PROOF_DIGEST = re.compile(r'sha256:[a-f0-9]{64}\Z')
MAX_VERIFIED = 5


def timestamp(value: object) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError:
        return None
    return parsed if parsed.tzinfo is not None else None


def trusted_artifact(artifact: object, now: datetime) -> tuple[int, str, int, datetime, int] | None:
    if not isinstance(artifact, dict) or artifact.get('expired') is not False:
        return None
    name = artifact.get('name')
    match = PROOF_NAME.fullmatch(name) if isinstance(name, str) else None
    if match is None:
        return None
    if type(artifact.get('id')) is not int or artifact['id'] <= 0:
        return None
    if type(artifact.get('size_in_bytes')) is not int or not 0 < artifact['size_in_bytes'] <= 65536:
        return None
    digest = artifact.get('digest')
    if not isinstance(digest, str) or PROOF_DIGEST.fullmatch(digest) is None:
        return None
    created, expires = timestamp(artifact.get('created_at')), timestamp(artifact.get('expires_at'))
    if created is None or expires is None or not created <= now < expires:
        return None
    linked = artifact.get('workflow_run')
    if not isinstance(linked, dict) or linked.get('head_branch') != 'qa':
        return None
    repo_id = linked.get('repository_id')
    if type(repo_id) is not int or repo_id <= 0 or linked.get('head_repository_id') != repo_id:
        return None
    run_id = linked.get('id')
    if type(run_id) is not int or run_id <= 0 or linked.get('head_sha') != match[1]:
        return None
    attempt = int(match[2])
    if attempt > 1000000:
        return None
    return run_id, match[1], attempt, created, repo_id


def valid_run(run: object, run_id: int, source: str, attempt: int, repository_id: int) -> bool:
    if not isinstance(run, dict):
        return False
    if not (run.get('id') == run_id and type(run.get('run_attempt')) is int
            and run['run_attempt'] == attempt
            and run.get('head_sha') == source and run.get('head_branch') == 'qa'
            and run.get('event') == 'push' and run.get('path') == WORKFLOW
            and run.get('status') == 'completed' and run.get('conclusion') == 'success'):
        return False
    for key in ('repository', 'head_repository'):
        value = run.get(key)
        if not isinstance(value, dict) or value.get('id') != repository_id or value.get('full_name') != REPOSITORY:
            return False
    return True


def valid_publish_job(data: object, run_id: int, source: str, artifact_created: datetime) -> bool:
    if not isinstance(data, dict) or not isinstance(data.get('jobs'), list):
        return False
    jobs = data['jobs']
    if type(data.get('total_count')) is not int or data['total_count'] != len(jobs) or len(jobs) > 100:
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
    names = (
        'Scan every image layer and metadata before registry authentication',
        'Require successful verification of this exact QA push before publishing',
        'Publish only the checked image and write promotion proof',
        'Retain exact digest and CI provenance for promotion review',
    )
    selected = []
    for name in names:
        matches = [step for step in steps if isinstance(step, dict) and step.get('name') == name]
        if len(matches) != 1 or matches[0].get('conclusion') != 'success':
            return False
        selected.append(matches[0])
    numbers = [step.get('number') for step in selected]
    if not all(type(number) is int for number in numbers) or numbers != sorted(numbers) or len(set(numbers)) != 4:
        return False
    finished = [timestamp(step.get('completed_at')) for step in selected]
    started = [timestamp(step.get('started_at')) for step in selected]
    if any(value is None for value in finished + started):
        return False
    return (all(start <= end for start, end in zip(started, finished))
            and all(finished[index] <= started[index + 1] for index in range(3))
            and started[-1] <= artifact_created <= finished[-1] + timedelta(minutes=2))


def select_base(head: str, api, is_ancestor, now: datetime) -> str:
    if SHA.fullmatch(head) is None:
        raise ValueError('Invalid exact QA source')
    listing = api('actions/artifacts?per_page=100')
    if not isinstance(listing, dict) or not isinstance(listing.get('artifacts'), list):
        return ZERO
    artifacts = listing['artifacts']
    if len(artifacts) > 100 or type(listing.get('total_count')) is not int or listing['total_count'] < len(artifacts):
        return ZERO
    candidates = sorted(artifacts, key=lambda a: a.get('created_at', '') if isinstance(a, dict) else '', reverse=True)
    examined = 0
    for artifact in candidates:
        linked = trusted_artifact(artifact, now)
        if linked is None:
            continue
        if examined >= MAX_VERIFIED:
            break
        examined += 1
        run_id, source, attempt, created, repo_id = linked
        run = api(f'actions/runs/{run_id}')
        if not valid_run(run, run_id, source, attempt, repo_id):
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
        raise SystemExit('Web publication baseline is only for a trusted QA push')
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
        print(f'Web publication baseline unavailable ({type(error).__name__}); rebuilding web', file=sys.stderr)
        base = ZERO
    if output := os.getenv('GITHUB_OUTPUT'):
        with open(output, 'a', encoding='utf-8') as stream:
            stream.write(f'base={base}\n')
    print(f'Web publication baseline: {base}')


if __name__ == '__main__':
    main()
