import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, type Session } from '../../core/api/client';
import { PrivacyClient, deletionReceipt, publicationReceipt } from './client';
import { ACCOUNT_DELETION_PENDING, DeletionFlow, accountBinding, browserPrivacyStore, clearDeletion, isAccountDeletionPending, readDeletion, type MarkerStore, type DeletionPreparation, type DeletionState } from './deletion';
import { PublicationFlow, canOfferPublication, publicationKey, type PublicationContext } from './publication';

const origin = 'https://api.qa.rogi.chat';
const id = '11111111-1111-4111-8111-111111111111';
const pub = '22222222-2222-4222-8222-222222222222';
const session = { authenticated: true as const, soopLinkStatus: 'VERIFIED' as const, csrfToken: 'A'.repeat(43), accountPartition: 'B'.repeat(42) + 'A' };
const context: PublicationContext = { session, generation: 1,
  scope: { roomId: id, name: 'test', mode: 'FAN', actorId: pub, role: 'STREAMER', membershipScope: 'A'.repeat(43), authorizationRevision: '1' },
  message: { id, version: '1', createdAt: '2026-09-20T00:00:00.000Z', audience: 'PRIVATE', author: { kind: 'anonymous' }, content: { type: 'TEXT', text: 'isolated test' }, counterpart: null, quote: null, allowedActions: { reply: false, publish: true, delete: false } } };
function store(): MarkerStore {
  const values = new Map<string, string>();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } };
}
function deletionFlow(client: PrivacyClient, storage: MarkerStore, changed: (state: DeletionState) => void, blocked: (session: Session) => void,
  preparation: DeletionPreparation = { cleanupBinding: async () => '1'.repeat(64), onPrepare: async () => {} }) {
  return new DeletionFlow(client, storage, changed, blocked, preparation);
}
function response(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }); }
function api(handler: (path: string, init: RequestInit) => Promise<Response> | Response) {
  return new PrivacyClient(origin, (input, init) => Promise.resolve(handler(String(input).slice(origin.length), init!)));
}

void test('strict receipts distinguish access blocking and publication completion', () => {
  assert.equal(deletionReceipt({ requestId: id.replace('-4111-', '-5111-'), status: 'blocked' }).status, 'blocked');
  for (const value of [{ requestId: id, status: 'deleted' }, { requestId: id, status: 'blocked', deleted: true }, { status: 'blocked' }]) assert.throws(() => deletionReceipt(value));
  assert.equal(publicationReceipt({ publicationId: pub, status: 'preparing' }).status, 'preparing');
  assert.throws(() => publicationReceipt({ publicationId: pub, status: 'published' }));
  assert.throws(() => publicationReceipt({ publicationId: pub, status: 'revoked', messageId: id }));
  assert.throws(() => publicationReceipt({ publicationId: pub, status: 'preparing' }, id));
});

void test('transport uses approved origin, cookie/CSRF, bounded JSON and exact status', async () => {
  assert.throws(() => new PrivacyClient('https://example.invalid'));
  const client = api((path, init) => {
    assert.equal(path, '/v1/me/account'); assert.equal(init.method, 'DELETE'); assert.equal(init.body, '{}');
    assert.equal(init.credentials, 'include'); assert.equal(init.cache, 'no-store'); assert.equal(init.redirect, 'error');
    assert.equal((init.headers as Record<string, string>)['X-CSRF-Token'], session.csrfToken);
    return response({ requestId: id, status: 'blocked' });
  });
  await client.deleteAccount(session.csrfToken, new AbortController().signal);
  await assert.rejects(api(() => response({ requestId: id, status: 'blocked' }, 202)).deleteAccount(session.csrfToken, new AbortController().signal));
  await assert.rejects(api(() => response({ extra: 'x'.repeat(9000) })).session(new AbortController().signal));
  await assert.rejects(api(() => response({ error: { code: 'RECENT_AUTH_REQUIRED' } }, 403)).deleteAccount(session.csrfToken, new AbortController().signal), (error: unknown) => error instanceof ApiError && error.code === 'RECENT_AUTH_REQUIRED');
});

void test('account deletion persists before dispatch, validates receipt then cleans once', async () => {
  const storage = store(); let cleanups = 0; let deletes = 0;
  const flow = deletionFlow(api(path => {
    if (path.endsWith('/session')) return response(session);
    deletes++; assert.equal(readDeletion(storage)?.phase, 'unknown'); return response({ requestId: id, status: 'blocked' });
  }), storage, () => {}, () => { cleanups++; });
  await flow.submit(session); await flow.submit(session);
  assert.equal(flow.state, 'blocked'); assert.equal(readDeletion(storage)?.phase, 'blocked'); assert.equal(cleanups, 1); assert.equal(deletes, 1);
  const marker = storage.getItem(ACCOUNT_DELETION_PENDING)!;
  assert.ok(!marker.includes(session.csrfToken) && !marker.includes(session.accountPartition) && !marker.includes(id));
});

