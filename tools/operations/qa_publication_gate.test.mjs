import assert from 'node:assert/strict';
import test from 'node:test';
import { exactChecks, REQUIRED, selectSource, triggerIsLatest } from './qa_publication_gate.mjs';
import { completedPublication, publicationNeeds } from './qa_publication_preflight.mjs';
import { priorPublicationBase } from './qa_publication_base.mjs';
import { verifyFinalQaAncestry } from './qa_publication_finalize.mjs';
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
      const runs = [fixture(workflow, 100 + index, retry && index === 4 ? 2 : 1,
        failedAttempt && index === 4 ? 'failure' : 'success')];
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
        failedAttempt && id === 104 ? 'failure' : 'success')));
    }
    throw new Error(`Unexpected API call: ${url}`);
  };
  return fetcher;
}

test('duplicate successful completion has the same trusted source and attempt', async () => {
  const trigger = fixture('mobile.yml', 104);
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
    workflow_run: fixture('mobile.yml', 104, 1) }, SHA, SHA);
  const checked = await exactChecks(SHA, 'token', api({ retry: true }));
  assert.equal(checked.ready, true);
  assert.equal(triggerIsLatest(old.trigger, checked.evidence), false);
  const latest = selectSource('workflow_run', { repository: { full_name: REPO },
    workflow_run: fixture('mobile.yml', 104, 2) }, SHA, SHA);
  assert.equal(triggerIsLatest(latest.trigger, checked.evidence), true);
});

test('failed completion, failed rerun, and failed aggregate job remain closed', async () => {
  const failed = selectSource('workflow_run', { repository: { full_name: REPO },
    workflow_run: fixture('mobile.yml', 104, 2, 'failure') }, SHA, SHA);
  assert.equal(failed.ready, false);
  assert.equal((await exactChecks(SHA, 'token', api({ failedAttempt: true }))).ready, false);
  assert.equal((await exactChecks(SHA, 'token', api({ failedJob: 'mobile.yml' }))).ready, false);
});

test('wrong repository, stale QA source, and forged event are rejected', () => {
  const run = fixture('mobile.yml', 104);
  assert.throws(() => selectSource('workflow_run', { repository: { full_name: 'attacker/fork' },
    workflow_run: run }, SHA, SHA), /Untrusted/);
  assert.equal(selectSource('workflow_run', { repository: { full_name: REPO },
    workflow_run: run }, 'b'.repeat(40), SHA).ready, false);
  assert.throws(() => selectSource('push', {}, SHA, SHA), /Unsupported/);
  assert.throws(() => selectSource('workflow_run', { repository: { full_name: REPO },
    workflow_run: fixture('web.yml', 100) }, SHA, SHA), /Untrusted/);
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
    'token', lookup, async kind => kind === 'web');
  assert.deepEqual(needs, { web: false, backend: true });
  assert.deepEqual(await publicationNeeds({ web: true, backend: true },
    'workflow_run', SHA, 'token', lookup, async kind => kind === 'web'),
  { web: false, backend: true });
  assert.deepEqual(await publicationNeeds({ web: true, backend: false },
    'workflow_run', SHA, 'token', async () => ({ manifestDigest: `sha256:${'d'.repeat(64)}` }),
    async () => false), { web: true, backend: false });
});

function recoveryApi({ kind = 'web', failedJob = false, missingProof = false,
  wrongAttempt = false, failedRun = false, otherComponent = false } = {}) {
  const selected = otherComponent ? (kind === 'web' ? 'backend' : 'web') : kind;
  const title = selected === 'web' ? 'Web' : 'Backend';
  const artifact = name => ({ id: 42, name, expired: false,
    digest: `sha256:${'e'.repeat(64)}`,
    workflow_run: { id: 12, head_sha: SHA, head_branch: 'qa' } });
  return async url => {
    const parsed = new URL(url);
    const path = parsed.pathname;
    let result;
    if (path.endsWith('/actions/artifacts')) {
      result = { total_count: 1, artifacts: [artifact(`qa-${kind}-published-${SHA}`)] };
    } else if (path.endsWith('/actions/runs/12')) {
      result = { id: 12, run_attempt: 2, head_sha: SHA, head_branch: 'qa',
        event: 'workflow_run', path: `.github/workflows/qa-${selected}-publication.yml`,
        name: `QA ${selected} image publication`, status: 'completed',
        conclusion: failedRun ? 'failure' : 'success',
        repository: { full_name: REPO }, head_repository: { full_name: REPO } };
    } else if (path.endsWith('/actions/runs/12/attempts/2/jobs')) {
      result = { total_count: 1, jobs: [{ name: `${title} publication result`, run_id: 12,
        run_attempt: wrongAttempt ? 1 : 2, status: 'completed',
        conclusion: failedJob ? 'failure' : 'success' }] };
    } else if (path.endsWith('/actions/runs/12/artifacts')) {
      result = { total_count: missingProof ? 0 : 1, artifacts: missingProof ? [] :
        [artifact(`web-publication-proof-${SHA}-2`)] };
    } else throw new Error(`Unexpected recovery API: ${url}`);
    return new Response(JSON.stringify(result));
  };
}

