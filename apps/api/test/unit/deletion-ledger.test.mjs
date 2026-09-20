import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { setImmediate } from 'node:timers';
import { DeletionLedger, accountDeletionId, messageDeletionId, checkedDeletionIntent, encodeDeletionIntent, decodeDeletionIntent, deletionIntentKey } from '../../dist/modules/deletion/deletion-ledger.js';
import { R2DeletionLedgerStore } from '../../dist/modules/deletion/adapters/r2-deletion-ledger.js';

const intent = () => ({ schemaVersion: 1, environment: 'qa', requestId: randomUUID(), actorUserId: randomUUID(),
  scope: 'MESSAGE', targetId: randomUUID(), roomId: randomUUID(), requestedAt: '2026-09-20T00:00:00.000Z' });
const config = () => ({ accountId: randomBytes(16).toString('hex'), bucket: 'fixture-ledger', mediaBucket: 'fixture-media',
  accessKeyId: randomBytes(16).toString('hex'), secretAccessKey: randomBytes(32).toString('hex'), environment: 'qa' });
const signal = () => AbortSignal.timeout(5000);

// Synthetic isolated store; never registered by the product module.
class Store {
  rows = new Map(); writes = 0; loseAck = false;
  async read(key) { return this.rows.get(key) ?? null; }
  async putIfAbsent(key, bytes) {
    this.writes++;
    if (this.rows.has(key)) throw new Error('already_exists');
    this.rows.set(key, Buffer.from(bytes));
    if (this.loseAck) throw new Error('private_transport_detail');
  }
  close() {}
}

test('deletion intent is minimal canonical UUID metadata, with strict environment/scope/date and no content fields', () => {
  const value = intent(); const encoded = encodeDeletionIntent(value);
  assert.deepEqual(decodeDeletionIntent(encoded, 'qa'), value);
  assert.ok(Object.isFrozen(checkedDeletionIntent(value, 'qa')));
  assert.ok(encoded.length < 1024);
  for (const change of [{ text: 'private' }, { token: 'untrusted' }, { schemaVersion: 2 }, { requestId: '../other' }, { environment: 'production' },
    { requestedAt: '2026-02-30T00:00:00.000Z' }, { requestedAt: '2026-09-20' }, { requestedAt: '2026-09-20T00:00:00.000+00:00' },
    { scope: 'ALL' }, { scope: ['MESSAGE'] }, { scope: { toString: () => 'MESSAGE' } }, { roomId: null }, { scope: 'ACCOUNT', roomId: null }]) {
    assert.throws(() => checkedDeletionIntent({ ...value, ...change }, 'qa'), { code: 'INVALID_LEDGER_INTENT' });
  }
  const account = { ...value, scope: 'ACCOUNT', roomId: null, targetId: value.actorUserId };
  assert.deepEqual(decodeDeletionIntent(encodeDeletionIntent(account), 'qa'), account);
  for (const data of [Buffer.alloc(1025), Buffer.from([0xff]), Buffer.from(encoded.toString() + ' '),
    Buffer.from(encoded.toString().replace('{', '{"schemaVersion":1,'))]) {
    assert.throws(() => decodeDeletionIntent(data, 'qa'), { code: 'INVALID_LEDGER_INTENT' });
  }
});

test('ledger read-back establishes durability, retries preserve original UTC and lost PUT ACK does not duplicate intent', async () => {
  const store = new Store(); store.loseAck = true; const ledger = new DeletionLedger(store, 'qa'); const value = intent();
  const first = await ledger.ensureIntent(value);
  const second = await ledger.ensureIntent({ ...value, requestedAt: '2026-09-21T00:00:00.000Z' });
  assert.deepEqual(first, second); assert.equal(store.writes, 1); assert.match(first.sha256, /^[a-f0-9]{64}$/);
  assert.ok(Object.isFrozen(first)); assert.ok(Object.isFrozen(first.intent));
  for (const change of [{ actorUserId: randomUUID() }, { targetId: randomUUID() }, { roomId: randomUUID() }]) {
    await assert.rejects(ledger.ensureIntent({ ...value, ...change }), { code: 'LEDGER_CONFLICT' });
  }
  assert.equal(store.writes, 1);
});

