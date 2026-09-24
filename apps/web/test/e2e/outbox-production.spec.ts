import { expect, test, type Page } from '@playwright/test';
import type { ServerMessage } from '../../src/features/chat/contract';
import { installApi, json, TEST_ACTOR_ID, TEST_ROOM_ID, TEST_SCOPES } from './api-fixture';

// Only isolated API fixtures. These exercise the real production route/composer,
// controller and native IndexedDB; no product test route or runtime global exists.
const recipientId = '44444444-4444-4444-8444-444444444444';
async function recoveryApi(page: Page) {
  const account = await installApi(page, true); account.joined = true;
  const state = { posts: [] as Record<string, unknown>[], lookups: [] as string[], messages: [] as ServerMessage[], failSend: true, commitOnLookup: false, holdLookup: null as Promise<void> | null, snapshots: 0 };
  const committed = (body: Record<string, unknown>): ServerMessage => ({
    id: String(body.clientMessageId), version: '1', createdAt: '2026-09-20T01:00:00.000Z', audience: 'PRIVATE',
    author: { kind: 'member', actorId: TEST_ACTOR_ID, nickname: '테스트 팬', avatar: null }, counterpart: { actorId: recipientId },
    allowedActions: { reply: true, publish: false, delete: true }, content: body.content as { type: 'TEXT'; text: string }, quote: null,
  });
  await page.routeWebSocket('**/v1/realtime/**', socket => {
    socket.send('0' + JSON.stringify({ sid: 'isolated-outbox-session', upgrades: [], pingInterval: 25000, pingTimeout: 20000, maxPayload: 1024 }));
    socket.onMessage(packet => { if (typeof packet === 'string' && packet.startsWith('40')) socket.send('40' + JSON.stringify({ sid: 'isolated-outbox-socket' })); });
  });
  await page.route('https://api.qa.rogi.chat/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === 'OPTIONS') { await json(route, null, 204); return; }
    if (path !== '/v1/sync' && !path.startsWith(`/v1/rooms/${TEST_ROOM_ID}/`)) { await route.fallback(); return; }
    const envelope = { schemaVersion: 2, resetRequired: false, ...TEST_SCOPES };
    if (path === '/v1/sync') { await json(route, { schemaVersion: 2, resetRequired: false, generation: 'isolated-outbox-manifest', rooms: [{ roomId: TEST_ROOM_ID, name: '후로기', actorId: TEST_ACTOR_ID, role: 'FAN', mode: 'FAN', ...TEST_SCOPES }], nextCursor: null, complete: true }); return; }
    if (path.endsWith('/profile-sync')) { await json(route, { ...envelope, generation: 'isolated-outbox-profile', profiles: [{ actorId: TEST_ACTOR_ID, nickname: '테스트 팬', role: 'FAN', avatar: null }, { actorId: recipientId, nickname: '테스트 스트리머', role: 'STREAMER', avatar: null }], nextCursor: null, complete: true }); return; }
    if (path.endsWith('/private-recipients')) { await json(route, { recipients: [{ actorId: recipientId, nickname: '테스트 스트리머', avatar: null }], next: null }); return; }
    if (path.endsWith('/snapshot')) { state.snapshots++; await json(route, { ...envelope, messages: state.messages, nextCursor: 'isolated-events', historyCursor: null }); return; }
    if (path.endsWith('/events')) { await json(route, { ...envelope, events: state.messages.map(message => ({ type: 'message.upsert', message })), nextCursor: 'isolated-events', hasMore: false }); return; }
    if (path.includes('/message-commands/')) {
      const id = path.split('/').at(-1)!; state.lookups.push(id);
      if (state.holdLookup) await state.holdLookup;
      const body = state.posts.find(post => post.clientMessageId === id);
      if (state.commitOnLookup && body) {
        const message = committed(body); state.messages = [message];
        await json(route, { clientMessageId: id, messageId: message.id, status: 'committed', version: '1' }); return;
      }
      await json(route, { error: { code: 'NOT_FOUND' } }, 404); return;
    }
    if (path.endsWith('/messages') && route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as Record<string, unknown>; state.posts.push(body);
      if (state.failSend) { await json(route, {}, 503); return; }
      const message = committed(body); state.messages = [message];
      await json(route, { clientMessageId: body.clientMessageId, messageId: message.id, status: 'committed', version: '1' }); return;
    }
    await route.fallback();
  });
  return { account, state };
}

