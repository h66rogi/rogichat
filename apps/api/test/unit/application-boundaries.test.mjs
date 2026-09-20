import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UsersService } from '../../dist/modules/users/users.service.js';
import { RoomsService } from '../../dist/modules/rooms/rooms.service.js';
import { SyncService } from '../../dist/modules/sync/sync.service.js';

const credentials = Object.freeze({ token: 'a'.repeat(43), csrf: 'b'.repeat(43) });
const principal = Object.freeze({ userId: 'user-fixture', sessionId: 'session-fixture', soopLinked: true });
function fixture(kind, requiresSoop) {
  const transaction = Object.freeze({ kind });
  const calls = [];
  let revoked = false;
  const transactions = {
    read: async operation => { assert.equal(kind, 'read'); calls.push('begin'); return operation(transaction); },
    write: async operation => { assert.equal(kind, 'write'); calls.push('begin'); return operation(transaction); },
  };
  const auth = { require: async (tx, value, chat = false) => {
    assert.equal(tx, transaction); assert.equal(value, credentials); assert.equal(chat, requiresSoop);
    calls.push('authorize');
    if (revoked) throw new Error('revoked-current-session');
    return principal;
  } };
  const domain = new Proxy({}, { get: (_target, method) => async (tx, ...args) => {
    assert.equal(tx, transaction); assert.equal(calls.at(-1), 'authorize');
    calls.push('domain'); return { method, args };
  } });
  return { transactions, auth, domain, calls, revoke: () => { revoked = true; } };
}

const scenarios = [
  ['self profile read without SOOP', 'read', false, f => new UsersService(f.transactions, f.auth, { key: Buffer.alloc(32) }, f.domain), service => service.self(credentials)],
  ['self profile update without SOOP', 'write', false, f => new UsersService(f.transactions, f.auth, { key: Buffer.alloc(32) }, f.domain), service => service.update(credentials, { nickname: '새 이름' })],
  ['room actor profile read', 'read', true, f => new UsersService(f.transactions, f.auth, { key: Buffer.alloc(32) }, f.domain), service => service.profile(credentials, 'room', 'actor')],
  ['profile revision page', 'read', true, f => new UsersService(f.transactions, f.auth, { key: Buffer.alloc(32) }, f.domain), service => service.revisions(credentials, 'room')],
  ['visible rooms', 'read', true, f => new RoomsService(f.transactions, f.auth, f.domain), service => service.list(credentials)],
  ['room provisioning', 'write', true, f => new RoomsService(f.transactions, f.auth, f.domain), service => service.provision(credentials, {})],
  ['room join', 'write', true, f => new RoomsService(f.transactions, f.auth, f.domain), service => service.join(credentials, 'room')],
  ['room leave', 'write', true, f => new RoomsService(f.transactions, f.auth, f.domain), service => service.leave(credentials, 'room')],
  ['room history policy', 'write', true, f => new RoomsService(f.transactions, f.auth, f.domain), service => service.historyPolicy(credentials, 'room', {})],
  ...['manifest', 'snapshot', 'events', 'history', 'profiles'].map(method => [
    `sync ${method}`, 'read', true, f => new SyncService(f.transactions, f.auth, f.domain),
    service => method === 'manifest' ? service[method](credentials, {}) : service[method](credentials, 'room', {}),
  ]),
];
for (const [name, kind, soop, create, invoke] of scenarios) {
  test(`${name} reauthorizes on the same transaction and refuses a later revoked session`, async () => {
    const f = fixture(kind, soop); const service = create(f);
    await invoke(service);
    assert.deepEqual(f.calls, ['begin', 'authorize', 'domain']);
    f.calls.length = 0; f.revoke();
    await assert.rejects(invoke(service), /revoked-current-session/);
    assert.deepEqual(f.calls, ['begin', 'authorize']);
  });
}