test('concurrent same-request intents converge to one immutable record and first durable time', async () => {
  const store = new Store(); const ledger = new DeletionLedger(store, 'qa'); const value = intent();
  const results = await Promise.all(Array.from({ length: 10 }, (_, index) => ledger.ensureIntent({ ...value, requestedAt: new Date(Date.parse(value.requestedAt) + index).toISOString() })));
  assert.equal(store.rows.size, 1);
  for (const result of results) assert.deepEqual(result, results[0]);
});

test('missing, corrupted or unavailable read-back never acknowledges durability; aborted requests perform no I/O', async () => {
  const value = intent();
  for (const read of [async () => null, async () => { throw new Error('private_transport_detail'); }, async () => Buffer.from('corrupt')]) {
    const ledger = new DeletionLedger({ read, putIfAbsent: async () => {}, close() {} }, 'qa');
    await assert.rejects(ledger.ensureIntent(value), error => ['LEDGER_UNAVAILABLE', 'INVALID_LEDGER_INTENT'].includes(error.code) && !error.message.includes('private_transport_detail'));
  }
  const store = new Store(); const controller = new globalThis.AbortController(); controller.abort('private_abort_reason');
  await assert.rejects(new DeletionLedger(store, 'qa').ensureIntent(value, controller.signal), { code: 'LEDGER_UNAVAILABLE' });
  assert.equal(store.writes, 0); assert.equal(store.rows.size, 0);
});

test('R2 ledger uses a separate bucket, exact environment/key, immutable JSON PUT and no delete/signed URL capability', async t => {
  const value = intent(); const settings = config();
  assert.throws(() => new R2DeletionLedgerStore({ ...settings, bucket: settings.mediaBucket }), { code: 'INVALID_LEDGER_INTENT' });
  const store = new R2DeletionLedgerStore(settings); t.after(() => store.close());
  const commands = []; t.mock.method(store.client, 'send', async (command, options) => { commands.push(command); assert.ok(options.abortSignal); return {}; });
  settings.bucket = 'changed-by-caller';
  const key = deletionIntentKey('qa', value.requestId); const bytes = encodeDeletionIntent(value);
  await store.putIfAbsent(key, bytes, signal());
  assert.equal(commands[0].input.Bucket, 'fixture-ledger'); assert.equal(commands[0].input.IfNoneMatch, '*');
  assert.equal(commands[0].input.ContentLength, bytes.length); assert.equal(commands[0].input.ContentType, 'application/json');
  assert.equal(commands[0].input.CacheControl, 'private, no-store, max-age=0');
  assert.equal('remove' in store, false); assert.equal('signedGet' in store, false);
  for (const bad of [key.replace('qa/', 'production/'), key + '?secret=x', key.replace('/intent.json', '/../../other'), deletionIntentKey('qa', randomUUID())]) {
    await assert.rejects(store.putIfAbsent(bad, bytes, signal()), { code: 'INVALID_LEDGER_INTENT' });
  }
  assert.equal(commands.length, 1);
});

test('R2 ledger GET treats only NoSuchKey/404 as absent; bounds streamed bytes and aborts a stalled response', async t => {
  const store = new R2DeletionLedgerStore(config()); t.after(() => store.close()); const value = intent();
  const key = deletionIntentKey('qa', value.requestId); const bytes = encodeDeletionIntent(value); let response;
  t.mock.method(store.client, 'send', async () => { if (response instanceof Error) throw response; return response; });
  response = { Body: Readable.from([bytes]), ContentLength: bytes.length, ContentType: 'application/json' };
  assert.deepEqual(Buffer.from(await store.read(key, signal())), bytes);
  response = Object.assign(new Error('private'), { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } });
  assert.equal(await store.read(key, signal()), null);
  for (const error of [Object.assign(new Error('private'), { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } }),
    Object.assign(new Error('private'), { name: 'NoSuchKey', $metadata: { httpStatusCode: 403 } })]) {
    response = error; await assert.rejects(store.read(key, signal()), { code: 'LEDGER_UNAVAILABLE' });
  }
  for (const bad of [{ ContentLength: 1025 }, { ContentLength: bytes.length - 1 }, { ContentType: 'text/html' }, { Body: Readable.from([Buffer.alloc(1025)]) }]) {
    response = { Body: Readable.from([bytes]), ContentLength: bytes.length, ContentType: 'application/json', ...bad };
    await assert.rejects(store.read(key, signal()), { code: 'LEDGER_UNAVAILABLE' }); assert.equal(response.Body.destroyed, true);
  }
  const body = new Readable({ read() {} }); response = { Body: body, ContentLength: 10, ContentType: 'application/json' };
  const controller = new globalThis.AbortController(); const pending = store.read(key, controller.signal);
  setImmediate(() => controller.abort('private_abort_reason'));
  await assert.rejects(pending, { code: 'LEDGER_UNAVAILABLE' }); assert.equal(body.destroyed, true);
});

