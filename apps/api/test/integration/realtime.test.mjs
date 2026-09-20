import { createUser, createRoom, joinRoom, leaveRoom, sendMessage, sendInput, deleteMessage, enqueueJob, Jobs } from '../support/domain-fixture.mjs';
import { NestFactory } from '@nestjs/core';
import { RealtimeModule } from '../../dist/modules/realtime/realtime.module.js';
import { RealtimeService } from '../../dist/modules/realtime/realtime.service.js';
import { DatabaseModule } from '../../dist/infrastructure/database/database.module.js';
import { AuthModule } from '../../dist/modules/auth/auth.module.js';
import { SessionRepository } from '../../dist/modules/auth/session.repository.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { io } from 'socket.io-client';
import { readConfig } from '../../dist/infrastructure/config/config.js';
import { MysqlDatabase } from '../../dist/infrastructure/database/database.js';
import { SessionService } from '../../dist/modules/auth/session.service.js';
import { RealtimeGateway } from '../../dist/modules/realtime/realtime.gateway.js';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function fixture(t) {
  assert.equal(process.env.ROGICHAT_TEST_MYSQL, 'disposable');
  const db = new MysqlDatabase(readConfig('api'));
  let gateway; const clients = [];
  t.after(async () => { try { for (const client of clients) client.disconnect(); await gateway?.stop(); } finally { await db.close(); } });
  const config = { audience: `realtime-${randomBytes(8).toString('hex')}`, origin: 'http://localhost:3001', secure: false, key: randomBytes(32) };
  const sessions = new SessionService(new SessionRepository(), config.audience, config.key);
  const user = name => db.transactions.write(async tx => {
    const id = await createUser(tx, name);
    await tx.execute('INSERT INTO platform_soop (id,user_id,provider_subject,verified_at) VALUES (?,?,?,UTC_TIMESTAMP(3))', [randomUUID(), id, Buffer.from(`fixture-${randomUUID()}`)]);
    return { id, ...await sessions.issue(tx, id), hints: [] };
  });
  const owner = await user('실시간 방장'), a = await user('실시간 팬 하나'), b = await user('실시간 팬 둘'), newcomer = await user('실시간 신규팬');
  const room = await db.transactions.write(async tx => {
    const id = await createRoom(tx, '실시간 합성방', 'FAN');
    for (const person of [owner, a, b]) person.actor = await joinRoom(tx, id, person.id);
    await tx.execute("UPDATE room_members SET role='STREAMER' WHERE id=?", [owner.actor]);
    await tx.execute('UPDATE rooms SET owner_member_id=? WHERE id=?', [owner.actor, id]);
    return id;
  });
  const server = createServer((_request, response) => response.end());
  const infrastructure = DatabaseModule.register({ database: db, externallyOwned: true });
  const context = await NestFactory.createApplicationContext(RealtimeModule.register(infrastructure, AuthModule.register(infrastructure, { config, sessions })), { logger: false, abortOnError: false });
  t.after(() => context.close());
  gateway = new RealtimeGateway(server, context.get(RealtimeService), config, { draining: false }, new Jobs(db.transactions, 'api'), { chunkSize: 2 });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  for (const person of [owner, a, b, newcomer]) {
    const client = io(`http://127.0.0.1:${server.address().port}`, { path: '/v1/realtime', transports: ['websocket'],
      reconnection: false, extraHeaders: { Origin: config.origin, Cookie: `rogi_session=${person.token}` },
      auth: { schemaVersion: 1, csrfToken: person.csrf } });
    clients.push(client); person.client = client;
    client.on('sync.required', payload => person.hints.push(payload));
    await new Promise((resolve, reject) => { client.once('connect', resolve); client.once('connect_error', reject); });
  }
  const send = (person, intent, target) => db.transactions.write(async tx => {
    await sessions.require(tx, person.token, person.csrf, true);
    return sendMessage(tx, room, person.id, sendInput({ clientMessageId: randomUUID(), intent,
      ...(target ? { recipientActorId: target.actor } : {}), content: { type: 'TEXT', text: 'wire에 들어가면 안 되는 합성 본문' } }), config.key);
  });
  const drain = async () => {
    for (let attempt = 0; attempt < 20; attempt++) {
      await gateway.tick();
      const [row] = await db.transactions.read(tx => tx.rows("SELECT COUNT(*) AS count FROM jobs WHERE purpose='REALTIME_HINT' AND state='PENDING' AND available_at<=UTC_TIMESTAMP(3)"));
      if (Number(row.count) === 0) { await pause(20); return; }
    }
    throw new Error('fixture_hint_drain_exhausted');
  };
  const counts = () => [owner, a, b, newcomer].map(person => person.hints.length);
  const clear = () => { for (const person of [owner, a, b, newcomer]) person.hints.length = 0; };
  return { db, config, sessions, gateway, owner, a, b, newcomer, room, send, drain, counts, clear };
}

