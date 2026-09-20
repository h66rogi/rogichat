import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ApiError } from '../../dist/modules/auth/auth-primitives.js';
import { MessageCommandsService } from '../../dist/modules/messages/message-commands.service.js';
import { MessageCommandsRepository } from '../../dist/modules/messages/message-commands.repository.js';
import { MessageCommandsController } from '../../dist/modules/messages/message-commands.controller.js';

function fixture() {
  const room = randomUUID(), command = randomUUID(), actor = randomUUID(), user = randomUUID(), message = randomUUID();
  const tx = Object.freeze({ writable: false }), calls = [], credentials = { token: 'a'.repeat(43) };
  const state = { receipt: { message_id: message, deleted: false }, row: { id: message, version: 9007199254740993n }, readable: true };
  const check = (name, handle) => { assert.equal(handle, tx); calls.push(name); };
  const auth = { require: async (handle, supplied, chat) => {
    check('auth', handle); assert.equal(supplied, credentials); assert.equal(chat, true);
    if (state.authError) throw new ApiError(state.authError, 401);
    return { userId: user };
  } };
  const access = { requireActiveMember: async (handle, suppliedRoom, suppliedUser) => {
    check('member', handle); assert.equal(suppliedRoom, room); assert.equal(suppliedUser, user);
    if (state.left) throw new ApiError('NOT_FOUND', 404);
    return { id: actor, room_id: room };
  } };
  const repository = { ownReceipt: async (handle, suppliedRoom, suppliedActor, suppliedCommand) => {
    check('receipt', handle); assert.deepEqual([suppliedRoom, suppliedActor, suppliedCommand], [room, actor, command]); return state.receipt;
  } };
  const messages = { load: async (handle, suppliedRoom, id) => { check('load', handle); assert.equal(suppliedRoom, room); assert.equal(id, message); return state.row; },
    readable: async (handle, viewer, row) => { check('acl', handle); assert.equal(viewer.id, actor); assert.equal(row, state.row); return state.readable; } };
  const service = new MessageCommandsService({ read: operation => { calls.push('snapshot'); return operation(tx); } }, auth, access, repository, messages);
  return { room, command, actor, message, service, state, calls, credentials };
}

test('own command lookup reauthenticates and checks current ACL on one snapshot without projecting content', async () => {
  const f = fixture();
  assert.deepEqual(await f.service.get(f.credentials, f.room, f.command), {
    clientMessageId: f.command, status: 'committed', messageId: f.message, version: '9007199254740993',
  });
  assert.deepEqual(f.calls, ['snapshot', 'auth', 'member', 'receipt', 'load', 'acl']);
  f.state.readable = false;
  await assert.rejects(f.service.get(f.credentials, f.room, f.command), { code: 'NOT_FOUND' });
});

test('deleted receipt is terminal and has no message ID even when the content row is gone', async () => {
  const f = fixture(); f.state.receipt.deleted = true; f.state.row = null;
  assert.deepEqual(await f.service.get(f.credentials, f.room, f.command), { clientMessageId: f.command, status: 'deleted' });
  assert.deepEqual(f.calls, ['snapshot', 'auth', 'member', 'receipt']);
  f.state.left = true;
  await assert.rejects(f.service.get(f.credentials, f.room, f.command), { code: 'NOT_FOUND' });
});

test('missing, inaccessible, revoked and malformed requests fail closed before receipt disclosure', async () => {
  for (const changes of [{ receipt: null }, { row: null }, { readable: false }, { left: true }, { authError: 'UNAUTHENTICATED' }]) {
    const f = fixture(); Object.assign(f.state, changes);
    await assert.rejects(f.service.get(f.credentials, f.room, f.command), { code: changes.authError ?? 'NOT_FOUND' });
    if (changes.left || changes.authError) assert.equal(f.calls.includes('receipt'), false);
  }
  const f = fixture();
  assert.throws(() => f.service.get(f.credentials, 'invalid', f.command), { code: 'INVALID_REQUEST' });
  assert.throws(() => f.service.get(f.credentials, f.room, 'invalid'), { code: 'INVALID_REQUEST' });
  assert.deepEqual(f.calls, []);
});

test('repository constrains sender/room/key and never selects digests or private identifiers', async () => {
  const f = fixture(); let input;
  const repository = new MessageCommandsRepository();
  await repository.ownReceipt({ prisma: { command_receipts: { findUnique: async value => { input = value; return null; } } } }, f.room, f.actor, f.command);
  assert.deepEqual(input, { where: { room_id_actor_id_client_message_id: { room_id: f.room, actor_id: f.actor, client_message_id: f.command } }, select: { message_id: true, deleted: true } });
});

test('controller reuses web/native read credential rules without taking a sender or account partition', async () => {
  const f = fixture(), calls = [];
  const controller = new MessageCommandsController({ get: (...args) => { calls.push(args); } }, { origin: 'http://localhost:3001', secure: false });
  controller.get({ headers: { cookie: `rogi_session=${f.credentials.token}` } }, f.room, f.command);
  controller.get({ headers: { authorization: `Bearer ${f.credentials.token}`, 'x-rogi-client': 'ios' } }, f.room, f.command);
  assert.deepEqual(calls, [[f.credentials, f.room, f.command], [{ transport: 'NATIVE', token: f.credentials.token, clientId: 'ios' }, f.room, f.command]]);
  assert.throws(() => controller.get({ headers: { authorization: `Bearer ${f.credentials.token}`, 'x-rogi-client': 'ios', cookie: 'rogi_session=other' } }, f.room, f.command), { code: 'INVALID_REQUEST' });
});