test('different targets cannot race to repurpose one deletion request UUID', async () => {
  const store = new Store(); const ledger = new DeletionLedger(store, 'qa'); const value = intent();
  const results = await Promise.allSettled([ledger.ensureIntent(value), ledger.ensureIntent({ ...value, targetId: randomUUID() })]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'LEDGER_CONFLICT');
  assert.equal(store.rows.size, 1);
});

test('abort after durable write reports unavailable, while retry recovers the unchanged intent', async () => {
  const store = new Store(); const ledger = new DeletionLedger(store, 'qa'); const value = intent();
  const controller = new globalThis.AbortController(); const put = store.putIfAbsent.bind(store);
  store.putIfAbsent = async (...args) => { await put(...args); controller.abort(); };
  await assert.rejects(ledger.ensureIntent(value, controller.signal), { code: 'LEDGER_UNAVAILABLE' });
  assert.deepEqual((await ledger.ensureIntent({ ...value, requestedAt: '2026-09-21T00:00:00.000Z' })).intent, value);
  assert.equal(store.writes, 1);
});

test('Nest ledger module owns real adapter shutdown without creating any external request', async t => {
  await import('reflect-metadata');
  const { NestFactory } = await import('@nestjs/core');
  const { DeletionLedgerModule } = await import('../../dist/modules/deletion/deletion-ledger.module.js');
  const app = await NestFactory.createApplicationContext(DeletionLedgerModule.register(config()), { logger: false });
  const store = app.get(R2DeletionLedgerStore); let closed = 0;
  t.mock.method(store.client, 'destroy', () => { closed++; });
  assert.ok(app.get(DeletionLedger) instanceof DeletionLedger);
  await app.close(); assert.equal(closed, 1);
});

test('bounded R2 inventory fixes environment prefix and validates every key, size and continuation', async () => {
  const cfg = config(); const store = new R2DeletionLedgerStore(cfg); const value = intent(); const key = deletionIntentKey('qa', value.requestId);
  let response = { IsTruncated: true, Contents: [{ Key: key, Size: 400 }], NextContinuationToken: 'next' };
  const commands = [];
  store.client.send = async command => { commands.push(command); return response; };
  try {
    assert.deepEqual(await store.list(null, 5, signal()), { keys: [key], cursor: 'next' });
    assert.equal(commands[0].constructor.name, 'ListObjectsV2Command');
    assert.deepEqual(commands[0].input, { Bucket: cfg.bucket, Prefix: 'qa/', MaxKeys: 5 });
    await store.list('prior', 5, signal()); assert.equal(commands[1].input.ContinuationToken, 'prior');
    for (const invalid of [0, 101, 1.5]) await assert.rejects(store.list(null, invalid, signal()));
    for (const page of [
      { IsTruncated: true }, { IsTruncated: true, NextContinuationToken: 'prior' },
      { IsTruncated: false, NextContinuationToken: 'hidden' },
      { IsTruncated: false, Contents: [{ Key: 'production/' + value.requestId + '/intent.json', Size: 400 }] },
      { IsTruncated: false, Contents: [{ Key: key, Size: 1025 }] },
      { IsTruncated: false, Contents: [{ Key: key, Size: 400 }, { Key: key, Size: 400 }] },
    ]) { response = page; await assert.rejects(store.list('prior', 5, signal()), { code: 'INVALID_LEDGER_INTENT' }); }
  } finally { store.close(); }
});