void test('401, lost ACK, malformed receipt and ledger 503 never prove deletion; reload is read only', async () => {
  for (const failure of [() => response({ error: { code: 'UNAUTHENTICATED' } }, 401), () => { throw new TypeError('offline'); }, () => response({ status: 'blocked' }), () => response({}, 503)]) {
    const storage = store(); let deletes = 0; let cleaned = false;
    const client = api(path => { if (path.endsWith('/session')) return response(session); deletes++; return failure(); });
    const flow = deletionFlow(client, storage, () => {}, () => { cleaned = true; });
    await flow.submit(session); assert.ok(['unknown', 'unavailable'].includes(flow.state)); assert.equal(cleaned, false);
    const restored = deletionFlow(client, storage, () => {}, () => {}); await restored.recover();
    assert.equal(restored.state, 'ready'); assert.equal(deletes, 1); assert.equal(readDeletion(storage)?.phase, 'unknown');
  }
});

void test('recent auth uses login only; different-account reauth never mutates', async () => {
  const storage = store(); let deletes = 0; let switched = false;
  const client = api((path, init) => {
    if (path.endsWith('/session')) return response(switched ? { ...session, accountPartition: 'C'.repeat(42) + 'A' } : session);
    if (path.endsWith('/start')) { assert.deepEqual(JSON.parse(String(init.body)), { intent: 'login', termsVersion: '2026-09-20' }); return response({ authorizeUrl: 'https://example.invalid/auth' }); }
    deletes++; return response({ error: { code: 'RECENT_AUTH_REQUIRED' } }, 403);
  });
  const flow = deletionFlow(client, storage, () => {}, () => {});
  await flow.submit(session); assert.equal(flow.state, 'reauth'); await flow.login(); switched = true; await flow.recover();
  assert.equal(flow.state, 'differentAccount'); await flow.retry(); assert.equal(deletes, 1);
  await flow.submit({ ...session, accountPartition: 'C'.repeat(42) + 'A' }); assert.equal(deletes, 1);
});

void test('storage failure blocks deletion, stale operation and disposed responses cannot bless newer state', async () => {
  let deletes = 0;
  const storage = store(); storage.setItem = () => { throw new Error('quota'); };
  const flow = deletionFlow(api(path => { if (path.endsWith('/session')) return response(session); deletes++; return response({ requestId: id, status: 'blocked' }); }), storage, () => {}, () => {});
  await flow.submit(session); assert.equal(deletes, 0); assert.equal(flow.state, 'storageError');
  assert.equal(isAccountDeletionPending({ ...storage, getItem: () => { throw new Error(); } }), true);
  const healthy = store(); let release!: (response: Response) => void; let cleanups = 0;
  const pending = deletionFlow(api(path => path.endsWith('/session') ? response(session) : new Promise(resolve => { release = resolve; })), healthy, () => {}, () => { cleanups++; });
  const work = pending.submit(session);
  while (!release) await new Promise(resolve => setTimeout(resolve, 0));
  const previous = readDeletion(healthy)!;
  healthy.setItem(ACCOUNT_DELETION_PENDING, JSON.stringify({ ...previous, operation: crypto.randomUUID() }));
  assert.equal(clearDeletion(healthy, previous.operation), false);
  pending.dispose(); release(response({ requestId: id, status: 'blocked' })); await work;
  assert.equal(cleanups, 0); assert.equal(readDeletion(healthy)?.phase, 'unknown');
});

void test('publication disclosure, TEXT affordance and permission/session/generation/DTO keys fence work', async () => {
  let writes = 0;
  const client = api(path => { if (path.endsWith('/session')) return response(session); writes++; return response({ publicationId: pub, status: 'preparing' }, 202); });
  const flow = new PublicationFlow(client, context, () => {}, () => {});
  await flow.publish(false); assert.equal(writes, 0); await flow.publish(true); await flow.publish(true); assert.equal(writes, 1); assert.equal(flow.state, 'preparing');
  assert.equal(canOfferPublication({ ...context, scope: { ...context.scope, role: 'FAN' } }), false);
  assert.equal(canOfferPublication({ ...context, message: { ...context.message, allowedActions: { ...context.message.allowedActions, publish: false } } }), false);
  assert.equal(canOfferPublication({ ...context, message: { ...context.message, content: { type: 'VIDEO', attachments: [] } } }), false);
  for (const changed of [{ ...context, generation: 2 }, { ...context, scope: { ...context.scope, authorizationRevision: '2' } }, { ...context, message: { ...context.message, version: '2' } }, { ...context, session: { ...session, csrfToken: 'D'.repeat(42) + 'A' } }]) assert.notEqual(publicationKey(context), publicationKey(changed));
});

