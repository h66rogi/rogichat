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
const target = { scope: 'PRIVATE' as const, recipient: { actorId: otherRoomId, displayName: '운영자', avatarUrl: null } };
function server(post: ChatRequest): ChatRequest {
  return async (path, options) => {
    const base = { schemaVersion: 2, resetRequired: false, membershipScope: 'A'.repeat(43), authorizationRevision: 'B'.repeat(42) + 'A' };
    if (path === '/v1/auth/session') return { authenticated: true, soopLinkStatus: 'VERIFIED', csrfToken: 'A'.repeat(43), accountPartition: 'C'.repeat(42) + 'A' };
    if (path.includes('/message-commands/')) throw Object.assign(new Error('unknown'), { status: 404 });
    if (path.startsWith('/v1/sync?')) return { schemaVersion: 2, resetRequired: false, generation: 'a', complete: true, nextCursor: null, rooms: [{ roomId, actorId: assetId, name: '테스트 방', mode: 'FAN', role: 'FAN', membershipScope: base.membershipScope, authorizationRevision: base.authorizationRevision }] };
    if (path.includes('/profile-sync?')) return { ...base, generation: 'p', complete: true, nextCursor: null, profiles: [{ actorId: assetId, role: 'FAN', nickname: '팬', avatar: null }] };
    if (path.includes('/private-recipients')) return { recipients: [{ actorId: otherRoomId, nickname: '운영자', avatar: null }], next: null };
    if (path.includes('/read-state')) return { readContext: 'A'.repeat(43), items: [], firstUnreadMessageId: null };
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
    return { clientMessageId: body.clientMessageId, messageId: otherRoomId, status: 'committed', version: '1' };
  }));
  await controller.refresh();
  let status = 'processing'; const upload = uploadFor(controller, () => status);
  await upload.start('PHOTO', new Blob(['test'], { type: 'image/png' }), roomId);
  assert.equal(upload.getSnapshot().phase, 'pending');
  assert.equal((await controller.send({ target, body: '', photo: upload })).accepted, false);
  assert.equal(writes.length, 0);
  status = 'ready'; await upload.refresh();
  const unknown = await controller.send({ target, body: '', photo: upload }); assert.equal(unknown.accepted, false);
  assert.equal((await controller.send({ target, body: '', photo: upload, ...(!unknown.accepted && unknown.retryCommandId ? { retryCommandId: unknown.retryCommandId } : {}) })).accepted, true);
  assert.deepEqual(writes[0], writes[1]);
  assert.deepEqual(writes[0]?.content, { type: 'PHOTO', assetIds: [assetId] });
  assert.equal(writes[0]?.recipientActorId, otherRoomId);
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
  await new Promise(resolve => setImmediate(resolve)); controller.dispose();
  assert.equal(upload.getSnapshot().phase, 'empty');
  release({ clientMessageId: sent?.clientMessageId, messageId: otherRoomId, status: 'committed', version: '1' });
  assert.equal((await work).accepted, false); upload.dispose();
});
void test('PHOTO/STICKER retain exact references without anonymous author linkage; VIDEO stays unsupported', () => {
  const base = { id: roomId, version: '1', createdAt: '2026-09-20T00:00:00.000Z', audience: 'SHARED', author: { kind: 'anonymous' }, quote: null, counterpart: null, allowedActions: { reply: false, publish: false, delete: false } };
  const photo = message({ ...base, content: { type: 'PHOTO', attachments: [{ assetId, width: 10, height: 20, variant: 'image' }] } });
  const item = projectMessages([photo], 'fan', [])[0]!;
  assert.equal(item.kind, 'publication'); assert.equal('author' in item, false);
  if (item.kind !== 'publication') return;
  assert.equal(item.media?.assets[0]?.assetId, assetId);
  const sticker = message({ ...base, content: { type: 'STICKER', stickerId: otherRoomId, assetId, width: 10, height: 20 } });
  const stickerItem = projectMessages([sticker], 'fan', [])[0]!;
  assert.equal(stickerItem.kind === 'publication' && stickerItem.media?.stickerId, otherRoomId);
  assert.equal(projectMessages([message({ ...base, content: { type: 'PHOTO', attachments: [{ assetId, width: 10, height: 20, variant: 'video' }] } })], assetId, [])[0]?.kind, 'unsupported');
  assert.equal(projectMessages([message({ ...base, content: { type: 'VIDEO', attachments: [] } })], 'fan', [])[0]?.kind, 'unsupported');
});

