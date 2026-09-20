import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readAuthConfig } from '../../dist/infrastructure/config/auth-config.js';
import { HttpBroker } from '../../dist/modules/auth/broker.adapter.js';
import { secret } from '../../dist/modules/auth/auth-primitives.js';

test('auth secret config is strict, host-only origins are environment-bound, credentials never enter errors', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'rogi-auth-config-')); t.after(() => rm(directory, { recursive: true }));
  const file = join(directory, 'auth.json'); const key = randomBytes(32).toString('hex');
  await writeFile(file, JSON.stringify({ key }), { mode: 0o600 });
  const qa = readAuthConfig({ environment: 'qa' }, { AUTH_SECRET_FILE: file });
  assert.equal(qa.secure, true); assert.equal(qa.origin, 'https://qa.rogi.chat');
  assert.equal(qa.broker, undefined); assert.equal(qa.audience, 'rogi-qa');
  assert.equal(readAuthConfig({ environment: 'production' }, { AUTH_SECRET_FILE: file }).origin, 'https://rogi.chat');
  for (const data of [{ key, extra: 'no' }, { key: 'short' }, { key, broker: { baseUrl: 'http://broker.invalid/', clientId: 'fixture', clientSecret: secret() } }]) {
    await writeFile(file, JSON.stringify(data));
    assert.throws(() => readAuthConfig({ environment: 'qa' }, { AUTH_SECRET_FILE: file }), error => {
      assert.equal(error.message, 'Invalid configuration: AUTH_SECRET_FILE'); assert.ok(!String(error).includes(key)); return true;
    });
  }
});

test('HTTP broker request/exchange allowlists, fixed binding, bounded response and redirect policy', async t => {
  const config = { audience: 'rogi-qa', callback: 'https://api.qa.rogi.chat/v1/auth/soop/callback', broker: { baseUrl: 'https://broker.example', clientId: 'fixture-qa', clientSecret: secret() } };
  const id = randomUUID(); const state = secret(); const code = secret();
  let body = { authorize_url: `https://broker.example/v1/platform/oauth/rogichat/authorize?request=${code}`, expires_in: 600 };
  let status = 201; let contentType = 'application/json'; let raw;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.match(url, /^https:\/\/broker.example\/v1\/platform\/oauth\/rogichat\/(requests|exchange)$/);
    assert.equal(options.redirect, 'error'); assert.ok(options.signal);
    const input = JSON.parse(options.body);
    assert.equal(input.environment, 'qa'); assert.equal(input.client_id, 'fixture-qa'); assert.equal(input.redirect_uri, config.callback); assert.equal(input.transaction_id, id);
    assert.equal(options.headers.authorization, `Basic ${Buffer.from(`fixture-qa:${config.broker.clientSecret}`).toString('base64')}`);
    return new globalThis.Response(raw ?? JSON.stringify(body), { status, headers: { 'content-type': contentType } });
  });
  const broker = new HttpBroker(config);
  const request = () => broker.request({ transactionId: id, state, challenge: secret() });
  assert.equal(await request(), body.authorize_url);
  body = { authorize_url: `https://evil.example/?request=${code}`, expires_in: 600 };
  await assert.rejects(request(), { code: 'AUTH_UNAVAILABLE' });
  body = { authorize_url: `https://broker.example/v1/platform/oauth/rogichat/authorize?request=${code}&extra=1`, expires_in: 600 };
  await assert.rejects(request());
  body = { schemaVersion: 1, provider: 'soop', subject: 'fixture-viewer', clientId: 'fixture-qa', transactionId: id, authenticatedAt: new Date().toISOString(), nickname: 'not-forwarded' };
  const result = await broker.exchange({ transactionId: id, code, verifier: secret() });
  assert.equal(result.subject, body.subject); assert.ok(!('nickname' in result));
  body.extraToken = 'must-reject'; await assert.rejects(broker.exchange({ transactionId: id, code, verifier: secret() }));
  raw = 'x'.repeat(8193); await assert.rejects(request(), { code: 'AUTH_UNAVAILABLE' });
  raw = undefined; contentType = 'text/html'; await assert.rejects(request(), { code: 'AUTH_UNAVAILABLE' });
  contentType = 'application/json'; status = 503; await assert.rejects(request(), { code: 'AUTH_UNAVAILABLE' });
  await assert.rejects(new HttpBroker({ ...config, broker: undefined }).request({ transactionId: id, state, challenge: secret() }), { code: 'AUTH_UNAVAILABLE' });
});