async function unknownSend(page: Page, body: string) {
  await page.goto('/chat');
  const input = page.getByTestId('chat-composer-input'); await expect(input).toBeVisible();
  await input.fill(body); await input.press('Enter');
  await expect(page.getByTestId('chat-composer-error')).toContainText('전송 결과가 확인되지 않았습니다');
  await expect(input).toHaveValue(body);
}

// A real navigation may abort the old document's best-effort IDB lease release.
// Exercise bounded expiry with the browser clock, without rewriting ownership or
// bypassing fresh authorization. Payloads and IDs must remain intact meanwhile.
async function recoveredLookup(page: Page, expectedId: unknown, waitUntilIdle = true) {
  const lookup = page.getByRole('button', { name: '전송 1 결과 조회', exact: true });
  const reconnect = page.getByRole('button', { name: '지금 다시 시도', exact: true });
  await expect.poll(async () => await lookup.count() + await reconnect.count()).toBeGreaterThan(0);
  if (!await lookup.count()) {
    const persisted = await page.evaluate(async () => new Promise<{ leaseUntil: number; ids: string[] }>((resolve, reject) => {
      const request = indexedDB.open('rogichat-outbox-qa', 1);
      request.onsuccess = () => {
        const db = request.result, read = db.transaction('state', 'readonly').objectStore('state').get('singleton');
        read.onsuccess = () => { resolve({ leaseUntil: read.result.leaseUntil, ids: read.result.records.map((record: { clientMessageId: string }) => record.clientMessageId) }); db.close(); };
        read.onerror = () => reject(Error('read failed'));
      };
      request.onerror = () => reject(Error('open failed'));
    }));
    expect(persisted.ids).toEqual([expectedId]);
    await page.clock.setFixedTime(persisted.leaseUntil + 1);
  }
  await expect(lookup).toBeVisible();
  if (waitUntilIdle) await expect(lookup).toBeEnabled();
  return lookup;
}

test('production outbox reload is receipt-first and explicit retry preserves frozen command', async ({ page }) => {
  const { state } = await recoveryApi(page);
  await unknownSend(page, '재시작 후 같은 전송만 재시도');
  const original = structuredClone(state.posts[0]); expect(original).toBeTruthy();
  await page.reload();
  await expect(page.getByTestId('chat-composer-input')).toHaveValue('');
  expect(state.posts).toHaveLength(1);
  const lookup = await recoveredLookup(page, state.posts[0]?.clientMessageId);
  expect(state.posts).toHaveLength(1);
  await lookup.click(); await expect.poll(() => state.lookups.length).toBeGreaterThan(0);
  expect(state.lookups.every(id => id === original!.clientMessageId)).toBe(true); expect(state.posts).toHaveLength(1);
  state.failSend = false;
  await page.getByRole('button', { name: '전송 1 같은 전송 다시 시도', exact: true }).click();
  await expect(page.getByText('재시작 후 같은 전송만 재시도', { exact: true })).toBeVisible();
  await expect.poll(() => state.posts.length).toBe(2); expect(state.posts[1]).toEqual(original);
  await expect(lookup).toHaveCount(0);
});

test('production cold receipt recovery performs fresh message read without another SEND', async ({ page }) => {
  const { state } = await recoveryApi(page);
  await unknownSend(page, '유실된 ACK는 조회로 복구');
  const id = state.posts[0]?.clientMessageId, snapshots = state.snapshots;
  let release!: () => void;
  state.commitOnLookup = true; state.holdLookup = new Promise<void>(resolve => { release = resolve; });
  await page.reload(); expect(state.posts).toHaveLength(1);
  const lookup = await recoveredLookup(page, id, false);
  await expect.poll(() => state.lookups.length).toBeGreaterThan(0);
  await expect(lookup).toBeDisabled(); expect(state.posts).toHaveLength(1);
  state.holdLookup = null; release();
  await expect(page.getByRole('region', { name: '후로기 메시지', exact: true }).getByText('유실된 ACK는 조회로 복구', { exact: true })).toBeVisible();
  await expect.poll(() => state.snapshots).toBeGreaterThan(snapshots);
  expect(state.lookups.every(value => value === id)).toBe(true);
  await expect(lookup).toHaveCount(0); expect(state.posts).toHaveLength(1);
});