void test('STICKER requires explicit catalog selection and retries exact catalog ID, never image asset ID', async () => {
  const writes: Record<string, unknown>[] = [];
  const controller = new ChatController(roomId, server(async (_path, options) => {
    const body = options!.body as Record<string, unknown>; writes.push(body);
    if (writes.length === 1) throw new TypeError('lost ACK');
    return { clientMessageId: body.clientMessageId, messageId: otherRoomId, status: 'committed', version: '1' };
  }));
  await controller.refresh();
  const catalog = new StickerCatalog(new MediaClient({ apiOrigin: 'https://api.qa.rogi.chat', storageOrigins: [], csrf: () => 'A'.repeat(43), lifetime: controller.mediaLifetime(),
    transport: async () => Response.json({ items: [{ id: otherRoomId, assetId, label: '카탈로그 스티커' }], nextCursor: null }),
  }), roomId);
  await catalog.load();
  assert.equal((await controller.send({ target, body: '', sticker: catalog })).accepted, false); assert.equal(writes.length, 0);
  catalog.select(otherRoomId);
  assert.equal((await controller.send({ target, body: 'mixed', sticker: catalog })).accepted, false);
  const unknown = await controller.send({ target, body: '', sticker: catalog }); assert.equal(unknown.accepted, false);
  assert.equal((await controller.send({ target, body: '', sticker: catalog, ...(!unknown.accepted && unknown.retryCommandId ? { retryCommandId: unknown.retryCommandId } : {}) })).accepted, true);
  assert.deepEqual(writes[0], writes[1]); assert.deepEqual(writes[0]?.content, { type: 'STICKER', stickerId: otherRoomId });
  assert.deepEqual(controller.getSnapshot().items, []); controller.dispose(); assert.equal(catalog.getSnapshot().selected, null); catalog.dispose();
});

void test('VIDEO requires correct READY room upload, persists one asset and retains exact explicit retry', async () => {
  const writes: Record<string, unknown>[] = [];
  const controller = new ChatController(roomId, server(async (_path, options) => {
    const body = options!.body as Record<string, unknown>; writes.push(body);
    if (writes.length === 1) throw new TypeError('ACK lost');
    return { clientMessageId: body.clientMessageId, messageId: otherRoomId, status: 'committed', version: '1' };
  }));
  await controller.refresh(); let status = 'processing'; const upload = uploadFor(controller, () => status);
  await upload.start('VIDEO', new Blob(['test video'], { type: 'video/mp4' }), roomId);
  assert.equal((await controller.send({ target, body: '', video: upload })).accepted, false); assert.equal(writes.length, 0);
  status = 'ready'; await upload.refresh();
  assert.equal((await controller.send({ target, body: '', photo: upload })).accepted, false);
  const unknown = await controller.send({ target, body: '', video: upload }); assert.equal(unknown.accepted, false);
  assert.ok(!unknown.accepted && unknown.retryCommandId);
  assert.equal((await controller.send({ target, body: '', video: upload, retryCommandId: unknown.retryCommandId })).accepted, true);
  assert.deepEqual(writes[0], writes[1]); assert.deepEqual(writes[0]?.content, { type: 'VIDEO', assetIds: [assetId] });
  const base = { id: roomId, version: '2', createdAt: '2026-09-20T00:00:00.000Z', audience: 'SHARED', author: { kind: 'anonymous' }, quote: null, counterpart: null, allowedActions: { reply: false, publish: false, delete: false } };
  const content = { type: 'VIDEO', attachments: ['video', 'poster'].map(variant => ({ assetId, width: 160, height: 90, variant })) };
  const projected = projectMessages([message({ ...base, content })], assetId, [])[0]!;
  assert.equal(projected.kind, 'publication'); assert.ok(projected.kind === 'publication' && projected.media?.type === 'VIDEO' && projected.media.revision === '2');
  assert.equal(projectMessages([message({ ...base, content: { ...content, attachments: [content.attachments[0]] } })], assetId, [])[0]?.kind, 'unsupported');
  controller.dispose(); upload.dispose();
});
