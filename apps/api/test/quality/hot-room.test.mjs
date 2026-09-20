import { test } from 'node:test';
import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { io } from 'socket.io-client';
import { createUser, createRoom, assignRoomOwner, joinRoom } from '../support/domain-fixture.mjs';
import { newIntentScope } from '../support/membership-scope-fixture.mjs';
import { SessionService } from '../../dist/modules/auth/session.service.js';
import { SessionRepository } from '../../dist/modules/auth/session.repository.js';
import { MysqlDatabase } from '../../dist/infrastructure/database/database.js';
import { readConfig } from '../../dist/infrastructure/config/config.js';
import { child, unusedPort, waitFor, stopChild } from '../helpers.mjs';
import { isolated, batches, distribution, evidence } from './evidence.mjs';

test('1000 isolated sockets: hot-room contention, node-local hints, tail loss and API restart recovery', { timeout: 300000 }, async t => {
  isolated();
  const started = performance.now(), db = new MysqlDatabase(readConfig('api'));
  const directory = await mkdtemp(join(tmpdir(), 'rogi-m12-'));
  const key = randomBytes(32), authFile = join(directory, 'auth.json');
  await writeFile(authFile, JSON.stringify({ key: key.toString('hex') }), { mode: 0o600 });
  const sessions = new SessionService(new SessionRepository(), 'rogi-test', key);
  const people = [], processes = [], ports = [await unusedPort(), await unusedPort()];
  t.after(async () => {
    for (const person of people) person.socket?.disconnect();
    for (const instance of processes) await stopChild(instance);
    await db.close(); await rm(directory, { recursive: true, force: true });
  });
  const room = await db.transactions.write(tx => createRoom(tx, 'M12 disposable hot room', 'GROUP'));
  // Sequential provisioning avoids interpreting fixture admission contention as API load.
  for (let index = 0; index < 1000; index++) {
    people.push(await db.transactions.write(async tx => {
      const id = await createUser(tx, `M12 synthetic ${index}`);
      await tx.prisma.platform_soop.create({ data: { id: randomUUID(), user_id: id,
        provider_subject: Buffer.from(`m12-${randomUUID()}`), verified_at: await tx.now() } });
      const actor = await joinRoom(tx, room, id);
      if (!index) await assignRoomOwner(tx, room, actor);
      return { id, ...await sessions.issue(tx, id), node: index % 2, hints: [],
        deviceId: randomUUID(), cacheId: randomUUID(),
        scope: await newIntentScope(tx, key, 'rogi-test', id, room) };
    }));
  }
  async function start(node) {
    const instance = child('api', { DATABASE_URL: process.env.DATABASE_URL, PORT: String(ports[node]), AUTH_SECRET_FILE: authFile });
    processes.push(instance);
    await waitFor(() => instance.output().includes('started'), 15000);
    assert.equal((await fetch(`http://127.0.0.1:${ports[node]}/ready`)).status, 200);
    return instance;
  }
  const apis = [await start(0), await start(1)];
  function connect(person) {
    person.socket?.disconnect();
    return new Promise((resolve, reject) => {
      const socket = io(`http://127.0.0.1:${ports[person.node]}`, { path: '/v1/realtime', transports: ['websocket'],
        reconnection: false, timeout: 10000, extraHeaders: { Origin: 'http://localhost:3001', Cookie: `rogi_session=${person.token}` },
        auth: { schemaVersion: 1, csrfToken: person.csrf } });
      person.socket = socket;
      socket.on('sync.required', value => person.hints.push(value));
      socket.once('connect', resolve); socket.once('connect_error', reject);
    });
  }
  const connectionStart = performance.now();
  for (let offset = 0; offset < people.length; offset += 50) {
    await batches(people.slice(offset, offset + 50), 10, connect);
    await delay(1100); // Stay within the unchanged 100 admissions/sec/node policy.
  }
  assert.equal(people.filter(p => p.socket.connected).length, 1000);
  const connectMs = performance.now() - connectionStart;
  const headers = p => ({ Origin: 'http://localhost:3001', Cookie: `rogi_session=${p.token}`, 'X-CSRF-Token': p.csrf, 'Content-Type': 'application/json' });
  const ackTimes = [], syncTimes = [];
  async function send(person, command = randomUUID(), node = person.node) {
    const before = performance.now();
    const response = await fetch(`http://127.0.0.1:${ports[node]}/v1/rooms/${room}/messages`, {
      method: 'POST', headers: headers(person), signal: AbortSignal.timeout(15000),
      body: JSON.stringify({ membershipScope: person.scope, clientMessageId: command, intent: 'SHARED', content: { type: 'TEXT', text: 'M12 isolated content' } }) });
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body)); assert.equal(body.status, 'committed');
    ackTimes.push(performance.now() - before); return body;
  }
  async function snapshot(person) {
    const before = performance.now();
    const query = new globalThis.URLSearchParams({ deviceId: person.deviceId, cacheId: person.cacheId, limit: '100' });
    const response = await fetch(`http://127.0.0.1:${ports[person.node]}/v1/rooms/${room}/snapshot?${query}`, { headers: headers(person), signal: AbortSignal.timeout(15000) });
    const body = await response.json(); assert.equal(response.status, 200, JSON.stringify(body));
    syncTimes.push(performance.now() - before); return body;
  }
  // Eight simultaneously admitted distinct senders contend on one room sequence across two OS processes.
  const loadStart = performance.now();
  const sent = await batches(people.slice(0, 80), 8, person => send(person));
  const loadMs = performance.now() - loadStart;
  assert.equal(new Set(sent.map(row => row.messageId)).size, 80);
  const retries = await Promise.all([send(people[0], sent[0].clientMessageId, 0), send(people[0], sent[0].clientMessageId, 1)]);
  for (const retry of retries) assert.deepEqual(retry, sent[0]);
  const expected = sent.map(row => row.messageId).sort();
  await batches(people, 8, async person => {
    const result = await snapshot(person);
    assert.deepEqual(result.messages.map(row => row.id).sort(), expected);
    for (const message of result.messages) {
      assert.equal(message.content.text, 'M12 isolated content');
      assert.equal(Object.hasOwn(message, 'user_id'), false);
    }
  });
  const hintCounts = [0, 1].map(node => people.filter(p => p.node === node && p.hints.length).length);
  for (const person of people) for (const hint of person.hints) assert.deepEqual(hint, { schemaVersion: 1 });
  // A disconnected tail recipient gets no hint and no subsequent message is sent to wake it.
  const witness = people[999]; witness.socket.disconnect(); const hintsBefore = witness.hints.length;
  const tail = await send(people[80]);
  const tailStart = performance.now();
  await delay(300); assert.equal(witness.hints.length, hintsBefore);
  assert.ok((await snapshot(witness)).messages.some(row => row.id === tail.messageId));
  const tailRecoveryMs = performance.now() - tailStart;
  await connect(witness);
  // Real process death; reconnects are explicitly paced foreground reconnects, not automatic backoff validation.
  const restartStart = performance.now();
  apis[0].proc.kill('SIGKILL'); assert.deepEqual(await apis[0].exited, [null, 'SIGKILL']);
  await waitFor(() => people.filter(p => p.node === 0).every(p => !p.socket.connected));
  apis[0] = await start(0);
  const reconnect = people.filter(p => p.node === 0);
  for (let offset = 0; offset < reconnect.length; offset += 50) {
    await batches(reconnect.slice(offset, offset + 50), 10, connect); await delay(1100);
  }
  await batches(reconnect, 8, async person => {
    const ids = (await snapshot(person)).messages.map(row => row.id).sort();
    assert.deepEqual(ids, [...expected, tail.messageId].sort());
  });
  assert.equal(people.filter(p => p.socket.connected).length, 1000);
  const restartRecoveryMs = performance.now() - restartStart;
  const totals = await db.transactions.read(async tx => ({ messages: await tx.prisma.messages.count({ where: { room_id: room } }),
    receipts: await tx.prisma.command_receipts.count({ where: { room_id: room } }), events: await tx.prisma.room_events.count({ where: { room_id: room } }) }));
  assert.deepEqual(totals, { messages: 81, receipts: 81, events: 81 });
  for (const instance of processes) for (const secret of [people[0].token, key.toString('hex'), 'M12 isolated content']) assert.ok(!instance.output().includes(secret));
  await evidence('hot-room', { outcome: 'passed', topology: 'two local API processes, MySQL, node-local lossy hints; REST recovery',
    concurrentSockets: 1000, distinctAccounts: 1000, socketsPerProcess: 500, connectionRampMs: connectMs,
    concurrentSenders: 8, hotRoomCommands: 80, crossProcessIdempotentRetries: 2, hotRoomDurationMs: loadMs, commandsPerSecond: 80000 / loadMs,
    ack: distribution(ackTimes), restSnapshot: distribution(syncTimes), hintRecipientsPerProcess: hintCounts,
    tailLossRecoveryMs: tailRecoveryMs, killedApiRecoveryMs: restartRecoveryMs, recoveredSockets: 1000,
    totals, totalDurationMs: performance.now() - started,
    limitations: ['no Redis adapter or cross-node delivery guarantee', 'REST latency is not rendered screen latency',
      'no 30-minute soak, video overlap or production capacity claim', 'paced explicit reconnect, not automatic reconnect storm'] });
});
