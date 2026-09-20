import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../../dist/application.js';
import { LifecycleState } from '../../dist/common/lifecycle/lifecycle-state.js';
import { SafeLogger } from '../../dist/infrastructure/observability/logging.js';
import { waitFor } from '../helpers.mjs';

test('minimal HTTP contract, security headers, safe errors and current readiness', async (t) => {
  let ready = true;
  let logs = '';
  const state = new LifecycleState();
  const database = { check: async () => ({ ready, reason: ready ? 'ready' : 'database_unavailable' }), close: async () => {} };
  const app = await createApi(database, new SafeLogger('api', (line) => { logs += line; }), state);
  await app.listen(0, '127.0.0.1');
  t.after(() => app.close());
  const base = await app.getUrl();
  let response = await fetch(`${base}/live?token=secret-marker`, { headers: { Cookie: 'secret-marker', Authorization: 'Bearer secret-marker', 'X-Request-Id': 'secret-marker', Origin: 'https://evil.invalid' } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok' });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-powered-by'), null);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.notEqual(response.headers.get('x-request-id'), 'secret-marker');
  assert.equal((await fetch(`${base}/ready`)).status, 200);
  ready = false;
  response = await fetch(`${base}/ready`);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: { code: 'UNAVAILABLE' } });
  assert.equal((await fetch(`${base}/live`)).status, 200);
  for (const path of ['/docs', '/debug', '/auth/test', '/secret-marker']) {
    response = await fetch(`${base}${path}`);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: { code: 'NOT_FOUND' } });
  }
  response = await fetch(`${base}/unknown`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{secret-marker' });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: { code: 'BAD_REQUEST' } });
  response = await fetch(`${base}/unknown`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: 'x'.repeat(65536) }) });
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { error: { code: 'PAYLOAD_TOO_LARGE' } });
  ready = true;
  state.draining = true;
  assert.equal((await fetch(`${base}/ready`)).status, 503);
  assert.equal((await fetch(`${base}/live`)).status, 200);
  assert.ok(!logs.includes('secret-marker'));
});

test('unexpected dependency errors do not leak their content', async (t) => {
  const database = { check: async () => { throw new Error('private-db-host secret-marker'); }, close: async () => {} };
  const app = await createApi(database, new SafeLogger('api', () => {}));
  await app.listen(0, '127.0.0.1');
  t.after(() => app.close());
  const response = await fetch(`${await app.getUrl()}/ready`);
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: { code: 'INTERNAL_ERROR' } });
});

test('shutdown during an in-flight readiness probe cannot return a stale ready response', async (t) => {
  let finishProbe;
  const state = new LifecycleState();
  const database = { check: () => new Promise((resolve) => { finishProbe = resolve; }), close: async () => {} };
  const app = await createApi(database, new SafeLogger('api', () => {}), state);
  await app.listen(0, '127.0.0.1');
  t.after(() => app.close());
  const pending = fetch(`${await app.getUrl()}/ready`);
  await waitFor(() => finishProbe !== undefined);
  state.draining = true;
  finishProbe({ ready: true, reason: 'ready' });
  const response = await pending;
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: { code: 'UNAVAILABLE' } });
});
