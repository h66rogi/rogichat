import assert from 'node:assert/strict';
import test from 'node:test';
import { ChatController } from './chat-controller';
import { message, projectMessages, type ChatRequest } from './contract';
import { MediaClient } from '../media/client';
import { MediaUpload } from '../media/upload';
import { StickerCatalog } from '../media/sticker-catalog';

const roomId = '11111111-1111-4111-8111-111111111111';
const assetId = '22222222-2222-4222-8222-222222222222';
const otherRoomId = '33333333-3333-4333-8333-333333333333';
const target = { scope: 'PRIVATE' as const, recipient: { actorId: 'streamer', displayName: '운영자', avatarUrl: null } };
function server(post: ChatRequest): ChatRequest {
  return async (path, options) => {
    const base = { schemaVersion: 1, resetRequired: false };
    if (path.startsWith('/v1/sync?')) return { ...base, generation: 'a', complete: true, nextCursor: null, rooms: [{ roomId, actorId: 'fan', name: '테스트 방', mode: 'FAN', role: 'FAN' }] };
    if (path.includes('/profile-sync?')) return { ...base, generation: 'p', complete: true, nextCursor: null, profiles: [{ actorId: 'fan', role: 'FAN', nickname: '팬' }] };
    if (path.includes('/private-recipients')) return { recipients: [{ actorId: 'streamer', nickname: '운영자' }], next: null };
    if (path.includes('/snapshot?')) return { ...base, messages: [], nextCursor: 'events', historyCursor: null };
    if (path.includes('/events?')) return { ...base, events: [], nextCursor: 'events-next', hasMore: false };
    return post(path, options);
  };
}
function uploadFor(controller: ChatController, current: () => string) {
  return new MediaUpload(new MediaClient({ apiOrigin: 'https://api.qa.rogi.chat', storageOrigins: [], csrf: () => 'A'.repeat(43), lifetime: controller.mediaLifetime(),
    transport: async (path, options) => Response.json({ assetId, status: String(path).endsWith('/content') ? 'processing' : options?.method === 'POST' ? 'reserved' : current() }, { status: String(path).endsWith('/content') ? 202 : options?.method === 'POST' ? 201 : 200 }),
  }), { attempts: 1, intervalMs: 0 });
}
void test('PHOTO waits for READY and ambiguous send reuses exact ID and payload', async () => {
  const writes: Record<string, unknown>[] = [];
  const controller = new ChatController(roomId, server(async (_path, options) => {
    const body = options!.body as Record<string, unknown>; writes.push(body);
    if (writes.length === 1) throw new TypeError('lost ACK');
    return { clientMessageId: body.clientMessageId, messageId: 'saved', status: 'committed', version: '1' };
  }));
  await controller.refresh();
  let status = 'processing'; const upload = uploadFor(controller, () => status);
  await upload.start('PHOTO', new Blob(['test'], { type: 'image/png' }), roomId);
  assert.equal(upload.getSnapshot().phase, 'pending');
  assert.equal((await controller.send({ target, body: '', photo: upload })).accepted, false);
  assert.equal(writes.length, 0);
  status = 'ready'; await upload.refresh();
  assert.equal((await controller.send({ target, body: '', photo: upload })).accepted, false);
  assert.equal((await controller.send({ target, body: '', photo: upload })).accepted, true);
  assert.deepEqual(writes[0], writes[1]);
  assert.deepEqual(writes[0]?.content, { type: 'PHOTO', assetIds: [assetId] });
  assert.equal(writes[0]?.recipientActorId, 'streamer');
  assert.deepEqual(controller.getSnapshot().items, []); // Receipt never creates a fake photo row.
  controller.dispose(); assert.equal(upload.getSnapshot().phase, 'empty'); upload.dispose();
});
void test('a READY avatar or another-room upload cannot become a photo command', async () => {
  let writes = 0;
  const controller = new ChatController(roomId, server(async () => { writes++; throw new Error('unexpected write'); }));
  await controller.refresh();
  for (const kind of ['AVATAR', 'PHOTO'] as const) {
    const upload = uploadFor(controller, () => 'ready');
    await upload.start(kind, new Blob(['test'], { type: 'image/png' }), kind === 'PHOTO' ? otherRoomId : undefined);
    assert.equal((await controller.send({ target, body: '', photo: upload })).accepted, false);
    upload.dispose();
  }
  assert.equal(writes, 0); controller.dispose();
});
void test('room scope disposal clears READY photo and fences late ACK', async () => {
  let release!: (value: unknown) => void;
  let sent: Record<string, unknown> | undefined;
  const controller = new ChatController(roomId, server(async (_path, options) => { sent = options?.body as Record<string, unknown>; return new Promise(resolve => { release = resolve; }); }));
  await controller.refresh(); const upload = uploadFor(controller, () => 'ready');
  await upload.start('PHOTO', new Blob(['test'], { type: 'image/png' }), roomId);
  const work = controller.send({ target, body: '', photo: upload });
  controller.dispose();
  assert.equal(upload.getSnapshot().phase, 'empty');
  release({ clientMessageId: sent?.clientMessageId, messageId: 'saved', status: 'committed', version: '1' });
  assert.equal((await work).accepted, false); upload.dispose();
});
void test('PHOTO/STICKER retain exact references without anonymous author linkage; VIDEO stays unsupported', () => {
  const base = { id: 'message', version: '1', createdAt: '2026-09-20T00:00:00Z', audience: 'SHARED', author: { kind: 'anonymous' }, quote: null };
  const photo = message({ ...base, content: { type: 'PHOTO', attachments: [{ assetId, width: 10, height: 20, variant: 'image' }] } });
  const item = projectMessages([photo], 'fan', [])[0]!;
  assert.equal(item.kind, 'publication'); assert.equal('author' in item, false);
  if (item.kind !== 'publication') return;
  assert.equal(item.media?.assets[0]?.assetId, assetId);
  const sticker = message({ ...base, content: { type: 'STICKER', stickerId: otherRoomId, assetId, width: 10, height: 20 } });
  const stickerItem = projectMessages([sticker], 'fan', [])[0]!;
  assert.equal(stickerItem.kind === 'publication' && stickerItem.media?.stickerId, otherRoomId);
  assert.throws(() => message({ ...base, content: { type: 'PHOTO', attachments: [{ assetId, width: 10, height: 20, variant: 'video' }] } }));
  assert.equal(projectMessages([message({ ...base, content: { type: 'VIDEO' } })], 'fan', [])[0]?.kind, 'unsupported');
});

