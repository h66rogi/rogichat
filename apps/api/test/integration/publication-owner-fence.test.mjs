import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { createRoom, joinRoom, sendMessage, sendInput } from '../support/domain-fixture.mjs';
import { PrismaDatabase } from '../../dist/infrastructure/database/database.js';
import { readConfig } from '../../dist/infrastructure/config/config.js';
import { PublicationsCoreModule } from '../../dist/modules/publications/publications-core.module.js';
import { PublicationsCoreService } from '../../dist/modules/publications/publications-core.service.js';
import { SessionService } from '../../dist/modules/auth/session.service.js';
import { SessionRepository } from '../../dist/modules/auth/session.repository.js';

async function fixture(t, kind = 'TEXT') {
  assert.equal(process.env.ROGICHAT_TEST_MYSQL, 'disposable');
  const db = new PrismaDatabase(readConfig('api'));
  const deletion = new PrismaDatabase(readConfig('api'));
  const context = await NestFactory.createApplicationContext(PublicationsCoreModule, { logger: false, abortOnError: false });
  t.after(async () => { await context.close(); await db.close(); await deletion.close(); });
  const core = context.get(PublicationsCoreService);
  const key = randomBytes(32), sessions = new SessionService(new SessionRepository(), randomBytes(8).toString('hex'), key);
  const person = () => db.transactions.write(async tx => {
    const id = randomUUID();
    await tx.prisma.users.create({ data: { id, profile: { create: { nickname: '합성 동시성 사용자' } }, soop: { create: { id: randomUUID(), provider_subject: Buffer.from(randomUUID()), verified_at: await tx.now() } } }, select: { id: true } });
    return { id, ...await sessions.issue(tx, id) };
  });
  const publisher = await person(), author = await person();
  const room = await db.transactions.write(async tx => {
    const id = await createRoom(tx, '합성 소유자 경합방', 'FAN');
    for (const user of [publisher, author]) user.actor = await joinRoom(tx, id, user.id);
    await tx.prisma.room_members.update({ where: { id: publisher.actor }, data: { role: 'STREAMER' }, select: { id: true } });
    await tx.prisma.rooms.update({ where: { id }, data: { owner_member_id: publisher.actor }, select: { id: true } });
    return id;
  });
  const assetId = randomUUID();
  if (kind === 'PHOTO') await db.transactions.write(async tx => {
    await tx.prisma.media_assets.create({ data: { id: assetId, owner_user_id: author.id, room_id: room, kind: 'PHOTO', content_type: 'image/jpeg', state: 'READY', declared_bytes: 8n, reserved_bytes: 0n,
      expires_at: new Date((await tx.now()).getTime() + 3600000), objects: { create: { id: randomUUID(), attempt_id: randomUUID(), variant: 'image', object_key: `test/${assetId}/image`, state: 'READY', byte_length: 8n, sha256: 'a'.repeat(64), width: 2, height: 3 } } }, select: { id: true } });
  });
  const source = await db.transactions.write(tx => sendMessage(tx, room, author.id, sendInput({ clientMessageId: randomUUID(), intent: 'PRIVATE', recipientActorId: publisher.actor,
    content: kind === 'TEXT' ? { type: 'TEXT', text: '합성 비공개 원문' } : { type: 'PHOTO', assetIds: [assetId] } }), key));
  const request = tx => core.requestPublication(tx, room, publisher.id, source.messageId);
  const publication = () => db.transactions.write(request);
  const claim = publicationId => db.transactions.write(async tx => {
    const job = await tx.prisma.jobs.findFirst({ where: { purpose: 'PUBLICATION', resource_id: publicationId }, select: { id: true, generation: true, max_attempts: true } });
    assert.ok(job);
    const generation = job.generation + 1n, leaseOwner = randomUUID(), leaseToken = randomUUID();
    await tx.prisma.jobs.update({ where: { id: job.id }, data: { state: 'RUNNING', generation, lease_owner: leaseOwner, lease_token: leaseToken, lease_until: new Date((await tx.now()).getTime() + 300000), attempts: 1 }, select: { id: true } });
    return { id: job.id, purpose: 'PUBLICATION', roomId: room, resourceId: publicationId, generation, leaseOwner, leaseToken, attempts: 1, maxAttempts: job.max_attempts };
  });
  // Connection A establishes a real RR snapshot; connection B commits deletion
  // before the protected operation starts. No mocks replace the domain or DB.
  const stale = operation => db.transactions.write(async tx => {
    const [first] = await tx.rows('SELECT CONNECTION_ID() AS connection_id,@@transaction_isolation AS isolation');
    assert.equal(first.isolation, 'REPEATABLE-READ');
    assert.equal((await tx.prisma.users.findUnique({ where: { id: author.id }, select: { status: true } })).status, 'ACTIVE');
    await deletion.transactions.write(async other => {
      const [second] = await other.rows('SELECT CONNECTION_ID() AS connection_id');
      assert.notEqual(first.connection_id, second.connection_id);
      await other.prisma.users.update({ where: { id: author.id }, data: { status: 'DELETING' }, select: { id: true } });
    });
    assert.equal((await tx.prisma.users.findUnique({ where: { id: author.id }, select: { status: true } })).status, 'ACTIVE');
    return operation(tx);
  });
  const inspect = () => db.transactions.read(async tx => ({
    publications: await tx.prisma.message_publications.findMany({ where: { room_id: room }, select: { state: true, published_message_id: true } }),
    messages: await tx.prisma.messages.count({ where: { room_id: room, deletion_root_id: source.messageId } }),
    copies: await tx.prisma.publication_media.findMany({ where: { room_id: room }, select: { destination: { select: { state: true } } } }),
    events: await tx.prisma.room_events.count({ where: { room_id: room } }),
    audits: await tx.prisma.audit_events.count({ where: { room_id: room, action: 'MESSAGE_PUBLISHED' } }),
    counter: await tx.prisma.room_counters.findUnique({ where: { room_id: room }, select: { last_order: true } }),
  }));
  return { db, core, sessions, publisher, request, publication, claim, stale, inspect };
}

