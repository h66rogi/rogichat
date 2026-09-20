import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../../dist/application.js';
import { SafeLogger } from '../../dist/infrastructure/observability/logging.js';
import { LifecycleState } from '../../dist/common/lifecycle/lifecycle-state.js';
for (const environment of ['local', 'qa', 'test', 'production']) test(`documentation exposure follows APP_ENV=${environment}`, { timeout: 15000 }, async t => {
  const lifecycle = new LifecycleState();
  const db = { check: async () => ({ ready: true }), close: async () => {} };
  const app = await createApi(db, new SafeLogger('api', () => {}), lifecycle, undefined, undefined, environment);
  await app.listen(0, '127.0.0.1'); t.after(() => app.close());
  const base = await app.getUrl();
  const enabled = ['local', 'qa'].includes(environment);
  for (const path of ['/docs', '/docs/', '/docs/openapi.json', '/docs/swagger-ui-init.js', '/docs/swagger-ui-bundle.js', '/docs/swagger-ui.css']) {
    const result = await fetch(`${base}${path}`);
    assert.equal(result.status, enabled ? 200 : 404, `${environment} ${path}`);
    assert.equal(result.headers.get('cache-control'), 'no-store');
    assert.equal(result.headers.get('x-content-type-options'), 'nosniff');
    assert.ok(result.headers.get('content-security-policy').includes("script-src 'self'"));
    await result.arrayBuffer();
  }
  for (const path of ['/docs-json', '/docs-yaml', '/docs/openapi.yaml', '/debug', '/auth/test']) assert.equal((await fetch(`${base}${path}`)).status, 404);
  if (enabled) {
    const doc = await (await fetch(`${base}/docs/openapi.json`)).json();
    assert.equal(doc.info.title, '로기챗 API');
    assert.deepEqual(Object.keys(doc.paths).sort(), ['/live', '/ready']);
    const init = await (await fetch(`${base}/docs/swagger-ui-init.js`)).text();
    assert.match(init, /"supportedSubmitMethods":\s*\[\]/);
    assert.match(init, /"persistAuthorization":\s*false/);
    assert.match(init, /"validatorUrl":\s*null/);
  }
  assert.equal((await fetch(`${base}/ready`)).status, 200);
  lifecycle.draining = true;
  assert.equal((await fetch(`${base}/docs`)).status, 503);
  assert.equal((await fetch(`${base}/live`)).status, 200);
});
