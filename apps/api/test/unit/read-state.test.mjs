import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readContext, requireReadContext } from '../../dist/modules/read-state/read-context.js';
import { parseReadState } from '../../dist/modules/read-state/dto/read-state.dto.js';
import { ReadStateService } from '../../dist/modules/read-state/read-state.service.js';
import { ReadStateCoreService } from '../../dist/modules/read-state/read-state-core.service.js';

const viewer = { id: randomUUID(), user_id: randomUUID(), room_id: randomUUID(), active_period_id: randomUUID() };
const binding = { key: randomBytes(32), audience: 'read-state-unit', sessionId: randomUUID() };

test('opaque context binds session/account/room/period/audience/key and rejects malformed encodings', () => {
  const context = readContext(viewer, binding);
  assert.match(context, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(requireReadContext(context, viewer, binding), undefined);
  for (const field of ['user_id', 'room_id', 'active_period_id']) {
    assert.throws(() => requireReadContext(context, { ...viewer, [field]: randomUUID() }, binding), { code: 'CONFLICT' });
  }
  for (const change of [{ sessionId: randomUUID() }, { audience: 'other' }, { key: randomBytes(32) }]) {
    assert.throws(() => requireReadContext(context, viewer, { ...binding, ...change }), { code: 'CONFLICT' });
  }
  for (const malformed of [undefined, '', context + '=', 'a'.repeat(42), 'a'.repeat(44), '!'.repeat(43)]) {
    assert.throws(() => requireReadContext(malformed, viewer, binding), { code: 'INVALID_REQUEST' });
  }
  for (const id of Object.values(viewer)) assert.ok(!context.includes(id));
});

test('shared request parser admits only message UUID and opaque context, never positions or selectors', () => {
  const input = { messageId: randomUUID(), readContext: readContext(viewer, binding) };
  assert.deepEqual(parseReadState(input), input);
  for (const field of ['userId', 'memberId', 'roomId', 'periodId', 'streamId', 'lastReadOrder', 'cursor']) {
    assert.throws(() => parseReadState({ ...input, [field]: 'untrusted' }), { code: 'INVALID_REQUEST' });
  }
  for (const invalid of [{ messageId: input.messageId }, { readContext: input.readContext }, { ...input, messageId: '123' }, null, []]) {
    assert.throws(() => parseReadState(invalid), { code: 'INVALID_REQUEST' });
  }
});

test('HTTP service authenticates and writes on exactly the same transaction and stops on revoked auth', async () => {
  const tx = {}, calls = [], credentials = { csrf: randomBytes(32).toString('base64url') };
  const transactions = { write: operation => operation(tx), read: operation => operation(tx) };
  const auth = { require: async (actual, creds, soop) => {
    assert.equal(actual, tx); assert.equal(creds, credentials); assert.equal(soop, true);
    calls.push('auth'); return { userId: viewer.user_id, sessionId: binding.sessionId };
  } };
  const core = { put: async (actual, room, user, input, scope) => {
    assert.equal(actual, tx); assert.equal(room, viewer.room_id); assert.equal(user, viewer.user_id);
    assert.equal(scope.sessionId, binding.sessionId); calls.push('put'); return input;
  } };
  const service = new ReadStateService(transactions, auth, core, binding);
  const input = { messageId: randomUUID(), readContext: readContext(viewer, binding) };
  await service.put(credentials, viewer.room_id, input);
  assert.deepEqual(calls, ['auth', 'put']);
  auth.require = async () => { throw new Error('revoked'); };
  await assert.rejects(service.put(credentials, viewer.room_id, input), /revoked/);
  assert.deepEqual(calls, ['auth', 'put']);
});

test('bounded purge rejects invalid limits and read-only transactions before persistence', () => {
  const core = new ReadStateCoreService({ purgeAccount() { assert.fail('unexpected persistence'); } });
  for (const limit of [0, -1, 501, 1.5, Infinity, '10']) {
    assert.throws(() => core.purgeAccount({ writable: true }, viewer.user_id, limit), { code: 'INVALID_REQUEST' });
  }
  assert.throws(() => core.purgeAccount({ writable: false }, viewer.user_id, 1), /transaction_not_writable/);
});
