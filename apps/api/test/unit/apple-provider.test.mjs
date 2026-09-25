import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { AppleProvider } from '../../dist/modules/auth/apple/apple-provider.js';
import { AppleSeal } from '../../dist/modules/auth/apple/apple-seal.js';
import { appleStart, appleExchange, appleNativeComplete } from '../../dist/modules/auth/apple/apple.dto.js';
import { appleFixture } from '../support/apple-fixture.mjs';

const nonce = () => randomBytes(32).toString('base64url');
test('real RSA signature/JWKS and ES256 client-secret exchange work without name or email', async () => {
  const f = appleFixture(); const provider = new AppleProvider(f.config, f.request); const n = nonce();
  const code = f.code('ios', n); const proof = await provider.exchange('ios', code.code, n, new Date(), code.identityToken);
  assert.equal(proof.subject, code.subject); assert.equal(proof.scope, 'test-primary');
  const form = new globalThis.URLSearchParams(f.requests.find(row => row.url.endsWith('/auth/token')).input.body);
  const secret = form.get('client_secret').split('.');
  assert.equal(JSON.parse(Buffer.from(secret[0], 'base64url')).alg, 'ES256');
  assert.equal(JSON.parse(Buffer.from(secret[1], 'base64url')).sub, f.config.clients.ios.audience);
  assert.equal(form.has('redirect_uri'), false);
  await assert.rejects(provider.exchange('ios', code.code, n, new Date(), code.identityToken));
});
test('Services ID exchanges bind audience and configured redirect URI', async () => {
  const f = appleFixture(); const p = new AppleProvider(f.config, f.request); const n = nonce(); const code = f.code('android', n);
  assert.equal((await p.exchange('android', code.code, n, new Date())).subject, code.subject);
  const form = new globalThis.URLSearchParams(f.requests[0].input.body); assert.equal(form.get('redirect_uri'), f.config.callback);
  const url = new URL(p.authorize('android', nonce(), n)); assert.equal(url.origin, 'https://appleid.apple.com'); assert.equal(url.searchParams.get('response_mode'), 'form_post');
});
test('bad issuer/audience/nonce/expiry/iat and native code hash fail closed', async () => {
  const f = appleFixture(); const p = new AppleProvider(f.config, f.request);
  for (const changes of [{ iss: 'https://attacker.invalid' }, { aud: f.config.clients.web.audience }, { nonce: nonce() }, { exp: 1 }, { iat: 1 }, { iat: Math.floor(Date.now() / 1000) + 100 }]) {
    const n = nonce(); const code = f.code('ios', n, undefined, changes);
    await assert.rejects(p.exchange('ios', code.code, n, new Date(), code.identityToken));
  }
  const n = nonce(); const code = f.code('ios', n);
  await assert.rejects(p.exchange('ios', code.code, n, new Date(), f.jwt(f.claims('ios', n, code.subject, { c_hash: 'wrong' }))));
});
test('forged signatures and algorithm confusion never admit a decoded identity', async () => {
  const f = appleFixture(); const p = new AppleProvider(f.config, f.request); const n = nonce();
  for (const transform of [value => ({ ...value, id_token: value.id_token.slice(0, -10) + 'aaaaaaaaaa' }),
    value => ({ ...value, id_token: f.jwt(f.claims('ios', n), { alg: 'none' }) }), value => ({ ...value, id_token: f.jwt(f.claims('ios', n), { kid: 'unknown' }) })]) {
    f.responseTransform = transform; const code = f.code('ios', n); await assert.rejects(p.exchange('ios', code.code, n, new Date(), code.identityToken));
  }
});
test('bounded requests use deadlines, deny redirect/oversized responses and absent configuration', async () => {
  await assert.rejects(new AppleProvider(undefined).exchange('ios', 'code', nonce(), new Date()), error => error.code === 'AUTH_UNAVAILABLE');
  const f = appleFixture(); const n = nonce(); const code = f.code('ios', n);
  const provider = new AppleProvider(f.config, async (_url, input) => {
    assert.equal(input.redirect, 'error'); assert.ok(input.signal instanceof AbortSignal);
    return new globalThis.Response('x'.repeat(65537));
  });
  await assert.rejects(provider.exchange('ios', code.code, n, new Date(), code.identityToken));
});
test('signed Apple account events accept no exp, reject wrong audience/stale/future and expose no email', async () => {
  const f = appleFixture(); const p = new AppleProvider(f.config, f.request); const now = Math.floor(Date.now() / 1000);
  const event = { iss: 'https://appleid.apple.com', aud: f.config.clients.web.audience, iat: now, jti: randomUUID(), events: { type: 'consent-revoked', sub: 'fixture-subject', event_time: now } };
  const verified = await p.notification(f.jwt(event)); assert.equal(verified.type, 'consent-revoked'); assert.equal(verified.scope, 'test-primary');
  assert.equal((await p.notification(f.jwt({ ...event, events: JSON.stringify(event.events) }))).subject, 'fixture-subject');
  for (const change of [{ aud: 'other' }, { iat: now + 100 }, { iat: now - 86401 }, { events: { ...event.events, event_time: now + 100 } }, { jti: '' }]) await assert.rejects(p.notification(f.jwt({ ...event, ...change })));
});
test('credential sealing binds environment, obligation UUID and purpose', () => {
  const key = randomBytes(32); const seal = new AppleSeal(key, 'rogi-qa'); const bytes = seal.seal('private-token', 'one', 'refresh');
  assert.equal(seal.open(bytes, 'one', 'refresh'), 'private-token');
  assert.throws(() => seal.open(bytes, 'two', 'refresh')); assert.throws(() => seal.open(bytes, 'one', 'proof'));
  assert.throws(() => new AppleSeal(key, 'rogi-production').open(bytes, 'one', 'refresh'));
});
test('DTOs accept login and reject extra provider/profile fields, invalid S256 and arbitrary clients', () => {
  const input = { clientId: 'ios', intent: 'login', codeChallenge: nonce(), returnState: nonce() };
  assert.deepEqual(appleStart(input), { clientId: input.clientId, intent: input.intent, codeChallenge: input.codeChallenge, returnState: input.returnState });
  for (const change of [{ clientId: 'other' }, { codeChallenge: 'short' }, { email: 'person@example.invalid' }]) assert.throws(() => appleStart({ ...input, ...change }));
  assert.deepEqual(appleStart({ ...input, intent: 'link' }), { ...input, intent: 'link' });
  assert.throws(() => appleExchange({ clientId: 'ios', transactionId: randomUUID(), code: nonce(), codeVerifier: 'short' }));
  assert.throws(() => appleNativeComplete({ transactionId: randomUUID(), state: nonce(), authorizationCode: 'code', identityToken: 'jwt', codeVerifier: nonce(), user: 'untrusted' }));
});
