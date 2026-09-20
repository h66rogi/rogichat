import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { setImmediate } from 'node:timers';
import { DeletionLedger, checkedDeletionIntent, encodeDeletionIntent, decodeDeletionIntent, deletionIntentKey } from '../../dist/modules/deletion/deletion-ledger.js';
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
