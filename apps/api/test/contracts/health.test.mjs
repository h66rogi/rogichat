import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../../dist/application.js';
import { SafeLogger } from '../../dist/infrastructure/observability/logging.js';

test('checked-in health contract matches live controller output exactly', async (t) => {
  const contract = JSON.parse(await readFile(new URL('../../../../packages/contracts/health.json', import.meta.url), 'utf8'));
  let ready = true;
  const database = { check: async () => ({ ready, reason: ready ? 'ready' : 'schema_mismatch' }), close: async () => {} };
  const app = await createApi(database, new SafeLogger('api', () => {}));
  await app.listen(0, '127.0.0.1');
  t.after(() => app.close());
  for (const [path, statuses] of Object.entries(contract.endpoints)) {
    for (const [status, expected] of Object.entries(statuses)) {
      ready = status !== '503';
      const response = await fetch(`${await app.getUrl()}${path}`);
      assert.equal(response.status, Number(status));
      assert.deepEqual(await response.json(), expected);
    }
  }
});
