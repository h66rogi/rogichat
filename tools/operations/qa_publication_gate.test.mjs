import assert from 'node:assert/strict';
import test from 'node:test';
import { exactChecks, REQUIRED, selectSource, triggerIsLatest } from './qa_publication_gate.mjs';
import { publicationNeeds } from './qa_publication_preflight.mjs';
import { publicationDecision } from './qa_registry.mjs';

const SHA = 'a'.repeat(40);
const REPO = 'h66rogi/rogichat';
const workflows = Object.keys(REQUIRED);

function fixture(workflow, id, attempt = 1, conclusion = 'success') {
  return {
    id, run_attempt: attempt, name: REQUIRED[workflow].workflow,
    path: `.github/workflows/${workflow}`, event: 'push', head_branch: 'qa', head_sha: SHA,
    repository: { full_name: REPO }, head_repository: { full_name: REPO },
    status: 'completed', conclusion,
  };
}

function api({ retry = false, failedJob = null, failedAttempt = false } = {}) {
  const fetcher = async url => {
    let match = url.match(/workflows\/([^/]+)\/runs\?/);
    if (match) {
      const workflow = match[1];
      const index = workflows.indexOf(workflow);
      const runs = [fixture(workflow, 100 + index, retry && index === 0 ? 2 : 1,
        failedAttempt && index === 0 ? 'failure' : 'success')];
      return new Response(JSON.stringify({ workflow_runs: runs, total_count: runs.length }));
    }
    match = url.match(/runs\/(\d+)\/attempts\/(\d+)\/jobs\?/);
    if (match) {
      const id = Number(match[1]);
      const attempt = Number(match[2]);
      const workflow = workflows[id - 100];
      const job = { id: 1000 + id, name: REQUIRED[workflow].job, run_id: id,
        run_attempt: attempt, status: 'completed',
        conclusion: workflow === failedJob ? 'failure' : 'success' };
      return new Response(JSON.stringify({ jobs: [job], total_count: 1 }));
    }
    match = url.match(/runs\/(\d+)\/attempts\/(\d+)$/);
    if (match) {
      const id = Number(match[1]);
      const attempt = Number(match[2]);
      const workflow = workflows[id - 100];
      return new Response(JSON.stringify(fixture(workflow, id, attempt,
        failedAttempt && id === 100 ? 'failure' : 'success')));
    }
    throw new Error(`Unexpected API call: ${url}`);
  };
  return fetcher;
}

test('duplicate successful completion has the same trusted source and attempt', async () => {
  const trigger = fixture('web.yml', 100);
  const selected = selectSource('workflow_run', { repository: { full_name: REPO },
    workflow_run: trigger }, SHA, SHA);
  const checked = await exactChecks(SHA, 'token', api());
  assert.equal(selected.ready, true);
  assert.equal(checked.ready, true);
  assert.equal(checked.evidence.length, 5);
  assert.equal(triggerIsLatest(selected.trigger, checked.evidence), true);
  assert.equal(triggerIsLatest(selected.trigger, checked.evidence), true);
});

test('out of order completion from an older attempt cannot authorize publication', async () => {
  const old = selectSource('workflow_run', { repository: { full_name: REPO },
    workflow_run: fixture('web.yml', 100, 1) }, SHA, SHA);
  const checked = await exactChecks(SHA, 'token', api({ retry: true }));
  assert.equal(checked.ready, true);
  assert.equal(triggerIsLatest(old.trigger, checked.evidence), false);
  const latest = selectSource('workflow_run', { repository: { full_name: REPO },
    workflow_run: fixture('web.yml', 100, 2) }, SHA, SHA);
  assert.equal(triggerIsLatest(latest.trigger, checked.evidence), true);
});

test('failed completion, failed rerun, and failed aggregate job remain closed', async () => {
  const failed = selectSource('workflow_run', { repository: { full_name: REPO },
    workflow_run: fixture('web.yml', 100, 2, 'failure') }, SHA, SHA);
  assert.equal(failed.ready, false);
  assert.equal((await exactChecks(SHA, 'token', api({ failedAttempt: true }))).ready, false);
  assert.equal((await exactChecks(SHA, 'token', api({ failedJob: 'mobile.yml' }))).ready, false);
});

test('wrong repository, stale QA source, and forged event are rejected', () => {
  const run = fixture('web.yml', 100);
  assert.throws(() => selectSource('workflow_run', { repository: { full_name: 'attacker/fork' },
    workflow_run: run }, SHA, SHA), /Untrusted/);
  assert.equal(selectSource('workflow_run', { repository: { full_name: REPO },
    workflow_run: run }, 'b'.repeat(40), SHA).ready, false);
  assert.throws(() => selectSource('push', {}, SHA, SHA), /Unsupported/);
});

test('registry decision never overwrites a different checked image', () => {
  const id = `sha256:${'b'.repeat(64)}`;
  assert.equal(publicationDecision(id, null), 'push');
  assert.equal(publicationDecision(id, { configDigest: id }), 'already-published');
  assert.throws(() => publicationDecision(id, { configDigest: `sha256:${'c'.repeat(64)}` }),
    /differs/);
});

test('scheduled recovery rebuilds a missing component and skips complete existing tags', async () => {
  const lookup = async repository => repository === 'rogichat-api-migration'
    ? null : { manifestDigest: `sha256:${'d'.repeat(64)}` };
  const needs = await publicationNeeds({ web: true, backend: true }, 'schedule', SHA,
    'token', lookup);
  assert.deepEqual(needs, { web: false, backend: true });
  assert.deepEqual(await publicationNeeds({ web: true, backend: true },
    'workflow_run', SHA, 'token', lookup), { web: true, backend: true });
});
