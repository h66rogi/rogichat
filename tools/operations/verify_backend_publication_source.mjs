#!/usr/bin/env node
// Only exact trusted QA push checks authorize backend publication.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const workflows = ['backend.yml', 'security.yml', 'infrastructure.yml', 'mobile.yml'];
const api = 'https://api.github.com';

function validateSource(sha, repository, token) {
  if (!/^[a-f0-9]{40}$/.test(sha ?? '') || repository !== 'h66rogi/rogichat' || !token) {
    throw new Error('Invalid source');
  }
}

function matches(run, sha, repository, workflow) {
  return run?.head_sha === sha && run.head_branch === 'qa' && run.event === 'push'
    && run.repository?.full_name === repository && run.head_repository?.full_name === repository
    && run.path === `.github/workflows/${workflow}`
    && Number.isSafeInteger(run.id) && run.id > 0
    && Number.isSafeInteger(run.run_attempt) && run.run_attempt > 0;
}

async function getJson(url, token, fetchImpl) {
  const response = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Verification API failed (${response.status})`);
  return response.json();
}

export async function verifyOnce({ sha, repository, token, cache, fetchImpl = fetch }) {
  validateSource(sha, repository, token);
  const listing = await getJson(
    `${api}/repos/${repository}/actions/runs?branch=qa&event=push&head_sha=${sha}&per_page=100`,
    token, fetchImpl,
  );
  if (!Number.isSafeInteger(listing.total_count) || listing.total_count > 100
      || !Array.isArray(listing.workflow_runs)
      || listing.workflow_runs.length > 100
      || listing.workflow_runs.length !== listing.total_count) {
    throw new Error('Invalid or incomplete run listing');
  }
  const evidence = [];
  for (const workflow of workflows) {
    const run = listing.workflow_runs.filter(candidate => matches(candidate, sha, repository, workflow))
      .sort((a, b) => b.id - a.id)[0];
    if (!run || run.status !== 'completed') {
      cache.delete(workflow);
      continue;
    }
    const prior = cache.get(workflow);
    if (prior?.id === run.id && prior.attempt === run.run_attempt
        && run.conclusion === 'success') {
      evidence.push(prior);
      continue;
    }
    cache.delete(workflow);
    const exact = await getJson(
      `${api}/repos/${repository}/actions/runs/${run.id}/attempts/${run.run_attempt}`,
      token, fetchImpl,
    );
    if (!matches(exact, sha, repository, workflow)
        || exact.id !== run.id || exact.run_attempt !== run.run_attempt) {
      throw new Error('Attempt identity mismatch');
    }
    if (exact.status !== 'completed') continue;
    if (exact.conclusion !== 'success') throw new Error(`${workflow} did not pass`);
    const proof = { workflow, id: run.id, attempt: run.run_attempt };
    cache.set(workflow, proof);
    evidence.push(proof);
  }
  if (evidence.length !== workflows.length) return false;
  if (new Set(evidence.map(run => run.id)).size !== workflows.length) {
    throw new Error('Duplicate verification identity');
  }
  return true;
}

async function main() {
  const sha = process.env.SOURCE_SHA;
  const repository = process.env.SOURCE_REPOSITORY;
  const token = process.env.GH_TOKEN;
  validateSource(sha, repository, token);
  const cache = new Map();
  const deadline = Date.now() + 20 * 60 * 1000;
  while (Date.now() < deadline) {
    if (await verifyOnce({ sha, repository, token, cache })) {
      console.log('Exact QA source passed backend, security, infrastructure and mobile verification');
      return;
    }
    await new Promise(resolve => setTimeout(resolve, Date.now() < deadline - 19 * 60 * 1000 ? 15000 : 30000));
  }
  throw new Error('Timed out waiting for exact-source verification');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
