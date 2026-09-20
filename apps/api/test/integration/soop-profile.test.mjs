// Synthetic accounts exist only inside the disposable integration database.
import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { users, createRoom, joinRoom, assignRoomOwner, enqueueJob } from '../support/domain-fixture.mjs';
import { readConfig } from '../../dist/infrastructure/config/config.js';
import { MysqlDatabase } from '../../dist/infrastructure/database/database.js';
import { IdentityRepository } from '../../dist/modules/auth/identity.repository.js';
import { IdentityService } from '../../dist/modules/auth/identity.service.js';
import { IdentityGuardService } from '../../dist/modules/auth/identity-guard.service.js';
import { IdentityGuardRepository } from '../../dist/modules/auth/identity-guard.repository.js';
import { ProviderAvatarService } from '../../dist/modules/users/provider-avatar.service.js';
async function fixture(t) {
  assert.equal(process.env.ROGICHAT_TEST_MYSQL, 'disposable');
  const db = new MysqlDatabase(readConfig('api')); t.after(() => db.close());
  const key = randomBytes(32), identities = new IdentityService(new IdentityRepository(), { identityGuardKey: key }, new IdentityGuardService(new IdentityGuardRepository()), { enqueue: enqueueJob });
  const subject = `test_${randomBytes(8).toString('hex')}`;
  const identity = { schemaVersion: 1, provider: 'soop', subject, clientId: 'isolated', transactionId: randomUUID(), authenticatedAt: new Date().toISOString() };
  const profile = { displayId: subject, nickname: '인증된 별명', imageUrl: `https://stimg.sooplive.com/LOGO/te/${subject}/${subject}.jpg` };
  const resolve = value => db.transactions.write(tx => identities.resolve(tx, value));
  const self = id => db.transactions.read(tx => users.selfProfile(tx, id));
  const changes = id => db.transactions.read(tx => tx.prisma.profile_changes.count({ where: { user_id: id } }));
  return { db, key, identity, profile, resolve, self, changes };
}
test('old broker remains accepted; later verified profile initializes same UUID exactly once and emits hint atomically', async t => {
  const f = await fixture(t), id = await f.resolve(f.identity);
  assert.equal((await f.self(id)).nickname, '새 사용자');
  assert.equal(await f.resolve({ ...f.identity, profile: f.profile }), id);
  assert.deepEqual(await f.self(id), { id, nickname: f.profile.nickname, avatar: null, birthday: null, birthdayVisibleToStreamers: false, soop: { displayId: f.identity.subject }, providerAvatarUrl: f.profile.imageUrl });
  assert.equal(await f.changes(id), 1);
  assert.equal(await f.resolve({ ...f.identity, profile: { ...f.profile, nickname: '다음 공급자 별명', imageUrl: null } }), id);
  assert.equal((await f.self(id)).nickname, f.profile.nickname); assert.equal((await f.self(id)).providerAvatarUrl, f.profile.imageUrl);
  assert.equal(await f.changes(id), 1);
  const hints = await f.db.transactions.read(async tx => {
    const changes = await tx.prisma.profile_changes.findMany({ where: { user_id: id }, select: { id: true } });
    return tx.prisma.jobs.count({ where: { purpose: 'REALTIME_HINT', resource_id: { in: changes.map(c => c.id) } } });
  });
  assert.equal(hints, 1);
});
test('manual edits and explicit avatar clearing survive OAuth; old edited profiles are conservatively preserved', async t => {
  const f = await fixture(t), id = await f.resolve(f.identity);
  await f.db.transactions.write(tx => users.updateProfile(tx, id, { nickname: '직접 고른 별명', avatarAssetId: null }));
  await f.resolve({ ...f.identity, profile: f.profile });
  assert.equal((await f.self(id)).nickname, '직접 고른 별명'); assert.equal((await f.self(id)).providerAvatarUrl, null);
  const second = { ...f.identity, subject: f.identity.subject + 'b' }, other = await f.resolve(second);
  await f.db.transactions.write(tx => tx.prisma.user_profiles.update({ where: { user_id: other }, data: { nickname: '새 사용자', revision: 2n } }));
  await f.resolve({ ...second, profile: { displayId: second.subject, nickname: '변경 금지', imageUrl: null } });
  assert.equal((await f.self(other)).nickname, '새 사용자');
});
test('provider metadata never widens actor DTO; fan privacy, revocation and clearing invalidate read authorization', async t => {
  const f = await fixture(t), owner = await f.resolve({ ...f.identity, profile: f.profile });
  const fanIdentity = { ...f.identity, subject: f.identity.subject + 'f' }, fan = await f.resolve(fanIdentity);
  const otherIdentity = { ...f.identity, subject: f.identity.subject + 'g' }, other = await f.resolve(otherIdentity);
  const room = randomUUID(); let ownerActor, fanActor;
  await f.db.transactions.write(async tx => {
    await createRoom(tx, '격리 방', 'FAN', room); ownerActor = await joinRoom(tx, room, owner); await assignRoomOwner(tx, room, ownerActor);
    fanActor = await joinRoom(tx, room, fan); await joinRoom(tx, room, other);
  });
  const actor = await f.db.transactions.read(tx => users.roomProfile(tx, room, fan, ownerActor, f.key));
  assert.equal(actor.providerAvatarAvailable, true); assert.ok(!JSON.stringify(actor).includes(f.identity.subject));
  assert.equal(await f.db.transactions.read(tx => users.providerAvatar(tx, fan, room, ownerActor)), f.profile.imageUrl);
  let downloads = 0;
  t.mock.method(globalThis, 'fetch', async () => { downloads++; return new globalThis.Response(Buffer.from([255, 216, 255, 217]), { headers: { 'content-type': 'image/jpeg' } }); });
  const proxy = new ProviderAvatarService(f.db.transactions, { require: async () => ({ userId: fan }) }, { key: f.key, audience: 'isolated-proxy', callback: 'https://api.example/v1/auth/soop/callback' }, users);
  const lease = await proxy.access({}, room, ownerActor), ticket = new URL(lease.url).searchParams.get('ticket');
  assert.equal(lease.expiresIn, 60); assert.ok(!lease.url.includes(f.identity.subject));
  await proxy.image(ticket); await proxy.image(ticket); assert.equal(downloads, 1);
  await assert.rejects(f.db.transactions.read(tx => users.providerAvatar(tx, other, room, fanActor)), { code: 'NOT_FOUND' });
  await f.db.transactions.write(tx => users.updateProfile(tx, owner, { avatarAssetId: null }));
  assert.equal((await f.self(owner)).providerAvatarUrl, null);
  await assert.rejects(proxy.image(ticket), { code: 'NOT_FOUND' }); assert.equal(downloads, 1, 'cached bytes never bypass current avatar authorization');
  await assert.rejects(f.db.transactions.read(tx => users.providerAvatar(tx, fan, room, ownerActor)), { code: 'NOT_FOUND' });
  await f.resolve({ ...f.identity, profile: f.profile }); assert.equal((await f.self(owner)).providerAvatarUrl, null);
  assert.equal(await f.changes(owner), 2);
});
test('invalid token-bound metadata cannot create an account or modify an existing profile', async t => {
  const f = await fixture(t);
  await assert.rejects(f.resolve({ ...f.identity, profile: { ...f.profile, displayId: 'different' } }));
  assert.equal(await f.db.transactions.read(tx => tx.prisma.platform_soop.count({ where: { provider_subject: Buffer.from(f.identity.subject) } })), 0);
  const id = await f.resolve(f.identity), before = await f.self(id);
  await assert.rejects(f.resolve({ ...f.identity, profile: { ...f.profile, imageUrl: 'https://evil.invalid/image.jpg' } }));
  assert.deepEqual(await f.self(id), before);
});

test('a preexisting RR snapshot cannot overwrite a subsequently committed manual profile edit', async t => {
  const f = await fixture(t), id = await f.resolve(f.identity), read = Promise.withResolvers(), updated = Promise.withResolvers();
  const initialization = f.db.transactions.write(async tx => {
    await tx.prisma.user_profiles.findUnique({ where: { user_id: id }, select: { revision: true } }); read.resolve();
    await updated.promise;
    await new IdentityRepository().initializeProfile(tx, id, f.profile);
  });
  try {
    await read.promise;
    await f.db.transactions.write(tx => users.updateProfile(tx, id, { nickname: '경합 중 직접 변경', avatarAssetId: null }));
  } finally { updated.resolve(); }
  await initialization;
  const profile = await f.self(id); assert.equal(profile.nickname, '경합 중 직접 변경'); assert.equal(profile.providerAvatarUrl, null);
});
