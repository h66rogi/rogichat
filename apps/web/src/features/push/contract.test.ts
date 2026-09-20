import assert from 'node:assert/strict';
import test from 'node:test';

import {
  fromBase64Url,
  isApplicationServerKey,
  isAuthSecret,
  isGeneration,
  isSubscriptionEndpoint,
  isSubscriptionId,
  parseCapabilities,
  parsePreferences,
  parseSubscriptionIdentity,
  sameInitialRegistration,
  subscriptionBody,
  subscriptionPath,
  toBase64Url,
} from './contract';

// Synthetic, deterministic byte patterns. No real VAPID or subscription material is used here.
const point = (seed: number): Uint8Array => Uint8Array.from([4, ...Array.from({ length: 64 }, (_, index) => (index * 7 + seed) & 0xff)]);
const secret = (seed: number): Uint8Array => Uint8Array.from(Array.from({ length: 16 }, (_, index) => (index * 11 + seed) & 0xff));
const P256DH = toBase64Url(point(1));
const AUTH = toBase64Url(secret(1));
const ID = '2f1a4b6c-8d3e-4f10-92a7-5c6d7e8f9a0b';

void test('base64url encoding matches the canonical unpadded encoding for every byte length', () => {
  for (let length = 0; length <= 70; length += 1) {
    const bytes = Uint8Array.from(Array.from({ length }, (_, index) => (index * 37 + length) & 0xff));
    const expected = Buffer.from(bytes).toString('base64url');
    assert.equal(toBase64Url(bytes), expected);
    assert.deepEqual(fromBase64Url(expected), bytes);
  }
});

void test('non-canonical base64url is refused instead of silently decoded', () => {
  assert.equal(fromBase64Url('A'), null, 'impossible length');
  assert.equal(fromBase64Url('AB=='), null, 'padding is not canonical');
  assert.equal(fromBase64Url('A+/A'), null, 'standard base64 alphabet');
  // The trailing character of a 16-byte secret carries four unused bits; they must be zero.
  assert.ok(AUTH.endsWith('A') || AUTH.endsWith('Q') || AUTH.endsWith('g') || AUTH.endsWith('w'));
  assert.equal(fromBase64Url(`${AUTH.slice(0, 21)}B`), null);
});

void test('generations are canonical positive uint64 decimal strings', () => {
  for (const value of ['1', '2', '18446744073709551615']) assert.ok(isGeneration(value));
  for (const value of ['0', '01', '-1', '1.0', '', ' 1', '18446744073709551616', 1 as unknown]) assert.equal(isGeneration(value), false);
});

void test('subscription keys must be the exact P-256 point and auth secret shapes', () => {
  assert.ok(isApplicationServerKey(P256DH));
  assert.ok(isAuthSecret(AUTH));
  assert.equal(isApplicationServerKey(AUTH), false, '16 bytes is not a curve point');
  assert.equal(isAuthSecret(P256DH), false);
  // An uncompressed point starts with 0x04; a compressed one is rejected before it is sent.
  assert.equal(isApplicationServerKey(toBase64Url(Uint8Array.from([2, ...point(2).slice(1)]))), false);
  assert.equal(isApplicationServerKey(toBase64Url(point(3).slice(0, 64))), false);
});

void test('endpoints follow the server parser: https, no credentials, no fragment, port 443', () => {
  assert.ok(isSubscriptionEndpoint('https://push.example/subscription/abc'));
  assert.ok(isSubscriptionEndpoint('https://push.example:443/subscription/abc'));
  for (const value of [
    'http://push.example/a',
    'https://user:pass@push.example/a',
    'https://push.example/a#fragment',
    'https://push.example:8443/a',
    'https://push.example/a b',
    `https://push.example/${'a'.repeat(2048)}`,
  ]) assert.equal(isSubscriptionEndpoint(value), false, value.slice(0, 40));
});

void test('capability responses are the exact documented union', () => {
  assert.deepEqual(parseCapabilities({ available: false }), { available: false });
  assert.deepEqual(parseCapabilities({ available: true, applicationServerKey: P256DH }), { available: true, applicationServerKey: P256DH });
  assert.equal(parseCapabilities({ available: true }), null, 'available true needs the key');
  assert.equal(parseCapabilities({ available: false, applicationServerKey: P256DH }), null, 'no key is exposed when unavailable');
  assert.equal(parseCapabilities({ available: true, applicationServerKey: P256DH, subject: 'mailto:ops@example' }), null, 'unknown fields');
  assert.equal(parseCapabilities({ available: 'true' }), null);
  assert.equal(parseCapabilities(null), null);
});

void test('preference and subscription responses reject wrong types and extra fields', () => {
  assert.deepEqual(parsePreferences({ pushEnabled: false, generation: '1' }), { pushEnabled: false, generation: '1' });
  assert.equal(parsePreferences({ pushEnabled: false, generation: 1 }), null, 'numeric generation loses uint64 precision');
  assert.equal(parsePreferences({ pushEnabled: false, generation: '1', userId: 'x' }), null);
  assert.deepEqual(parseSubscriptionIdentity({ id: ID, generation: '3' }), { id: ID, generation: '3' });
  assert.equal(parseSubscriptionIdentity({ id: ID, generation: '3', endpoint: 'https://push.example/a' }), null, 'endpoint is never echoed');
  assert.equal(parseSubscriptionIdentity({ id: 'not-a-uuid', generation: '3' }), null);
});

void test('the registration body carries generation only for a compare-and-set update', () => {
  const keys = { p256dh: P256DH, auth: AUTH };
  assert.deepEqual(subscriptionBody({ endpoint: 'https://push.example/a', keys }), { endpoint: 'https://push.example/a', keys });
  assert.deepEqual(subscriptionBody({ endpoint: 'https://push.example/a', keys, generation: '4' }), { endpoint: 'https://push.example/a', keys, generation: '4' });
  assert.throws(() => subscriptionBody({ endpoint: 'http://push.example/a', keys }), TypeError);
  assert.throws(() => subscriptionBody({ endpoint: 'https://push.example/a', keys, generation: '0' }), TypeError);
});

void test('an initial registration retry is only the byte-identical generation-free request', () => {
  const keys = { p256dh: P256DH, auth: AUTH };
  const initial = { endpoint: 'https://push.example/a', keys };
  assert.ok(sameInitialRegistration(initial, { endpoint: 'https://push.example/a', keys }));
  assert.equal(sameInitialRegistration(initial, { endpoint: 'https://push.example/b', keys }), false);
  assert.equal(sameInitialRegistration(initial, { ...initial, generation: '2' }), false);
  assert.equal(sameInitialRegistration(initial, { endpoint: 'https://push.example/a', keys: { p256dh: toBase64Url(point(9)), auth: AUTH } }), false);
});

void test('only a validated subscription id reaches a request path', () => {
  assert.ok(isSubscriptionId(ID));
  assert.equal(subscriptionPath(ID), `/v1/me/push-subscriptions/${ID}`);
  for (const value of ['../session', `${ID}/..`, '', 'ffffffff-ffff-ffff-ffff-ffffffffffff']) assert.throws(() => subscriptionPath(value), TypeError);
});
