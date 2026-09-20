import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { RealtimeModule } from '../../dist/modules/realtime/realtime.module.js';
import { Transactions } from '../../dist/infrastructure/database/transactions.js';
import { LifecycleState } from '../../dist/common/lifecycle/lifecycle-state.js';
import { AuthService } from '../../dist/modules/auth/auth.service.js';
import { AUTH_CONFIG } from '../../dist/modules/auth/auth.tokens.js';
import { Jobs } from '../support/domain-fixture.mjs';
import { RealtimeService } from '../../dist/modules/realtime/realtime.service.js';
import { RealtimeRepository } from '../../dist/modules/realtime/realtime.repository.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { io } from 'socket.io-client';
import { RealtimeGateway, socketCredentials } from '../../dist/modules/realtime/realtime.gateway.js';
import { DatabaseUnavailableError } from '../../dist/infrastructure/database/database-unavailable.js';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
test('realtime policy keeps its fixed ceiling despite ordinary HTTP headroom', () => {
  const server = createServer();
  for (const maxConnections of [1001, Infinity, 0, 1.5]) {
    assert.throws(() => new RealtimeGateway(server, {}, {}, {}, {}, { maxConnections }), /invalid_realtime_policy/);
  }
});

async function fixture(t, options = {}) {
  const tokens = new Map(); const allowed = new Set(); const completed = []; const retried = []; const queries = [];
  const config = { audience: 'realtime-unit', origin: 'http://localhost:3001', secure: false, key: randomBytes(32) };
  const tx = {
    now: async () => new Date('2026-09-20T00:00:00Z'),
    prisma: {
      rate_buckets: { createMany: async () => ({ count: 1 }), updateMany: async () => ({ count: 1 }) },
      auth_sessions: { findMany: async () => [...allowed].map(id => ({ id })) },
      room_events: { findMany: async input => { queries.push({ sql: 'room_events.findMany', params: input.where.OR }); return input.where.OR; } },
      profile_changes: { findMany: async () => [] },
    },
    async rows(sql, params) {
      queries.push({ sql, params });
      if (sql.includes('FROM rate_buckets')) return [{ used: 0, expired: 0 }];
      if (sql.includes('SELECT s.id FROM auth_sessions')) return [...allowed].map(id => ({ id }));
      if (sql.includes('FROM room_events')) return Array.from({ length: params.length / 2 }, (_, i) => ({ id: params[i * 2], room_id: params[i * 2 + 1] }));
      return [];
    },
    async execute() { return { affectedRows: 1 }; },
  };
  const auth = { config, sessions: { transactions: { read: operation => operation(tx), write: operation => operation(tx) },
    async require(_tx, token, csrf, chat) {
      const found = tokens.get(token);
      if (!found || csrf !== found.csrf || chat !== true) throw new Error('private-auth-detail');
      return found;
    } } };
  const server = createServer((_request, response) => response.end());
  const lifecycle = { draining: false }; const gateway = new RealtimeGateway(server, new RealtimeService(auth.sessions.transactions, { require: (tx, credentials, chat) => auth.sessions.require(tx, credentials.token, credentials.csrf, chat) }, config, new RealtimeRepository()), config, lifecycle, new Jobs(auth.sessions.transactions, 'api'), options);
  let leases = []; let claims = 0; let hold;
  gateway.jobs = {
    async claim(input) { assert.deepEqual(input, { purposes: ['REALTIME_HINT'], limit: 20 }); claims++; if (hold) await hold; return leases.splice(0, 20); },
    async complete(lease) { completed.push(lease.id); return true; },
    async retry(lease, code, options) { retried.push({ id: lease.id, code, options }); return true; },
  };
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const clients = [];
  t.after(async () => { for (const client of clients) client.disconnect(); await gateway.stop(); });
  const user = (userId = randomUUID()) => {
    const person = { userId, sessionId: randomUUID(), token: randomBytes(32).toString('base64url'), csrf: randomBytes(32).toString('base64url') };
    tokens.set(person.token, person); allowed.add(person.sessionId); return person;
  };
  const connect = async (person, overrides = {}) => {
    const client = io(`http://127.0.0.1:${server.address().port}`, {
      path: '/v1/realtime', transports: ['websocket'], reconnection: false, timeout: 2000,
      extraHeaders: { Origin: config.origin, Cookie: `rogi_session=${person.token}` },
      auth: { schemaVersion: 1, csrfToken: person.csrf }, ...overrides,
    });
    clients.push(client);
    await new Promise((resolve, reject) => { client.once('connect', resolve); client.once('connect_error', reject); });
    return client;
  };
  const enqueue = (roomId = randomUUID(), resourceId = randomUUID()) => { const id = randomUUID(); leases.push({ id, roomId, resourceId, purpose: 'REALTIME_HINT' }); return id; };
  return { gateway, lifecycle, auth, user, connect, enqueue, completed, retried, queries, allowed, get claims() { return claims; }, hold: value => { hold = value; } };
}

