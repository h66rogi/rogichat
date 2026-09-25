import { appendFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { completedPublication } from './qa_publication_preflight.mjs';

const REPOSITORY = 'h66rogi/rogichat';
const SHA = /^[a-f0-9]{40}$/;
const ZERO = '0'.repeat(40);
const KIND = new Set(['web', 'backend']);

function gitAncestor(base, head) {
  const result = spawnSync('git', ['merge-base', '--is-ancestor', base, head], {
    stdio: 'ignore', timeout: 15000,
  });
  if (result.error || ![0, 1].includes(result.status)) {
    throw new Error('Cannot verify publication ancestry');
  }
  return result.status === 0;
}

export async function priorPublicationBase(kind, head, token,
  { fetcher = fetch, isAncestor = gitAncestor, completed = completedPublication } = {}) {
  if (!KIND.has(kind) || !SHA.test(head ?? '') || !token) {
    throw new Error('Invalid publication baseline request');
  }
  // This fixed-name artifact is a discovery hint only. The source-specific
  // marker, exact run/attempt/job and web proof are verified independently.
  const name = `qa-${kind}-published-base`;
  const query = new URLSearchParams({ name, per_page: '100' });
  const response = await fetcher(`https://api.github.com/repos/${REPOSITORY}/actions/artifacts?${query}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28' }, signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Publication baseline API failed (${response.status})`);
  const listing = await response.json();
  if (!Number.isSafeInteger(listing?.total_count) || listing.total_count < 0
      || !Array.isArray(listing.artifacts) || listing.artifacts.length > 100
      || listing.artifacts.length > listing.total_count) {
    throw new Error('Incomplete publication baseline listing');
  }
  const candidates = listing.artifacts.filter(artifact => artifact.name === name
    && Number.isSafeInteger(artifact.id) && artifact.id > 0
    && artifact.expired === false && artifact.workflow_run?.head_branch === 'qa'
    && SHA.test(artifact.workflow_run?.head_sha ?? '')).sort((a, b) => b.id - a.id);
  // An older base only causes a conservative rebuild. Bound trust reads under
  // bursts instead of scanning an unbounded artifact history.
  for (const marker of candidates.slice(0, 5)) {
    const source = marker.workflow_run.head_sha;
    // The current source must still be checked for a missing image or proof.
    if (source === head || !await isAncestor(source, head)) continue;
    if (await completed(kind, source, token, fetcher)) return source;
  }
  // No proven earlier source means a full component rebuild, never a skip.
  return ZERO;
}

if (process.argv[1]?.endsWith('/qa_publication_base.mjs')) {
  const base = await priorPublicationBase(process.env.PUBLICATION_KIND,
    process.env.SOURCE_SHA, process.env.GH_TOKEN);
  await appendFile(process.env.GITHUB_OUTPUT, `base=${base}\n`);
  console.log(`Verified ${process.env.PUBLICATION_KIND} publication boundary: ${base}`);
}
