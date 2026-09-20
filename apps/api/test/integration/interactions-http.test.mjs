import { createUser, createRoom, joinRoom, Jobs, publishText } from '../support/domain-fixture.mjs';
import { SessionRepository } from '../../dist/modules/auth/session.repository.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { readConfig } from '../../dist/infrastructure/config/config.js';
import { MysqlDatabase } from '../../dist/infrastructure/database/database.js';
import { SessionService } from '../../dist/modules/auth/session.service.js';
import { createApi } from '../../dist/application.js';
import { SafeLogger } from '../../dist/infrastructure/observability/logging.js';
import { reactionRefreshTargets } from '../../../../packages/contracts/interactions-client.mjs';

async function fixture(t) {
  assert.equal(process.env.ROGICHAT_TEST_MYSQL, 'disposable');
  const db = new MysqlDatabase(readConfig('api')); let app;
  t.after(async () => { try { await app?.close(); } finally { await db.close(); } });
  const config = { audience: `http-${randomBytes(8).toString('hex')}`, origin: 'http://localhost:3001', secure: false, key: randomBytes(32) };
  const sessions = new SessionService(new SessionRepository(), config.audience, config.key);
  const user = name => db.transactions.write(async tx => {
    const id = await createUser(tx, name);
    await tx.execute('INSERT INTO platform_soop (id,user_id,provider_subject,verified_at) VALUES (?,?,?,UTC_TIMESTAMP(3))', [randomUUID(), id, Buffer.from(`fixture-http-${randomUUID()}`)]);
    return { id, ...await sessions.issue(tx, id) };
  });
  const owner = await user('HTTP 방장'), a = await user('HTTP 팬 하나'), b = await user('HTTP 팬 둘');
  const room = await db.transactions.write(async tx => {
    const id = await createRoom(tx, 'HTTP 상호작용방', 'FAN');
    for (const person of [owner, a, b]) person.actor = await joinRoom(tx, id, person.id);
    await tx.execute("UPDATE room_members SET role='STREAMER' WHERE id=?", [owner.actor]);
    await tx.execute('UPDATE rooms SET owner_member_id=? WHERE id=?', [owner.actor, id]);
    return id;
  });
  app = await createApi(db, new SafeLogger('api', () => {}), undefined, { config, sessions });
  await app.listen(0, '127.0.0.1'); const base = await app.getUrl();
  const call = async (person, method, path, body, headers = {}) => {
    const response = await fetch(`${base}/v1${path}`, { method, headers: { Origin: config.origin, Cookie: `rogi_session=${person.token}`,
      'X-CSRF-Token': person.csrf, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const responseBody = response.headers.get('content-type')?.includes('application/json') ? await response.json() : undefined;
    return { status: response.status, body: responseBody, headers: response.headers };
  };
  const messagePath = id => `/rooms/${room}/messages/${id}`;
  const read = (person, id) => call(person, 'GET', `${messagePath(id)}/reactions`);
  const react = (person, id, emoji) => call(person, 'PUT', `${messagePath(id)}/reactions/me`, { emoji });
  const send = async (person = owner, target) => {
    const response = await call(person, 'POST', `/rooms/${room}/messages`, { clientMessageId: randomUUID(), intent: target ? 'PRIVATE' : 'SHARED',
      ...(target ? { recipientActorId: target.actor } : {}), content: { type: 'TEXT', text: 'HTTP 상호작용 합성 본문' } });
    assert.equal(response.status, 200); return response.body.messageId;
  };
  const device = { deviceId: randomUUID(), cacheId: randomUUID() };
  const sync = (person, endpoint, fields = {}) => call(person, 'GET', `/rooms/${room}/${endpoint}?${new globalThis.URLSearchParams({ ...device, ...fields })}`);
  return { db, config, owner, a, b, room, call, read, react, send, sync, messagePath };
}
function minimal(summary, people) {
  assert.deepEqual(Object.keys(summary).sort(), ['counts', 'mine']);
  for (const count of summary.counts) assert.deepEqual(Object.keys(count).sort(), ['count', 'emoji']);
  for (const person of people) for (const identifier of [person.id, person.actor]) assert.ok(!JSON.stringify(summary).includes(identifier));
}

test('reaction HTTP PUT replacement/idempotence and DELETE return only aggregate plus own reaction; browser preflight allows PUT', { timeout: 20000 }, async t => {
  const f = await fixture(t); const id = await f.send();
  const preflight = await f.call(f.a, 'OPTIONS', `${f.messagePath(id)}/reactions/me`, undefined, {
    'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'content-type,x-csrf-token',
  });
  assert.equal(preflight.status, 204); assert.ok(preflight.headers.get('access-control-allow-methods').split(',').map(x => x.trim()).includes('PUT'));
  assert.equal(preflight.headers.get('access-control-allow-origin'), f.config.origin);
  assert.deepEqual((await f.read(f.a, id)).body, { counts: [], mine: null });
  for (let repeat = 0; repeat < 2; repeat++) {
    const first = await f.react(f.a, id, '👍'); assert.equal(first.status, 200);
    assert.deepEqual(first.body, { counts: [{ emoji: '👍', count: 1 }], mine: '👍' });
  }
  assert.equal((await f.react(f.b, id, '👍')).status, 200);
  const replaced = await f.react(f.a, id, '❤️'); assert.equal(replaced.status, 200);
  assert.deepEqual(Object.fromEntries(replaced.body.counts.map(value => [value.emoji, value.count])), { '👍': 1, '❤️': 1 });
  assert.equal(replaced.body.mine, '❤️'); minimal(replaced.body, [f.owner, f.a, f.b]);
  for (let repeat = 0; repeat < 2; repeat++) {
    const removed = await f.call(f.a, 'DELETE', `${f.messagePath(id)}/reactions/me`); assert.equal(removed.status, 200);
    assert.deepEqual(removed.body, { counts: [{ emoji: '👍', count: 1 }], mine: null });
  }
  const [stored] = await f.db.transactions.read(tx => tx.rows('SELECT version,content_revision FROM messages WHERE id=?', [id]));
  assert.equal(String(stored.version), '5'); assert.equal(String(stored.content_revision), '1');
});

test('reaction HTTP rejects CSRF/unknown fields/malformed emoji and hides private existence on all verbs', { timeout: 20000 }, async t => {
  const f = await fixture(t); const shared = await f.send(); const secret = await f.send(f.a, f.owner);
  const path = `${f.messagePath(shared)}/reactions/me`;
  for (const headers of [{ 'X-CSRF-Token': '' }, { 'X-CSRF-Token': randomBytes(32).toString('base64url') }, { Origin: 'https://attacker.example' }, { Cookie: '' }]) {
    const result = await f.call(f.a, 'PUT', path, { emoji: '👍' }, headers); assert.ok([400, 401, 403].includes(result.status));
  }
  for (const body of [{ emoji: '👍', memberId: f.b.actor }, { emoji: ['👍'] }, { emoji: '👍👍' }, { emoji: 'plain text' }, {}]) {
    assert.equal((await f.call(f.a, 'PUT', path, body)).status, 400);
  }
  assert.equal((await f.call(f.a, 'DELETE', path, { actorId: f.b.actor })).status, 400);
  for (const [method, body] of [['GET', undefined], ['PUT', { emoji: '👍' }], ['DELETE', undefined]]) {
    const privatePath = `${f.messagePath(secret)}/reactions${method === 'GET' ? '' : '/me'}`;
    const hidden = await f.call(f.b, method, privatePath, body); assert.equal(hidden.status, 404);
    assert.deepEqual(hidden.body, { error: { code: 'NOT_FOUND' } });
    const missingPath = `/rooms/${randomUUID()}/messages/${secret}/reactions${method === 'GET' ? '' : '/me'}`;
    assert.equal((await f.call(f.b, method, missingPath, body)).status, 404);
  }
  assert.deepEqual((await f.read(f.owner, secret)).body, { counts: [], mine: null });
  assert.deepEqual((await f.read(f.owner, shared)).body, { counts: [], mine: null });
});

test('reaction change produces resource-version sync upsert and viewer-specific GET rendering without reactor identity', { timeout: 20000 }, async t => {
  const f = await fixture(t); const id = await f.send();
  const before = await f.sync(f.b, 'snapshot'); assert.equal(before.status, 200);
  assert.equal(before.body.messages.find(message => message.id === id).version, '1');
  assert.equal((await f.react(f.a, id, '😂')).status, 200);
  const delta = await f.sync(f.b, 'events', { cursor: before.body.nextCursor }); assert.equal(delta.status, 200);
  assert.equal(delta.body.resetRequired, false);
  const targets = reactionRefreshTargets(delta.body.events); assert.deepEqual(targets, [id]);
  assert.equal(delta.body.events[0].type, 'message.upsert'); assert.equal(delta.body.events[0].message.version, '2');
  const rendered = await f.read(f.b, targets[0]); assert.equal(rendered.status, 200);
  assert.deepEqual(rendered.body, { counts: [{ emoji: '😂', count: 1 }], mine: null });
  assert.deepEqual((await f.read(f.a, id)).body, { counts: [{ emoji: '😂', count: 1 }], mine: '😂' });
  minimal(rendered.body, [f.owner, f.a, f.b]);
  for (const hidden of [f.a.id, f.a.actor]) assert.ok(!JSON.stringify(delta.body).includes(hidden));
  const changedAgain = await f.call(f.a, 'DELETE', `${f.messagePath(id)}/reactions/me`); assert.equal(changedAgain.status, 200);
  const next = await f.sync(f.b, 'events', { cursor: delta.body.nextCursor });
  assert.deepEqual(reactionRefreshTargets(next.body.events), [id]); assert.equal(next.body.events[0].message.version, '3');
  assert.deepEqual((await f.read(f.b, id)).body, { counts: [], mine: null });
});

test('private source, anonymous publication and ordinary shared message have independent HTTP reaction aggregates', { timeout: 20000 }, async t => {
  const f = await fixture(t); const source = await f.send(f.a, f.owner); const shared = await f.send();
  assert.equal((await f.react(f.a, source, '👍')).status, 200);
  const publication = await f.call(f.owner, 'POST', `${f.messagePath(source)}/publications`, {}); assert.equal(publication.status, 202);
  const queue = new Jobs(f.db.transactions, 'worker'); const leases = await queue.claim({ purposes: ['PUBLICATION'] });
  const claimed = leases.find(lease => lease.resourceId === publication.body.publicationId); assert.ok(claimed);
  assert.equal(await publishText(f.db.transactions, claimed), 'completed');
  const status = await f.call(f.owner, 'GET', `/rooms/${f.room}/publications/${publication.body.publicationId}`);
  assert.equal(status.status, 200); const published = status.body.messageId;
  assert.deepEqual((await f.read(f.b, published)).body, { counts: [], mine: null });
  await f.react(f.b, published, '❤️'); await f.react(f.b, shared, '😂');
  assert.deepEqual((await f.read(f.owner, source)).body, { counts: [{ emoji: '👍', count: 1 }], mine: null });
  assert.deepEqual((await f.read(f.a, published)).body, { counts: [{ emoji: '❤️', count: 1 }], mine: null });
  assert.deepEqual((await f.read(f.a, shared)).body, { counts: [{ emoji: '😂', count: 1 }], mine: null });
  assert.equal((await f.read(f.b, source)).status, 404);
  assert.equal((await f.call(f.b, 'GET', `/rooms/${f.room}/publications/${publication.body.publicationId}`)).status, 404);
  const copy = await f.call(f.b, 'GET', f.messagePath(published)); assert.equal(copy.status, 200); assert.deepEqual(copy.body.author, { kind: 'anonymous' });
  for (const forbidden of [source, f.a.actor, f.a.id]) assert.ok(!JSON.stringify(copy.body).includes(forbidden));
  assert.equal((await f.call(f.a, 'POST', `${f.messagePath(source)}/delete`, {})).status, 200);
  assert.equal((await f.read(f.b, published)).status, 404);
  assert.equal((await f.react(f.b, published, '👍')).status, 404);
});

test('HTTP rate limit commits before mutation and keeps separate account budgets even for same-value retries', { timeout: 20000 }, async t => {
  const f = await fixture(t); const id = await f.send(); assert.equal((await f.react(f.a, id, '👍')).status, 200);
  const key = createHmac('sha256', f.config.key).update(`reaction:burst:${f.a.id}:${f.room}`).digest();
  // Keep this synthetic fixture's existing window open across slow CI requests; production limits are unchanged.
  await f.db.transactions.write(tx => tx.execute('UPDATE rate_buckets SET expires_at=TIMESTAMPADD(MINUTE,1,UTC_TIMESTAMP(3)) WHERE key_digest=?', [key]));
  for (let count = 1; count < 10; count++) assert.equal((await f.react(f.a, id, '👍')).status, 200);
  const blocked = await f.react(f.a, id, '😂'); assert.equal(blocked.status, 429); assert.deepEqual(blocked.body, { error: { code: 'RATE_LIMITED' } });
  assert.deepEqual((await f.read(f.a, id)).body, { counts: [{ emoji: '👍', count: 1 }], mine: '👍' });
  assert.equal((await f.react(f.b, id, '❤️')).status, 200);
  const [stored] = await f.db.transactions.read(tx => tx.rows('SELECT version FROM messages WHERE id=?', [id])); assert.equal(String(stored.version), '3');
});