test('inventory read-by-key refuses body/key mismatch and does not turn missing objects into success', async () => {
  const value = intent(), store = new Store(), ledger = new DeletionLedger(store, 'qa');
  const key = deletionIntentKey('qa', value.requestId);
  await assert.rejects(ledger.readByKey(key), { code: 'LEDGER_UNAVAILABLE' });
  store.rows.set(key, encodeDeletionIntent({ ...value, requestId: randomUUID() }));
  await assert.rejects(ledger.readByKey(key), { code: 'LEDGER_CONFLICT' });
  store.rows.set(key, encodeDeletionIntent(value));
  assert.equal((await ledger.readByKey(key)).intent.requestId, value.requestId);
});

test('message deletion IDs are standard UUIDv5 scoped to environment and immutable target, independent of time/device', () => {
  const actor = '11111111-1111-4111-8111-111111111111', room = '22222222-2222-4222-8222-222222222222', target = '33333333-3333-4333-8333-333333333333';
  // Independently computed with Python uuid.uuid5 and the documented fixed namespace.
  assert.equal(messageDeletionId('qa', actor, room, target), 'b74685d3-0c46-558e-8b2d-12512b102949');
  assert.notEqual(messageDeletionId('qa', actor, room, target), messageDeletionId('production', actor, room, target));
});

test('already-aborted inventory/read never calls storage, and replay never starts apply after deadline', async t => {
  const { DeletionReconciler } = await import('../../dist/modules/deletion/deletion-reconciler.js');
  let calls = 0, applied = 0;
  const value = intent(), key = deletionIntentKey('qa', value.requestId);
  const store = { close() {}, putIfAbsent: async () => {},
    list: async () => { calls++; return { keys: [key], cursor: null }; },
    read: async () => { calls++; await new Promise(resolve => setTimeout(resolve, 20)); return encodeDeletionIntent(value); } };
  const ledger = new DeletionLedger(store, 'qa'), abort = new globalThis.AbortController(); abort.abort();
  await assert.rejects(ledger.inventory(null, 50, abort.signal));
  await assert.rejects(ledger.readByKey(key, abort.signal));
  assert.equal(calls, 0);
  const original = AbortSignal.timeout;
  t.mock.method(AbortSignal, 'timeout', ms => original(ms === 30000 ? 5 : ms));
  await assert.rejects(new DeletionReconciler(ledger, { apply: async () => { applied++; } }).tick());
  assert.equal(applied, 0);
});

test('ACCOUNT replay routes through admission and malformed records stop without skipping the page', async () => {
  const { DeletionReconciler } = await import('../../dist/modules/deletion/deletion-reconciler.js');
  const value = intent(); const account = { ...value, scope: 'ACCOUNT', targetId: value.actorUserId, roomId: null };
  const key = deletionIntentKey('qa', value.requestId); let applied = 0; const cursors = [];
  const store = { close() {}, putIfAbsent: async () => {}, list: async cursor => { cursors.push(cursor); return { keys: [key], cursor: 'next' }; },
    read: async () => encodeDeletionIntent(account) };
  const replay = new DeletionReconciler(new DeletionLedger(store, 'qa'), { apply: async () => { applied++; }, scrubBindings: async () => {} });
  await replay.tick();
  store.read = async () => Buffer.from('private malformed data');
  await assert.rejects(replay.tick(), { message: 'INVALID_LEDGER_INTENT' });
  assert.equal(applied, 1); assert.deepEqual(cursors, [null, 'next']);
});


