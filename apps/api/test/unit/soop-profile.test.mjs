import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, realpath, writeFile, chmod, symlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readDefaultRoomConfig } from '../../dist/modules/owner-bootstrap/default-room.config.js';
import { canonicalProfileId, parseSoopProfile } from '../../dist/modules/auth/soop-profile.contract.js';
import { sealAvatarTicket, openAvatarTicket, fetchProviderAvatar } from '../../dist/modules/users/provider-avatar.service.js';
import { ProviderAvatarReader } from '../../dist/modules/users/provider-avatar-reader.js';
const { Response } = globalThis;
const subject = 'Test_Viewer';
const imageUrl = 'https://stimg.sooplive.com/LOGO/Te/Test_Viewer/m/Test_Viewer.webp';
test('owner config is optional but configured custody, size and shape fail closed without leaking values', async t => {
  assert.deepEqual(readDefaultRoomConfig({}), {});
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'default-room-config-'))); t.after(() => rm(directory, { recursive: true }));
  const file = join(directory, 'owner.json'), alias = join(directory, 'alias.json');
  const value = { expectedSubject: 'isolated_owner' };
  await writeFile(file, JSON.stringify(value), { mode: 0o600 });
  assert.deepEqual(readDefaultRoomConfig({ DEFAULT_ROOM_SECRET_FILE: file }), value);
  await symlink(file, alias); assert.throws(() => readDefaultRoomConfig({ DEFAULT_ROOM_SECRET_FILE: alias }), { message: 'default_room_configuration' });
  await chmod(file, 0o644); assert.throws(() => readDefaultRoomConfig({ DEFAULT_ROOM_SECRET_FILE: file })); await chmod(file, 0o600);
  for (const invalid of [{ ...value, extra: true }, { expectedSubject: 'unverified:subject' }, { ...value, roomId: 'bad' }, { expectedSubject: 'a'.repeat(3000) }]) {
    await writeFile(file, JSON.stringify(invalid)); assert.throws(() => readDefaultRoomConfig({ DEFAULT_ROOM_SECRET_FILE: file }), { message: 'default_room_configuration' });
  }
});
test('many authorized viewers of one avatar share one download; distinct images queue within four active reads', async () => {
  let calls = 0, active = 0, peak = 0;
  const reader = new ProviderAvatarReader(async () => {
    calls++; active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 10)); active--;
    return { bytes: Buffer.from([255, 216, 255, 217]), contentType: 'image/jpeg' };
  }, () => new Error('bounded_capacity'));
  const burst = await Promise.all(Array.from({ length: 30 }, () => reader.get(imageUrl)));
  assert.equal(calls, 1); assert.equal(burst.length, 30);
  await reader.get(imageUrl); assert.equal(calls, 1);
  await Promise.all(Array.from({ length: 12 }, (_, index) => reader.get(`${imageUrl}?t=${index}`)));
  assert.equal(calls, 13); assert.equal(peak, 4);
});
test('avatar reader does not cache failures and bounds distinct queued reads', async () => {
  let attempts = 0;
  const failed = new ProviderAvatarReader(async () => { attempts++; throw new Error('provider_failed'); }, () => new Error('bounded_capacity'));
  await assert.rejects(failed.get(imageUrl)); await assert.rejects(failed.get(imageUrl)); assert.equal(attempts, 2);
  const release = Promise.withResolvers();
  const reader = new ProviderAvatarReader(async () => { await release.promise; return { bytes: Buffer.alloc(4), contentType: 'image/jpeg' }; }, () => new Error('bounded_capacity'));
  const requests = Array.from({ length: 36 }, (_, index) => reader.get(`${imageUrl}?t=${index}`));
  await assert.rejects(reader.get(`${imageUrl}?t=100`), /bounded_capacity/);
  release.resolve(); await Promise.all(requests);
});
test('token-bound display profile is a closed projection, never an identity inference', () => {
  const profile = { displayId: subject, nickname: '검증된 별명', imageUrl };
  assert.deepEqual(parseSoopProfile(profile, subject), profile);
  assert.deepEqual(parseSoopProfile({ ...profile, nickname: null, imageUrl: null }, subject), { displayId: subject, nickname: null, imageUrl: null });
  assert.equal(parseSoopProfile({ ...profile, nickname: ' \u1100\u1161e\u0301 ' }, subject).nickname, '가é');
  assert.equal(parseSoopProfile({ ...profile, nickname: '😀'.repeat(40) }, subject).nickname, '😀'.repeat(40));
  for (const patch of [{ displayId: 'Other' }, { nickname: '\u202Ehidden' }, { nickname: '😀'.repeat(41) }, { nickname: 'x'.repeat(41) }, { nickname: undefined }, { imageUrl: undefined }, { accessToken: 'forbidden' }])
    assert.throws(() => parseSoopProfile({ ...profile, ...patch }, subject));
  for (const value of ['http://stimg.sooplive.com/LOGO/Te/Test_Viewer/Test_Viewer.jpg', imageUrl + '#fragment', imageUrl + '&x=1', imageUrl.replace('/Te/', '/te/'), imageUrl.replace('https://', 'https://user@'), imageUrl.replace('.com/', '.com.evil.invalid/'), imageUrl.replace('/m/', '/../'), imageUrl + '\n']) {
    assert.equal(canonicalProfileId(value), null); assert.throws(() => parseSoopProfile({ ...profile, imageUrl: value }, subject));
  }
});
test('opaque avatar capabilities are encrypted, short-lived, canonical and bound to scope', () => {
  const key = randomBytes(32), now = Date.now(), value = { userId: randomUUID(), roomId: randomUUID(), actorId: randomUUID(), sourceHash: 'a'.repeat(64), expires: now + 60000 };
  const ticket = sealAvatarTicket(value, key);
  assert.deepEqual(openAvatarTicket(ticket, key, now), value);
  assert.ok(!Buffer.from(ticket, 'base64url').includes(Buffer.from(value.userId)));
  for (const candidate of [ticket + '=', ticket.slice(1), ticket.slice(0, -4) + 'AAAA']) assert.throws(() => openAvatarTicket(candidate, key, now));
  assert.throws(() => openAvatarTicket(ticket, randomBytes(32), now));
  assert.throws(() => openAvatarTicket(ticket, key, now + 60000));
  for (const patch of [{ expires: now + 60001 }, { actorId: undefined }, { userId: 'wrong' }, { sourceHash: '' }]) assert.throws(() => openAvatarTicket(sealAvatarTicket({ ...value, ...patch }, key), key, now));
});
test('provider reader never follows redirects or accepts arbitrary hosts, SVG, oversized or disguised bytes', async () => {
  let calls = 0;
  const reader = async (url, options) => { calls++; assert.equal(url, imageUrl); assert.equal(options.redirect, 'error'); assert.ok(options.signal); return new Response(Buffer.from('RIFF0000WEBPdata'), { headers: { 'content-type': 'image/webp' } }); };
  assert.equal((await fetchProviderAvatar(imageUrl, reader)).contentType, 'image/webp');
  await assert.rejects(fetchProviderAvatar('https://evil.invalid/', reader)); assert.equal(calls, 1);
  for (const response of [new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } }), new Response('not an image', { headers: { 'content-type': 'image/jpeg' } }), new Response(null, { status: 302, headers: { location: 'https://evil.invalid/' } }), new Response('x', { headers: { 'content-type': 'image/jpeg', 'content-length': '2097153' } }), new Response(new Uint8Array(2097153), { headers: { 'content-type': 'image/jpeg' } })]) {
    await assert.rejects(fetchProviderAvatar(imageUrl, async () => response), { code: 'MEDIA_UNAVAILABLE' });
  }
  const jpeg = Buffer.from([255, 216, 255, 217]);
  assert.deepEqual((await fetchProviderAvatar(imageUrl, async () => new Response(jpeg, { headers: { 'content-type': 'image/jpeg' } }))).bytes, jpeg);
});
