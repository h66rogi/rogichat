import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PrivacyClient } from './client';
import { accountBinding, type MarkerStore } from './deletion';
import { BlockFlow, REPORT_PENDING, ReportFlow, blockTarget, readReport } from './moderation';
import { blockPage, blockReceipt, reportInput, reportReceipt } from './moderation-contract';
import type { ServerMessage } from '../chat/contract';

const origin = 'https://api.qa.rogi.chat';
const id = '11111111-1111-4111-8111-111111111111';
const actor = '22222222-2222-4222-8222-222222222222';
const receipt = { reportId: id, status: 'received', createdAt: '2026-09-20T00:00:00.000Z' };
const session = { authenticated: true as const, soopLinkStatus: 'VERIFIED' as const, csrfToken: 'A'.repeat(43), accountPartition: 'B'.repeat(42) + 'A' };
function store(): MarkerStore { const data = new Map<string, string>(); return { getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); }, removeItem: key => { data.delete(key); } }; }
function response(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }); }
function api(handler: (path: string, init: RequestInit) => Response | Promise<Response>) { return new PrivacyClient(origin, (input, init) => Promise.resolve(handler(String(input).slice(origin.length), init!))); }

void test('moderation DTO rejects extra identity, false resets and invalid detail', () => {
  assert.deepEqual(reportReceipt(receipt), receipt);
  assert.throws(() => reportReceipt({ ...receipt, authorId: actor }));
  assert.throws(() => reportReceipt({ ...receipt, status: 'reviewing' }));
  assert.throws(() => reportInput({ idempotencyKey: id, reason: 'spam', detail: '\u0000' }));
  assert.equal(reportInput({ idempotencyKey: id, reason: 'spam', detail: '😀'.repeat(1000) }).detail, '😀'.repeat(1000));
  assert.throws(() => reportInput({ idempotencyKey: id, reason: 'spam', detail: '😀'.repeat(1001) }));
  assert.throws(() => blockReceipt({ actorId: actor, blocked: true, resetRequired: false }, actor, true));
  assert.throws(() => blockPage({ blocks: [{ actorId: actor, blockedAt: receipt.createdAt }], next: id }));
});

void test('report ACK loss recovers own receipt after reload without detail or raw source storage', async () => {
  const storage = store(); let calls = 0; let key = '';
  const client = api((path, init) => {
    if (path.endsWith('/session')) return response(session);
    if (init.method === 'POST') { calls++; key = (JSON.parse(String(init.body)) as { idempotencyKey: string }).idempotencyKey; throw new Error('ACK lost'); }
    assert.equal(path, `/v1/report-receipts/${key}`); return response(receipt);
  });
  const flow = new ReportFlow(client, storage, session, () => {});
  await flow.submit(id, actor, 'harassment', 'private detail'); assert.equal(flow.state, 'unknown');
  const saved = storage.getItem(REPORT_PENDING)!;
  for (const privateValue of ['private detail', session.csrfToken, session.accountPartition, id, actor]) assert.ok(!saved.includes(privateValue));
  flow.dispose(); const recovered = new ReportFlow(client, storage, session, () => {}); await recovered.recover();
  assert.equal(recovered.state, 'received'); assert.equal(calls, 1); assert.equal(readReport(storage), null);
});

void test('report 404 permits only explicit same-body retry while memory exists', async () => {
  const storage = store(); const bodies: string[] = [];
  const client = api((path, init) => {
    if (path.endsWith('/session')) return response(session);
    if (init.method === 'POST') { bodies.push(String(init.body)); if (bodies.length === 1) throw new Error('lost before commit'); return response(receipt); }
    return response({}, 404);
  });
  const flow = new ReportFlow(client, storage, session, () => {});
  await flow.submit(id, actor, 'other', 'exact original'); await flow.retry(id, actor); assert.equal(bodies.length, 1);
  await flow.recover(); assert.equal(flow.state, 'missing'); assert.equal(flow.canRetry, true);
  await flow.retry(id, actor); assert.equal(bodies.length, 2); assert.equal(bodies[0], bodies[1]); assert.equal(flow.state, 'received');
});

void test('reload missing receipt has no payload to resend and stale dismiss preserves successor', async () => {
  const storage = store(); const marker = { key: id, account: await accountBinding(origin, session.accountPartition) };
  storage.setItem(REPORT_PENDING, JSON.stringify(marker));
  const flow = new ReportFlow(api(path => response(path.endsWith('/session') ? session : {}, path.endsWith('/session') ? 200 : 404)), storage, session, () => {});
  await flow.recover(); assert.equal(flow.canRetry, false);
  storage.setItem(REPORT_PENDING, JSON.stringify({ ...marker, key: actor })); assert.equal(flow.dismiss(), false); assert.equal(readReport(storage)?.key, actor);
});

void test('report different account recovery and late session replacement never claim received', async () => {
  const storage = store(); let switched = false; let reads = 0;
  const client = api((path, init) => {
    if (path.endsWith('/session')) return response(switched ? { ...session, accountPartition: 'C'.repeat(42) + 'A' } : session);
    if (init.method === 'POST') { switched = true; return response(receipt); }
    reads++; return response(receipt);
  });
  const flow = new ReportFlow(client, storage, session, () => {}); await flow.submit(id, actor, 'spam', ''); assert.equal(flow.state, 'unknown');
  const successor = new ReportFlow(client, storage, { ...session, accountPartition: 'C'.repeat(42) + 'A' }, () => {}); await successor.recover(); assert.equal(successor.state, 'differentAccount'); assert.equal(reads, 0);
});

