import assert from 'node:assert/strict';
import { test } from 'node:test';
import { VideoClient, VIDEO_MAX_BYTES } from './video-client';
import { MediaVideoResource } from './video-resource';
import type { VideoElement } from './video-resource';
const asset = '11111111-1111-4111-8111-111111111111';
const context = { roomId: '22222222-2222-4222-8222-222222222222', messageId: '33333333-3333-4333-8333-333333333333' };
const idle = () => new AbortController().signal;
function setup(change?: (response: Response, call: number) => Response | Promise<Response>, size = 7) {
  const abort = new AbortController(); let valid = true, used = 0, peak = 0, ranges = 0, verifies = 0;
  const calls: RequestInit[] = [];
  const client = new VideoClient({ apiOrigin: 'https://api.qa.rogi.chat', storageOrigins: ['https://media.example.test'],
    csrf: () => 'a'.repeat(43), lifetime: { signal: abort.signal, isCurrent: () => valid }, verifySession: async () => { verifies++; },
    budget: { reserve(bytes) { if (used + bytes > 64 * 1024 * 1024) throw Error('capacity'); used += bytes; peak = Math.max(used, peak);
      let released = false; return () => { if (!released) { used -= bytes; released = true; } }; } },
    transport: async (_url, init) => {
      calls.push(init!);
      if (init?.method === 'POST') return new Response(JSON.stringify({ url: 'https://media.example.test/object?isolated=1', expiresIn: 60 }), { headers: { 'Content-Type': 'application/json' } });
      const range = /bytes=(\d+)-(\d+)/.exec(new Headers(init?.headers).get('Range')!)!;
      const start = Number(range[1]), end = Number(range[2]);
      const response = new Response(new Uint8Array(end - start + 1), { status: 206, headers: {
        ETag: '"isolated-video"', 'Content-Type': 'video/mp4', 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) } });
      return change ? change(response, ++ranges) : response;
    } });
  return { client, abort, calls, invalidate: () => { valid = false; }, used: () => used, peak: () => peak, verifies: () => verifies };
}
void test('full 50MiB rendition: bounded ranges, credential isolation and idempotent release', async () => {
  const s = setup(undefined, VIDEO_MAX_BYTES); const lease = await s.client.load(asset, context, 'video', idle());
  assert.equal(lease.blob.size, VIDEO_MAX_BYTES); assert.ok(s.peak() < 55 * 1024 * 1024); assert.equal(s.calls.length, 52); assert.equal(s.verifies(), 3);
  for (const call of s.calls.slice(1)) { assert.equal(call.credentials, 'omit'); assert.equal(call.cache, 'no-store'); assert.equal(call.redirect, 'error');
    assert.equal(call.referrerPolicy, 'no-referrer'); assert.deepEqual([...new Headers(call.headers).keys()], ['range']); }
  lease.release(); lease.release(); assert.equal(s.used(), 0);
});
for (const [name, change] of Object.entries({
  ignoredRange: (r: Response) => new Response(r.body, { status: 200, headers: r.headers }),
  missingIdentity: (r: Response) => { r.headers.delete('ETag'); return r; },
  weakIdentity: (r: Response) => { r.headers.set('ETag', 'W/"isolated"'); return r; },
  malformed: (r: Response) => { r.headers.set('Content-Range', 'bytes 0-0/*'); return r; },
  wrongOffset: (r: Response) => { r.headers.set('Content-Range', 'bytes 1-1/7'); return r; },
  wrongType: (r: Response) => { r.headers.set('Content-Type', 'text/html'); return r; },
  oversized: (r: Response) => { r.headers.set('Content-Range', `bytes 0-0/${VIDEO_MAX_BYTES + 1}`); return r; },
  encoded: (r: Response) => { r.headers.set('Content-Encoding', 'gzip'); return r; },
  wrongLength: (r: Response) => { r.headers.set('Content-Length', '2'); return r; },
  truncated: (r: Response) => new Response(new Uint8Array(), { status: 206, headers: r.headers }),
  overflow: (r: Response) => new Response(new Uint8Array(2), { status: 206, headers: r.headers }),
})) void test(`rejects ${name} and releases all reservations`, async () => {
  const s = setup(change); await assert.rejects(s.client.load(asset, context, 'video', idle())); assert.equal(s.used(), 0);
});
void test('changed total cannot assemble mixed resource', async () => {
  const s = setup((r, n) => { if (n === 2) r.headers.set('Content-Range', 'bytes 1-6/8'); return r; });
  await assert.rejects(s.client.load(asset, context, 'video', idle())); assert.equal(s.used(), 0);
});
void test('session/account/room/revision lifetime fence discards late transport', async () => {
  for (const reason of ['session', 'account', 'room', 'revision']) {
    const s = setup(r => { s.invalidate(); return r; });
    await assert.rejects(s.client.load(asset, context, 'video', idle()), reason); assert.equal(s.used(), 0);
  }
});
void test('abort cancels stalled body and releases capacity', async () => {
  let cancelled = false; const request = new AbortController();
  const s = setup(r => new Response(new ReadableStream({ start() { queueMicrotask(() => request.abort()); }, cancel() { cancelled = true; } }), { status: 206, headers: r.headers }));
  await assert.rejects(s.client.load(asset, context, 'video', request.signal)); assert.equal(cancelled, true); assert.equal(s.used(), 0);
});
class Element extends EventTarget {
  src = ''; poster = ''; currentTime = 0; duration = 3; paused = true; playbackRate = 1;
  canPlayType() { return 'probably' as const; } pause() { this.paused = true; } async play() { this.paused = false; } load() {}
  removeAttribute(name: string) { if (name === 'src') this.src = ''; if (name === 'poster') this.poster = ''; }
}
void test('expiry revokes before reauthorization and restores position, rate and playing state', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  const abort = new AbortController(); let used = 0; let accesses = 0;
  const client = { lifetime: { signal: abort.signal, isCurrent: () => true }, async load() {
    accesses++; used++; let released = false;
    return { blob: new Blob(['isolated']), expiresAt: Date.now() + 60_000, release() { if (!released) { released = true; used--; } } };
  } } as unknown as VideoClient;
  const resource = new MediaVideoResource(client); const element = new Element(); resource.attach(element as VideoElement);
  await resource.load(asset, context, '1'); element.dispatchEvent(new Event('loadedmetadata'));
  const old = element.src; element.currentTime = 1.25; element.playbackRate = 1.5; await element.play();
  t.mock.timers.tick(60_000); assert.equal(element.src, ''); assert.equal(element.paused, true);
  await new Promise(resolve => setImmediate(resolve)); element.dispatchEvent(new Event('loadedmetadata'));
  assert.equal(accesses, 4); assert.equal(used, 2); assert.notEqual(element.src, old); await assert.rejects(fetch(old));
  assert.equal(element.currentTime, 1.25); assert.equal(element.playbackRate, 1.5); assert.equal(element.paused, false);
  abort.abort(); assert.equal(element.src, ''); assert.equal(used, 0); resource.dispose();
});
void test('new revision resets position; disposal discards late completion', async () => {
  const abort = new AbortController(); let released = 0;
  const client = { lifetime: { signal: abort.signal, isCurrent: () => true }, async load() {
    return { blob: new Blob(['isolated']), expiresAt: Date.now() + 60_000, release() { released++; } };
  } } as unknown as VideoClient;
  const resource = new MediaVideoResource(client); const element = new Element(); resource.attach(element as VideoElement);
  await resource.load(asset, context, '1'); element.currentTime = 2;
  await resource.load(asset, context, '2', true); element.dispatchEvent(new Event('loadedmetadata')); assert.equal(element.currentTime, 0); assert.equal(released, 2);
  const late = resource.load(asset, context, '3'); resource.dispose(); await late;
  assert.equal(element.src, ''); assert.equal(resource.getSnapshot().phase, 'empty'); assert.equal(released, 5);
});
void test('aggregate capacity rejects a concurrent max rendition before its payload; old release cannot release new lease', async () => {
  const s = setup(undefined, VIDEO_MAX_BYTES);
  const first = await s.client.load(asset, context, 'video', idle()); const held = s.used();
  await assert.rejects(s.client.load(asset, context, 'video', idle())); assert.equal(s.used(), held);
  first.release(); const next = await s.client.load(asset, context, 'video', idle());
  first.release(); assert.equal(s.used(), held); next.release(); assert.equal(s.used(), 0);
});
void test('whole-transfer deadline discards bytes received at the 60s boundary', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 });
  const s = setup(r => { t.mock.timers.setTime(61_000); return r; });
  await assert.rejects(s.client.load(asset, context, 'video', idle())); assert.equal(s.used(), 0);
});
void test('lease denial after expiry leaves no old video and does not retry indefinitely', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  const abort = new AbortController(); let calls = 0, released = 0;
  const client = { lifetime: { signal: abort.signal, isCurrent: () => true }, async load() {
    if (++calls > 2) throw Error('revoked');
    return { blob: new Blob(['isolated']), expiresAt: Date.now() + 60_000, release() { released++; } };
  } } as unknown as VideoClient;
  const resource = new MediaVideoResource(client); const element = new Element(); resource.attach(element as VideoElement);
  await resource.load(asset, context, '1'); await element.play(); t.mock.timers.tick(60_000); await new Promise(resolve => setImmediate(resolve));
  assert.equal(element.src, ''); assert.equal(released, 2); assert.equal(resource.getSnapshot().phase, 'unavailable');
  t.mock.timers.tick(180_000); assert.equal(calls, 3); resource.dispose();
});
void test('poster expiry cancels a delayed video without retaining the poster', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  const abort = new AbortController(); let calls = 0, released = 0; let finish: (() => void) | undefined;
  const client = { lifetime: { signal: abort.signal, isCurrent: () => true }, async load() {
    if (++calls === 2) await new Promise<void>(resolve => { finish = resolve; });
    return { blob: new Blob(['isolated']), expiresAt: Date.now() + 60_000, release() { released++; } };
  } } as unknown as VideoClient;
  const resource = new MediaVideoResource(client); const element = new Element(); resource.attach(element as VideoElement);
  const loading = resource.load(asset, context, '1'); await new Promise(resolve => setImmediate(resolve));
  t.mock.timers.tick(60_000); assert.equal(released, 1); assert.equal(element.src, '');
  finish!(); await loading; assert.equal(released, 2); assert.equal(resource.getSnapshot().phase, 'unavailable'); resource.dispose();
});
void test('same-size replacement ETag is rejected before assembly', async () => {
  const s = setup((r, n) => { if (n === 2) r.headers.set('ETag', '"replacement"'); return r; });
  await assert.rejects(s.client.load(asset, context, 'video', idle())); assert.equal(s.used(), 0);
});
void test('paused/ended expiry and background suspension make no fetch until explicit position restore', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  for (const reason of ['paused', 'ended', 'background']) {
    const abort = new AbortController(); let calls = 0, used = 0;
    const client = { lifetime: { signal: abort.signal, isCurrent: () => true }, async load() {
      calls++; used++; let released = false;
      return { blob: new Blob(['isolated']), expiresAt: Date.now() + 60_000, release() { if (!released) { released = true; used--; } } };
    } } as unknown as VideoClient;
    const resource = new MediaVideoResource(client); const element = new Element(); resource.attach(element as VideoElement);
    await resource.load(asset, context, '1'); element.currentTime = reason === 'ended' ? 3 : 1.25;
    if (reason === 'background') { await element.play(); resource.suspend(); }
    t.mock.timers.tick(120_000); await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, 2, reason); assert.equal(used, 0); assert.equal(element.src, ''); assert.equal(resource.getSnapshot().phase, 'expired');
    await resource.load(asset, context, '1', true); element.dispatchEvent(new Event('loadedmetadata'));
    assert.equal(element.currentTime, reason === 'ended' ? 3 : 1.25); assert.equal(element.paused, true); assert.equal(calls, 4); resource.dispose();
  }
});
void test('unattached owner preview sends variant only; partial or extra references never reach API', async () => {
  const s = setup(); const lease = await s.client.load(asset, {}, 'video', idle());
  assert.deepEqual(JSON.parse(s.calls[0]!.body as string), { variant: 'video' }); lease.release(); assert.equal(s.used(), 0);
  for (const invalid of [{ roomId: context.roomId }, { messageId: context.messageId }, { actorId: asset }, { roomId: null, messageId: null }]) {
    const denied = setup(); await assert.rejects(denied.client.load(asset, invalid as never, 'video', idle())); assert.equal(denied.calls.length, 0);
  }
});
