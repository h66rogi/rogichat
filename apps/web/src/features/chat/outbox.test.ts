import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAuthority, applyReceipt, emptyState, expire, insert, normalizeAuthority, normalizePayload, OUTBOX_LIMITS, outboxSessionKey } from './outbox/model';

const roomId = '11111111-1111-4111-8111-111111111111';
const id = '22222222-2222-4222-8222-222222222222';
const scope = 'A'.repeat(43);
const authority = normalizeAuthority({ accountPartition: scope, sessionKey: 'a'.repeat(64), rooms: [{ roomId, membershipScope: scope, authorizationRevision: scope }] });
const payload = normalizePayload({ clientMessageId: id, membershipScope: scope, intent: 'SHARED', content: { type: 'TEXT', text: 'e\u0301' } });
function seeded() { const state = emptyState(); applyAuthority(state, authority, 100); insert(state, roomId, payload, 100); return state; }

void test('durable payload is normalized, copied and frozen before persistence', () => {
  assert.equal(payload.content.type === 'TEXT' && payload.content.text, 'é'); assert.ok(Object.isFrozen(payload.content));
  assert.throws(() => normalizePayload({ ...payload, recipientActorId: id }));
  assert.throws(() => normalizePayload({ ...payload, content: { type: 'TEXT', text: '\0' } }));
  assert.throws(() => normalizePayload({ ...payload, content: { type: 'TEXT', text: 'x'.repeat(4001) } }));
});
void test('same command cannot change immutable payload or rebind after authorization ABA', () => {
  const state = seeded();
  assert.throws(() => insert(state, roomId, { ...payload, content: { type: 'TEXT', text: 'other' } }, 101));
  applyAuthority(state, { ...authority, rooms: [{ ...authority.rooms[0]!, authorizationRevision: 'B'.repeat(42) + 'A' }] }, 102);
  applyAuthority(state, authority, 103);
  assert.equal(state.records[0]!.payload, undefined);
  assert.throws(() => insert(state, roomId, payload, 104));
});
void test('new same-account session and complete manifest room removal scrub payload', () => {
  for (const next of [{ ...authority, sessionKey: 'b'.repeat(64) }, { ...authority, rooms: [] }]) {
    const state = seeded(); applyAuthority(state, next, 101);
    assert.equal(state.records[0]!.payload, undefined);
    assert.equal(state.records[0]!.clientMessageId, id);
  }
});
void test('expiry never renews on repeated preparation; identity retention is bounded', () => {
  const state = seeded(); insert(state, roomId, payload, 200);
  assert.equal(state.records[0]!.payloadExpiresAt, 100 + OUTBOX_LIMITS.payloadMs);
  expire(state, 100 + OUTBOX_LIMITS.payloadMs); assert.equal(state.records[0]!.payload, undefined);
  expire(state, 100 + OUTBOX_LIMITS.identityMs); assert.deepEqual(state.records, []);
});
void test('deleted receipt scrubs content and remains terminal under late committed receipt', () => {
  const record = seeded().records[0]!;
  applyReceipt(record, { clientMessageId: id, status: 'deleted' });
  applyReceipt(record, { clientMessageId: id, status: 'committed', messageId: roomId, version: '1' });
  assert.equal(record.payload, undefined); assert.deepEqual(record.result, { clientMessageId: id, status: 'deleted' });
});
void test('capacity refuses new input without evicting unknown commands', () => {
  const state = seeded();
  for (let i = 1; i < OUTBOX_LIMITS.records; i++) insert(state, roomId, { ...payload, clientMessageId: `${String(i).padStart(8, '0')}-1111-4111-8111-111111111111` }, 100);
  assert.throws(() => insert(state, roomId, { ...payload, clientMessageId: 'ffffffff-1111-4111-8111-111111111111' }, 100), /CAPACITY/);
  assert.equal(state.records.length, 256);
});
void test('session binding persisted only as environment-domain-separated digest', async () => {
  const qa = await outboxSessionKey('qa', 'isolated-test-session');
  assert.match(qa, /^[a-f0-9]{64}$/);
  assert.notEqual(qa, await outboxSessionKey('production', 'isolated-test-session'));
});
void test('media payload retains only wire references and freezes independent asset arrays', () => {
  const assetIds = [roomId];
  const media = normalizePayload({ ...payload, content: { type: 'PHOTO', assetIds } });
  assetIds.push(id);
  assert.equal(media.content.type === 'PHOTO' && media.content.assetIds.length, 1);
  assert.throws(() => normalizePayload({ ...payload, content: { type: 'PHOTO', assetIds: [id, id] } }));
  assert.throws(() => normalizePayload({ ...payload, content: { type: 'VIDEO', assetIds: [id, roomId] } }));
  assert.deepEqual(normalizePayload({ ...payload, content: { type: 'STICKER', stickerId: id } }).content, { type: 'STICKER', stickerId: id });
});
