import assert from 'node:assert/strict';
import test from 'node:test';

import { PUSH_BINDING_KEY, forgetBinding, readAccountBinding, readBinding, rememberBinding } from './binding';
import type { BindingStorage } from './binding';

const ID = '2f1a4b6c-8d3e-4f10-92a7-5c6d7e8f9a0b';
const identity = { account: 'account-one', session: 'session-one' };

function memory(initial: Record<string, string> = {}): BindingStorage & { values: Record<string, string> } {
  const values = { ...initial };
  return {
    values,
    getItem: key => values[key] ?? null,
    setItem: (key, value) => { values[key] = value; },
    removeItem: key => { delete values[key]; },
  };
}

void test('only the subscription id, generation and opaque identities are stored', () => {
  const storage = memory();
  rememberBinding(storage, identity, { id: ID, generation: '2' });
  const stored = storage.values[PUSH_BINDING_KEY] ?? '';
  assert.equal(stored, `v1:account-one:session-one:${ID}:2`);
  assert.ok(!stored.includes('https://'), 'the endpoint is credential data and is never stored');
  assert.deepEqual(readBinding(storage), { account: 'account-one', session: 'session-one', id: ID, generation: '2' });
});

void test('a record from another account is not reused for this account', () => {
  const storage = memory({ [PUSH_BINDING_KEY]: `v1:account-two:session-nine:${ID}:5` });
  assert.equal(readAccountBinding(storage, identity), null);
  assert.deepEqual(readAccountBinding(storage, { account: 'account-two', session: 'session-other' }), {
    account: 'account-two', session: 'session-nine', id: ID, generation: '5',
  }, 'the same account keeps it across sessions so a rebinding can send its generation');
});

void test('malformed storage is treated as no record at all', () => {
  for (const raw of [
    '',
    'v2:account-one:session-one:' + ID + ':2',
    `v1:account-one:session-one:${ID}`,
    `v1:account-one:session-one:${ID}:0`,
    `v1:account-one:session-one:not-a-uuid:2`,
    `v1:account one:session-one:${ID}:2`,
    `v1:account-one:session-one:${ID}:2:extra`,
  ]) {
    assert.equal(readBinding(memory({ [PUSH_BINDING_KEY]: raw })), null, raw);
  }
  assert.equal(readBinding(memory()), null);
});

void test('an invalid binding is refused rather than written', () => {
  const storage = memory();
  assert.throws(() => rememberBinding(storage, identity, { id: 'not-a-uuid', generation: '1' }), TypeError);
  assert.throws(() => rememberBinding(storage, identity, { id: ID, generation: '0' }), TypeError);
  assert.throws(() => rememberBinding(storage, { account: 'a:b', session: 'session-one' }, { id: ID, generation: '1' }), TypeError);
  assert.deepEqual(storage.values, {});
});

void test('forgetting removes the record', () => {
  const storage = memory({ [PUSH_BINDING_KEY]: `v1:account-one:session-one:${ID}:2` });
  forgetBinding(storage);
  assert.equal(readBinding(storage), null);
});
