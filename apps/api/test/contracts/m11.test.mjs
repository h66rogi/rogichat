import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { m11OpenApi } from '../../../../packages/contracts/generate-m11-openapi.mjs';

test('published M11 OpenAPI artifact matches composed runtime feature contracts', async () => {
  const published = JSON.parse(await readFile(new URL('../../../../packages/contracts/m11.openapi.json', import.meta.url), 'utf8'));
  assert.deepEqual(published, m11OpenApi);
  const names = new Set(Object.keys(published.components.schemas));
  for (const match of JSON.stringify(published.paths).matchAll(/#\/components\/schemas\/([A-Za-z]+)/g)) assert.ok(names.has(match[1]), `unresolved schema ${match[1]}`);
});
