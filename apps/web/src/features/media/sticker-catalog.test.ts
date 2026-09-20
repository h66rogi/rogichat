import assert from 'node:assert/strict';
import test from 'node:test';
import { MediaClient } from './client';
import { StickerCatalog } from './sticker-catalog';

const roomId = '11111111-1111-4111-8111-111111111111';
const firstId = '22222222-2222-4222-8222-222222222222';
const secondId = '33333333-3333-4333-8333-333333333333';
const sticker = (id: string) => ({ id, assetId: '44444444-4444-4444-8444-444444444444', label: '테스트 스티커' });
void test('catalog replaces bounded pages, requires real selection and rejects other-room use', async () => {
  const abort = new AbortController(); let empty = false;
  const client = new MediaClient({ apiOrigin: 'https://api.qa.rogi.chat', storageOrigins: [], csrf: () => 'A'.repeat(43), lifetime: { signal: abort.signal, isCurrent: () => !abort.signal.aborted },
    transport: async input => Response.json({ items: empty ? [] : [sticker(String(input).includes('after=') ? secondId : firstId)], nextCursor: !empty && !String(input).includes('after=') ? firstId : null }),
  });
  const catalog = new StickerCatalog(client, roomId); await catalog.load();
  assert.throws(() => catalog.readySticker(roomId)); assert.throws(() => catalog.select(secondId));
  catalog.select(firstId); assert.equal(catalog.readySticker(roomId), firstId);
  assert.throws(() => catalog.readySticker(secondId));
  await catalog.load(firstId); assert.equal(catalog.getSnapshot().items.length, 1); assert.equal(catalog.getSnapshot().selected, null);
  catalog.select(secondId); empty = true; await catalog.load(); assert.deepEqual(catalog.getSnapshot().items, []); assert.throws(() => catalog.select(firstId)); abort.abort(); assert.deepEqual(catalog.getSnapshot().items, []); assert.throws(() => catalog.readySticker(roomId));
  catalog.dispose();
});
void test('late catalog response cannot restore a disposed selection or invent an empty-catalog option', async () => {
  const abort = new AbortController(); let release!: (value: Response) => void;
  const client = new MediaClient({ apiOrigin: 'https://api.qa.rogi.chat', storageOrigins: [], csrf: () => 'A'.repeat(43), lifetime: { signal: abort.signal, isCurrent: () => true }, transport: () => new Promise(resolve => { release = resolve; }) });
  const catalog = new StickerCatalog(client, roomId); const work = catalog.load(); catalog.dispose();
  release(Response.json({ items: [sticker(firstId)], nextCursor: null })); await work;
  assert.deepEqual(catalog.getSnapshot().items, []); assert.throws(() => catalog.select(firstId));
});
