import { stickers as stickerService } from '../support/domain-fixture.mjs';
import { reserveMedia, recoverMedia } from '../support/domain-fixture.mjs';
import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readConfig } from '../../dist/infrastructure/config/config.js';
import { MysqlDatabase } from '../../dist/infrastructure/database/database.js';
import { SessionService } from '../../dist/modules/auth/session.service.js';
import { SessionRepository } from '../../dist/modules/auth/session.repository.js';
import { AccessService } from '../../dist/modules/access/access.service.js';
import { MembershipRepository } from '../../dist/modules/access/membership.repository.js';
import { MEDIA_LIMITS } from '../../dist/common/media/media-policy.js';

const keys = value => Object.keys(value).sort();
const denied = promise => assert.rejects(promise, { code: 'NOT_FOUND' });
const forbidden = promise => assert.rejects(promise, { code: 'FORBIDDEN' });
const invalid = promise => assert.rejects(promise, { code: 'INVALID_REQUEST' });

async function fixture(t) {
  assert.equal(process.env.ROGICHAT_TEST_MYSQL, 'disposable');
  const db = new MysqlDatabase(readConfig('api')); t.after(() => db.close());
  const sessions = new SessionService(new SessionRepository(), 'stickers-fixture', randomBytes(32));
  const access = new AccessService(new MembershipRepository());
  const stickers = stickerService;
  // Test-owned persisted principals only; no production login bypass or provider endpoint.
  const user = nickname => db.transactions.write(async tx => {
    const id = randomUUID();
    await tx.execute('INSERT INTO users (id) VALUES (?)', [id]);
    await tx.execute('INSERT INTO user_profiles (user_id,nickname) VALUES (?,?)', [id, nickname]);
    await tx.execute('INSERT INTO platform_soop (id,user_id,provider_subject,verified_at) VALUES (?,?,?,UTC_TIMESTAMP(3))', [randomUUID(), id, Buffer.from(randomUUID())]);
    return { id, actors: new Map(), ...await sessions.issue(tx, id) };
  });
  const operator = await user('스티커 등록자'), approver = await user('스티커 승인자');
  const owner = await user('스티커 방장'), fan = await user('스티커 팬'), outsider = await user('스티커 외부인');
  await db.transactions.write(async tx => {
    for (const person of [operator, approver]) await tx.execute('INSERT INTO admin_capabilities (user_id,manage_stickers) VALUES (?,1)', [person.id]);
    await tx.execute('INSERT INTO admin_capabilities (user_id,manage_rooms,manage_users) VALUES (?,1,1)', [owner.id]);
  });
  const room = () => db.transactions.write(async tx => {
    const id = randomUUID(), streamId = randomUUID();
    await tx.execute("INSERT INTO rooms (id,name,mode) VALUES (?,?,'FAN')", [id, '스티커 합성방']);
    await tx.execute('INSERT INTO room_counters (room_id) VALUES (?)', [id]);
    await tx.execute("INSERT INTO message_streams (id,room_id,kind) VALUES (?,?,'ROOM_SHARED')", [streamId, id]);
    for (const person of [owner, fan]) {
      const memberId = randomUUID(), periodId = randomUUID(); person.actors.set(id, memberId);
      await tx.execute('INSERT INTO room_members (id,room_id,user_id,role) VALUES (?,?,?,?)', [memberId, id, person.id, person === owner ? 'STREAMER' : 'FAN']);
      await tx.execute("INSERT INTO membership_periods (id,room_id,member_id,policy_version,history_policy,visible_from_order) VALUES (?,?,?,1,'ALL_AVAILABLE',0)", [periodId, id, memberId]);
      await tx.execute('UPDATE room_members SET active_period_id=? WHERE id=?', [periodId, memberId]);
      await tx.execute('INSERT INTO stream_grants (id,room_id,stream_id,member_id,can_read,can_send) VALUES (?,?,?,?,1,1)', [randomUUID(), id, streamId, memberId]);
    }
    await tx.execute('UPDATE rooms SET owner_member_id=? WHERE id=?', [owner.actors.get(id), id]);
    return { id, streamId };
  });
  const rooms = [await room(), await room()];
  const auth = (person, writable, action) => db.transactions[writable ? 'write' : 'read'](async tx => {
    await sessions.require(tx, person.token, writable ? person.csrf : undefined, true);
    return action(tx);
  });
  // READY objects are synthetic eligibility fixtures, NOT upload/decoder/R2 verification.
  const asset = (person = operator, options = {}) => db.transactions.write(async tx => {
    const id = randomUUID(), attempt = randomUUID();
    const { kind = 'STICKER', roomId = null, state = 'READY', expired = false, deleted = false,
      declaredBytes = 32, outputBytes = 32, width = 32, height = 32, objectState = 'READY', image = true } = options;
    await tx.execute(`INSERT INTO media_assets (id,owner_user_id,room_id,kind,content_type,state,declared_bytes,reserved_bytes,expires_at,deleted_at)
      VALUES (?,?,?,?,'image/png',?,?,0,TIMESTAMPADD(SECOND,?,UTC_TIMESTAMP(3)),${deleted ? 'UTC_TIMESTAMP(3)' : 'NULL'})`,
    [id, person.id, roomId, kind, state, declaredBytes, expired ? -1 : 3600]);
    if (image) await tx.execute("INSERT INTO media_objects (id,asset_id,attempt_id,variant,object_key,state,byte_length,sha256,width,height) VALUES (?,?,?,'image',?,?,?,?,?,?)",
      [randomUUID(), id, attempt, `test/${id}/${attempt}/image`, objectState, outputBytes, 'a'.repeat(64), width, height]);
    return id;
  });
  const register = (assetId, label = '합성 스티커', person = operator) => auth(person, true, tx => stickers.register(tx, person.id, { assetId, label }));
  const state = (id, status, person = approver) => auth(person, true, tx => stickers.changeState(tx, person.id, id, { status }));
  const approved = async () => { const created = await register(await asset()); return state(created.id, 'ACTIVE'); };
  const list = (person = fan, target = rooms[0], after) => auth(person, false, tx => stickers.list(tx, target.id, person.id, after));
  const admit = (id, person = fan, target = rooms[0]) => auth(person, true, async tx => {
    await access.requireActiveMember(tx, target.id, person.id); return stickers.requireSend(tx, target.id, id);
  });
  // Explicit synthetic message persistence exercises ONLY requireSend/attach repository ports.
  // It is not MessagesCoreService validation, idempotency, HTTP DTO, journal, or fan ACL proof.
  const attachSynthetic = (id, target = rooms[0], person = fan) => auth(person, true, async tx => {
    const member = await access.requireActiveMember(tx, target.id, person.id);
    const content = await stickers.requireSend(tx, target.id, id); const messageId = randomUUID();
    await tx.execute("INSERT INTO messages (id,room_id,stream_id,sender_member_id,content_owner_user_id,content_kind,created_order) VALUES (?,?,?,?,?,'STICKER',1)",
      [messageId, target.id, target.streamId, member.id, person.id]);
    await stickers.attach(tx, target.id, messageId, content.stickerId); return messageId;
  });
  // Trusted port exercised on the fixture's shared messages after current session/member checks.
  const content = (id, target = rooms[0]) => auth(fan, false, async tx => {
    await access.requireActiveMember(tx, target.id, fan.id); return stickers.messageContent(tx, target.id, id);
  });
  const audit = id => db.transactions.read(tx => tx.rows('SELECT actor_user_id,action FROM sticker_audit_events WHERE sticker_id=? ORDER BY action,actor_user_id', [id]));
  const assetState = id => db.transactions.read(async tx => {
    const [row] = await tx.rows('SELECT state,deleted_at,reserved_bytes FROM media_assets WHERE id=?', [id]);
    const jobs = await tx.rows("SELECT id,state FROM jobs WHERE purpose='MEDIA' AND resource_id=? ORDER BY id", [id]);
    return { row, jobs };
  });
  return { db, sessions, stickers, operator, approver, owner, fan, outsider, rooms, auth, asset, register, state, approved, list, admit, attachSynthetic, content, audit, assetState };
}