test('scheduled completion requires exact successful aggregate and original web proof', async () => {
  assert.equal(await completedPublication('web', SHA, 'token', recoveryApi()), true);
  for (const scenario of [{ failedJob: true }, { wrongAttempt: true },
    { failedRun: true }, { missingProof: true }, { otherComponent: true }]) {
    assert.equal(await completedPublication('web', SHA, 'token', recoveryApi(scenario)),
      false, JSON.stringify(scenario));
  }
  const existing = async () => ({ manifestDigest: `sha256:${'f'.repeat(64)}` });
  assert.deepEqual(await publicationNeeds({ web: true, backend: false }, 'schedule',
    SHA, 'token', existing, async () => false), { web: true, backend: false });
});

test('backend recovery accepts only its independent successful publication run', async () => {
  assert.equal(await completedPublication('backend', SHA, 'token', recoveryApi({ kind: 'backend' })), true);
  for (const change of [{ otherComponent: true }, { failedJob: true }, { failedRun: true }]) {
    assert.equal(await completedPublication('backend', SHA, 'token', recoveryApi({ kind: 'backend', ...change })),
      false, JSON.stringify(change));
  }
});

test('missed web completion at A is recovered from the earlier proven source at docs-only B', async () => {
  const previous = '1'.repeat(40);
  const missed = '2'.repeat(40);
  const docsOnlyHead = '3'.repeat(40);
  const marker = (id, head_sha) => ({ id, name: 'qa-web-published-base', expired: false,
    workflow_run: { head_sha, head_branch: 'qa' } });
  const fetcher = async () => new Response(JSON.stringify({ total_count: 3,
    artifacts: [marker(30, docsOnlyHead), marker(20, missed), marker(10, previous)] }));
  const examined = [];
  const base = await priorPublicationBase('web', docsOnlyHead, 'token', {
    fetcher, isAncestor: async () => true,
    completed: async (_, source) => { examined.push(source); return source === previous; },
  });
  assert.equal(base, previous);
  assert.deepEqual(examined, [missed, previous]);
  assert.equal(await priorPublicationBase('web', docsOnlyHead, 'token', {
    fetcher, isAncestor: async () => true, completed: async () => false,
  }), '0'.repeat(40));
});

test('current-source marker is excluded so a missing current image is rechecked', async () => {
  const fetcher = async () => new Response(JSON.stringify({ total_count: 1,
    artifacts: [{ id: 1, name: 'qa-backend-published-base', expired: false,
      workflow_run: { head_sha: SHA, head_branch: 'qa' } }] }));
  assert.equal(await priorPublicationBase('backend', SHA, 'token', {
    fetcher, isAncestor: async () => true, completed: async () => true,
  }), '0'.repeat(40));
});

test('rate limited gate and recovery fail closed until a later scheduled sweep', async () => {
  const limited = async () => new Response('{}', { status: 429 });
  await assert.rejects(exactChecks(SHA, 'token', limited), /API failed \(429\)/);
  await assert.rejects(completedPublication('web', SHA, 'token', limited), /API failed \(429\)/);
  await assert.rejects(priorPublicationBase('web', SHA, 'token', { fetcher: limited }),
    /API failed \(429\)/);
});

test('final publication check requires current QA head or exact ancestor', async () => {
  const next = 'b'.repeat(40);
  const fetcher = async url => new Response(JSON.stringify(url.includes('/git/ref/')
    ? { object: { sha: next } }
    : { status: 'ahead', merge_base_commit: { sha: SHA } }));
  assert.equal(await verifyFinalQaAncestry(SHA, 'token', fetcher), next);
  const diverged = async url => new Response(JSON.stringify(url.includes('/git/ref/')
    ? { object: { sha: next } }
    : { status: 'diverged', merge_base_commit: { sha: next } }));
  await assert.rejects(verifyFinalQaAncestry(SHA, 'token', diverged), /left QA ancestry/);
});
