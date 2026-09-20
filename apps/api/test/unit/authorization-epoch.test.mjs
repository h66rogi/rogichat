import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdtemp, writeFile, chmod, symlink, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readAuthorizationEpoch, authorizationKey, authorizationKeyFingerprint } from '../../dist/infrastructure/config/authorization-epoch.js';
import { SessionService } from '../../dist/modules/auth/session.service.js';
import { MembershipScopeService } from '../../dist/modules/membership-scope/membership-scope.service.js';
import { membershipScope } from '../../dist/modules/membership-scope/membership-scope.js';
import { CursorCodec } from '../../dist/modules/sync/cursor.js';
import { AppleSeal } from '../../dist/modules/auth/apple/apple-seal.js';

test('fresh authorization epoch rejects actual old scopes/cursors and partitions while Apple ciphertext remains decryptable', async () => {
  const key = randomBytes(32), base = { key, audience: 'rogi-test' }, first = { ...base, authorizationEpoch: randomUUID() }, second = { ...base, authorizationEpoch: randomUUID() };
  assert.equal(authorizationKey(base), key); // Exact absent-epoch compatibility, not a new legacy derivation.
  const before = authorizationKey(first), after = authorizationKey(second), user = randomUUID(), room = randomUUID(), period = randomUUID();
  assert.notDeepEqual(before, after); assert.notDeepEqual(before, key);
  assert.equal(authorizationKeyFingerprint(second), createHash('sha256').update(after).digest('hex'));
  assert.notEqual(authorizationKeyFingerprint(second), createHash('sha256').update(key).digest('hex'));
  assert.notEqual(membershipScope(before, base.audience, user, room, period), membershipScope(after, base.audience, user, room, period));
  assert.notEqual(new SessionService({}, base.audience, before).accountPartition(user), new SessionService({}, base.audience, after).accountPartition(user));
  const codec1 = new CursorCodec(before, base.audience), codec2 = new CursorCodec(after, base.audience);
  const binding = { purpose: 'events', userId: user, sessionId: randomUUID(), roomId: room, periodId: period, deviceId: randomUUID(), cacheId: randomUUID(), acl: randomBytes(32).toString('base64url') };
  const now = new Date();
  const token = codec1.encode(binding, { from: '0', upper: null, lastId: null }, { now });
  assert.deepEqual(codec1.decode(token, binding, now), { from: '0', upper: null, lastId: null });
  assert.throws(() => codec2.decode(token, binding, now));
  const membership = { id: randomUUID(), room_id: room, active_period_id: period, role: 'FAN', room: { mode: 'GROUP', policy_version: 1, content_epoch: 12n }, active_period: { visible_from_order: 0n }, acl_epoch: 12n, user: { membership_generation: 12n } };
  const repository = { batch: async () => ({ members: [membership], grants: [], revoked: [] }) };
  const oldScope = await new MembershipScopeService(first, repository).one({}, user, room, now);
  const newScope = await new MembershipScopeService(second, repository).one({}, user, room, now);
  assert.notEqual(oldScope.membershipScope, newScope.membershipScope);
  assert.notEqual(oldScope.authorizationRevision, newScope.authorizationRevision);
  const seal = new AppleSeal(key, base.audience), id = randomUUID(), ciphertext = seal.seal({ token: 'synthetic-revocation-obligation' }, id, 'refresh');
  assert.deepEqual(new AppleSeal(second.key, second.audience).open(ciphertext, id, 'refresh'), { token: 'synthetic-revocation-obligation' });
  assert.throws(() => new AppleSeal(after, base.audience).open(ciphertext, id, 'refresh'));
});
test('epoch file parser rejects permissive modes, links, relative paths, duplicates, BOM and non-JSON whitespace', async t => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'rg-epoch-'))); t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'epoch'), epoch = randomUUID(), body = JSON.stringify({ authorizationEpoch: epoch });
  await writeFile(path, body, { mode: 0o600 }); assert.equal(readAuthorizationEpoch({ AUTHORIZATION_EPOCH_FILE: path }), epoch);
  assert.equal(readAuthorizationEpoch({}), undefined);
  for (const invalid of ['\ufeff' + body, '\u00a0' + body, body.replace('}', `,"authorizationEpoch":"${epoch}"}`), JSON.stringify({ authorizationEpoch: epoch.toUpperCase() }), '{}']) {
    await writeFile(path, invalid); assert.throws(() => readAuthorizationEpoch({ AUTHORIZATION_EPOCH_FILE: path }));
  }
  await writeFile(path, body); await chmod(path, 0o644); assert.throws(() => readAuthorizationEpoch({ AUTHORIZATION_EPOCH_FILE: path })); await chmod(path, 0o600);
  await symlink(path, join(directory, 'link')); assert.throws(() => readAuthorizationEpoch({ AUTHORIZATION_EPOCH_FILE: join(directory, 'link') }));
  assert.throws(() => readAuthorizationEpoch({ AUTHORIZATION_EPOCH_FILE: 'relative-epoch' }));
  const parentLink = join(directory, 'parent-link'); await symlink(directory, parentLink);
  assert.throws(() => readAuthorizationEpoch({ AUTHORIZATION_EPOCH_FILE: join(parentLink, 'epoch') }));
});

// Deliberately retain the old row: rejection must not depend on changed counters
// or a revoked_at flag which an older backup could resurrect.
test('epoch-bound WEB and native token lookup rejects retained old session rows', async () => {
  const key = randomBytes(32), base = { key, audience: 'rogi-test' }, oldConfig = { ...base, authorizationEpoch: randomUUID() }, newConfig = { ...base, authorizationEpoch: randomUUID() };
  const rows = new Map(), userId = randomUUID();
  const repository = {
    async insert(_tx, row, binding = { transport: 'WEB' }) {
      rows.set(row.tokenDigest.toString('hex'), { ...row, ...binding, user_id: userId, status: 'ACTIVE', soop_status: 'VERIFIED' });
      return new Date(Date.now() + 60000);
    },
    async findCurrent(_tx, tokenDigest, _audience, binding) {
      const row = rows.get(tokenDigest.toString('hex'));
      return row?.transport === binding.transport && row.clientId === binding.clientId ? row : undefined;
    },
  };
  const old = new SessionService(repository, base.audience, authorizationKey(oldConfig), oldConfig.authorizationEpoch);
  const fresh = new SessionService(repository, base.audience, authorizationKey(newConfig), newConfig.authorizationEpoch);
  const legacy = new SessionService(repository, base.audience, key);
  for (const binding of [{ transport: 'WEB' }, { transport: 'NATIVE', clientId: 'android' }]) {
    const session = binding.transport === 'WEB' ? await old.issue({}, userId) : await old.issueNative({}, userId, binding.clientId);
    assert.equal((await old.require({}, session.token, undefined, false, binding)).userId, userId);
    await assert.rejects(fresh.require({}, session.token, undefined, false, binding));
    await assert.rejects(legacy.require({}, session.token, undefined, false, binding));
    const next = binding.transport === 'WEB' ? await fresh.issue({}, userId) : await fresh.issueNative({}, userId, binding.clientId);
    assert.equal((await fresh.require({}, next.token, undefined, false, binding)).userId, userId);
  }
  const prior = await legacy.issue({}, userId);
  assert.equal((await legacy.require({}, prior.token)).userId, userId);
  await assert.rejects(fresh.require({}, prior.token));
});