test('manage_stickers-only operators register DRAFT then approve ACTIVE with minimal DTOs and idempotent audit', { timeout: 20000 }, async t => {
  const f = await fixture(t), assetId = await f.asset();
  const [capability] = await f.db.transactions.read(tx => tx.rows('SELECT manage_rooms,manage_users,manage_stickers FROM admin_capabilities WHERE user_id=?', [f.operator.id]));
  assert.equal(Number(capability.manage_stickers), 1); assert.equal(Number(capability.manage_rooms), 0); assert.equal(Number(capability.manage_users), 0);
  for (const person of [f.fan, f.owner, f.outsider]) await forbidden(f.register(assetId, '합성', person));
  await denied(f.register(assetId, '합성', f.approver));
  const draft = await f.register(assetId, '  e\u0301 스티커  ');
  assert.deepEqual(keys(draft), ['assetId', 'id', 'label', 'status']);
  assert.equal(draft.label, 'é 스티커'); assert.equal(draft.status, 'DRAFT'); assert.equal(draft.assetId, assetId);
  assert.deepEqual(await f.register(assetId, 'é 스티커'), draft); assert.equal((await f.audit(draft.id)).length, 1);
  await assert.rejects(f.register(assetId, '다른 이름'), { code: 'CONFLICT' });
  await denied(f.admit(draft.id)); await forbidden(f.state(draft.id, 'ACTIVE', f.owner));
  await assert.rejects(f.state(draft.id, 'RETIRED'), { code: 'CONFLICT' });
  const active = await f.state(draft.id, 'ACTIVE'); assert.deepEqual(active, { ...draft, status: 'ACTIVE' });
  const [persisted] = await f.db.transactions.read(tx => tx.rows('SELECT approved_by_user_id,approved_at FROM sticker_catalog WHERE id=?', [draft.id]));
  assert.equal(persisted.approved_by_user_id, f.approver.id); assert.ok(persisted.approved_at);
  assert.deepEqual(await f.state(draft.id, 'ACTIVE'), active);
  assert.deepEqual(await f.audit(draft.id), [{ actor_user_id: f.approver.id, action: 'ACTIVE' }, { actor_user_id: f.operator.id, action: 'REGISTERED' }]);
});