test('socket credentials require exact Origin, version, CSRF and one HttpOnly-cookie binding', () => {
  const token = randomBytes(32).toString('base64url'), csrf = randomBytes(32).toString('base64url');
  const auth = { config: { origin: 'https://chat.example', secure: true } };
  const request = { headers: { origin: auth.config.origin, cookie: `__Host-rogi_session=${token}` } };
  assert.deepEqual(socketCredentials(request, { schemaVersion: 1, csrfToken: csrf }, auth.config), { token, csrf });
  for (const input of [{ schemaVersion: 2, csrfToken: csrf }, { schemaVersion: 1 }, { schemaVersion: 1, csrfToken: csrf, roomId: randomUUID() }, null]) {
    assert.throws(() => socketCredentials(request, input, auth.config));
  }
  for (const headers of [{ ...request.headers, origin: undefined }, { ...request.headers, origin: 'https://attacker.example' },
    { ...request.headers, cookie: `${request.headers.cookie}; ${request.headers.cookie}` }, { ...request.headers, cookie: 'x'.repeat(8193) }]) {
    assert.throws(() => socketCredentials({ headers }, { schemaVersion: 1, csrfToken: csrf }, auth.config));
  }
});

test('real socket handshake fails closed and bounds concurrent account connections', { timeout: 10000 }, async t => {
  const f = await fixture(t, { maxPerAccount: 1, maxConnections: 3 });
  const person = f.user(); await f.connect(person);
  assert.deepEqual(f.gateway.stats(), { connections: 1, accounts: 1, dispatching: false });
  await assert.rejects(f.connect(f.user(person.userId)), /UNAUTHENTICATED/);
  await assert.rejects(f.connect(f.user(), { auth: { schemaVersion: 1, csrfToken: randomBytes(32).toString('base64url') } }), /UNAUTHENTICATED/);
  await assert.rejects(f.connect(f.user(), { extraHeaders: { Origin: 'https://attacker.example' } }));
  await assert.rejects(f.connect(f.user(), { transports: ['polling'] }));
  f.lifecycle.draining = true;
  await assert.rejects(f.connect(f.user()));
});

test('hint dispatch is nonoverlapping, bounded and coalesces twenty references to one body-free event', { timeout: 10000 }, async t => {
  const f = await fixture(t); const person = f.user(); const client = await f.connect(person);
  const events = []; client.on('sync.required', payload => events.push(payload));
  for (let n = 0; n < 20; n++) f.enqueue();
  let release; f.hold(new Promise(resolve => { release = resolve; }));
  const first = f.gateway.tick(); const second = f.gateway.tick(); assert.equal(first, second);
  release(); await first; await pause(30);
  assert.equal(f.claims, 1); assert.equal(f.completed.length, 20);
  assert.deepEqual(events, [{ schemaVersion: 1 }]);
  assert.ok(f.queries.some(({ sql }) => sql.includes('msg.created_order>=p.visible_from_order') && sql.includes('g.revoked_at IS NULL')));
  f.allowed.delete(person.sessionId); f.enqueue(); await f.gateway.tick(); await pause(30);
  assert.equal(events.length, 1);
});

test('client-selected channels are forbidden and engine shutdown signals transport reconnect semantics', { timeout: 10000 }, async t => {
  const f = await fixture(t); const client = await f.connect(f.user());
  const closed = new Promise(resolve => client.once('disconnect', resolve)); client.emit('join', randomUUID());
  assert.equal(await closed, 'io server disconnect');
  const other = await f.connect(f.user());
  const drained = new Promise(resolve => other.once('disconnect', resolve));
  await f.gateway.stop(); assert.equal(await drained, 'transport close');
  assert.equal(f.gateway.stats().connections, 0);
});