void test('STICKER requires explicit catalog selection and retries exact catalog ID, never image asset ID', async () => {
  const writes: Record<string, unknown>[] = [];
  const controller = new ChatController(roomId, server(async (_path, options) => {
    const body = options!.body as Record<string, unknown>; writes.push(body);
    if (writes.length === 1) throw new TypeError('lost ACK');
    return { clientMessageId: body.clientMessageId, messageId: 'saved', status: 'committed', version: '1' };
  }));
  await controller.refresh();
  const catalog = new StickerCatalog(new MediaClient({ apiOrigin: 'https://api.qa.rogi.chat', storageOrigins: [], csrf: () => 'A'.repeat(43), lifetime: controller.mediaLifetime(),
    transport: async () => Response.json({ items: [{ id: otherRoomId, assetId, label: '카탈로그 스티커' }], nextCursor: null }),
  }), roomId);
  await catalog.load();
  assert.equal((await controller.send({ target, body: '', sticker: catalog })).accepted, false); assert.equal(writes.length, 0);
  catalog.select(otherRoomId);
  assert.equal((await controller.send({ target, body: 'mixed', sticker: catalog })).accepted, false);
  assert.equal((await controller.send({ target, body: '', sticker: catalog })).accepted, false);
  assert.equal((await controller.send({ target, body: '', sticker: catalog })).accepted, true);
  assert.deepEqual(writes[0], writes[1]); assert.deepEqual(writes[0]?.content, { type: 'STICKER', stickerId: otherRoomId });
  assert.deepEqual(controller.getSnapshot().items, []); controller.dispose(); assert.equal(catalog.getSnapshot().selected, null); catalog.dispose();
});