test('registration/state bodies and READY sticker metadata enforce exact fields, labels and byte/dimension caps', { timeout: 20000 }, async t => {
  const f = await fixture(t), assetId = await f.asset();
  for (const body of [null, [], {}, { assetId }, { assetId, label: 1 }, { assetId: 'invalid', label: 'x' },
    { assetId, label: 'x', objectKey: 'caller-controlled' }, { assetId, label: '' }, { assetId, label: ' ' },
    { assetId, label: 'x\ny' }, { assetId, label: '\u007f' }, { assetId, label: 'x'.repeat(65) }]) {
    await invalid(f.auth(f.operator, true, tx => f.stickers.register(tx, f.operator.id, body)));
  }
  const draft = await f.register(assetId, 'x'.repeat(64));
  for (const body of [null, [], {}, { status: 'DRAFT' }, { status: true }, { status: 'active' }, { status: 'ACTIVE', extra: 1 }]) {
    await invalid(f.auth(f.approver, true, tx => f.stickers.changeState(tx, f.approver.id, draft.id, body)));
  }
  const invalidAssets = [
    { expired: true }, { kind: 'PHOTO' }, { roomId: f.rooms[0].id }, { state: 'PROCESSING' }, { deleted: true },
    { image: false }, { objectState: 'STORED' }, { width: 513 }, { height: 513 }, { width: 0 }, { height: null },
    { declaredBytes: MEDIA_LIMITS.stickerBytes + 1 }, { outputBytes: MEDIA_LIMITS.stickerBytes + 1 }, { outputBytes: 0 },
  ];
  for (const options of invalidAssets) await denied(f.register(await f.asset(f.operator, options)));
  await denied(f.register(randomUUID()));
  assert.equal((await f.audit(draft.id)).length, 1);
  const boundary = await f.register(await f.asset(f.operator, { declaredBytes: MEDIA_LIMITS.stickerBytes, outputBytes: MEDIA_LIMITS.stickerBytes, width: 512, height: 512 }));
  assert.equal((await f.state(boundary.id, 'ACTIVE')).status, 'ACTIVE');
});