test('publication request denies source owner deleted after its repeatable-read snapshot', async t => {
  const f = await fixture(t);
  await assert.rejects(f.stale(async tx => {
    await f.sessions.require(tx, f.publisher.token, f.publisher.csrf, true);
    return f.request(tx);
  }), { code: 'NOT_FOUND' });
  assert.equal((await f.inspect()).publications.length, 0);
});

for (const phase of ['text', 'photo allocation', 'photo finalization']) {
  test(`${phase} uses a current source-owner deletion fence after an old snapshot`, async t => {
    const f = await fixture(t, phase === 'text' ? 'TEXT' : 'PHOTO');
    const publication = await f.publication(), lease = await f.claim(publication.publicationId);
    const attempts = phase === 'photo finalization' ? await f.db.transactions.write(tx => f.core.preparePhoto(tx, lease, 'test')) : undefined;
    const before = await f.inspect();
    if (phase === 'text') assert.equal(await f.core.publishText({ write: f.stale }, lease), 'completed');
    else if (phase === 'photo allocation') assert.equal(await f.stale(tx => f.core.preparePhoto(tx, lease, 'test')), 'completed');
    else await f.stale(tx => f.core.finalizePhoto(tx, lease, attempts));
    const after = await f.inspect();
    assert.deepEqual(after.publications, [{ state: 'REVOKED', published_message_id: null }]);
    assert.equal(after.messages, 0);
    assert.equal(after.audits, before.audits);
    assert.equal(after.events, before.events);
    assert.deepEqual(after.counter, before.counter);
    if (phase === 'photo finalization') assert.ok(after.copies.length > 0 && after.copies.every(copy => copy.destination.state === 'DELETING'));
    else assert.equal(after.copies.length, 0);
  });
}