void test('block accepts only exact actor reset receipt; lost ACK still invalidates room', async () => {
  for (const outcome of ['valid', 'wrongActor', 'lost']) {
    let resets = 0; const states: string[] = [];
    const flow = new BlockFlow(api((path, init) => {
      if (path.endsWith('/session')) return response(session);
      assert.equal(path, `/v1/rooms/${id}/blocks/${actor}`); assert.equal(init.method, 'PUT'); assert.equal(init.body, '{}');
      if (outcome === 'lost') throw new Error('lost');
      return response({ actorId: outcome === 'valid' ? actor : id, blocked: true, resetRequired: true });
    }), session, state => states.push(state), () => { resets++; });
    await flow.change(id, actor, true); assert.equal(states.at(-1), outcome === 'valid' ? 'blocked' : 'unknown'); assert.equal(resets, 1);
  }
});

void test('unblock sends no body; block list works without joining and is session fenced', async () => {
  let requests = 0;
  const flow = new BlockFlow(api((path, init) => {
    if (path.endsWith('/session')) return response(session);
    requests++;
    if (init.method === 'DELETE') { assert.equal(init.body, undefined); return response({ actorId: actor, blocked: false, resetRequired: true }); }
    assert.equal(path, `/v1/rooms/${id}/blocks`); return response({ blocks: [{ actorId: actor, blockedAt: receipt.createdAt }], next: null });
  }), session, () => {}, () => {});
  assert.equal((await flow.list(id, null)).blocks.length, 1); await flow.change(id, actor, false); assert.equal(requests, 2);
});

void test('anonymous publications and self messages never expose a block target', () => {
  const anonymous = { author: { kind: 'anonymous' }, counterpart: { actorId: actor } } as ServerMessage;
  assert.equal(blockTarget(anonymous, id), null);
  assert.equal(blockTarget({ author: { kind: 'member', actorId: id } } as ServerMessage, id), null);
  assert.equal(blockTarget({ author: { kind: 'member', actorId: actor } } as ServerMessage, id), actor);
});

void test('late block response cannot reset a successor account or claim blocked', async () => {
  let switched = false; let resets = 0; const states: string[] = [];
  const flow = new BlockFlow(api(path => {
    if (path.endsWith('/session')) return response(switched ? { ...session, accountPartition: 'D'.repeat(42) + 'A' } : session);
    switched = true; return response({ actorId: actor, blocked: true, resetRequired: true });
  }), session, state => states.push(state), () => { resets++; });
  await flow.change(id, actor, true); assert.equal(resets, 0); assert.equal(states.at(-1), 'unknown');
});

void test('corrupt report recovery is explicitly clearable but cannot clear a newer marker', async () => {
  const storage = store(); storage.setItem(REPORT_PENDING, 'corrupt');
  const flow = new ReportFlow(api(() => response(session)), storage, session, () => {});
  await flow.recover(); assert.equal(flow.state, 'storageError');
  const marker = { key: id, account: await accountBinding(origin, session.accountPartition) };
  storage.setItem(REPORT_PENDING, JSON.stringify(marker)); assert.equal(flow.dismiss(), false); assert.equal(readReport(storage)?.key, id);
  storage.setItem(REPORT_PENDING, 'corrupt'); await flow.recover(); assert.equal(flow.dismiss(), true); assert.equal(readReport(storage), null);
});

void test('recovering a successor report marker discards the predecessor retry body', async () => {
  const storage = store(); let posts = 0;
  const client = api((path, init) => {
    if (path.endsWith('/session')) return response(session);
    if (init.method === 'POST') { posts++; throw new Error('lost'); }
    return response({}, 404);
  });
  const flow = new ReportFlow(client, storage, session, () => {}); await flow.submit(id, actor, 'spam', 'predecessor');
  const old = readReport(storage)!; storage.setItem(REPORT_PENDING, JSON.stringify({ ...old, key: id }));
  await flow.recover(); assert.equal(flow.state, 'missing'); assert.equal(flow.canRetry, false);
  await flow.retry(id, actor); assert.equal(posts, 1); assert.equal(readReport(storage)?.key, id);
});

void test('predispatch report failure returns to explicit editable confirmation through read-only recovery', async () => {
  const storage = store(); let unavailable = true; let posts = 0;
  const client = api((path, init) => {
    if (path.endsWith('/session')) return response(unavailable ? {} : session, unavailable ? 503 : 200);
    if (init.method === 'POST') posts++;
    return response(receipt);
  });
  const flow = new ReportFlow(client, storage, session, () => {}); await flow.submit(id, actor, 'spam', '');
  assert.equal(flow.state, 'storageError'); assert.equal(posts, 0); unavailable = false;
  await flow.recover(); assert.equal(flow.state, 'idle'); assert.equal(posts, 0); assert.equal(readReport(storage), null);
});