test('missing typed hint resource is terminal and a slow transport cannot accumulate hints', { timeout: 10000 }, async t => {
  const f = await fixture(t); const client = await f.connect(f.user());
  const malformed = f.enqueue(null, randomUUID()); await f.gateway.tick();
  assert.deepEqual(f.retried, [{ id: malformed, code: 'INVALID_RESOURCE', options: { terminal: true } }]);
  const connection = [...f.gateway.connections.values()][0];
  connection.socket.conn.transport.writable = false;
  const closed = new Promise(resolve => client.once('disconnect', resolve));
  f.enqueue(); await f.gateway.tick(); assert.equal(await closed, 'transport close');
  assert.equal(f.gateway.stats().connections, 0);
});

test('automatic dispatcher uses a five-second idle interval and short active interval', { timeout: 10000 }, async t => {
  for (const active of [false, true]) {
    const f = await fixture(t);
    if (active) await f.connect(f.user());
    const delays = [];
    const mocked = t.mock.method(globalThis, 'setTimeout', (_callback, delay) => { delays.push(delay); return { unref() {} }; });
    try { f.gateway.start(); assert.deepEqual(delays, [active ? 250 : 5000]); }
    finally { mocked.mock.restore(); }
    await f.gateway.stop();
  }
});


test('Nest owns realtime attachment after HTTP initialization and closes the transport', async t => {
  const config = { audience: 'realtime-nest-unit', origin: 'http://localhost:3001', secure: false, key: randomBytes(32) };
  const tx = {
    now: async () => new Date('2026-09-20T00:00:00Z'),
    rows: async () => [{ used: 0, expired: 0 }],
    execute: async () => ({ affectedRows: 1 }),
    prisma: { rate_buckets: { createMany: async () => ({ count: 1 }), updateMany: async () => ({ count: 1 }) } },
  };
  class InfrastructureFixture {} class AuthFixture {}
  Module({})(InfrastructureFixture); Module({})(AuthFixture);
  const infrastructure = { module: InfrastructureFixture, providers: [
    { provide: Transactions, useValue: { read: run => run(tx), write: run => run(tx) } },
    { provide: LifecycleState, useValue: new LifecycleState() },
  ], exports: [Transactions, LifecycleState] };
  const authentication = { module: AuthFixture, providers: [
    { provide: AUTH_CONFIG, useValue: config },
    { provide: AuthService, useValue: { require: async handle => { assert.equal(handle, tx); return { userId: randomUUID(), sessionId: randomUUID(), soopLinked: true }; } } },
  ], exports: [AUTH_CONFIG, AuthService] };
  const app = await NestFactory.create(RealtimeModule.register(infrastructure, authentication, true), { logger: false, abortOnError: false });
  t.after(() => app.close());
  await app.listen(0, '127.0.0.1');
  const client = io(await app.getUrl(), { path: '/v1/realtime', transports: ['websocket'], reconnection: false,
    extraHeaders: { Origin: config.origin, Cookie: `rogi_session=${'a'.repeat(43)}` }, auth: { schemaVersion: 1, csrfToken: 'b'.repeat(43) } });
  t.after(() => client.disconnect());
  await new Promise((resolve, reject) => { client.once('connect', resolve); client.once('connect_error', reject); });
  assert.equal(app.get(RealtimeGateway).stats().connections, 1);
  const disconnected = new Promise(resolve => client.once('disconnect', resolve));
  await app.close();
  assert.equal(await disconnected, 'transport close');
});

test('temporary admission failure keeps automatic reconnect active without accepting unauthenticated sockets', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  const admit = f.gateway.service.admit.bind(f.gateway.service);
  let attempts = 0;
  f.gateway.service.admit = credentials => {
    if (++attempts === 1) throw new DatabaseUnavailableError('database_admission');
    return admit(credentials);
  };
  const person = f.user();
  const client = io(`http://127.0.0.1:${f.gateway.io.httpServer.address().port}`, {
    path: '/v1/realtime', transports: ['websocket'], reconnection: true,
    reconnectionDelay: 30, reconnectionDelayMax: 50, randomizationFactor: 0,
    extraHeaders: { Origin: f.auth.config.origin, Cookie: `rogi_session=${person.token}` },
    auth: { schemaVersion: 1, csrfToken: person.csrf },
  });
  t.after(() => client.disconnect());
  const errors = [];
  let reconnects = 0;
  client.io.on('reconnect_attempt', () => { reconnects++; assert.equal(f.gateway.stats().connections, 0); });
  client.on('connect_error', error => errors.push(error.message));
  await new Promise(resolve => client.once('connect', resolve));
  assert.equal(attempts, 2);
  assert.equal(reconnects, 1);
  assert.ok(errors.every(message => message !== 'UNAUTHENTICATED'));
  assert.equal(f.gateway.stats().connections, 1);
});
