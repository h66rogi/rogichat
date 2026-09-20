import assert from 'node:assert/strict';
import test from 'node:test';
import { MediaBudget } from './byte-budget';
import { MediaClient } from './client';
import { MediaImageResource } from './image-resource';

const MiB = 1024 * 1024;
const assetId = '22222222-2222-4222-8222-222222222222';
void test('media reservations include in-flight bytes, reject overflow and release idempotently', () => {
  const budget = new MediaBudget();
  const video = budget.reserve(52 * MiB); const image = budget.reserve(10 * MiB);
  assert.equal(budget.reservedBytes, 62 * MiB);
  assert.throws(() => budget.reserve(10 * MiB));
  image(); image(); assert.equal(budget.reservedBytes, 52 * MiB);
  video(); assert.equal(budget.reservedBytes, 0);
  for (const size of [0, -1, Infinity, NaN, 0.5]) assert.throws(() => budget.reserve(size));
});
void test('retained blobs hold the byte budget until actual resource revocation', async () => {
  const parent = new AbortController(); const budget = new MediaBudget(10 * MiB);
  let calls = 0;
  const client = new MediaClient({ apiOrigin: 'https://api.qa.rogi.chat', storageOrigins: ['https://storage.example'], csrf: () => 'A'.repeat(43), budget,
    lifetime: { signal: parent.signal, isCurrent: () => !parent.signal.aborted }, transport: async input => {
      calls++;
      return String(input).startsWith('https://api.qa.rogi.chat') ? Response.json({ url: 'https://storage.example/image', expiresIn: 60 }) : new Response(new Blob(['image'], { type: 'image/png' }));
    },
  });
  const first = new MediaImageResource(client); const second = new MediaImageResource(client);
  await first.load(assetId, { variant: 'image' }); assert.equal(budget.reservedBytes, 5);
  await second.load(assetId, { variant: 'image' }); assert.equal(second.getSnapshot().phase, 'unavailable'); assert.equal(calls, 2);
  first.clear(); assert.equal(budget.reservedBytes, 0);
  await second.load(assetId, { variant: 'image' }); assert.equal(second.getSnapshot().phase, 'ready');
  parent.abort(); assert.equal(budget.reservedBytes, 0); assert.equal(second.getSnapshot().objectUrl, undefined);
  first.dispose(); second.dispose();
});
void test('cancelled non-cooperative image admission releases capacity before its late response', async () => {
  const budget = new MediaBudget(10 * MiB); const operation = new AbortController(); const parent = new AbortController();
  let release!: (value: Response) => void;
  const client = new MediaClient({ apiOrigin: 'https://api.qa.rogi.chat', storageOrigins: ['https://storage.example'], csrf: () => 'A'.repeat(43), budget,
    lifetime: { signal: parent.signal, isCurrent: () => true }, transport: () => new Promise(resolve => { release = resolve; }) });
  const work = client.image(assetId, { variant: 'image' }, operation.signal);
  assert.equal(budget.reservedBytes, 10 * MiB);
  operation.abort(); assert.equal(budget.reservedBytes, 0);
  release(Response.json({ url: 'https://storage.example/image', expiresIn: 60 }));
  await assert.rejects(work); assert.equal(budget.reservedBytes, 0);
});

void test('tiny retained image admits the maximum video/poster reservation in the shared budget', async () => {
  const budget = new MediaBudget(); const abort = new AbortController();
  const client = new MediaClient({ apiOrigin: 'https://api.qa.rogi.chat', storageOrigins: ['https://storage.example'], csrf: () => 'A'.repeat(43), budget,
    lifetime: { signal: abort.signal, isCurrent: () => true }, transport: async input => String(input).startsWith('https://api.qa.rogi.chat') ? Response.json({ url: 'https://storage.example/image', expiresIn: 60 }) : new Response(new Blob(['image'], { type: 'image/png' })) });
  const image = new MediaImageResource(client); await image.load(assetId, { variant: 'image' });
  const videoAndPoster = budget.reserve(60 * MiB + 128 * 1024);
  assert.equal(budget.reservedBytes, 60 * MiB + 128 * 1024 + 5);
  image.dispose(); videoAndPoster(); assert.equal(budget.reservedBytes, 0);
});
