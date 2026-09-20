import { mkdir, writeFile } from 'node:fs/promises';
import { openApiFixture } from '../test/support/openapi-fixture.mjs';
import { createOpenApiDocument } from '../dist/infrastructure/openapi/openapi.js';
function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])]));
  return value;
}
const directory = new URL('../build/openapi/', import.meta.url);
await mkdir(directory, { recursive: true });
for (const shape of ['health', 'auth', 'full']) {
  const fixture = await openApiFixture(shape);
  try {
    const document = createOpenApiDocument(fixture.app, shape === 'health' ? undefined : fixture.config);
    await writeFile(new URL(`${shape}.json`, directory), `${JSON.stringify(sorted(document), null, 2)}\n`);
    if (fixture.calls.length) throw new Error('Export attempted external I/O');
  } finally { await fixture.app.close(); }
}
