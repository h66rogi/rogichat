import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync, openSync, closeSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { BOOTSTRAP_RECEIPT, ownerBootstrapRequest, bootstrapSpecId, readOwnerBootstrapRequest, requirePrivateFile } from '../../dist/modules/owner-bootstrap/owner-bootstrap.request.js';
import { OwnerBootstrapService } from '../../dist/modules/owner-bootstrap/owner-bootstrap.service.js';
const request = () => ({ version: 1, scope: 'INITIAL_OWNER', environment: 'qa', requestId: randomUUID(), ownerUserId: randomUUID(),
  expectedProvider: 'soop', expectedSubject: 'isolated-unit-subject', roomId: randomUUID(), name: '테스트', mode: 'FAN',
  historyPolicy: 'SINCE_JOIN', grantCreator: true, grantManageRooms: false });

test('strict explicit scope and canonical values; no account/provider inference', () => {
  const r = request(); assert.deepEqual(ownerBootstrapRequest(r), r);
  for (const patch of [{ extra: true }, { scope: 'AUTO' }, { expectedProvider: 'email' }, { expectedSubject: '' },
    { expectedSubject: '\ud800' }, { expectedSubject: '가'.repeat(64) }, { ownerUserId: 'nickname' }, { roomId: r.ownerUserId },
    { requestId: BOOTSTRAP_RECEIPT }, { grantCreator: 'true' }, { grantManageRooms: undefined }, { mode: 'GROUP' },
    { name: ' trim ' }, { name: '' }, { historyPolicy: 'DEFAULT' }, { environment: 'test' }]) {
    assert.throws(() => ownerBootstrapRequest({ ...r, ...patch }));
  }
  for (const key of Object.keys(r)) { const copy = { ...r }; delete copy[key]; assert.throws(() => ownerBootstrapRequest(copy)); }
});
test('keyed specification binds every exact request field, independent of input property order', () => {
  const r = ownerBootstrapRequest(request()), key = randomBytes(32), id = bootstrapSpecId(r, key);
  assert.equal(bootstrapSpecId(ownerBootstrapRequest(Object.fromEntries(Object.entries(r).reverse())), key), id);
  for (const patch of [{ requestId: randomUUID() }, { ownerUserId: randomUUID() }, { roomId: randomUUID() }, { name: '다른 방' },
    { expectedSubject: 'another-subject' }, { grantCreator: false }, { grantManageRooms: true }, { historyPolicy: 'ALL_AVAILABLE' }, { environment: 'production' }]) {
    assert.notEqual(bootstrapSpecId(ownerBootstrapRequest({ ...r, ...patch }), key), id);
  }
  assert.notEqual(bootstrapSpecId(r, randomBytes(32)), id);
});
test('private regular stdin only, bounded size and protected config', t => {
  const dir = mkdtempSync(join(tmpdir(), 'owner-bootstrap-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'request.json'), r = request(); writeFileSync(path, JSON.stringify(r), { mode: 0o600 });
  let fd = openSync(path, 'r'); try { assert.deepEqual(readOwnerBootstrapRequest(fd), r); } finally { closeSync(fd); }
  requirePrivateFile(path); chmodSync(path, 0o644); assert.throws(() => requirePrivateFile(path));
  fd = openSync(path, 'r'); try { assert.throws(() => readOwnerBootstrapRequest(fd)); } finally { closeSync(fd); }
  chmodSync(path, 0o600); writeFileSync(path, 'x'.repeat(8193));
  fd = openSync(path, 'r'); try { assert.throws(() => readOwnerBootstrapRequest(fd)); } finally { closeSync(fd); }
});
function fixture(patch = {}) {
  const r = request(), calls = [];
  const state = { receipts: [{ id: BOOTSTRAP_RECEIPT, actor_user_id: r.ownerUserId, room_id: r.roomId, action: 'INITIAL_OWNER_BOOTSTRAP' }],
    user: { status: 'ACTIVE', soop: { status: 'VERIFIED', provider_subject: Buffer.from(r.expectedSubject), verified_at: new Date() }, creator: null, admin: null },
    deletion: 0, intents: 0, room: null, otherRooms: 0, otherCreators: 0, otherManagers: 0, ...patch };
  const config = { environment: 'qa', identityGuardKey: randomBytes(32) };
  const tx = {}, repository = {
    claim: async () => calls.push('claim'), lockTargets: async () => calls.push('locks'),
    snapshot: async () => { calls.push('snapshot'); return state; }, grant: async () => calls.push('grant'), receipt: async () => calls.push('receipt'),
  };
  const service = new OwnerBootstrapService({ write: fn => fn(tx) }, { check: async () => ({ ready: true }) }, repository,
    { check: async () => calls.push('guard') }, { createOwnedRoom: async (...args) => { calls.push('room'); assert.equal(args[4], r.ownerUserId); assert.equal(args[5], r.roomId); return { roomId: r.roomId }; } }, config);
  return { r, state, calls, service, config, repository };
}
test('one transaction uses guards before target locks and shared domain primitive', async () => {
  const f = fixture(); assert.deepEqual(await f.service.provision(f.r), { status: 'applied', roomId: f.r.roomId });
  assert.deepEqual(f.calls, ['claim', 'guard', 'locks', 'snapshot', 'grant', 'room', 'receipt']);
});
for (const patch of [{ user: null }, { deletion: 1 }, { intents: 1 }, { otherRooms: 2 }, { otherCreators: 1 }, { otherManagers: 1 }]) {
  test(`fails closed without grants: ${Object.keys(patch)[0]}`, async () => {
    const f = fixture(patch); await assert.rejects(f.service.provision(f.r)); assert.ok(!f.calls.includes('grant'));
  });
}
test('unverified, inactive, wrong subject, missing creator opt-in and conflicting receipt deny', async () => {
  for (const mutate of [f => { f.state.user.status = 'DELETING'; }, f => { f.state.user.soop.status = 'REVOKED'; },
    f => { f.state.user.soop.provider_subject = Buffer.from('wrong'); }, f => { f.r.grantCreator = false; },
    f => { f.state.receipts[0].actor_user_id = randomUUID(); }]) {
    const f = fixture(); mutate(f); await assert.rejects(f.service.provision(f.r)); assert.ok(!f.calls.includes('grant'));
  }
});
test('exact replay verifies live owner, period, policy and requested grant without mutation', async () => {
  const f = fixture(), actor = randomUUID();
  f.state.receipts.push(...[[f.r.requestId, 'INITIAL_OWNER_REQUEST'], [bootstrapSpecId(f.r, f.config.identityGuardKey), 'INITIAL_OWNER_SPEC']].map(([id, action]) => ({ id, action, actor_user_id: f.r.ownerUserId, room_id: f.r.roomId })));
  f.state.user.creator = { enabled: true };
  f.state.room = { id: f.r.roomId, name: f.r.name, mode: 'FAN', status: 'ACTIVE', history_policy: f.r.historyPolicy,
    policy_version: 1, join_policy: 'OPEN_AUTHENTICATED', counter: {}, streams: [{}], owner_member_id: actor,
    owner: { id: actor, user_id: f.r.ownerUserId, role: 'STREAMER', status: 'ACTIVE', active_period: {
      room_id: f.r.roomId, member_id: actor, left_at: null, history_policy: f.r.historyPolicy, policy_version: 1 } } };
  assert.equal((await f.service.provision(f.r)).status, 'already_applied'); assert.ok(!f.calls.includes('grant'));
  f.state.room.owner.role = 'FAN'; await assert.rejects(f.service.provision(f.r));
});
test('precommit receipt failure propagates without service-level retry', async () => {
  const f = fixture(); f.repository.receipt = async () => { throw new Error('isolated_receipt_failure'); };
  await assert.rejects(f.service.provision(f.r), /isolated_receipt_failure/); assert.equal(f.calls.filter(x => x === 'grant').length, 1);
});
test('operator CLI rejects argv and pipes without logging supplied private values', () => {
  try { execFileSync(process.execPath, ['dist/modules/owner-bootstrap/owner-bootstrap.command.js', 'private-marker'], { cwd: new URL('../../', import.meta.url), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }); assert.fail(); }
  catch (error) { assert.equal(error.status, 1); assert.equal(error.stdout, ''); assert.match(error.stderr, /^owner_bootstrap_failed_or_outcome_unknown;/); assert.ok(!error.stderr.includes('private-marker')); }
  try { execFileSync(process.execPath, ['dist/modules/owner-bootstrap/owner-bootstrap.command.js'], { cwd: new URL('../../', import.meta.url), input: JSON.stringify(request()), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }); assert.fail(); }
  catch (error) { assert.equal(error.status, 1); assert.equal(error.stdout, ''); assert.ok(!error.stderr.includes('isolated-unit-subject')); }
});