test('sticker upload intents require dedicated operator capability and bounded PNG/WebP room-null input', { timeout: 20000 }, async t => {
  const f = await fixture(t); const input = { kind: 'STICKER', contentType: 'image/png', byteLength: 32 };
  const reserve = (person, body = input, roomId = null) => f.auth(person, true, tx => reserveMedia(tx, person.id, roomId, body));
  for (const person of [f.fan, f.owner, f.outsider]) await assert.rejects(reserve(person), { code: 'MEDIA_FORBIDDEN' });
  for (const body of [{ ...input, byteLength: MEDIA_LIMITS.stickerBytes + 1 }, { ...input, byteLength: 0 },
    { ...input, contentType: 'image/jpeg' }, { ...input, canRegisterStickers: true }, { ...input, bucket: 'public' }]) {
    await assert.rejects(reserve(f.operator, body), { code: 'INVALID_MEDIA_INTENT' });
  }
  await invalid(reserve(f.operator, input, f.rooms[0].id));
  const reserved = await reserve(f.operator);
  assert.deepEqual(keys(reserved), ['assetId', 'status']); assert.equal(reserved.status, 'reserved');
  const [asset] = await f.db.transactions.read(tx => tx.rows('SELECT kind,room_id,declared_bytes,reserved_bytes FROM media_assets WHERE id=?', [reserved.assetId]));
  assert.equal(asset.kind, 'STICKER'); assert.equal(asset.room_id, null);
  assert.equal(Number(asset.reserved_bytes), 32 + MEDIA_LIMITS.stickerBytes);
  await f.db.transactions.write(tx => tx.execute('UPDATE admin_capabilities SET manage_stickers=0 WHERE user_id=?', [f.operator.id]));
  await assert.rejects(reserve(f.operator), { code: 'MEDIA_FORBIDDEN' });
});

test('catalog listing requires current room membership/policy and exposes only approved minimal entries', { timeout: 20000 }, async t => {
  const f = await fixture(t), active = await f.approved(), draft = await f.register(await f.asset());
  const listed = await f.list();
  assert.deepEqual(keys(listed), ['items', 'nextCursor']);
  assert.ok(listed.items.some(item => item.id === active.id)); assert.ok(!listed.items.some(item => item.id === draft.id));
  for (const item of listed.items) assert.deepEqual(keys(item), ['assetId', 'id', 'label']);
  await denied(f.list(f.outsider)); await denied(f.list(f.operator));
  await invalid(f.list(f.fan, f.rooms[0], 'invalid'));
  await f.db.transactions.write(tx => tx.execute('INSERT INTO room_media_policy (room_id,sticker_enabled) VALUES (?,0)', [f.rooms[0].id]));
  await assert.rejects(f.list(), { code: 'MEDIA_FORBIDDEN' });
  await assert.rejects(f.admit(active.id), { code: 'MEDIA_FORBIDDEN' });
  assert.ok((await f.list(f.fan, f.rooms[1])).items.some(item => item.id === active.id));
  await f.db.transactions.write(tx => tx.execute("UPDATE room_members SET status='LEFT' WHERE id=?", [f.fan.actors.get(f.rooms[1].id)]));
  await denied(f.list(f.fan, f.rooms[1]));
});

test('one approved catalog asset attaches to synthetic messages in two rooms; RETIRED blocks new sends but preserves history', { timeout: 20000 }, async t => {
  const f = await fixture(t), sticker = await f.approved();
  const first = await f.attachSynthetic(sticker.id), second = await f.attachSynthetic(sticker.id);
  const otherRoom = await f.attachSynthetic(sticker.id, f.rooms[1]);
  const expected = { stickerId: sticker.id, assetId: sticker.assetId, width: 32, height: 32 };
  for (const id of [first, second]) assert.deepEqual(await f.content(id), expected);
  assert.deepEqual(await f.content(otherRoom, f.rooms[1]), expected); await denied(f.content(first, f.rooms[1]));
  const links = await f.db.transactions.read(tx => tx.rows('SELECT room_id,message_id FROM message_stickers WHERE sticker_id=?', [sticker.id]));
  assert.equal(links.length, 3); assert.equal(new Set(links.map(row => row.room_id)).size, 2);
  await f.state(sticker.id, 'RETIRED'); await denied(f.admit(sticker.id));
  assert.ok(!(await f.list()).items.some(item => item.id === sticker.id));
  assert.deepEqual(await f.content(first), expected); assert.deepEqual(await f.content(otherRoom, f.rooms[1]), expected);
  assert.deepEqual((await f.assetState(sticker.assetId)).jobs, []);
  await f.state(sticker.id, 'ACTIVE'); assert.deepEqual(await f.admit(sticker.id), { stickerId: sticker.id, assetId: sticker.assetId });
});

