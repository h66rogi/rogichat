import { appendFile } from 'node:fs/promises';
import { remoteImage } from './qa_registry.mjs';

export async function publicationNeeds(changed, eventName, sourceSha, token, lookup = remoteImage) {
  const required = {
    web: ['rogichat-web'],
    backend: ['rogichat-api', 'rogichat-api-migration', 'rogichat-media-decoder'],
  };
  const needs = { web: changed.web, backend: changed.backend };
  if (eventName !== 'schedule') return needs;
  for (const component of ['web', 'backend']) {
    if (!changed[component]) continue;
    const existing = await Promise.all(required[component].map(repository =>
      lookup(repository, sourceSha, token)));
    needs[component] = existing.some(image => image === null);
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