test('production same-account new session scrubs durable private payload and never restores composer', async ({ page }) => {
  const { account, state } = await recoveryApi(page);
  const body = '이전 세션 전용 비공개 본문'; await unknownSend(page, body);
  account.sessionToken = 'synthetic-csrf-session-B'; await page.reload();
  await expect(page.getByTestId('chat-composer-input')).toHaveValue('');
  await expect(page.getByRole('button', { name: /같은 전송 다시 시도/ })).toHaveCount(0);
  await expect(page.getByText(body, { exact: true })).toHaveCount(0); expect(state.posts).toHaveLength(1);
  const stored = await page.evaluate(async () => {
    const databases = (await indexedDB.databases()).filter(database => database.name?.startsWith('rogichat-outbox-'));
    return Promise.all(databases.map(database => new Promise<string>((resolve, reject) => {
      const request = indexedDB.open(database.name!);
      request.onsuccess = () => {
        const db = request.result, tx = db.transaction('state', 'readonly'), read = tx.objectStore('state').get('singleton');
        read.onsuccess = () => { resolve(JSON.stringify(read.result)); db.close(); }; read.onerror = () => reject(Error('read failed'));
      };
      request.onerror = () => reject(Error('open failed'));
    })));
  });
  expect(stored.length).toBeGreaterThan(0);
  expect(stored.join('')).not.toContain(body); expect(stored.join('')).not.toContain('synthetic-csrf-session');
});

test('production foreground reauthorizes durable recovery and preserves pending input without replay', async ({ page }) => {
  const { state } = await recoveryApi(page);
  await unknownSend(page, '백그라운드에서도 결과 미확인 입력 보존');
  const input = page.getByTestId('chat-composer-input'), snapshots = state.snapshots;
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide'))); await expect(input).toBeHidden();
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await expect(input).toHaveValue('백그라운드에서도 결과 미확인 입력 보존');
  await expect.poll(() => state.snapshots).toBeGreaterThan(snapshots);
  expect(state.posts).toHaveLength(1);
  state.failSend = false;
  await page.getByRole('button', { name: '전송 1 같은 전송 다시 시도', exact: true }).click();
  await expect(page.getByText('백그라운드에서도 결과 미확인 입력 보존', { exact: true })).toBeVisible();
  await expect.poll(() => state.posts.length).toBe(2); expect(state.posts[1]).toEqual(state.posts[0]);
});

// Native lease fault injection is isolated to this browser test. It represents a
// live writer in another process without introducing an app bypass or fake IDB.
async function foreignLease(page: Page, owner: string, release = false) {
  await page.evaluate(async ({ owner, release }) => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('rogichat-outbox-qa', 1);
      request.onsuccess = () => {
        const db = request.result, tx = db.transaction('state', 'readwrite'), store = tx.objectStore('state'), read = store.get('singleton');
        read.onsuccess = () => {
          const state = read.result as { owner: string | null; fence: number; leaseUntil: number };
          if (release && state.owner !== owner) { tx.abort(); return; }
          state.fence++; state.owner = release ? null : owner; state.leaseUntil = release ? 0 : Date.now() + 30_000;
          store.put(state, 'singleton');
        };
        tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => { db.close(); reject(Error('lease fixture failed')); };
      };
      request.onerror = () => reject(Error('lease fixture failed'));
    });
  }, { owner, release });
}

test('production second-tab handoff preserves input and restores sending automatically', async ({ page, context }) => {
  await recoveryApi(page); await page.goto('/chat'); await expect(page.getByTestId('chat-composer-input')).toBeVisible();
  const owner = 'isolated-other-writer'; await foreignLease(page, owner);
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await expect(page.getByTestId('chat-composer-input')).toBeHidden();
  const second = await context.newPage(); const { state } = await recoveryApi(second); await second.goto('/chat');
  const reconnect = second.getByRole('button', { name: '지금 다시 시도', exact: true }); await expect(reconnect).toBeVisible();
  await expect(second.getByRole('status').first()).toContainText('메시지 전송을 준비하고 있어요.');
  const input = second.getByTestId('chat-composer-input'); await expect(input).toBeVisible(); await input.fill('다른 탭 사용 중에도 입력 보존');
  await expect(input).toHaveValue('다른 탭 사용 중에도 입력 보존'); expect(state.posts).toHaveLength(0);
  await foreignLease(second, owner, true);
  await expect(second.getByTestId('chat-composer-send')).toBeEnabled(); await expect(input).toHaveValue('다른 탭 사용 중에도 입력 보존');
  state.failSend = false; await input.press('Enter');
  await expect.poll(() => state.posts.length).toBe(1); await expect(second.getByText('다른 탭 사용 중에도 입력 보존', { exact: true })).toBeVisible();
});

