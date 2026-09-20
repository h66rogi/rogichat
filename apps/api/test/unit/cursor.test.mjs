import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { CursorCodec, CursorError } from '../../dist/modules/sync/cursor.js';

const key = randomBytes(32);
const audience = 'rogichat-test';
const codec = new CursorCodec(key, audience);
const now = new Date('2026-09-20T00:00:00.000Z');
const scope = { purpose: 'events', userId: randomUUID(), sessionId: randomUUID(), deviceId: randomUUID(),
  cacheId: randomUUID(), roomId: randomUUID(), periodId: randomUUID(), acl: randomBytes(32).toString('base64url') };
const progress = { from: '9007199254740993', upper: '18446744073709551615', lastId: null };
const invalid = error => error instanceof CursorError && error.code === 'INVALID_CURSOR' && error.message === 'INVALID_CURSOR';

test('opaque cursors have fixed wire size, random IV and lossless unsigned 64-bit positions', () => {
  const first = codec.encode(scope, progress, { now });
  const second = codec.encode(scope, { from: '0', upper: null, lastId: randomUUID() }, { now });
  assert.equal(first.length, second.length);
  assert.notEqual(first, codec.encode(scope, progress, { now }));
  assert.deepEqual(codec.decode(first, scope, now), progress);
  assert.equal(Object.isFrozen(codec.decode(first, scope, now)), true);
  assert.equal(Buffer.from(first, 'base64url').includes(Buffer.from(scope.userId)), false);
  const reordered = Object.fromEntries(Object.entries(scope).reverse());
  assert.deepEqual(codec.decode(first, reordered, now), progress);
  for (const purpose of ['manifest', 'snapshot', 'events', 'history', 'profile']) {
    const binding = { ...scope, purpose, ...(purpose === 'manifest' ? { roomId: null, periodId: null } : {}) };
    const token = codec.encode(binding, progress, { now });
    assert.equal(token.length, first.length);
    assert.deepEqual(codec.decode(token, binding, now), progress);
  }
});

test('every binding component and environment/key is authenticated; no token error leaks details', () => {
  const token = codec.encode(scope, progress, { now });
  for (const field of ['userId', 'sessionId', 'deviceId', 'cacheId', 'roomId', 'periodId']) {
    assert.throws(() => codec.decode(token, { ...scope, [field]: randomUUID() }, now), invalid);
  }
  assert.throws(() => codec.decode(token, { ...scope, acl: randomBytes(32).toString('base64url') }, now), invalid);
  assert.throws(() => codec.decode(token, { ...scope, purpose: 'history' }, now), invalid);
  assert.throws(() => new CursorCodec(key, 'rogichat-prod').decode(token, scope, now), invalid);
  assert.throws(() => new CursorCodec(randomBytes(32), audience).decode(token, scope, now), invalid);
  for (const offset of [0, 1, 13, 29, 100, 1564]) {
    const corrupted = Buffer.from(token, 'base64url'); corrupted[offset] ^= 1;
    assert.throws(() => codec.decode(corrupted.toString('base64url'), scope, now), invalid);
  }
  for (const malformed of [null, 5, '', token + '=', token.slice(1), token + 'A', ' '.repeat(token.length)]) {
    assert.throws(() => codec.decode(malformed, scope, now), invalid);
  }
});

test('expiry uses caller DB time exclusively and rejects future-issued, boundary-expired and invalid clocks', () => {
  const token = codec.encode(scope, progress, { now, ttlSeconds: 60 });
  assert.deepEqual(codec.decode(token, scope, new Date(now.getTime() + 59999)), progress);
  for (const time of [new Date(now.getTime() - 1), new Date(now.getTime() + 60000), new Date(NaN), now.getTime()]) {
    assert.throws(() => codec.decode(token, scope, time), invalid);
  }
  for (const ttlSeconds of [0, -1, 0.5, 604801, Infinity, '60', null]) assert.throws(() => codec.encode(scope, progress, { now, ttlSeconds }), invalid);
  for (const options of [{ now, untrusted: true }, { now: new Date(NaN) }, { now: Date.now() }, null]) assert.throws(() => codec.encode(scope, progress, options), invalid);
});

test('strict schema forbids unknown/missing fields, wrong UUID scope and unsafe positions', () => {
  for (const binding of [{ ...scope, rawSequence: 1 }, { ...scope, acl: 'x'.repeat(43) }, { ...scope, purpose: 'unknown' },
    { ...scope, purpose: 'manifest' }, { ...scope, roomId: null }, { ...scope, userId: 'not-a-uuid' },
    Object.fromEntries(Object.entries(scope).filter(([key]) => key !== 'cacheId'))]) {
    assert.throws(() => codec.encode(binding, progress, { now }), invalid);
  }
  for (const from of ['-1', '01', '', '1.0', '18446744073709551616', '1'.repeat(1000), 1, 1n, null]) {
    assert.throws(() => codec.encode(scope, { ...progress, from }, { now }), invalid);
  }
  for (const position of [{ ...progress, leakedCount: 1 }, { from: '0', upper: null }, { ...progress, lastId: 'invalid' }, { ...progress, upper: -1 }]) {
    assert.throws(() => codec.encode(scope, position, { now }), invalid);
  }
  assert.throws(() => new CursorCodec(Buffer.alloc(31), audience), invalid);
  assert.throws(() => new CursorCodec(key, ''), invalid);
});

// Independent fixture writer exercises decoder schema rejection beyond GCM tamper rejection.
function authenticatedFixture(patch, corruptPadding = false) {
  const object = { version: 1, binding: scope, position: progress, issued: now.getTime(), expires: now.getTime() + 60000, ...patch };
  const encoded = Buffer.from(JSON.stringify(object)); const clear = Buffer.alloc(1536);
  clear.writeUInt16BE(encoded.length); encoded.copy(clear, 2);
  if (corruptPadding) clear[1535] = 1;
  const iv = randomBytes(12);
  const derived = createHmac('sha256', key).update(`rogichat:cursor:key:v1:${audience}`).digest();
  const cipher = createCipheriv('aes-256-gcm', derived, iv); cipher.setAAD(Buffer.from(`rogichat:cursor:v1:${audience}`));
  const encrypted = Buffer.concat([cipher.update(clear), cipher.final()]);
  return Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), encrypted]).toString('base64url');
}
test('authenticated but unsupported or malformed token payloads still fail closed', () => {
  for (const patch of [{ version: 2 }, { extra: true }, { position: { ...progress, upper: '01' } },
    { binding: { ...scope, extra: true } }, { expires: now.getTime() }, { issued: now.getTime() + 1 },
    { expires: now.getTime() + 604800001 }, { issued: '2026-09-20' }]) {
    assert.throws(() => codec.decode(authenticatedFixture(patch), scope, now), invalid);
  }
  assert.throws(() => codec.decode(authenticatedFixture({}, true), scope, now), invalid);
});
