import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, randomBytes, randomUUID } from 'node:crypto';
import { createUser, createRoom, assignRoomOwner, joinRoom, sendMessage, activeMember, loadMessage, readable, leaveRoom } from '../support/domain-fixture.mjs';
import { readConfig } from '../../dist/infrastructure/config/config.js';
import { MysqlDatabase } from '../../dist/infrastructure/database/database.js';
import { SessionService } from '../../dist/modules/auth/session.service.js';
import { SessionRepository } from '../../dist/modules/auth/session.repository.js';
import { NotificationsCoreService } from '../../dist/modules/notifications/notifications-core.service.js';
import { NotificationsRepository } from '../../dist/modules/notifications/notifications.repository.js';
import { PushEnqueueService } from '../../dist/modules/notifications/push-enqueue.service.js';
import { PushEnqueueRepository } from '../../dist/modules/notifications/push-enqueue.repository.js';
import { PushDeliveryService } from '../../dist/modules/notifications/push-delivery.service.js';
import { PushDeliveryRepository } from '../../dist/modules/notifications/push-delivery.repository.js';
import { JobsCoreService } from '../../dist/modules/jobs/jobs-core.service.js';
import { JobsRepository } from '../../dist/modules/jobs/jobs.repository.js';
import { Jobs } from '../../dist/modules/jobs/jobs.service.js';