void test('publication poll only refreshes sync after published; ambiguous 404 never republishes', async () => {
  let writes = 0; let synced = 0; let status: 'preparing' | 'published' | '404' = 'preparing';
  const flow = new PublicationFlow(api((path, init) => {
    if (path.endsWith('/session')) return response(session);
    if (init.method === 'POST') { writes++; return response({ publicationId: pub, status: 'preparing' }, 202); }
    return status === '404' ? response({}, 404) : response({ publicationId: pub, status, ...(status === 'published' ? { messageId: id } : {}) });
  }), context, () => {}, () => { synced++; });
  await flow.publish(true); await flow.check(); assert.equal(synced, 0);
  status = '404'; await flow.check(); assert.equal(flow.state, 'unknown'); await flow.publish(true); assert.equal(writes, 1);
  status = 'published'; await flow.check(); assert.equal(synced, 1); await flow.check(); assert.equal(synced, 1);
});

void test('publication ACK lost and session replacement do not resend or project content', async () => {
  let writes = 0; let switched = false; let synced = 0;
  const flow = new PublicationFlow(api((path, init) => {
    if (path.endsWith('/session')) return response(switched ? { ...session, csrfToken: 'D'.repeat(42) + 'A' } : session);
    if (init.method === 'POST') { writes++; return response({ publicationId: pub, status: 'preparing' }, 202); }
    return response({ publicationId: pub, status: 'published', messageId: id });
  }), context, () => {}, () => { synced++; });
  await flow.publish(true); switched = true; await flow.check(); assert.equal(flow.state, 'unavailable'); assert.equal(synced, 0); assert.equal(writes, 1);
  const lost = new PublicationFlow(api(path => { if (path.endsWith('/session')) return response(session); throw new Error('lost'); }), context, () => {}, () => { synced++; });
  await lost.publish(true); assert.equal(lost.state, 'unknown'); assert.equal(lost.canCheck, false); await lost.publish(true); assert.equal(synced, 0);
});

void test('account binding is environment-specific and carries no raw identifier', async () => {
  assert.notEqual(await accountBinding(origin, session.accountPartition), await accountBinding('https://api.rogi.chat', session.accountPartition));
});

void test('stale recovery dismissal cannot clear successor marker; corrupt marker remains gated', async () => {
  const storage = store();
  const a = { version: 1, operation: crypto.randomUUID(), account: await accountBinding(origin, session.accountPartition), phase: 'unknown' };
  storage.setItem(ACCOUNT_DELETION_PENDING, JSON.stringify(a));
  const recovery = deletionFlow(api(() => response(session)), storage, () => {}, () => {});
  await recovery.recover(); assert.equal(recovery.state, 'ready');
  const b = { ...a, operation: crypto.randomUUID() };
  storage.setItem(ACCOUNT_DELETION_PENDING, JSON.stringify(b));
  assert.equal(recovery.dismiss(), false); assert.equal(readDeletion(storage)?.operation, b.operation);
  storage.setItem(ACCOUNT_DELETION_PENDING, 'corrupt'); await recovery.recover();
  assert.equal(recovery.state, 'storageError'); assert.equal(isAccountDeletionPending(storage), true);
  assert.equal(recovery.dismiss(), true); assert.equal(isAccountDeletionPending(storage), false);
});

void test('throwing browser storage getter is deferred and fails closed', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { get localStorage() { throw new DOMException('denied', 'SecurityError'); } } });
  try {
    assert.equal(isAccountDeletionPending(browserPrivacyStore), true);
    const flow = deletionFlow(api(() => response(session)), browserPrivacyStore, () => {}, () => {});
    await flow.recover(); assert.equal(flow.state, 'storageError');
    await flow.submit(session); assert.equal(flow.state, 'storageError');
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'window', descriptor);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});

void test('late session change during publication POST or status GET cannot refresh successor timeline', async () => {
  for (const during of ['POST', 'GET']) {
    let changed = false; let synchronized = 0;
    const flow = new PublicationFlow(api((path, init) => {
      if (path.endsWith('/session')) return response(changed ? { ...session, accountPartition: 'D'.repeat(42) + 'A' } : session);
      if (init.method === 'POST') {
        if (during === 'POST') changed = true;
        return response({ publicationId: pub, status: during === 'POST' ? 'published' : 'preparing', ...(during === 'POST' ? { messageId: id } : {}) }, 202);
      }
      changed = true; return response({ publicationId: pub, status: 'published', messageId: id });
    }), context, () => {}, () => { synchronized++; });
    await flow.publish(true);
    if (during === 'GET') await flow.check();
    assert.equal(synchronized, 0); assert.equal(flow.state, 'unavailable'); assert.equal(flow.canCheck, false);
  }
});

