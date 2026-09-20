import assert from 'node:assert/strict';
import test from 'node:test';

import { PUSH_BINDING_KEY, forgetBinding, guardedStorage, isFingerprint, readAccountBinding, readBinding, rememberBinding, subscriptionFingerprint } from './binding';
import type { BindingStorage } from './binding';
import { toBase64Url } from './contract';
import { PushError } from './errors';

const ID = '2f1a4b6c-8d3e-4f10-92a7-5c6d7e8f9a0b';
const identity = { account: 'account-one', session: 'session-one' };
// Synthetic values generated here; no real endpoint, subscription key or VAPID key is used.
const KEY = toBase64Url(Uint8Array.from([4, ...Array.from({ length: 64 }, (_, index) => (index * 5 + 3) & 0xff)]));
const OTHER_KEY = toBase64Url(Uint8Array.from([4, ...Array.from({ length: 64 }, (_, index) => (index * 9 + 17) & 0xff)]));
const KEYS = {
  p256dh: toBase64Url(Uint8Array.from([4, ...Array.from({ length: 64 }, (_, index) => (index * 3 + 11) & 0xff)])),
  auth: toBase64Url(Uint8Array.from(Array.from({ length: 16 }, (_, index) => (index * 13 + 2) & 0xff))),
};
const FINGERPRINT = await subscriptionFingerprint('https://push.example/a', KEYS, KEY);

function memory(initial: Record<string, string> = {}): BindingStorage & { values: Record<string, string> } {
  const values = { ...initial };
  return {
    values,
    getItem: key => values[key] ?? null,
    setItem: (key, value) => { values[key] = value; },
    removeItem: key => { delete values[key]; },
  };
}

void test('the record keeps the id, generation, fingerprint and opaque identities only', () => {
  const storage = memory();
  rememberBinding(storage, identity, { id: ID, generation: '2', fingerprint: FINGERPRINT });
  const written = storage.values[PUSH_BINDING_KEY] ?? '';
  assert.equal(written, `v3:account-one:session-one:${ID}:2:${FINGERPRINT}`);
  assert.ok(!written.includes('https://'), 'the endpoint is credential data and is never stored');
  assert.ok(!written.includes(KEYS.p256dh) && !written.includes(KEYS.auth), 'subscription keys are never stored');
  assert.deepEqual(readBinding(storage), { account: 'account-one', session: 'session-one', id: ID, generation: '2', fingerprint: FINGERPRINT });
});

void test('the fingerprint changes with the endpoint, either subscription key or the server key', async () => {
  assert.ok(isFingerprint(FINGERPRINT));
  assert.equal(await subscriptionFingerprint('https://push.example/a', KEYS, KEY), FINGERPRINT, 'the same subscription is stable');
  for (const other of [
    await subscriptionFingerprint('https://push.example/b', KEYS, KEY),
    await subscriptionFingerprint('https://push.example/a', { ...KEYS, p256dh: OTHER_KEY }, KEY),
    await subscriptionFingerprint('https://push.example/a', { ...KEYS, auth: KEYS.auth.replace(/^./, 'B') }, KEY),
    await subscriptionFingerprint('https://push.example/a', KEYS, OTHER_KEY),
  ]) {
    assert.notEqual(other, FINGERPRINT);
  }
});

void test('a record written before fingerprints existed proves nothing about the subscription', () => {
  for (const raw of [`v1:account-one:session-one:${ID}:2`, `v2:account-one:session-one:${ID}:2:${KEY}`]) {
    assert.deepEqual(readBinding(memory({ [PUSH_BINDING_KEY]: raw })), {
      account: 'account-one', session: 'session-one', id: ID, generation: '2', fingerprint: null,
    }, raw);
  }
});

void test('a record from another account is not reused for this account', () => {
  const storage = memory({ [PUSH_BINDING_KEY]: `v3:account-two:session-nine:${ID}:5:${FINGERPRINT}` });
  assert.equal(readAccountBinding(storage, identity), null);
  assert.deepEqual(readAccountBinding(storage, { account: 'account-two', session: 'session-other' }), {
    account: 'account-two', session: 'session-nine', id: ID, generation: '5', fingerprint: FINGERPRINT,
  }, 'the same account keeps it across sessions so a rebinding can send its generation');
});

void test('malformed storage is treated as no record at all', () => {
  for (const raw of [
    '',
    `v4:account-one:session-one:${ID}:2:${FINGERPRINT}`,
    `v1:account-one:session-one:${ID}`,
    `v1:account-one:session-one:${ID}:0`,
    `v1:account-one:session-one:not-a-uuid:2`,
    `v1:account one:session-one:${ID}:2`,
    `v1:account-one:session-one:${ID}:2:${FINGERPRINT}`,
    `v3:account-one:session-one:${ID}:2`,
    `v3:account-one:session-one:${ID}:2:not-a-fingerprint`,
  ]) {
    assert.equal(readBinding(memory({ [PUSH_BINDING_KEY]: raw })), null, raw);
  }
  assert.equal(readBinding(memory()), null);
});

void test('an invalid binding is refused rather than written', () => {
  const storage = memory();
  assert.throws(() => rememberBinding(storage, identity, { id: 'not-a-uuid', generation: '1', fingerprint: FINGERPRINT }), TypeError);
  assert.throws(() => rememberBinding(storage, identity, { id: ID, generation: '0', fingerprint: FINGERPRINT }), TypeError);
  assert.throws(() => rememberBinding(storage, identity, { id: ID, generation: '1', fingerprint: 'not-a-fingerprint' }), TypeError);
  assert.throws(() => rememberBinding(storage, { account: 'a:b', session: 'session-one' }, { id: ID, generation: '1', fingerprint: FINGERPRINT }), TypeError);
  assert.deepEqual(storage.values, {});
});

void test('forgetting removes the record', () => {
  const storage = memory({ [PUSH_BINDING_KEY]: `v3:account-one:session-one:${ID}:2:${FINGERPRINT}` });
  forgetBinding(storage);
  assert.equal(readBinding(storage), null);
});

void test('an unusable browser storage is reported, never treated as an empty one', () => {
  const blocked = guardedStorage({
    getItem: () => { throw new DOMException('blocked'); },
    setItem: () => { throw new DOMException('blocked'); },
    removeItem: () => { throw new DOMException('blocked'); },
  });
  const failure = (operation: () => unknown): unknown => {
    try {
      operation();
      return null;
    } catch (error) {
      return error;
    }
  };
  for (const operation of [
    () => readBinding(blocked),
    () => rememberBinding(blocked, identity, { id: ID, generation: '1', fingerprint: FINGERPRINT }),
    () => { forgetBinding(blocked); },
  ]) {
    const error = failure(operation);
    assert.ok(error instanceof PushError && error.kind === 'storage', 'a blocked storage is its own state');
  }

  const working = memory();
  rememberBinding(guardedStorage(working), identity, { id: ID, generation: '1', fingerprint: FINGERPRINT });
  assert.equal(readBinding(guardedStorage(working))?.id, ID, 'a usable storage behaves exactly as before');
});

void test('a storage that throws on access is guarded too, not only on its methods', () => {
  const blocked = guardedStorage((): never => { throw new DOMException('blocked'); });
  for (const operation of [() => readBinding(blocked), () => { forgetBinding(blocked); }]) {
    try {
      operation();
      assert.fail('the access itself must be guarded');
    } catch (error) {
      assert.ok(error instanceof PushError && error.kind === 'storage');
    }
  }
});