const barrier = () => { let release; return { wait: new Promise(resolve => { release = resolve; }), release: () => release() }; };
async function fixture(t) {
  assert.equal(process.env.ROGICHAT_TEST_MYSQL, 'disposable');
  const db = new MysqlDatabase(readConfig('api')); t.after(() => db.close());
  const txs = db.transactions; const key = randomBytes(32); const audience = 'rogi-test';
  const sessions = new SessionService(new SessionRepository(), audience, key);
  const notifications = new NotificationsCoreService(new NotificationsRepository());
  const jobs = new JobsCoreService(new JobsRepository());
  const producer = new PushEnqueueService(jobs, new PushEnqueueRepository());
  const queue = new Jobs(txs, 'worker', new JobsRepository(), jobs);
  const point = createECDH('prime256v1'); point.generateKeys();
  const input = { endpoint: `https://fcm.googleapis.com/send/${randomUUID()}`, keys: { p256dh: point.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') } };
  const f = await txs.write(async tx => {
    const sender = await createUser(tx, '합성 발신자'); const recipient = await createUser(tx, '합성 수신자');
    for (const userId of [sender, recipient]) await tx.prisma.platform_soop.create({ data: { id: randomUUID(), user_id: userId, provider_subject: randomBytes(24), verified_at: await tx.now() } });
    const issued = await sessions.issue(tx, recipient); const principal = await sessions.require(tx, issued.token);
    const room = await createRoom(tx, '푸시 합성방', 'GROUP'); await assignRoomOwner(tx, room, await joinRoom(tx, room, sender)); const member = await joinRoom(tx, room, recipient);
    await notifications.setPreferences(tx, recipient, true);
    const subscription = await notifications.register(tx, principal, audience, input);
    return { sender, recipient, room, member, issued, principal, subscription };
  });
  const message = await txs.write(tx => sendMessage(tx, f.room, f.sender, { clientMessageId: randomUUID(), intent: 'SHARED', content: { type: 'TEXT', text: 'private fixture body must never enter a push job' } }, key));
  const intentId = await txs.write(tx => producer.enqueue(tx, { messageId: message.messageId, subscriptionId: f.subscription.id }));
  assert.ok(intentId);
  // Claim exactly this test's job without consuming other tests' fanout jobs.
  const lease = await txs.write(async tx => {
    const job = await tx.prisma.jobs.findFirstOrThrow({ where: { purpose: 'PUSH', resource_id: intentId }, select: { id: true, room_id: true } });
    const token = randomUUID();
    await tx.prisma.jobs.update({ where: { id: job.id }, data: { state: 'RUNNING', generation: 1n, attempts: 1, lease_owner: queue.ownerId, lease_token: token, lease_until: new Date((await tx.now()).getTime() + 30000) } });
    return { id: job.id, purpose: 'PUSH', roomId: job.room_id, resourceId: intentId, generation: 1n, leaseOwner: queue.ownerId, leaseToken: token, attempts: 1, maxAttempts: 5 };
  });
  const worker = (transport, repository = new PushDeliveryRepository()) => new PushDeliveryService(txs, repository, notifications, { requireActiveMember: activeMember }, { load: loadMessage, readable }, jobs, { config: { audience }, ...transport });
  return { ...f, db, txs, notifications, producer, queue, worker, lease, intentId, messageId: message.messageId, input };
}

test('real MySQL fresh pre-I/O revocation races suppress old subscription/account/session/preference/ACL intents', { timeout: 60000 }, async t => {
  const changes = [
    ['logout', f => f.txs.write(tx => tx.prisma.auth_sessions.update({ where: { id: f.principal.sessionId }, data: { revoked_at: new Date() } }))],
    ['account deletion', f => f.txs.write(tx => tx.prisma.users.update({ where: { id: f.recipient }, data: { status: 'DELETING', membership_generation: { increment: 1n } } }))],
    ['preference off/on generation', f => f.txs.write(async tx => { await f.notifications.setPreferences(tx, f.recipient, false); await f.notifications.setPreferences(tx, f.recipient, true); })],
    ['subscription rotation', f => f.txs.write(tx => f.notifications.register(tx, f.principal, 'rogi-test', { ...f.input, generation: f.subscription.generation }))],
    ['membership removal', f => f.txs.write(tx => leaveRoom(tx, f.room, f.recipient))],
    ['message deletion', f => f.txs.write(tx => tx.prisma.messages.update({ where: { id: f.messageId }, data: { deleted_at: new Date() } }))],
    ['source account deletion', f => f.txs.write(tx => tx.prisma.users.update({ where: { id: f.sender }, data: { status: 'DELETING' } }))],
    ['session expiry', f => f.txs.write(tx => tx.prisma.auth_sessions.update({ where: { id: f.principal.sessionId }, data: { expires_at: new Date(0) } }))],
    ['SOOP revocation', f => f.txs.write(tx => tx.prisma.platform_soop.update({ where: { user_id: f.recipient }, data: { status: 'REVOKED' } }))],
  ];
  for (const [name, change] of changes) await t.test(name, async t => {
    const f = await fixture(t); const preparing = barrier(); const continuePreparation = barrier(); let sends = 0;
    const pending = f.worker({ prepare: async () => { preparing.release(); await continuePreparation.wait; return { send: async () => { sends++; return { kind: 'accepted' }; } }; } }).consume(f.lease);
    await preparing.wait;
    try { await change(f); } finally { continuePreparation.release(); }
    assert.equal(await pending, 'completed'); assert.equal(sends, 0);
    assert.equal((await f.txs.read(tx => tx.prisma.jobs.findUnique({ where: { id: f.lease.id }, select: { state: true } }))).state, 'COMPLETED');
  });
});

test('real MySQL late 410 cannot revoke rotated binding; network holds no DB transaction', { timeout: 20000 }, async t => {
  const f = await fixture(t); const sending = barrier(); const response = barrier();
  const pending = f.worker({ prepare: async () => ({ send: async () => { sending.release(); await response.wait; return { kind: 'gone' }; } }) }).consume(f.lease);
  await sending.wait;
  try {
    // Must finish while provider is stalled: proves no subscription row lock
    // survives admission and prevents stale-generation 410 cleanup.
    await f.txs.write(tx => f.notifications.register(tx, f.principal, 'rogi-test', { ...f.input, generation: f.subscription.generation }));
  } finally { response.release(); }
  assert.equal(await pending, 'completed');
  const row = await f.txs.read(tx => tx.prisma.push_subscriptions.findUnique({ where: { id: f.subscription.id }, select: { generation: true, revoked_at: true } }));
  assert.equal(row.generation, 2n); assert.equal(row.revoked_at, null);
});

test('real MySQL expired lease rolls back 410 cleanup and stale admission never sends', { timeout: 20000 }, async t => {
  const f = await fixture(t); const sending = barrier(); const response = barrier();
  const pending = f.worker({ prepare: async () => ({ send: async () => { sending.release(); await response.wait; return { kind: 'gone' }; } }) }).consume(f.lease);
  await sending.wait;
  try { await f.txs.write(tx => tx.execute('UPDATE jobs SET lease_until=TIMESTAMPADD(SECOND,-1,UTC_TIMESTAMP(3)) WHERE id=?', [f.lease.id])); }
  finally { response.release(); }
  assert.equal(await pending, 'lease_lost');
  assert.equal((await f.txs.read(tx => tx.prisma.push_subscriptions.findUnique({ where: { id: f.subscription.id }, select: { revoked_at: true } }))).revoked_at, null);
  assert.equal(await f.worker({ prepare: async () => assert.fail('stale lease prepared transport') }).consume(f.lease), 'lease_lost');
});

test('real MySQL retries remain intents, ACK is processing, and deleted source cannot enqueue', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  assert.equal(await f.txs.write(tx => f.producer.enqueue(tx, { messageId: f.messageId, subscriptionId: f.subscription.id })), f.intentId);
  for (const kind of ['retry', 'unavailable', 'rejected']) await assert.rejects(f.worker({ prepare: async () => ({ send: async () => ({ kind }) }) }).consume(f.lease), error => error.code === (kind === 'retry' ? 'TEMPORARY_UNAVAILABLE' : kind === 'unavailable' ? 'SOURCE_UNAVAILABLE' : 'PERMANENT_FAILURE'));
  await assert.rejects(f.worker({ prepare: async () => null }).consume(f.lease), error => error.code === 'SOURCE_UNAVAILABLE');
  const rows = await f.txs.read(async tx => ({ jobs: await tx.prisma.jobs.findMany({ where: { resource_id: f.intentId } }), intents: await tx.prisma.push_deliveries.findMany({ where: { id: f.intentId } }) }));
  const json = JSON.stringify(rows, (_, value) => typeof value === 'bigint' ? String(value) : value);
  assert.ok(!json.includes('private fixture body')); assert.ok(!json.includes(f.input.endpoint)); assert.ok(!json.includes(f.input.keys.auth));
  await f.txs.write(tx => tx.prisma.users.update({ where: { id: f.sender }, data: { status: 'DELETING' } }));
  assert.equal(await f.txs.write(tx => f.producer.enqueue(tx, { messageId: f.messageId, subscriptionId: f.subscription.id })), null);
});


test('real MySQL current-generation gone revokes exactly once and completes atomically', { timeout: 15000 }, async t => {
  const f = await fixture(t);
  assert.equal(await f.worker({ prepare: async () => ({ send: async () => ({ kind: 'gone' }) }) }).consume(f.lease), 'completed');
  const row = await f.txs.read(tx => tx.prisma.push_subscriptions.findUnique({ where: { id: f.subscription.id }, select: { generation: true, revoked_at: true } }));
  assert.equal(row.generation, 2n); assert.ok(row.revoked_at);
  assert.equal(await f.worker({ prepare: async () => assert.fail('completed job must not retry') }).consume(f.lease), 'lease_lost');
});

test('real MySQL lock wait consumes dispatch headroom and can expire the lease before admission', { timeout: 20000 }, async t => {
  for (const seconds of [7, 1]) await t.test(seconds === 7 ? 'six-second dispatch margin exhausted' : 'lease expired', async t => {
    const f = await fixture(t); const locked = barrier(); const attempting = barrier(); const release = barrier();
    const holder = f.txs.write(async tx => {
      await tx.execute('UPDATE jobs SET lease_until=TIMESTAMPADD(SECOND,?,UTC_TIMESTAMP(3)) WHERE id=?', [seconds, f.lease.id]);
      locked.release();
      await release.wait;
    });
    await locked.wait;
    const repository = new PushDeliveryRepository();
    let clockSampled = false;
    const admission = f.txs.write(tx => repository.admitLease({
      rows: (sql, values) => { attempting.release(); return tx.rows(sql, values); },
      now: () => { clockSampled = true; return tx.now(); },
    }, f.lease));
    await attempting.wait;
    // Stay below the production two-second lock-wait timeout. A seven-second
    // lease starts with >6s headroom but loses that budget during this wait;
    // a one-second lease expires outright. The old statement-start clock would
    // incorrectly admit the seven-second case after acquiring the row.
    try {
      await new Promise(resolve => globalThis.setTimeout(resolve, 1250));
      assert.equal(clockSampled, false, 'fresh DB time must not be sampled before acquiring the job row');
    } finally { release.release(); }
    await holder;
    assert.equal(await admission, false);
    assert.equal(clockSampled, true);
    assert.equal(await f.worker({ prepare: async () => assert.fail('insufficient lease must never prepare or send') }).consume(f.lease), 'lease_lost');
  });
});


test('real MySQL lease expiring during completion lock wait rolls back gone-generation revocation', { timeout: 15000 }, async t => {
  const f = await fixture(t); const sending = barrier(); const response = barrier(); const locked = barrier(); const attempting = barrier(); const release = barrier();
  const repository = new PushDeliveryRepository();
  const currentLease = repository.currentLease.bind(repository);
  repository.currentLease = (tx, lease, minimumRemainingMs = 0) => {
    if (minimumRemainingMs === 0) attempting.release();
    return currentLease(tx, lease, minimumRemainingMs);
  };
  const pending = f.worker({ prepare: async () => ({ send: async () => { sending.release(); await response.wait; return { kind: 'gone' }; } }) }, repository).consume(f.lease);
  await sending.wait;
  const holder = f.txs.write(async tx => {
    await tx.execute('UPDATE jobs SET lease_until=TIMESTAMPADD(SECOND,1,UTC_TIMESTAMP(3)) WHERE id=?', [f.lease.id]);
    locked.release(); await release.wait;
  });
  await locked.wait; response.release();
  await attempting.wait;
  try { await new Promise(resolve => globalThis.setTimeout(resolve, 1250)); }
  finally { release.release(); }
  await holder;
  assert.equal(await pending, 'lease_lost');
  const row = await f.txs.read(tx => tx.prisma.push_subscriptions.findUnique({ where: { id: f.subscription.id }, select: { generation: true, revoked_at: true } }));
  assert.equal(row.generation, 1n); assert.equal(row.revoked_at, null);
  assert.equal((await f.txs.read(tx => tx.prisma.jobs.findUnique({ where: { id: f.lease.id }, select: { state: true } }))).state, 'RUNNING');
});
