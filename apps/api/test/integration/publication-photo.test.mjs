import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createRoom, joinRoom, sendMessage, sendInput, getMessage, deleteMessage, processMedia, recoverMedia, enqueueJob } from '../support/domain-fixture.mjs';
import { PrismaDatabase } from '../../dist/infrastructure/database/database.js';
import { Transactions } from '../../dist/infrastructure/database/transactions.js';
import { readConfig } from '../../dist/infrastructure/config/config.js';
import { SessionService } from '../../dist/modules/auth/session.service.js';
import { SessionRepository } from '../../dist/modules/auth/session.repository.js';
import { PublicationsCoreModule } from '../../dist/modules/publications/publications-core.module.js';
import { PublicationsCoreService } from '../../dist/modules/publications/publications-core.service.js';
import { MediaCopyService } from '../../dist/modules/media/media-copy.service.js';
import { MediaStorageModule } from '../../dist/modules/media/media-storage.module.js';
import { MediaSpooler } from '../../dist/common/media/media-spool.js';
import { createApi, createConfiguredApi } from '../../dist/application.js';
import { AppModule } from '../../dist/app.module.js';
import { LifecycleState } from '../../dist/common/lifecycle/lifecycle-state.js';

const bytes = Buffer.from('isolated synthetic image bytes; no R2 or decoder evidence');
const sha256 = createHash('sha256').update(bytes).digest('hex');
const barrier = () => { let release; return { wait: new Promise(resolve => { release = resolve; }), release: () => release() }; };
async function fixture(t) {
  assert.equal(process.env.ROGICHAT_TEST_MYSQL, 'disposable');
  const db = new PrismaDatabase(readConfig('api')), txs = db.transactions;
  const directory = await mkdtemp(join(tmpdir(), 'rogichat-publication-photo-'));
  const objects = new Map(), hooks = {}, puts = [], removes = [], signs = [];
  const store = {
    async read(key, signal) { assert.equal(signal.aborted, false); await hooks.read?.(); const value = objects.get(key); assert.ok(value); return { bytes: value.length, stream: Readable.from([value], { objectMode: false }) }; },
    async put(key, path, size, type, signal) { assert.equal(signal.aborted, false); assert.equal(type, 'image/webp'); assert.equal(size, bytes.length); assert.equal(objects.has(key), false); objects.set(key, await readFile(path)); puts.push(key); await hooks.put?.(); },
    async remove(key) { await hooks.remove?.(); removes.push(key); objects.delete(key); },
    async signedGet(key) { signs.push(key); return 'https://synthetic.invalid/image'; },
  };
  const media = { store, prefix: 'test', spool: new MediaSpooler({ directory }) };
  class FixtureModule {}
  Module({ imports: [{ module: PublicationsCoreModule, providers: [PublicationsCoreService] }, MediaStorageModule.register(media, true)], providers: [MediaCopyService, { provide: Transactions, useValue: txs }] })(FixtureModule);
  const context = await NestFactory.createApplicationContext(FixtureModule, { logger: false, abortOnError: false });
  const core = context.get(PublicationsCoreService), worker = context.get(MediaCopyService);
  const config = { audience: randomBytes(8).toString('hex'), key: randomBytes(32), origin: 'http://localhost:3001', secure: false };
  const sessions = new SessionService(new SessionRepository(), config.audience, config.key);
  let app;
  t.after(async () => { await app?.close(); await context.close(); await db.close(); await rm(directory, { recursive: true, force: true }); });
  const person = () => txs.write(async tx => {
    const id = randomUUID();
    await tx.prisma.users.create({ data: { id, profile: { create: { nickname: '합성 사진 사용자' } }, soop: { create: { id: randomUUID(), provider_subject: Buffer.from(randomUUID()), verified_at: await tx.now() } } }, select: { id: true } });
    return { id, ...await sessions.issue(tx, id) };
  });
  const owner = await person(), fan = await person(), other = await person();
  const room = await txs.write(async tx => {
    const id = await createRoom(tx, '합성 독립 공개방', 'FAN');
    for (const user of [owner, fan, other]) user.actor = await joinRoom(tx, id, user.id);
    await tx.prisma.room_members.update({ where: { id: owner.actor }, data: { role: 'STREAMER' }, select: { id: true } });
    await tx.prisma.rooms.update({ where: { id }, data: { owner_member_id: owner.actor }, select: { id: true } });
    return id;
  });
  const source = async (count = 1) => {
    const assets = await txs.write(async tx => {
      const ids = [];
      for (let position = 0; position < count; position++) {
        const id = randomUUID(), attempt = randomUUID(), key = `test/${id}/${attempt}/image`; objects.set(key, bytes);
        await tx.prisma.media_assets.create({ data: { id, owner_user_id: fan.id, room_id: room, kind: 'PHOTO', content_type: 'image/jpeg', state: 'READY', declared_bytes: BigInt(bytes.length), reserved_bytes: 0n,
          expires_at: new Date((await tx.now()).getTime() + 3600000), objects: { create: { id: randomUUID(), attempt_id: attempt, variant: 'image', object_key: key, state: 'READY', byte_length: BigInt(bytes.length), sha256, width: 2, height: 3 } } }, select: { id: true } });
        ids.push(id);
      }
      return ids;
    });
    const message = await txs.write(tx => sendMessage(tx, room, fan.id, sendInput({ clientMessageId: randomUUID(), intent: 'PRIVATE', recipientActorId: owner.actor, content: { type: 'PHOTO', assetIds: assets } }), config.key));
    return { ...message, assets };
  };
  const request = id => txs.write(tx => core.requestPublication(tx, room, owner.id, id));
  const status = id => txs.read(tx => core.publicationStatus(tx, room, owner.id, id));
  const claim = (publicationId, purpose = 'PUBLICATION') => txs.write(async tx => {
    const job = await tx.prisma.jobs.findFirst({ where: { purpose, resource_id: publicationId, state: { in: ['PENDING', 'RUNNING'] } }, orderBy: { created_at: 'asc' }, select: { id: true, generation: true, attempts: true, max_attempts: true } });
    assert.ok(job); const generation = job.generation + 1n, leaseOwner = randomUUID(), leaseToken = randomUUID();
    await tx.prisma.jobs.update({ where: { id: job.id }, data: { state: 'RUNNING', generation, lease_owner: leaseOwner, lease_token: leaseToken, lease_until: new Date((await tx.now()).getTime() + 300000), attempts: { increment: 1 } }, select: { id: true } });
    return { id: job.id, purpose, roomId: room, resourceId: publicationId, generation, leaseOwner, leaseToken, attempts: job.attempts + 1, maxAttempts: job.max_attempts };
  });
  const expire = lease => txs.write(async tx => tx.prisma.jobs.update({ where: { id: lease.id }, data: { lease_until: new Date((await tx.now()).getTime() - 1000) }, select: { id: true } }));
  const inspect = publicationId => txs.read(async tx => ({
    copies: await tx.prisma.publication_media.findMany({ where: { publication_id: publicationId }, select: { destination_asset_id: true, destination: { select: { state: true, reserved_bytes: true, objects: { select: { object_key: true, state: true } } } } } }),
    budget: (await tx.prisma.media_budget.findUnique({ where: { id: 'global' }, select: { reserved_bytes: true } }))?.reserved_bytes ?? 0n,
  }));
  const http = async (recovery = false) => {
    if (recovery) app = await createApi(db, { event() {} }, undefined, { sessions, config }, media);
    else {
      // Full-feature security regressions register the preserved implementation only here.
      const lifecycle = new LifecycleState();
      const module = AppModule.register(db, lifecycle, { sessions, config }, media);
      const publications = module.imports.find(entry => entry.module?.name === 'PublicationsModule');
      publications.imports = publications.imports.map(entry => entry === PublicationsCoreModule
        ? { module: PublicationsCoreModule, providers: [PublicationsCoreService] } : entry);
      app = await createConfiguredApi(module, { event() {} }, lifecycle, config, true);
    }
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    return async (user, method, path, body) => {
      const result = await fetch(base + '/v1' + path, { method, headers: { cookie: `rogi_session=${user.token}`, origin: config.origin, 'x-csrf-token': user.csrf, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: result.status, body: await result.json(), cache: result.headers.get('cache-control') };
    };
  };
  const get = id => txs.read(tx => getMessage(tx, room, other.id, id));
  const remove = id => txs.write(tx => deleteMessage(tx, room, fan.id, id));
  const cleanup = async assetId => { const lease = await claim(assetId, 'MEDIA'); return processMedia(txs, store, {}, 'test', lease); };
  const age = id => txs.write(async tx => { await tx.prisma.media_objects.updateMany({ where: { asset_id: id }, data: { created_at: new Date(0) } }); });
  return { recoveryCore: () => app.get(PublicationsCoreService), db, txs, core, worker, source, request, status, claim, expire, inspect, http, get, remove, owner, fan, other, room, objects, hooks, puts, removes, signs, cleanup, age };
}

test('PHOTO publication HTTP and anonymous DTO use independent keys, and every destination stays inaccessible before atomic READY', async t => {
  const f = await fixture(t), source = await f.source(2), call = await f.http();
  const response = await call(f.owner, 'POST', `/rooms/${f.room}/messages/${source.messageId}/publications`, {});
  assert.equal(response.status, 202); const publication = response.body, lease = await f.claim(publication.publicationId);
  const before = await f.inspect(publication.publicationId);
  f.hooks.put = async () => {
    const state = await f.inspect(publication.publicationId); assert.equal(state.copies.length, 2);
    assert.equal(state.budget - before.budget, BigInt(bytes.length * 2));
    for (const copy of state.copies) {
      assert.equal(copy.destination.state, 'PROCESSING'); assert.equal(copy.destination.objects[0].state, 'ALLOCATED');
      assert.equal((await call(f.fan, 'POST', `/media/assets/${copy.destination_asset_id}/access`, { variant: 'image' })).status, 404);
      assert.equal((await call(f.owner, 'POST', `/media/assets/${copy.destination_asset_id}/access`, { roomId: f.room, messageId: source.messageId, variant: 'image' })).status, 404);
    }
    assert.equal(f.signs.length, 0); assert.equal((await f.status(publication.publicationId)).status, 'preparing');
  };
  assert.equal(await f.worker.processPublication(lease), 'completed');
  const published = await f.status(publication.publicationId), dto = await f.get(published.messageId);
  assert.equal(dto.audience, 'SHARED'); assert.deepEqual(dto.author, { kind: 'anonymous' }); assert.equal(dto.quote, null);
  assert.equal(dto.content.type, 'PHOTO'); assert.equal(dto.content.attachments.length, 2);
  const snapshot = await call(f.other, 'GET', `/rooms/${f.room}/snapshot?deviceId=${randomUUID()}&cacheId=${randomUUID()}`);
  assert.equal(snapshot.status, 200); assert.deepEqual(snapshot.body.messages, [dto]);
  for (const secret of [source.messageId, ...source.assets, f.fan.id, f.fan.actor]) assert.equal(JSON.stringify(dto).includes(secret), false);
  for (const attachment of dto.content.attachments) {
    const access = await call(f.other, 'POST', `/media/assets/${attachment.assetId}/access`, { roomId: f.room, messageId: published.messageId, variant: 'image' });
    assert.equal(access.status, 200); assert.equal(access.body.expiresIn, 60); assert.equal(access.cache, 'no-store');
    assert.ok(!source.assets.includes(attachment.assetId));
  }
  assert.deepEqual(await f.request(source.messageId), published);
  assert.equal(f.puts.length, 2);
  const state = await f.inspect(publication.publicationId);
  assert.ok(state.copies.every(copy => copy.destination.state === 'READY' && copy.destination.objects[0].state === 'READY'));
});

test('source deletion during PUT revokes publication and defers cleanup; cleanup releases reservation exactly once', async t => {
  const f = await fixture(t), source = await f.source(), publication = await f.request(source.messageId), lease = await f.claim(publication.publicationId);
  const before = await f.inspect(publication.publicationId);
  f.hooks.put = () => f.remove(source.messageId);
  assert.equal(await f.worker.processPublication(lease), 'completed');
  assert.equal((await f.status(publication.publicationId)).status, 'revoked');
  const state = await f.inspect(publication.publicationId), copy = state.copies[0];
  assert.equal(copy.destination.state, 'DELETING'); assert.equal(copy.destination.objects[0].state, 'ALLOCATED');
  assert.equal(await f.cleanup(copy.destination_asset_id), 'completed');
  assert.equal((await f.inspect(publication.publicationId)).budget, state.budget); assert.equal(f.removes.length, 0);
  await f.age(copy.destination_asset_id); assert.equal(await f.cleanup(copy.destination_asset_id), 'completed');
  assert.equal((await f.inspect(publication.publicationId)).budget, before.budget);
  assert.ok(!f.objects.has(copy.destination.objects[0].object_key));
});

test('owner, membership, SOOP, original revision, source asset and moderation changes during copy cannot publish', async t => {
  for (const mutation of ['owner', 'membership', 'soop', 'account', 'revision', 'asset', 'moderation']) {
    const f = await fixture(t), source = await f.source(), publication = await f.request(source.messageId), lease = await f.claim(publication.publicationId);
    f.hooks.put = () => f.txs.write(async tx => {
      if (mutation === 'owner') await tx.prisma.rooms.update({ where: { id: f.room }, data: { owner_member_id: f.other.actor }, select: { id: true } });
      if (mutation === 'membership') await tx.prisma.room_members.update({ where: { id: f.owner.actor }, data: { status: 'LEFT' }, select: { id: true } });
      if (mutation === 'soop') await tx.prisma.platform_soop.updateMany({ where: { user_id: f.owner.id }, data: { status: 'REVOKED' } });
      if (mutation === 'account') await tx.prisma.users.update({ where: { id: f.fan.id }, data: { status: 'DELETING' }, select: { id: true } });
      if (mutation === 'revision') await tx.prisma.messages.update({ where: { id: source.messageId }, data: { content_revision: { increment: 1n } }, select: { id: true } });
      if (mutation === 'asset') await tx.prisma.media_assets.update({ where: { id: source.assets[0] }, data: { state: 'DELETING', deleted_at: await tx.now() }, select: { id: true } });
      if (mutation === 'moderation') await tx.prisma.messages.update({ where: { id: source.messageId }, data: { moderated: true }, select: { id: true } });
    });
    assert.equal(await f.worker.processPublication(lease), 'completed', mutation);
    const result = await f.txs.read(tx => tx.prisma.message_publications.findUnique({ where: { id: publication.publicationId }, select: { state: true, published_message_id: true } }));
    assert.deepEqual(result, { state: 'REVOKED', published_message_id: null }, mutation);
    assert.ok((await f.inspect(publication.publicationId)).copies.every(copy => copy.destination.state === 'DELETING'));
  }
});

test('expired generation after PUT rolls back READY; retry uses a new destination and reclaims only orphan reservation', async t => {
  const f = await fixture(t), source = await f.source(), publication = await f.request(source.messageId), first = await f.claim(publication.publicationId);
  const baseline = await f.inspect(publication.publicationId);
  f.hooks.put = () => f.expire(first); assert.equal(await f.worker.processPublication(first), 'lease_lost');
  const old = (await f.inspect(publication.publicationId)).copies[0]; assert.equal(old.destination.state, 'PROCESSING');
  delete f.hooks.put; const second = await f.claim(publication.publicationId);
  assert.equal(await f.worker.processPublication(second), 'completed');
  const current = (await f.inspect(publication.publicationId)).copies[0]; assert.notEqual(old.destination_asset_id, current.destination_asset_id);
  assert.notEqual(f.puts[0], f.puts[1]); assert.equal(await f.worker.processPublication(first), 'lease_lost');
  await f.age(old.destination_asset_id); await f.cleanup(old.destination_asset_id);
  assert.equal((await f.inspect(publication.publicationId)).budget - baseline.budget, BigInt(bytes.length));
  assert.ok(f.objects.has(current.destination.objects[0].object_key));
  const original = await f.txs.read(tx => tx.prisma.media_assets.findUnique({ where: { id: source.assets[0] }, select: { state: true, deleted_at: true } }));
  assert.deepEqual(original, { state: 'READY', deleted_at: null });
});

test('uncertain PUT and exhausted worker recovery retain discoverable attempts and cleanup without touching original', async t => {
  const f = await fixture(t), source = await f.source(), publication = await f.request(source.messageId), lease = await f.claim(publication.publicationId);
  f.hooks.put = () => { throw new Error('synthetic lost PUT acknowledgement'); };
  await assert.rejects(f.worker.processPublication(lease), /synthetic lost PUT/);
  const state = await f.inspect(publication.publicationId), copy = state.copies[0]; assert.equal(copy.destination.state, 'PROCESSING');
  await f.txs.write(async tx => { await tx.prisma.jobs.update({ where: { id: lease.id }, data: { state: 'FAILED' }, select: { id: true } }); });
  await f.txs.write(tx => f.core.recoverPhotos(tx)); await f.txs.write(tx => f.core.recoverPhotos(tx));
  assert.equal((await f.status(publication.publicationId)).status, 'revoked');
  assert.equal((await f.inspect(publication.publicationId)).budget, state.budget);
  await f.age(copy.destination_asset_id); await f.cleanup(copy.destination_asset_id);
  assert.equal((await f.inspect(publication.publicationId)).budget, state.budget - BigInt(bytes.length));
  assert.equal(f.objects.size, 1); assert.equal(f.removes.length, 1);
});

test('source deletion after successful copy blocks DTO and URL immediately and deletes only the independent public attachment', async t => {
  const f = await fixture(t), source = await f.source(), publication = await f.request(source.messageId);
  await f.worker.processPublication(await f.claim(publication.publicationId));
  const result = await f.status(publication.publicationId), dto = await f.get(result.messageId), call = await f.http();
  await f.remove(source.messageId);
  await assert.rejects(f.get(result.messageId), { code: 'NOT_FOUND' });
  assert.equal((await call(f.other, 'POST', `/media/assets/${dto.content.attachments[0].assetId}/access`, { roomId: f.room, messageId: result.messageId, variant: 'image' })).status, 404);
  assert.equal(f.signs.length, 0);
});

test('original author leaving preserves published history; deleting the public copy never deletes private original', async t => {
  const f = await fixture(t), source = await f.source(), publication = await f.request(source.messageId);
  f.hooks.put = () => f.txs.write(tx => tx.prisma.room_members.update({ where: { id: f.fan.actor }, data: { status: 'LEFT' }, select: { id: true } }));
  assert.equal(await f.worker.processPublication(await f.claim(publication.publicationId)), 'completed');
  const published = await f.status(publication.publicationId), dto = await f.get(published.messageId);
  const copyId = dto.content.attachments[0].assetId;
  await f.txs.write(tx => deleteMessage(tx, f.room, f.owner.id, published.messageId));
  await f.age(copyId); await f.cleanup(copyId);
  const original = await f.txs.read(tx => tx.prisma.media_assets.findUnique({ where: { id: source.assets[0] }, select: { state: true, deleted_at: true, objects: { select: { object_key: true } } } }));
  assert.equal(original.state, 'READY'); assert.equal(original.deleted_at, null);
  assert.ok(f.objects.has(original.objects[0].object_key));
  const message = await f.txs.read(tx => tx.prisma.messages.findUnique({ where: { id: source.messageId }, select: { deleted_at: true } }));
  assert.equal(message.deleted_at, null);
});

test('quota denial creates no copy attempt or external call; unsupported STICKER and VIDEO create no publication or job', async t => {
  const f = await fixture(t), source = await f.source(), publication = await f.request(source.messageId), lease = await f.claim(publication.publicationId);
  const originalBudget = await f.txs.write(async tx => {
    await tx.prisma.media_budget.createMany({ data: [{ id: 'global' }], skipDuplicates: true });
    const row = await tx.prisma.media_budget.findUnique({ where: { id: 'global' }, select: { limit_bytes: true } });
    await tx.prisma.media_budget.update({ where: { id: 'global' }, data: { limit_bytes: 0n }, select: { id: true } }); return row.limit_bytes;
  });
  try { await assert.rejects(f.worker.processPublication(lease), { code: 'TEMPORARY_UNAVAILABLE' }); }
  finally { await f.txs.write(tx => tx.prisma.media_budget.update({ where: { id: 'global' }, data: { limit_bytes: originalBudget }, select: { id: true } })); }
  assert.equal((await f.inspect(publication.publicationId)).copies.length, 0); assert.equal(f.puts.length, 0);
  const jobsBefore = await f.txs.read(tx => tx.prisma.jobs.count({ where: { purpose: 'PUBLICATION', room_id: f.room } }));
  for (const kind of ['STICKER', 'VIDEO']) {
    const unsupported = await f.source();
    await f.txs.write(tx => tx.prisma.messages.update({ where: { id: unsupported.messageId }, data: { content_kind: kind }, select: { id: true } }));
    await assert.rejects(f.request(unsupported.messageId), { code: 'INVALID_REQUEST' });
    const count = await f.txs.read(tx => tx.prisma.message_publications.count({ where: { source_message_id: unsupported.messageId } })); assert.equal(count, 0);
    assert.equal(await f.txs.read(tx => tx.prisma.jobs.count({ where: { purpose: 'PUBLICATION', room_id: f.room } })), jobsBefore);
  }
});

test('two generations crossing PUT cannot resurrect an old key after replacement; active copy survives generic recovery', async t => {
  const f = await fixture(t), source = await f.source(), publication = await f.request(source.messageId), first = await f.claim(publication.publicationId);
  const entered = barrier(), resume = barrier();
  f.hooks.put = async () => { entered.release(); await resume.wait; };
  const running = f.worker.processPublication(first); await entered.wait;
  try {
    const copy = (await f.inspect(publication.publicationId)).copies[0];
    await f.txs.write(async tx => { await tx.prisma.media_assets.update({ where: { id: copy.destination_asset_id }, data: { expires_at: new Date(0) }, select: { id: true } }); });
    await f.txs.write(recoverMedia); assert.equal((await f.inspect(publication.publicationId)).copies[0].destination.state, 'PROCESSING');
    await f.expire(first); delete f.hooks.put;
    assert.equal(await f.worker.processPublication(await f.claim(publication.publicationId)), 'completed');
  } finally { resume.release(); }
  assert.equal(await running, 'lease_lost');
  assert.equal((await f.status(publication.publicationId)).status, 'published');
});

test('copy cleanup never waits on room membership after acquiring owner and asset locks', async t => {
  const f = await fixture(t), source = await f.source(), publication = await f.request(source.messageId), lease = await f.claim(publication.publicationId);
  const plan = await f.txs.write(tx => f.core.preparePhoto(tx, lease, 'test'));
  const assetId = plan[0].destinationId;
  await f.txs.write(async tx => {
    await tx.prisma.media_assets.update({ where: { id: assetId }, data: { state: 'DELETING', deleted_at: await tx.now() }, select: { id: true } });
    await enqueueJob(tx, { purpose: 'MEDIA', resourceId: assetId });
  });
  const locked = barrier(), unlock = barrier();
  const holder = f.txs.write(async tx => { await tx.rows('SELECT id FROM rooms WHERE id=? FOR UPDATE', [f.room]); locked.release(); await unlock.wait; });
  await locked.wait;
  let timer;
  try {
    assert.equal(await Promise.race([f.cleanup(assetId), new Promise(resolve => { timer = setTimeout(() => resolve('room-lock-inversion'), 1500); })]), 'completed');
  } finally { clearTimeout(timer); unlock.release(); await holder; }
});

test('two publication copies competing for the final quota slot reserve exactly one destination', async t => {
  const f = await fixture(t), a = await f.source(), b = await f.source();
  const publications = [await f.request(a.messageId), await f.request(b.messageId)];
  const leases = await Promise.all(publications.map(publication => f.claim(publication.publicationId)));
  const budget = await f.txs.write(async tx => {
    await tx.prisma.media_budget.createMany({ data: [{ id: 'global' }], skipDuplicates: true });
    const row = await tx.prisma.media_budget.findUnique({ where: { id: 'global' }, select: { reserved_bytes: true, limit_bytes: true } });
    await tx.prisma.media_budget.update({ where: { id: 'global' }, data: { limit_bytes: row.reserved_bytes + BigInt(bytes.length) }, select: { id: true } }); return row;
  });
  try {
    const results = await Promise.allSettled(leases.map(lease => f.worker.processPublication(lease)));
    assert.equal(results.filter(result => result.status === 'fulfilled' && result.value === 'completed').length, 1);
    assert.equal(results.filter(result => result.status === 'rejected' && result.reason.code === 'TEMPORARY_UNAVAILABLE').length, 1);
    assert.equal(f.puts.length, 1);
    assert.equal((await f.inspect(publications[0].publicationId)).budget - budget.reserved_bytes, BigInt(bytes.length));
  } finally {
    await f.txs.write(tx => tx.prisma.media_budget.update({ where: { id: 'global' }, data: { limit_bytes: budget.limit_bytes }, select: { id: true } }));
  }
});


test('recovery product rejects new PHOTO publication and cleans existing PREPARING copies', async t => {
  const f = await fixture(t), source = await f.source(), call = await f.http(true);
  const rejected = await call(f.owner, 'POST', `/rooms/${f.room}/messages/${source.messageId}/publications`, {});
  assert.equal(rejected.status, 400); assert.equal(rejected.body.error.code, 'INVALID_REQUEST');
  // Model a previously admitted job using the preserved feature implementation.
  const publication = await f.request(source.messageId), lease = await f.claim(publication.publicationId);
  await f.txs.write(tx => f.core.preparePhoto(tx, lease, 'test'));
  assert.equal((await f.inspect(publication.publicationId)).copies.length, 1);
  const result = await f.txs.write(tx => f.recoveryCore().preparePhoto(tx, lease, 'test'));
  assert.equal(result, 'completed'); assert.equal((await f.status(publication.publicationId)).status, 'revoked');
  for (const copy of (await f.inspect(publication.publicationId)).copies) {
    assert.equal(copy.destination.state, 'DELETING');
    await f.age(copy.destination_asset_id); await f.cleanup(copy.destination_asset_id);
  }
  for (const copy of (await f.inspect(publication.publicationId)).copies) assert.equal(copy.destination.state, 'DELETED');
  assert.equal(f.puts.length, 0);
});