test('production aborted IDB write preserves composer and never sends unpersisted input', async ({ page }) => {
  const { state } = await recoveryApi(page); await page.goto('/chat');
  const input = page.getByTestId('chat-composer-input'); await expect(input).toBeVisible(); await input.fill('저장 실패에도 사라지지 않을 입력');
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
      const data = value as { records?: { payload?: { content?: { text?: string } } }[] };
      if (this.name === 'state' && data?.records?.some(record => record.payload?.content?.text === '저장 실패에도 사라지지 않을 입력')) {
        IDBObjectStore.prototype.put = original;
        throw new DOMException('Isolated quota fault', 'QuotaExceededError');
      }
      return original.call(this, value, key);
    };
  });
  await input.press('Enter');
  await expect(page.getByRole('button', { name: '지금 다시 시도', exact: true })).toBeVisible();
  await expect(input).toHaveValue('저장 실패에도 사라지지 않을 입력'); expect(state.posts).toHaveLength(0);
  await page.getByRole('button', { name: '지금 다시 시도', exact: true }).click();
  await expect(page.getByTestId('chat-composer-send')).toBeEnabled(); expect(state.posts).toHaveLength(0);
  state.failSend = false; await input.press('Enter');
  await expect(page.getByText('저장 실패에도 사라지지 않을 입력', { exact: true })).toBeVisible();
  await expect(input).toHaveValue(''); expect(state.posts).toHaveLength(1); expect(state.lookups.length).toBeGreaterThan(0);
});

test('production settings logout scrubs durable payload after chat controller has unmounted', async ({ page }) => {
  const { account } = await recoveryApi(page); const body = '채팅을 떠난 뒤에도 로그아웃 시 지울 본문';
  await unknownSend(page, body);
  // Full document navigation guarantees the old active-controller registry is gone.
  await page.goto('/settings'); await page.getByRole('button', { name: '로그아웃', exact: true }).click();
  await expect.poll(() => account.logoutCount).toBe(1);
  const stored = await page.evaluate(async () => new Promise<string>((resolve, reject) => {
    const request = indexedDB.open('rogichat-outbox-qa', 1);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction('state', 'readonly'), read = tx.objectStore('state').get('singleton');
      read.onsuccess = () => { resolve(JSON.stringify(read.result)); db.close(); }; read.onerror = () => reject(Error('read failed'));
    };
    request.onerror = () => reject(Error('open failed'));
  }));
  expect(stored).not.toContain(body); expect(stored).not.toContain('synthetic-csrf-session');
});


test('receipt recovery blocks dispatch but keeps the draft editable until the read settles', async ({ page }) => {
  const { state } = await recoveryApi(page); await unknownSend(page, '보관된 전송');
  let release!: () => void; state.holdLookup = new Promise<void>(resolve => { release = resolve; });
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await expect(page.getByTestId('chat-composer-input')).toBeHidden();
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await expect.poll(() => state.lookups.length).toBeGreaterThan(0);
  const input = page.getByTestId('chat-composer-input'); await expect(input).toBeEditable();
  await input.fill('확인 중 작성한 새 초안'); await input.press('Enter');
  await expect(input).toHaveValue('확인 중 작성한 새 초안');
  await expect(page.getByTestId('chat-composer-send')).toBeDisabled(); expect(state.posts).toHaveLength(1);
  state.holdLookup = null; release();
  await expect(page.getByTestId('chat-composer-send')).toBeEnabled();
  await expect(input).toHaveValue('확인 중 작성한 새 초안'); expect(state.posts).toHaveLength(1);
});