test('ACCOUNT v2 is canonical opaque evidence, preserves immutable retry evidence and stable UUID', async () => {
  const actor = randomUUID(); const requestId = accountDeletionId('qa', actor);
  assert.equal(accountDeletionId('qa', actor), requestId);
  assert.notEqual(accountDeletionId('production', actor), requestId);
  assert.match(requestId, /^[a-f0-9-]{14}5/);
  const value = { schemaVersion: 2, environment: 'qa', requestId, actorUserId: actor, scope: 'ACCOUNT', targetId: actor,
    roomId: null, requestedAt: '2026-09-20T00:00:00.000Z', subjectGuard: { version: 1, identityId: randomUUID(),
      keyFingerprint: randomBytes(32).toString('hex'), subjectHmac: randomBytes(32).toString('hex') } };
  assert.deepEqual(decodeDeletionIntent(encodeDeletionIntent(value), 'qa'), value);
  assert.ok(encodeDeletionIntent(value).length <= 1024);
  for (const subjectGuard of [{ ...value.subjectGuard, subject: 'raw-provider-value' }, { ...value.subjectGuard, version: 2 },
    { ...value.subjectGuard, subjectHmac: 'short' }, { ...value.subjectGuard, identityId: 'not-a-uuid' }]) {
    assert.throws(() => checkedDeletionIntent({ ...value, subjectGuard }, 'qa'), { code: 'INVALID_LEDGER_INTENT' });
  }
  const ledger = new DeletionLedger(new Store(), 'qa'); const first = await ledger.ensureIntent(value);
  assert.deepEqual(await ledger.ensureIntent({ ...value, subjectGuard: null, requestedAt: '2026-09-21T00:00:00.000Z' }), first);
});

test('replay retains completed page progress across aborts and reaches later pages; restart safely repeats prefix', async () => {
  const { DeletionReconciler } = await import('../../dist/modules/deletion/deletion-reconciler.js');
  const records = Array.from({ length: 4 }, () => intent());
  const keys = records.map(value => deletionIntentKey('qa', value.requestId));
  const cursors = [], applied = []; const abort = new globalThis.AbortController();
  const store = { close() {}, putIfAbsent: async () => {},
    list: async cursor => { cursors.push(cursor); return cursor === null ? { keys: keys.slice(0, 3), cursor: 'second-page' } : { keys: [keys[3]], cursor: null }; },
    read: async key => encodeDeletionIntent(records[keys.indexOf(key)]) };
  const apply = { apply: async receipt => { applied.push(receipt.intent.requestId); if (applied.length === 1) abort.abort(); } };
  const ledger = new DeletionLedger(store, 'qa'), replay = new DeletionReconciler(ledger, apply);
  await assert.rejects(replay.tick(abort.signal));
  assert.deepEqual(applied, [records[0].requestId]);
  assert.deepEqual(await replay.tick(), { scanned: 2, passFinished: false });
  assert.deepEqual(await replay.tick(), { scanned: 1, passFinished: true });
  assert.deepEqual(applied, records.map(value => value.requestId));
  assert.deepEqual(cursors, [null, 'second-page']);
  const restarted = new DeletionReconciler(ledger, apply);
  assert.deepEqual(await restarted.tick(), { scanned: 3, passFinished: false });
  assert.deepEqual(applied.slice(4), records.slice(0, 3).map(value => value.requestId));
  assert.deepEqual(cursors, [null, 'second-page', null]);
});

test('failed ACCOUNT scrub retains the same receipt before advancing the pending page', async () => {
  const { DeletionReconciler } = await import('../../dist/modules/deletion/deletion-reconciler.js');
  const value = intent(); const account = { ...value, scope: 'ACCOUNT', targetId: value.actorUserId, roomId: null };
  const key = deletionIntentKey('qa', value.requestId); let lists = 0, applied = 0, scrubs = 0;
  const store = { close() {}, putIfAbsent: async () => {}, list: async () => { lists++; return { keys: [key], cursor: null }; }, read: async () => encodeDeletionIntent(account) };
  const replay = new DeletionReconciler(new DeletionLedger(store, 'qa'), {
    apply: async () => { applied++; }, scrubBindings: async () => { if (++scrubs === 1) throw new Error('synthetic_scrub_failure'); },
  });
  await assert.rejects(replay.tick(), /synthetic_scrub_failure/);
  assert.deepEqual(await replay.tick(), { scanned: 1, passFinished: true });
  assert.equal(lists, 1); assert.equal(applied, 2); assert.equal(scrubs, 2);
});