test('REVOKED blocks both new and historical content with atomic, idempotent cleanup and audit', { timeout: 20000 }, async t => {
  const f = await fixture(t), sticker = await f.approved(), message = await f.attachSynthetic(sticker.id);
  const beforeAudit = await f.audit(sticker.id), beforeAsset = await f.assetState(sticker.assetId);
  const rollback = new Error('fixture_revoke_rollback');
  await assert.rejects(f.auth(f.approver, true, async tx => {
    await f.stickers.changeState(tx, f.approver.id, sticker.id, { status: 'REVOKED' }); throw rollback;
  }), error => error === rollback);
  assert.deepEqual(await f.assetState(sticker.assetId), beforeAsset); assert.deepEqual(await f.audit(sticker.id), beforeAudit);
  assert.equal((await f.content(message)).stickerId, sticker.id);
  await f.state(sticker.id, 'REVOKED'); const revoked = await f.assetState(sticker.assetId);
  assert.equal(revoked.row.state, 'DELETING'); assert.ok(revoked.row.deleted_at); assert.equal(revoked.jobs.length, 1);
  assert.equal(revoked.jobs[0].state, 'PENDING'); assert.equal(revoked.row.reserved_bytes, beforeAsset.row.reserved_bytes);
  await denied(f.admit(sticker.id)); await denied(f.content(message));
  assert.ok(!(await f.list()).items.some(item => item.id === sticker.id));
  await f.state(sticker.id, 'REVOKED'); assert.deepEqual(await f.assetState(sticker.assetId), revoked);
  const events = await f.audit(sticker.id); assert.equal(events.length, beforeAudit.length + 1);
  assert.equal(events.filter(event => event.action === 'REVOKED').length, 1);
  for (const status of ['ACTIVE', 'RETIRED']) await assert.rejects(f.state(sticker.id, status), { code: 'CONFLICT' });
  const [link] = await f.db.transactions.read(tx => tx.rows('SELECT sticker_id FROM message_stickers WHERE room_id=? AND message_id=?', [f.rooms[0].id, message]));
  assert.equal(link.sticker_id, sticker.id); // Historical provenance survives access revocation.
});

test('approved service assets survive registrar deletion and expiry recovery; expired unapproved drafts do not', { timeout: 20000 }, async t => {
  const f = await fixture(t), active = await f.approved(), retired = await f.approved();
  const draft = await f.register(await f.asset()); const message = await f.attachSynthetic(retired.id);
  await f.state(retired.id, 'RETIRED');
  await f.db.transactions.write(async tx => {
    for (const entry of [active, retired, draft]) await tx.execute("UPDATE media_assets SET expires_at=TIMESTAMPADD(SECOND,-1,UTC_TIMESTAMP(3)),created_at='2000-01-01 00:00:00' WHERE id=?", [entry.assetId]);
    await tx.execute("UPDATE users SET status='DELETING' WHERE id=?", [f.operator.id]);
  });
  await denied(f.state(draft.id, 'ACTIVE'));
  await f.db.transactions.write(recoverMedia); await f.db.transactions.write(recoverMedia);
  for (const entry of [active, retired]) {
    const persisted = await f.assetState(entry.assetId); assert.equal(persisted.row.state, 'READY'); assert.deepEqual(persisted.jobs, []);
  }
  const expired = await f.assetState(draft.assetId); assert.equal(expired.row.state, 'DELETING'); assert.equal(expired.jobs.length, 1);
  assert.deepEqual(await f.admit(active.id), { stickerId: active.id, assetId: active.assetId });
  assert.equal((await f.content(message)).assetId, retired.assetId);
  assert.ok((await f.list()).items.some(item => item.id === active.id));
  assert.equal((await f.state(retired.id, 'ACTIVE')).status, 'ACTIVE');
  assert.deepEqual(await f.admit(retired.id), { stickerId: retired.id, assetId: retired.assetId });
});
