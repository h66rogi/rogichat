import { appendFile } from 'node:fs/promises';
import { remoteImage } from './qa_registry.mjs';

const REPOSITORY = 'h66rogi/rogichat';
const SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const PUBLICATION = {
  web: { job: 'Web publication result', path: '.github/workflows/qa-web-publication.yml',
    name: 'QA web image publication' },
  backend: { job: 'Backend publication result', path: '.github/workflows/qa-backend-publication.yml',
    name: 'QA backend image publication' },
};

async function github(path, token, fetcher) {
  const response = await fetcher(`https://api.github.com/repos/${REPOSITORY}/${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28' }, signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Publication recovery API failed (${response.status})`);
  return response.json();
}

function completeList(value, key) {
  return Number.isSafeInteger(value?.total_count) && value.total_count >= 0
    && value.total_count <= 100 && Array.isArray(value[key])
    && value[key].length === value.total_count;
}

export async function completedPublication(kind, sourceSha, token, fetcher = fetch) {
  if (!PUBLICATION[kind] || !SHA.test(sourceSha ?? '') || !token) throw new Error('Invalid recovery request');
  const markerName = `qa-${kind}-published-${sourceSha}`;
  const markerQuery = new URLSearchParams({ name: markerName, per_page: '100' });
  const found = await github(`actions/artifacts?${markerQuery}`, token, fetcher);
  // A truncated listing never proves completion; rebuilding is safe.
  if (!completeList(found, 'artifacts')) return false;
  const markers = found.artifacts.filter(artifact => artifact.name === markerName
    && artifact.expired === false && DIGEST.test(artifact.digest ?? '')
    && artifact.workflow_run?.head_sha === sourceSha
    && artifact.workflow_run?.head_branch === 'qa')
    .sort((a, b) => b.id - a.id).slice(0, 5);
  for (const marker of markers) {
    const runId = marker.workflow_run.id;
    if (!Number.isSafeInteger(runId) || runId <= 0) continue;
    const run = await github(`actions/runs/${runId}`, token, fetcher);
    if (run.id !== runId || run.head_sha !== sourceSha || run.head_branch !== 'qa'
        || !['workflow_run', 'schedule', 'workflow_dispatch'].includes(run.event)
        || run.path !== PUBLICATION[kind].path
        || run.name !== PUBLICATION[kind].name
        || run.repository?.full_name !== REPOSITORY
        || run.head_repository?.full_name !== REPOSITORY
        || run.status !== 'completed' || run.conclusion !== 'success'
        || !Number.isSafeInteger(run.run_attempt) || run.run_attempt <= 0) continue;
    const jobs = await github(`actions/runs/${runId}/attempts/${run.run_attempt}/jobs?per_page=100`,
      token, fetcher);
    if (!completeList(jobs, 'jobs')) continue;
    const aggregate = jobs.jobs.filter(job => job.name === PUBLICATION[kind].job);
    if (aggregate.length !== 1 || aggregate[0].run_id !== runId
        || aggregate[0].run_attempt !== run.run_attempt
        || aggregate[0].status !== 'completed' || aggregate[0].conclusion !== 'success') continue;
    if (kind === 'web') {
      const proofName = `web-publication-proof-${sourceSha}-${run.run_attempt}`;
      const proofQuery = new URLSearchParams({ name: proofName, per_page: '100' });
      const proof = await github(`actions/runs/${runId}/artifacts?${proofQuery}`, token, fetcher);
      if (!completeList(proof, 'artifacts') || proof.total_count !== 1) continue;
      const artifact = proof.artifacts[0];
      if (artifact.name !== proofName || artifact.expired !== false
          || !DIGEST.test(artifact.digest ?? '')
          || artifact.workflow_run?.id !== runId
          || artifact.workflow_run?.head_sha !== sourceSha) continue;
    }
    return true;
  }
  return false;
}

export async function publicationNeeds(changed, eventName, sourceSha, token,
  lookup = remoteImage, completed = completedPublication) {
  const required = {
    web: ['rogichat-web'],
    backend: ['rogichat-api', 'rogichat-api-migration', 'rogichat-media-decoder'],
  };
  const needs = { web: changed.web, backend: changed.backend };
  if (!['workflow_run', 'schedule', 'workflow_dispatch'].includes(eventName)) {
    throw new Error('Unsupported publication preflight event');
  }
  for (const component of ['web', 'backend']) {
    if (!changed[component]) continue;
    const existing = await Promise.all(required[component].map(repository =>
      lookup(repository, sourceSha, token)));
    needs[component] = existing.some(image => image === null)
      || !await completed(component, sourceSha, token);
  }
  return needs;
}

if (process.argv[1]?.endsWith('/qa_publication_preflight.mjs')) {
  const needs = await publicationNeeds({
    web: process.env.WEB_CHANGED === 'true',
    backend: process.env.BACKEND_CHANGED === 'true',
  }, process.env.GITHUB_EVENT_NAME, process.env.SOURCE_SHA, process.env.GHCR_TOKEN);
  await appendFile(process.env.GITHUB_OUTPUT,
    `web=${needs.web}\nbackend=${needs.backend}\n`);
  console.log(`Publication needed: web=${needs.web}, backend=${needs.backend}`);
}