test('real DB private/shared hint audience, deleted-message invalidation and current grant/period/session guards', { timeout: 30000 }, async t => {
  const f = await fixture(t);
  const privateMessage = await f.send(f.a, 'PRIVATE', f.owner);
  await f.drain(); assert.deepEqual(f.counts(), [1, 1, 0, 0]);
  assert.deepEqual(f.a.hints[0], { schemaVersion: 1 });
  f.clear();
  await deleteMessage(f.db.transactions, f.room, f.a.id, privateMessage.messageId);
  await f.drain(); assert.deepEqual(f.counts(), [1, 1, 0, 0]);
  f.clear();
  await f.send(f.owner, 'SHARED');
  // New member must not be awakened by a queued pre-join message under SINCE_JOIN.
  f.newcomer.actor = await f.db.transactions.write(tx => joinRoom(tx, f.room, f.newcomer.id));
  await f.drain(); assert.deepEqual(f.counts(), [1, 1, 1, 0]);
  f.clear();
  const revoked = await f.send(f.a, 'PRIVATE', f.owner);
  await f.db.transactions.write(tx => tx.execute(`UPDATE stream_grants g JOIN messages m ON m.room_id=g.room_id AND m.stream_id=g.stream_id
    SET g.expires_at=TIMESTAMPADD(SECOND,-1,UTC_TIMESTAMP(3)) WHERE m.id=? AND g.member_id=?`, [revoked.messageId, f.a.actor]));
  await f.drain(); assert.deepEqual(f.counts(), [1, 0, 0, 0]);
  f.clear();
  await f.send(f.owner, 'SHARED');
  await f.db.transactions.write(tx => leaveRoom(tx, f.room, f.b.id));
  await f.db.transactions.write(tx => f.sessions.revoke(tx, f.a.token, f.a.csrf));
  await f.drain(); assert.deepEqual(f.counts(), [1, 0, 0, 1]);
});

test('profile change discriminators reveal only current visible projection audiences, not hidden birthdays', { timeout: 30000 }, async t => {
  const f = await fixture(t);
  const change = (person, publicChanged, streamerChanged) => f.db.transactions.write(async tx => {
    const id = randomUUID();
    await tx.execute('INSERT INTO profile_changes (id,user_id,public_changed,streamer_changed) VALUES (?,?,?,?)', [id, person.id, publicChanged, streamerChanged]);
    await enqueueJob(tx, { purpose: 'REALTIME_HINT', resourceId: id });
  });
  await change(f.a, false, true); await f.drain(); assert.deepEqual(f.counts(), [1, 0, 0, 0]); f.clear();
  await change(f.a, true, false); await f.drain(); assert.deepEqual(f.counts(), [1, 1, 0, 0]); f.clear();
  await change(f.owner, true, false); await f.drain(); assert.deepEqual(f.counts(), [1, 1, 1, 0]); f.clear();
  await change(f.a, false, false); await f.drain(); assert.deepEqual(f.counts(), [0, 0, 0, 0]);
  const bad = await f.db.transactions.write(tx => enqueueJob(tx, { purpose: 'REALTIME_HINT', resourceId: f.a.id }));
  await f.drain();
  const [failed] = await f.db.transactions.read(tx => tx.rows('SELECT state,last_error_code FROM jobs WHERE id=?', [bad]));
  assert.equal(failed.state, 'FAILED'); assert.equal(failed.last_error_code, 'INVALID_RESOURCE');
});

test('claimed hint survives API loss and stale completion; transport replay stays body-free and bounded', { timeout: 30000 }, async t => {
  const f = await fixture(t); await f.drain(); f.clear();
  const sent = await f.send(f.a, 'PRIVATE', f.owner);
  const queue = new Jobs(f.db.transactions, 'api');
  const leases = await queue.claim();
  const [event] = await f.db.transactions.read(tx => tx.rows('SELECT id FROM room_events WHERE message_id=?', [sent.messageId]));
  const lost = leases.find(lease => lease.resourceId === event.id); assert.ok(lost);
  for (const lease of leases) {
    await f.db.transactions.write(tx => tx.execute('UPDATE jobs SET lease_until=TIMESTAMPADD(SECOND,-1,UTC_TIMESTAMP(3)) WHERE id=?', [lease.id]));
  }
  await f.drain(); assert.deepEqual(f.counts(), [1, 1, 0, 0]);
  assert.equal(await queue.complete(lost), false);
  const [row] = await f.db.transactions.read(tx => tx.rows('SELECT state,generation FROM jobs WHERE id=?', [lost.id]));
  assert.equal(row.state, 'COMPLETED'); assert.equal(String(row.generation), '2');
  assert.deepEqual(f.a.hints, [{ schemaVersion: 1 }]);
});