void test('noncooperative late publication response after disposal never updates UI', async () => {
  let release!: (value: Response) => void; let synchronized = 0;
  const flow = new PublicationFlow(api(path => path.endsWith('/session') ? response(session) : new Promise(resolve => { release = resolve; })), context, () => {}, () => { synchronized++; });
  const work = flow.publish(true);
  while (!release) await new Promise(resolve => setTimeout(resolve, 0));
  flow.dispose(); release(response({ publicationId: pub, status: 'published', messageId: id }, 202)); await work;
  assert.equal(synchronized, 0); assert.equal(flow.canCheck, false);
});

void test('reauth marker remains actionable across reload and rotated same-account session still needs confirmation', async () => {
  const storage = store(); let current = session; let deletes = 0;
  const client = api(path => { if (path.endsWith('/session')) return response(current); deletes++; return response({ error: { code: 'RECENT_AUTH_REQUIRED' } }, 403); });
  const flow = deletionFlow(client, storage, () => {}, () => {}); await flow.submit(session);
  const recovery = deletionFlow(client, storage, () => {}, () => {}); await recovery.recover(); assert.equal(recovery.state, 'reauth');
  current = { ...session, csrfToken: 'D'.repeat(42) + 'A' }; await recovery.recover(); assert.equal(recovery.state, 'ready'); assert.equal(deletes, 1);
});

void test('required cleanup persists exact digest before preparation and prevents DELETE on failure', async () => {
  const storage = store(); let deletes = 0; let prepared = false;
  const flow = deletionFlow(api(path => { if (path.endsWith('/session')) return response(session); deletes++; return response({ requestId: id, status: 'blocked' }); }), storage, () => {}, () => {}, {
    cleanupBinding: async captured => { assert.deepEqual(captured, session); return 'e'.repeat(64); },
    onPrepare: async captured => { assert.deepEqual(captured, session); assert.equal(readDeletion(storage)?.outbox, 'e'.repeat(64)); prepared = true; throw new Error('IndexedDB unavailable'); },
  });
  await flow.submit(session); assert.equal(prepared, true); assert.equal(deletes, 0); assert.equal(flow.state, 'prepareError'); assert.equal(readDeletion(storage)?.phase, 'unknown');
});

void test('invalid cleanup digest blocks marker creation and all mutation', async () => {
  const storage = store(); let prepared = false; let deletes = 0;
  const flow = deletionFlow(api(path => { if (path.endsWith('/session')) return response(session); deletes++; return response({ requestId: id, status: 'blocked' }); }), storage, () => {}, () => {}, {
    cleanupBinding: async () => session.csrfToken, onPrepare: async () => { prepared = true; },
  });
  await flow.submit(session); assert.equal(flow.state, 'storageError'); assert.equal(readDeletion(storage), null); assert.equal(prepared, false); assert.equal(deletes, 0);
});

void test('session switch during asynchronous preparation cannot delete successor account', async () => {
  const storage = store(); let switched = false; let deletes = 0;
  const flow = deletionFlow(api(path => {
    if (path.endsWith('/session')) return response(switched ? { ...session, csrfToken: 'D'.repeat(42) + 'A' } : session);
    deletes++; return response({ requestId: id, status: 'blocked' });
  }), storage, () => {}, () => {}, { cleanupBinding: async () => 'e'.repeat(64), onPrepare: async () => { switched = true; } });
  await flow.submit(session); assert.equal(deletes, 0); assert.equal(flow.state, 'differentAccount');
});

void test('blocked callback receives captured validated session without postdelete session read', async () => {
  const storage = store(); let deleted = false; let sessionReads = 0; let cleanupSession: Session | null = null;
  const flow = deletionFlow(api(path => {
    if (path.endsWith('/session')) { sessionReads++; assert.equal(deleted, false); return response(session); }
    deleted = true; return response({ requestId: id, status: 'blocked' });
  }), storage, () => {}, captured => { cleanupSession = captured; });
  await flow.submit(session); assert.equal(flow.state, 'blocked'); assert.deepEqual(cleanupSession, session); assert.equal(sessionReads, 2);
});

void test('legacy marker has no inferred cleanup binding and malformed digest is rejected', async () => {
  const storage = store(); const marker = { version: 1, operation: crypto.randomUUID(), account: await accountBinding(origin, session.accountPartition), phase: 'unknown' };
  storage.setItem(ACCOUNT_DELETION_PENDING, JSON.stringify(marker)); assert.equal(readDeletion(storage)?.outbox, undefined);
  storage.setItem(ACCOUNT_DELETION_PENDING, JSON.stringify({ ...marker, outbox: session.csrfToken })); assert.throws(() => readDeletion(storage)); assert.equal(isAccountDeletionPending(storage), true);
});
