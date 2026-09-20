import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { setTimeout as delay } from 'node:timers/promises';
import { createUser, createRoom, joinRoom, sendMessage, sendInput } from '../support/domain-fixture.mjs';
import { readConfig } from '../../dist/infrastructure/config/config.js';
import { MysqlDatabase } from '../../dist/infrastructure/database/database.js';
import { SessionRepository } from '../../dist/modules/auth/session.repository.js';
import { SessionService } from '../../dist/modules/auth/session.service.js';
import { PushEnqueueModule, PushEnqueueService } from '../../dist/modules/notifications/push-enqueue.service.js';
import { JobsCoreService } from '../../dist/modules/jobs/jobs-core.service.js';
import { NotificationFanoutService } from '../../dist/modules/notifications/notification-fanout.service.js';
import { NotificationFanoutRepository } from '../../dist/modules/notifications/notification-fanout.repository.js';

async function fixture(t, count) {
  assert.equal(process.env.ROGICHAT_TEST_MYSQL, 'disposable');
  const db = new MysqlDatabase(readConfig('api'));
  const context = await NestFactory.createApplicationContext(PushEnqueueModule, { logger: false, abortOnError: false });
  t.after(async () => { await context.close(); await db.close(); });
  const key = randomBytes(32), audience = 'rogi-test';
  const sessions = new SessionService(new SessionRepository(), audience, key);
  const state = await db.transactions.write(async tx => {
    const sender = await createUser(tx, '발송 합성 작성자'), recipient = await createUser(tx, '발송 합성 수신자');
    await tx.execute('INSERT INTO platform_soop (id,user_id,provider_subject,verified_at) VALUES (?,?,?,UTC_TIMESTAMP(3))', [randomUUID(), recipient, Buffer.from(randomUUID())]);
    const room = await createRoom(tx, '발송 합성 방', 'GROUP');
    await joinRoom(tx, room, sender); await joinRoom(tx, room, recipient);
    const session = await sessions.issue(tx, recipient);
    const principal = await sessions.require(tx, session.token, session.csrf);
    const user = await tx.prisma.users.findUnique({ where: { id: recipient }, select: { membership_generation: true } });
    await tx.prisma.notification_preferences.create({ data: { user_id: recipient, push_enabled: true, updated_at: new Date(0) } });
    const subscriptions = Array.from({ length: count }, () => {
      const id = randomUUID(), endpoint = `https://fcm.googleapis.com/fanout-fixture/${id}`;
      return { id, user_id: recipient, session_id: principal.sessionId, audience, endpoint,
        endpoint_digest: new Uint8Array(createHash('sha256').update(endpoint).digest()),
        p256dh: 'synthetic-unused-key', auth_secret: 'synthetic-unused-auth', account_generation: user.membership_generation,
        updated_at: new Date(0) };
    });
    await tx.prisma.push_subscriptions.createMany({ data: subscriptions });
    return { sender, recipient, room };
  });
  const message = await db.transactions.write(tx => sendMessage(tx, state.room, state.sender,
    sendInput({ clientMessageId: randomUUID(), intent: 'SHARED', content: { type: 'TEXT', text: '합성 알림 내용' } }), key));
  const job = await db.transactions.read(tx => tx.prisma.jobs.findFirst({ where: { purpose: 'PUSH', room_id: null, resource_id: message.messageId }, select: { id: true } }));
  assert.ok(job, 'message commit must persist body-free fanout intent');
  const lease = { id: job.id, purpose: 'PUSH', roomId: null, resourceId: message.messageId,
    generation: 1n, leaseOwner: randomUUID(), leaseToken: randomUUID(), attempts: 1, maxAttempts: 5 };
  await db.transactions.write(async tx => tx.prisma.jobs.update({ where: { id: job.id }, data: {
    state: 'RUNNING', generation: lease.generation, lease_owner: lease.leaseOwner, lease_token: lease.leaseToken,
    lease_until: new Date((await tx.now()).getTime() + 30000), attempts: 1,
  }, select: { id: true } }));
  const repository = new NotificationFanoutRepository();
  const service = new NotificationFanoutService(db.transactions, repository, context.get(PushEnqueueService), context.get(JobsCoreService), audience);
  const deliveries = () => db.transactions.read(tx => tx.prisma.push_deliveries.count({ where: { message_id: message.messageId } }));
  return { db, ...state, message, lease, repository, service, deliveries };
}

test('fanout persists all recipients across bounded pages and duplicate processing never recreates delivery', { timeout: 30000 }, async t => {
  const f = await fixture(t, 55);
  assert.equal((await f.db.transactions.read(tx => f.repository.candidates(tx, f.message.messageId, 'rogi-test', undefined))).length, 50);
  assert.equal(await f.service.consume(f.lease), 'completed');
  assert.equal(await f.deliveries(), 55);
  assert.equal(await f.service.consume(f.lease), 'lease_lost');
  assert.equal(await f.deliveries(), 55);
});

test('stale fanout lease rolls intent creation back and a later preference change excludes old events', { timeout: 20000 }, async t => {
  const f = await fixture(t, 1);
  await f.db.transactions.write(tx => tx.prisma.jobs.update({ where: { id: f.lease.id }, data: { generation: 2n }, select: { id: true } }));
  assert.equal(await f.service.consume(f.lease), 'lease_lost');
  assert.equal(await f.deliveries(), 0);
  await f.db.transactions.write(async tx => {
    const message = await tx.prisma.messages.findUnique({ where: { id: f.message.messageId }, select: { created_at: true } });
    await tx.prisma.notification_preferences.update({ where: { user_id: f.recipient }, data: { generation: 3n, updated_at: new Date(message.created_at.getTime() + 1) }, select: { user_id: true } });
  });
  assert.equal(await f.service.consume({ ...f.lease, generation: 2n }), 'completed');
  assert.equal(await f.deliveries(), 0);
});

test('fanout cannot renew a lease that expires while waiting for the job lock', { timeout: 10000 }, async t => {
  for (const count of [0, 1]) await t.test(`recipient count ${count}`, async t => {
  const f = await fixture(t, count);
  let acquired;
  const locked = new Promise(resolve => { acquired = resolve; });
  let release;
  const held = new Promise(resolve => { release = resolve; });
  await f.db.transactions.write(async tx => tx.prisma.jobs.update({ where: { id: f.lease.id },
    data: { lease_until: new Date((await tx.now()).getTime() + 500) }, select: { id: true } }));
  const holder = f.db.transactions.write(async tx => {
    await tx.rows('SELECT id FROM jobs WHERE id=? FOR UPDATE', [f.lease.id]);
    acquired(); await held;
  });
  await locked;
  const pending = f.service.consume(f.lease);
  try { await delay(1000); } finally { release(); }
  await holder;
  assert.equal(await pending, 'lease_lost');
  assert.equal(await f.deliveries(), 0);
  });
});
