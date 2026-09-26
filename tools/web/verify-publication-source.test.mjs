import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyOnce, workflows } from './verify-publication-source.mjs';

const sha = 'a'.repeat(40);
const repository = 'h66rogi/rogichat';
const token = 'test-token';
const run = (workflow, id, status = 'completed', attempt = 1) => ({
  head_sha: sha, head_branch: 'qa', event: 'push', path: `.github/workflows/${workflow}`,
  repository: { full_name: repository }, head_repository: { full_name: repository },
  id, run_attempt: attempt, status, conclusion: status === 'completed' ? 'success' : null,
  html_url: `https://github.com/${repository}/actions/runs/${id}`,
});

function fakeApi(runs) {
  const calls = [];
  const fetchImpl = async url => {
    calls.push(url);
    const attempt = url.match(/\/actions\/runs\/(\d+)\/attempts\/(\d+)$/);
    const body = attempt
      ? runs.find(item => item.id === Number(attempt[1]) && item.run_attempt === Number(attempt[2]))
      : { total_count: runs.length, workflow_runs: runs };
    return { ok: Boolean(body), status: body ? 200 : 404, json: async () => body };
  };
  return { calls, fetchImpl };
}

test('one listing and one exact request per completed workflow, with cached attempts', async () => {
  const runs = workflows.map((name, index) => run(name, index + 1));
  const api = fakeApi(runs);
  const cache = new Map();
  const options = { sha, repository, token, cache, fetchImpl: api.fetchImpl };
  assert.equal((await verifyOnce(options))?.length, 5);
  assert.equal(api.calls.length, 6);
  assert.match(api.calls[0], /\/actions\/runs\?/);
  assert.equal((await verifyOnce(options))?.length, 5);
  assert.equal(api.calls.length, 7);
  runs[0] = run(workflows[0], 1, 'completed', 2);
  assert.equal((await verifyOnce(options))?.length, 5);
  assert.equal(api.calls.length, 9);
  assert.match(api.calls.at(-1), /\/runs\/1\/attempts\/2$/);
});

test('pending run is rechecked without exact request and failed attempt blocks publication', async () => {
  const runs = workflows.map((name, index) => run(name, index + 1));
  runs[0] = run(workflows[0], 1, 'in_progress');
  const api = fakeApi(runs);
  const cache = new Map();
  const options = { sha, repository, token, cache, fetchImpl: api.fetchImpl };
  assert.equal(await verifyOnce(options), null);
  assert.equal(api.calls.length, 5);
  runs[0] = { ...run(workflows[0], 1), conclusion: 'failure' };
  await assert.rejects(verifyOnce(options), /web.yml did not pass/);
});

test('identity mismatch and incomplete listing fail closed', async () => {
  const runs = workflows.map((name, index) => run(name, index + 1));
  const api = fakeApi(runs);
  const fetchImpl = async url => {
    const result = await api.fetchImpl(url);
    if (url.includes('/attempts/')) return { ...result, json: async () => ({ ...await result.json(), head_sha: 'b'.repeat(40) }) };
    return result;
  };
  await assert.rejects(verifyOnce({ sha, repository, token, cache: new Map(), fetchImpl }), /Attempt identity mismatch/);
  const incomplete = async () => ({ ok: true, json: async () => ({ total_count: 101, workflow_runs: runs }) });
  await assert.rejects(verifyOnce({ sha, repository, token, cache: new Map(), fetchImpl: incomplete }), /incomplete run listing/);
});
