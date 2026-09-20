import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { envelope, event, mergeMessages, message, receipt, token, version } from './contract';
import { SendCommands } from './commands';

// Exact C05 492f2f75 fixture, copied only into isolated tests.
const fixture = JSON.parse(readFileSync(new URL('../../../test/fixtures/message-projection-c05.json', import.meta.url), 'utf8'));
const scopes = { membershipScope: 'A'.repeat(43), authorizationRevision: 'B'.repeat(42) + 'A' };
const base = { schemaVersion: 2, resetRequired: false };
const snapshot = { ...base, ...scopes, messages: [fixture.privateOutgoing], nextCursor: 'opaque-events', historyCursor: 'distinct-history' };

void test('exact C05 fixtures replace whole equal-version DTO including absent counterpart', () => {
  const outgoing = message(fixture.privateOutgoing); const changed = message(fixture.stalePrivateOutgoing);
  assert.equal(outgoing.version, changed.version);
  assert.deepEqual(mergeMessages([outgoing], [changed]), [changed]);
  assert.equal(message(fixture.anonymousPublisher).allowedActions.delete, true);
  assert.deepEqual(event(fixture.tombstone), fixture.tombstone);
});

void test('nested message allowlists reject private identities, extra hints and malformed media', () => {
  for (const mutate of [
    (m: typeof fixture.privateOutgoing) => { m.sourceId = m.id; },
    (m: typeof fixture.privateOutgoing) => { m.author.accountId = m.id; },
    (m: typeof fixture.privateOutgoing) => { m.author.avatar = { assetId: m.id, signedUrl: 'private' }; },
    (m: typeof fixture.privateOutgoing) => { m.counterpart.accountId = m.id; },
    (m: typeof fixture.privateOutgoing) => { m.allowedActions.grant = 'private'; },
    (m: typeof fixture.privateOutgoing) => { m.content.sender = 'private'; },
    (m: typeof fixture.privateOutgoing) => { m.content = { type: 'PHOTO', attachments: [{ assetId: m.id, width: 2, height: 3, variant: 'ORIGINAL', signedUrl: 'private' }] }; },
    (m: typeof fixture.privateOutgoing) => { m.quote = { id: m.id, sourceActorId: m.id, content: { type: 'TEXT', text: 'quote' } }; },
    (m: typeof fixture.privateOutgoing) => { m.id = m.id.toUpperCase().replace('000000000001', 'AAAAAAAAAAAA'); },
    (m: typeof fixture.privateOutgoing) => { m.createdAt = '2026-09-20T00:00:00Z'; },
    (m: typeof fixture.privateOutgoing) => { delete m.counterpart; },
    (m: typeof fixture.privateOutgoing) => { m.allowedActions.reply = 1; },
  ]) { const value = structuredClone(fixture.privateOutgoing); mutate(value); assert.throws(() => message(value)); }
  assert.throws(() => event({ ...fixture.tombstone, counterpart: null }));
});

void test('schema2 envelopes enforce exact manifest placement and all reset invariants', () => {
  assert.doesNotThrow(() => envelope(snapshot, 'snapshot'));
  const room = { roomId: fixture.privateOutgoing.id, actorId: fixture.privateOutgoing.author.actorId, name: '테스트', mode: 'FAN', role: 'FAN', ...scopes };
  const manifest = { ...base, rooms: [room], generation: 'one-generation', complete: true, nextCursor: null };
  assert.doesNotThrow(() => envelope(manifest, 'manifest'));
  assert.throws(() => envelope({ ...manifest, ...scopes }, 'manifest'));
  assert.throws(() => envelope({ ...snapshot, schemaVersion: 1 }, 'snapshot'));
  assert.throws(() => envelope({ ...manifest, rooms: [{ ...room, authorizationRevision: undefined }] }, 'manifest'));
  const reset = { schemaVersion: 2, resetRequired: true, membershipScope: null, authorizationRevision: null, events: [], nextCursor: null, hasMore: false };
  assert.doesNotThrow(() => envelope(reset, 'events'));
  for (const patch of [{ membershipScope: scopes.membershipScope }, { events: [fixture.tombstone] }, { nextCursor: 'stale' }, { hasMore: true }]) assert.throws(() => envelope({ ...reset, ...patch }, 'events'));
  assert.throws(() => envelope({ ...snapshot, resetRequired: true }, 'snapshot'));
  assert.doesNotThrow(() => envelope({ schemaVersion: 2, resetRequired: true, rooms: [], generation: null, complete: false, nextCursor: null }, 'manifest'));
});

void test('uint64 and scope tokens are canonical, and display order differs from input cursor order', () => {
  for (const invalid of ['01', '-1', '18446744073709551616', '1.0', 1]) assert.throws(() => version(invalid));
  assert.equal(version('18446744073709551615'), '18446744073709551615');
  for (const invalid of ['A'.repeat(42), 'A'.repeat(42) + 'B', 'A'.repeat(43) + '=', ' ' + 'A'.repeat(42)]) assert.throws(() => token(invalid));
  assert.equal(token('A'.repeat(43)), 'A'.repeat(43));
  const first = message(fixture.privateOutgoing); const second = { ...first, id: '00000000-0000-4000-8000-000000000000' };
  assert.deepEqual(mergeMessages([], [first, second]).map(m => m.id), [second.id, first.id]);
  assert.equal(envelope(snapshot, 'snapshot').historyCursor, 'distinct-history');
  assert.throws(() => mergeMessages([first], [{ ...first, version: '0', createdAt: '2026-09-21T00:00:00.000Z' }]));
});

void test('GET deleted receipt has no message fields; SEND deleted wire contract remains separately strict', () => {
  const id = fixture.privateOutgoing.id;
  assert.deepEqual(receipt({ clientMessageId: id, status: 'deleted' }, id, 'lookup'), { clientMessageId: id, status: 'deleted' });
  for (const extra of [{ messageId: id }, { version: '2' }, { body: 'private' }]) assert.throws(() => receipt({ clientMessageId: id, status: 'deleted', ...extra }, id, 'lookup'));
  assert.deepEqual(receipt({ clientMessageId: id, status: 'deleted', messageId: id }, id, 'send'), { clientMessageId: id, status: 'deleted' });
  const commands = new SendCommands();
  commands.settle({ clientMessageId: id, status: 'deleted' });
  commands.settle({ clientMessageId: id, status: 'committed', messageId: id, version: '99' });
  assert.deepEqual(commands.get(id), { clientMessageId: id, status: 'deleted' });
});
