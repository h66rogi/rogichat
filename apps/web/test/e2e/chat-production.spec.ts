import { codecFixture } from './video-fixture';
import { installMedia, MEDIA_ASSET, MEDIA_CSRF, TEST_IMAGE } from './media-fixture';
import { expect, test, type Page, type WebSocketRoute } from '@playwright/test';
import type { ServerMessage } from '../../src/features/chat/contract';
import AxeBuilder from '@axe-core/playwright';
import { installApi, json, TEST_ACTOR_ID, TEST_ROOM_ID, TEST_SCOPES, TEST_PARTITION } from './api-fixture';

// All synthetic payloads live in test code, behind interception of the real API paths.
const streamerId = '44444444-4444-4444-8444-444444444444';
const incoming = { id: '55555555-5555-4555-8555-555555555555', version: '1', createdAt: '2026-09-20T01:00:00.000Z', audience: 'PRIVATE' as const, author: { kind: 'member' as const, actorId: streamerId, nickname: '테스트 스트리머', avatar: null }, content: { type: 'TEXT' as const, text: '실제 계약 형식의 개인 메시지' }, quote: null, counterpart: { actorId: streamerId }, allowedActions: { reply: true, publish: false, delete: false } };
async function chatApi(page: Page) {
  const account = await installApi(page, true); account.joined = true;
  const state = { manifestGeneration: 'test-membership', profileGeneration: 'test-profiles', resetEvents: false, snapshots: 0, messages: [incoming] as ServerMessage[], recipients: [{ actorId: streamerId, nickname: '테스트 스트리머', avatar: null }], deletedIds: [] as string[], deleteCalls: 0, failDelete: false, holdDelete: null as Promise<void> | null, failSnapshot: false, revoked: false, canSend: true, ownerPresent: true, posts: [] as Record<string, unknown>[], failSend: false, holdSend: null as Promise<void> | null, sockets: [] as WebSocketRoute[] };
  await page.routeWebSocket('**/v1/realtime/**', socket => {
    state.sockets.push(socket);
    expect(new URL(socket.url()).searchParams.get('transport')).toBe('websocket');
    socket.send('0' + JSON.stringify({ sid: 'test-engine-session', upgrades: [], pingInterval: 25000, pingTimeout: 20000, maxPayload: 1024 }));
    socket.onMessage(packet => {
      if (typeof packet === 'string' && packet.startsWith('40')) {
        expect(JSON.parse(packet.slice(2))).toEqual({ schemaVersion: 1, csrfToken: account.sessionToken });
        socket.send('40' + JSON.stringify({ sid: 'test-socket-session' }));
      }
    });
  });
  await page.route('https://api.qa.rogi.chat/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === 'OPTIONS') { await json(route, null, 204); return; }
    if (path !== '/v1/sync' && !path.startsWith(`/v1/rooms/${TEST_ROOM_ID}/`)) { await route.fallback(); return; }
    if (state.revoked) { await json(route, {}, 403); return; }
    const envelope = { schemaVersion: 2, resetRequired: false, ...TEST_SCOPES };
    if (path === '/v1/sync') { await json(route, { schemaVersion: 2, resetRequired: false, generation: state.manifestGeneration, rooms: [{ roomId: TEST_ROOM_ID, name: '후로기', actorId: TEST_ACTOR_ID, mode: 'FAN', role: 'FAN', ...TEST_SCOPES }], nextCursor: null, complete: true }); return; }
    if (path.endsWith('/profile-sync')) { await json(route, { ...envelope, generation: state.profileGeneration, profiles: [{ actorId: TEST_ACTOR_ID, nickname: '테스트 팬', role: 'FAN', avatar: null }, ...(state.ownerPresent ? [{ actorId: streamerId, nickname: '테스트 스트리머', role: 'STREAMER', avatar: null }] : [])], nextCursor: null, complete: true }); return; }
    if (path.endsWith('/private-recipients')) { await json(route, { recipients: state.canSend ? state.recipients : [], next: null }); return; }
    if (path.endsWith('/snapshot')) { state.snapshots++; await json(route, { ...envelope, messages: state.messages, nextCursor: 'test-events', historyCursor: null }, state.failSnapshot ? 503 : 200); return; }
    if (path.endsWith('/events') && state.resetEvents) { state.resetEvents = false; await json(route, { schemaVersion: 2, resetRequired: true, events: [], hasMore: false, nextCursor: null, membershipScope: null, authorizationRevision: null }); return; }
    if (path.endsWith('/events')) { await json(route, { ...envelope, events: [...state.deletedIds.map(messageId => ({ type: 'message.deleted', messageId, version: '2' })), ...state.messages.map(message => ({ type: 'message.upsert', message }))], hasMore: false, nextCursor: 'test-events' }); return; }
    if (path.endsWith('/delete')) {
      state.deleteCalls++; expect(route.request().headers()['x-csrf-token']).toBe(account.sessionToken);
      expect(route.request().postDataJSON()).toEqual({});
      if (state.holdDelete) await state.holdDelete;
      if (state.failDelete) { await json(route, {}, 503); return; }
      const id = path.split('/').at(-2);
      state.messages = state.messages.filter(message => message.id !== id).map(message => message.quote?.id === id ? { ...message, quote: null } : message);
      await json(route, { requestId: '99999999-9999-4999-8999-999999999999', status: 'blocked' }); return;
    }
    if (/\/messages\/[0-9a-f-]+$/.test(path) && route.request().method() === 'GET') { const message = state.messages.find(item => item.id === path.split('/').at(-1)); await json(route, message ?? {}, message ? 200 : 404); return; }
    if (path.includes('/message-commands/')) { await json(route, { error: { code: 'NOT_FOUND' } }, 404); return; }
    if (path.endsWith('/messages')) {
      expect(route.request().headers()['x-csrf-token']).toBe(account.sessionToken);
      const body = route.request().postDataJSON() as Record<string, unknown>; state.posts.push(body); expect(body.membershipScope).toBe(TEST_SCOPES.membershipScope);
      if (state.holdSend) await state.holdSend;
      if (state.failSend) { await json(route, {}, 503); return; }
      const sent = { ...incoming, id: String(body.clientMessageId), counterpart: body.intent === 'ROOM_OWNER' ? state.ownerPresent ? { actorId: streamerId } : null : { actorId: String(body.recipientActorId) }, author: { ...incoming.author, actorId: TEST_ACTOR_ID, nickname: '테스트 팬' }, allowedActions: { reply: state.ownerPresent, publish: false, delete: true }, content: body.content as { type: 'TEXT'; text: string } };
      state.messages = [...state.messages, sent];
      await json(route, { clientMessageId: body.clientMessageId, messageId: sent.id, status: 'committed', version: '1' }); return;
    }
    await route.fallback();
  });
  return { account, state, hint: () => { for (const socket of state.sockets) socket.send('42["sync.required",{"schemaVersion":1}]'); } };
}

test('explicit reviewer entitlement permits real chat commands without inventing SOOP linkage and revokes on fresh session', async ({ page }) => {
  const { account, state } = await chatApi(page);
  let admitted = true;
  await page.route('**/v1/auth/session', route => json(route, { authenticated: true, csrfToken: account.sessionToken, accountPartition: TEST_PARTITION, soopLinkStatus: 'REQUIRED', onboardingState: admitted ? 'READY' : 'SOOP_LINK_REQUIRED', capabilities: { chat: admitted } }));
  await page.goto('/chat');
  const input = page.getByTestId('chat-composer-input');
  await input.fill('심사 계정의 격리된 메시지'); await input.press('Enter');
  await expect(input).toHaveValue('');
  await expect(page.getByText('심사 계정의 격리된 메시지', { exact: true })).toBeVisible();
  expect(state.posts).toHaveLength(1); expect(state.posts[0]?.intent).toBe('ROOM_OWNER');
  await page.reload(); await expect(page.getByTestId('chat-room')).toBeVisible();
  admitted = false;
  await page.evaluate(() => { window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })); window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); });
  await expect(page.getByTestId('chat-room')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'SOOP 계정 연결이 필요해요' })).toBeVisible();
  expect(state.posts).toHaveLength(1);
});

test('READY photo retries the same command, preserves text draft and clears bytes on deletion', async ({ page }) => {
  const { account, state, hint } = await chatApi(page); account.sessionToken = MEDIA_CSRF;
  const media = await installMedia(page); let fail = true;
  const savedId = '66666666-6666-4666-8666-666666666666';
  await page.route(`**/v1/rooms/${TEST_ROOM_ID}/messages`, async route => {
    if (route.request().method() === 'OPTIONS') return json(route, null, 204);
    const body = route.request().postDataJSON() as Record<string, unknown>; state.posts.push(body);
    if (fail) return json(route, {}, 503);
    state.messages.push({ ...incoming, id: savedId, author: { kind: 'member', actorId: TEST_ACTOR_ID, nickname: '테스트 팬', avatar: null }, content: { type: 'PHOTO', attachments: [{ assetId: MEDIA_ASSET, width: 1, height: 1, variant: 'image' }] } });
    return json(route, { clientMessageId: body.clientMessageId, messageId: savedId, status: 'committed', version: '1' });
  });
  await page.goto('/chat');
  await page.getByTestId('chat-composer-input').fill('별도로 보낼 글');
  await page.getByRole('button', { name: '사진 첨부', exact: true }).click();
  await page.getByLabel('이미지 선택', { exact: true }).setInputFiles(TEST_IMAGE);
  await expect.poll(() => media.statusReads).toBeGreaterThan(0);
  await expect(page.getByRole('button', { name: '사진 보내기', exact: true })).toBeDisabled();
  media.ready = true;
  await page.getByRole('button', { name: '이 이미지 사용' }).click();
  await page.getByRole('button', { name: '사진 보내기', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: '전송 결과가 확인되지 않았습니다' })).toBeVisible();
  fail = false; await page.getByRole('button', { name: '사진 보내기', exact: true }).click();
  const image = page.getByRole('img', { name: '대화 사진 1' });
  await expect(image).toBeVisible();
  await expect(page.getByTestId('chat-composer-input')).toHaveValue('별도로 보낼 글');
  await expect.poll(() => state.posts.length).toBe(2); expect(state.posts[0]).toEqual(state.posts[1]);
  expect(state.posts[0]).toMatchObject({ intent: 'ROOM_OWNER', content: { type: 'PHOTO', assetIds: [MEDIA_ASSET] } });
  expect(media.accesses).toContainEqual({ variant: 'image', roomId: TEST_ROOM_ID, messageId: savedId });
  const blob = await image.getAttribute('src'); expect(blob).toMatch(/^blob:/);
  state.messages = [incoming]; state.deletedIds = [savedId]; hint();
  await expect(image).toHaveCount(0);
  expect(await page.evaluate(async url => fetch(url!).then(() => true, () => false), blob)).toBe(false);
});

test('real chat keeps IME and pending focus, surfaces failure and retries the same command', async ({ page }) => {
  const { state } = await chatApi(page);
  await page.goto('/chat');
  const input = page.getByTestId('chat-composer-input'); await expect(input).toBeVisible();
  await page.getByTestId('chat-reply').click();
  await expect(page.getByTestId('chat-quote-preview')).toContainText(incoming.content.text);
  await input.fill('안녕하세요');
  await input.dispatchEvent('compositionstart'); await input.press('Enter');
  expect(state.posts).toHaveLength(0);
  await input.dispatchEvent('compositionend');
  await input.fill('안녕하세요'); // Final text committed by the IME.
  let release!: () => void; state.holdSend = new Promise<void>(resolve => { release = resolve; }); state.failSend = true;
  await input.press('Enter');
  await expect(input).toBeFocused(); await expect(input).toHaveAttribute('readonly', '');
  await expect(page.getByTestId('chat-composer-send')).toBeDisabled();
  release(); state.holdSend = null;
  await expect(page.getByTestId('chat-composer-error')).toContainText('전송 결과가 확인되지 않았습니다');
  await expect(input).toHaveValue('안녕하세요');
  state.failSend = false; await input.press('Enter');
  await expect(input).toHaveValue(''); await expect(page.getByText('안녕하세요', { exact: true })).toBeVisible();
  expect(state.posts).toHaveLength(2); expect(state.posts[0]?.clientMessageId).toBe(state.posts[1]?.clientMessageId);
  expect(state.posts[0]).toMatchObject({ intent: 'PRIVATE', recipientActorId: streamerId, quoteId: incoming.id, content: { type: 'TEXT', text: '안녕하세요' } });
});

test('empty state is truthful, snapshot failure offers retry, and keyboard view is accessible', async ({ page }) => {
  const { state } = await chatApi(page); state.messages = []; state.failSnapshot = true;
  await page.goto('/chat'); await expect(page.getByRole('alert').filter({ hasText: '메시지를 불러오지 못했습니다' })).toBeVisible();
  state.failSnapshot = false; await page.getByRole('button', { name: '다시 시도', exact: true }).click();
  await expect(page.getByTestId('chat-composer-input')).toBeVisible();
  await expect(page.getByText('실제 계약 형식의 개인 메시지')).toHaveCount(0);
  const results = await new AxeBuilder({ page }).analyze(); expect(results.violations).toEqual([]);
});

test('room-owner inbox remains available without private recipient grants and revoked access clears content', async ({ page }) => {
  const { state, hint } = await chatApi(page); state.canSend = false;
  await page.goto('/chat'); await expect(page.getByText(incoming.content.text, { exact: true })).toBeVisible();
  await expect(page.getByTestId('chat-composer-input')).toBeVisible();
  state.revoked = true; hint();
  await expect(page.getByText(incoming.content.text, { exact: true })).toHaveCount(0);
});

test('another-tab cookie session change clears previous draft before reauthorization', async ({ page }) => {
  const { account, state, hint } = await chatApi(page);
  await page.goto('/chat'); const input = page.getByTestId('chat-composer-input'); await expect(input).toBeVisible();
  await input.fill('이전 계정의 비공개 초안');
  account.sessionToken = 'synthetic-csrf-session-B'; account.profile.nickname = '새 계정'; state.messages = [];
  hint();
  await expect(page.getByText(incoming.content.text, { exact: true })).toHaveCount(0);
  await expect(input).toHaveValue('');
  expect(state.posts).toHaveLength(0);
});


test('only own messages offer confirmed deletion, retain failure for retry, and remove body plus quotes after ACK', async ({ page }) => {
  const { state } = await chatApi(page);
  const own = { ...incoming, id: '77777777-7777-4777-8777-777777777777', author: { ...incoming.author, actorId: TEST_ACTOR_ID }, allowedActions: { reply: true, publish: false, delete: true }, content: { type: 'TEXT' as const, text: '삭제할 내 메시지' } };
  state.messages = [own, { ...incoming, quote: { id: own.id, content: { type: 'TEXT', text: own.content.text } } }];
  await page.goto('/chat');
  await expect(page.getByTestId('chat-delete')).toHaveCount(1);
  await page.getByTestId('chat-delete').click();
  const dialog = page.getByRole('alertdialog'); await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: '취소', exact: true })).toBeFocused();
  await dialog.getByRole('button', { name: '취소', exact: true }).click(); expect(state.deleteCalls).toBe(0);
  await page.getByTestId('chat-delete').click();
  const accessibility = await new AxeBuilder({ page }).analyze(); expect(accessibility.violations).toEqual([]);
  let release!: () => void; state.holdDelete = new Promise<void>(resolve => { release = resolve; }); state.failDelete = true;
  await dialog.getByRole('button', { name: '삭제 확인', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '삭제 요청 중', exact: true })).toBeDisabled();
  await expect(page.getByText(own.content.text, { exact: true })).toHaveCount(2);
  release(); state.holdDelete = null;
  await expect(dialog.getByRole('alert')).toContainText('삭제 결과를 확인하지 못했습니다');
  state.failDelete = false; await dialog.getByRole('button', { name: '삭제 다시 시도', exact: true }).click();
  await expect(dialog).toHaveCount(0); await expect(page.getByText(own.content.text, { exact: true })).toHaveCount(0);
  await expect(page.getByText('메시지가 더 이상 표시되지 않도록 차단되었습니다.', { exact: true })).toBeVisible();
  expect(state.deleteCalls).toBe(2);
});


test('explicit private target selection stays actor-bound beside the default room-owner inbox', async ({ page }) => {
  const { state } = await chatApi(page);
  const second = { actorId: '88888888-8888-4888-8888-888888888888', nickname: '두 번째 스트리머', avatar: null };
  state.recipients.push(second);
  await page.goto('/chat');
  await expect(page.getByRole('radio')).toHaveCount(3);
  await expect(page.getByRole('radio', { name: '방장에게만', exact: true })).toBeChecked();
  await expect(page.getByTestId('chat-composer-input')).toHaveValue('');
  await page.getByRole('radio', { name: '두 번째 스트리머님에게만', exact: true }).click();
  const input = page.getByTestId('chat-composer-input'); await input.fill('선택한 대상에게만');
  await input.press('Enter'); await expect(input).toHaveValue('');
  expect(state.posts).toHaveLength(1); expect(state.posts[0]?.recipientActorId).toBe(second.actorId);
});


for (const hidden of [false, true]) test(`remote deletion clears ${hidden ? 'hidden' : 'visible'} quoted drafts while ambiguous sends retain their retry ID`, async ({ page }) => {
  const { state, hint } = await chatApi(page);
  const second = { actorId: '88888888-8888-4888-8888-888888888888', nickname: '두 번째 스트리머', avatar: null };
  state.recipients.push(second);
  await page.goto('/chat');
  const input = page.getByTestId('chat-composer-input');
  // An uncertain, unquoted command belongs to the same session across cache resets.
  await page.getByRole('radio', { name: '두 번째 스트리머님에게만', exact: true }).click();
  await input.fill('결과 미확인 메시지'); state.failSend = true; await input.press('Enter');
  await expect(page.getByTestId('chat-composer-error')).toContainText('전송 결과가 확인되지 않았습니다');
  await page.getByTestId('chat-reply').click();
  await expect(page.getByTestId('chat-quote-preview')).toContainText(incoming.content.text);
  await input.fill('삭제된 원문을 인용한 초안');
  // Exercise both the currently rendered quote and one held in an inactive target.
  if (hidden) {
    await page.getByRole('radio', { name: '두 번째 스트리머님에게만', exact: true }).click();
    await expect(input).toHaveValue('결과 미확인 메시지');
  }
  state.messages = []; state.deletedIds = [incoming.id]; hint();
  await expect(page.getByText(incoming.content.text, { exact: true })).toHaveCount(0);
  await expect(input).toHaveValue(''); // Fresh epoch clears every target draft, including the room-owner inbox.
  await page.getByRole('radio', { name: '테스트 스트리머님에게만', exact: true }).click();
  await expect(input).toHaveValue(''); await expect(page.getByTestId('chat-quote-preview')).toHaveCount(0);
  await page.getByRole('radio', { name: '두 번째 스트리머님에게만', exact: true }).click();
  await expect(input).toHaveValue(''); await expect(page.getByTestId('chat-quote-preview')).toHaveCount(0);
  state.deletedIds = []; state.failSend = false;
  await page.getByRole('button', { name: '전송 1 같은 전송 다시 시도', exact: true }).click();
  await expect(page.getByRole('button', { name: '전송 1 같은 전송 다시 시도', exact: true })).toHaveCount(0);
  expect(state.posts).toHaveLength(2); expect(state.posts[0]?.clientMessageId).toBe(state.posts[1]?.clientMessageId);
});

async function reactionApi(page: Page) {
  const chat = await chatApi(page);
  const state = { mine: null as string | null, count: 2, status: 200, calls: [] as string[], hold: null as Promise<void> | null };
  await page.route('**/reactions{,/me}', async route => {
    const method = route.request().method();
    if (method === 'OPTIONS') { await json(route, null, 204); return; }
    state.calls.push(method);
    if (method !== 'GET') expect(route.request().headers()['x-csrf-token']).toBe(chat.account.sessionToken);
    if (state.hold) await state.hold;
    if (state.status !== 200) { await json(route, { private: 'never-render-error-body' }, state.status); return; }
    if (method === 'PUT') state.mine = route.request().postDataJSON().emoji;
    if (method === 'DELETE') state.mine = null;
    await json(route, { counts: state.mine ? [{ emoji: state.mine, count: state.count }] : [], mine: state.mine });
  });
  return { ...chat, reactions: state };
}

test('reactions use real methods, authoritative counts, keyboard controls and accessible states', async ({ page }) => {
  const { reactions } = await reactionApi(page);
  await page.goto('/chat');
  const toggle = page.getByRole('button', { name: '반응 보기', exact: true });
  await expect(toggle).toBeVisible(); expect(reactions.calls).toEqual([]);
  await toggle.focus(); await toggle.press('Enter');
  await expect(page.getByText('아직 반응이 없습니다.')).toBeVisible();
  let release!: () => void; reactions.hold = new Promise(resolve => { release = resolve; });
  await page.getByRole('button', { name: '좋아요 반응', exact: true }).click();
  await expect(page.getByText('반응을 확인하는 중입니다.')).toBeVisible();
  await expect(page.getByRole('button', { name: /반응 2개/ })).toHaveCount(0);
  release(); reactions.hold = null;
  await expect(page.getByRole('button', { name: '👍 반응 2개, 내 반응 해제' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '하트 반응', exact: true }).focus();
  await page.getByRole('button', { name: '하트 반응', exact: true }).press('Enter');
  await expect(page.getByRole('button', { name: '❤️ 반응 2개, 내 반응 해제' })).toBeVisible();
  await expect(page.getByRole('button', { name: '하트 반응', exact: true })).toBeFocused();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole('button', { name: '내 반응 해제', exact: true }).click();
  await expect(page.getByText('아직 반응이 없습니다.')).toBeVisible();
  expect(reactions.calls).toEqual(['GET', 'PUT', 'PUT', 'DELETE']);
});

for (const status of [401, 403, 404, 429, 503]) test(`reaction ${status} hides unconfirmed counts and permits safe recovery`, async ({ page }) => {
  const { reactions, state, account } = await reactionApi(page);
  await page.goto('/chat'); await page.getByRole('button', { name: '반응 보기', exact: true }).click();
  await expect(page.getByText('아직 반응이 없습니다.')).toBeVisible();
  reactions.status = status;
  if (status === 401) account.sessionStatus = 401;
  if (status === 403 || status === 404) state.messages = [];
  await page.getByRole('button', { name: '좋아요 반응', exact: true }).click();
  if (status === 429 || status === 503) {
    await expect(page.getByRole('group', { name: '메시지 반응', exact: true }).getByRole('alert')).toContainText(status === 429 ? '30초' : '반응 결과');
    await expect(page.getByRole('button', { name: '좋아요 반응', exact: true })).toBeDisabled();
    if (status === 503) { reactions.status = 200; await page.getByRole('button', { name: '반응 다시 조회' }).click(); await expect(page.getByText('아직 반응이 없습니다.')).toBeVisible(); }
    else { await page.getByRole('button', { name: '반응 다시 조회' }).click(); expect(reactions.calls).toEqual(['GET', 'PUT']); }
  } else await expect(page.getByText(incoming.content.text, { exact: true })).toHaveCount(0);
  await expect(page.getByText('never-render-error-body')).toHaveCount(0);
  expect(reactions.calls.filter(method => method === 'PUT')).toHaveLength(1);
});

for (const transition of ['deletion', 'session'] as const) test(`late reaction response after ${transition} cannot repopulate private DOM`, async ({ page }) => {
  const { reactions, state, account, hint } = await reactionApi(page);
  await page.goto('/chat'); await expect(page.getByRole('button', { name: '반응 보기', exact: true })).toBeVisible();
  let release!: () => void; reactions.hold = new Promise(resolve => { release = resolve; }); reactions.mine = '👍'; reactions.count = 99;
  await page.getByRole('button', { name: '반응 보기', exact: true }).click();
  await expect(page.getByText('반응을 확인하는 중입니다.')).toBeVisible();
  state.messages = [];
  if (transition === 'deletion') { state.deletedIds = [incoming.id]; hint(); }
  else { account.sessionToken = 'synthetic-csrf-session-B'; await page.evaluate(() => window.dispatchEvent(new Event('rogichat-session-invalidated'))); }
  await expect(page.getByText(incoming.content.text, { exact: true })).toHaveCount(0);
  release(); reactions.hold = null;
  await expect(page.getByRole('group', { name: '메시지 반응', exact: true })).toHaveCount(0);
  await expect(page.getByText('👍 99', { exact: true })).toHaveCount(0);
});

test('message version hints refresh only opened reaction aggregates', async ({ page }) => {
  const { reactions, state, hint } = await reactionApi(page);
  await page.goto('/chat'); await page.getByRole('button', { name: '반응 보기', exact: true }).click();
  await expect(page.getByText('아직 반응이 없습니다.')).toBeVisible();
  reactions.mine = '🎉'; reactions.count = 5; state.messages = [{ ...incoming, version: '2' }]; hint();
  await expect(page.getByRole('button', { name: '🎉 반응 5개, 내 반응 해제' })).toBeVisible();
  expect(reactions.calls).toEqual(['GET', 'GET']);
});

test('anonymous publication reactions expose only aggregate selection without identity or source inference', async ({ page }) => {
  const { state, reactions } = await reactionApi(page);
  state.messages = [{ ...incoming, audience: 'SHARED', author: { kind: 'anonymous' }, counterpart: null, allowedActions: { reply: false, publish: false, delete: false } }];
  reactions.mine = '👍';
  await page.goto('/chat'); await page.getByRole('button', { name: '반응 보기', exact: true }).click();
  await expect(page.getByRole('button', { name: '👍 반응 2개, 내 반응 해제' })).toBeVisible();
  await expect(page.locator('[data-scope="PUBLICATION"]')).toContainText('보낸 사람 비공개');
  await expect(page.locator('[data-scope="PUBLICATION"]')).not.toContainText('테스트 스트리머');
  await expect(page.getByTestId('chat-reply')).toHaveCount(0);
});

for (const action of ['GET', 'PUT', 'closed'] as const) test(`pending reaction ${action} across version advance never commits stale counts or stalls open control`, async ({ page }) => {
  const { state, hint } = await reactionApi(page);
  let calls = 0; let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/reactions{,/me}', async route => {
    if (route.request().method() === 'OPTIONS') { await json(route, null, 204); return; }
    calls++;
    if (calls === 1) { await json(route, { counts: [], mine: null }); return; }
    if (calls === 2) { await held; await json(route, { counts: [{ emoji: '👍', count: 99 }], mine: '👍' }); return; }
    expect(route.request().method()).toBe('GET');
    await json(route, { counts: [{ emoji: '🎉', count: 5 }], mine: null });
  });
  await page.goto('/chat'); await page.getByRole('button', { name: '반응 보기', exact: true }).click();
  await expect(page.getByText('아직 반응이 없습니다.')).toBeVisible();
  await page.getByRole('button', { name: action === 'PUT' ? '좋아요 반응' : '반응 새로고침', exact: true }).click();
  await expect(page.getByText('반응을 확인하는 중입니다.')).toBeVisible();
  if (action === 'closed') await page.getByRole('button', { name: '반응 닫기', exact: true }).click();
  state.messages = [{ ...incoming, version: '2', content: { type: 'TEXT', text: '새 버전 메시지' } }]; hint();
  await expect(page.getByText('새 버전 메시지', { exact: true })).toBeVisible();
  release();
  if (action !== 'closed') {
    await expect(page.getByRole('button', { name: '🎉 반응 5개, 선택' })).toBeVisible();
    expect(calls).toBe(3);
  } else {
    // A subsequent socket sync lets the old request settle without reopening UI.
    hint(); await page.getByRole('button', { name: '반응 보기', exact: true }).focus();
    expect(calls).toBe(2);
  }
  await expect(page.getByRole('button', { name: /반응 99개/ })).toHaveCount(0);
});

for (const action of ['refresh', 'aggregate'] as const) test(`reaction keyboard ${action} retains logical focus through a deferred response`, async ({ page }) => {
  const { reactions } = await reactionApi(page); reactions.mine = '🦊';
  await page.goto('/chat'); await page.getByRole('button', { name: '반응 보기', exact: true }).click();
  const group = page.getByRole('group', { name: '메시지 반응', exact: true });
  const refresh = group.getByRole('button', { name: '반응 새로고침', exact: true });
  await expect(page.getByRole('button', { name: '🦊 반응 2개, 내 반응 해제' })).toBeVisible();
  let release!: () => void; reactions.hold = new Promise(resolve => { release = resolve; });
  const target = action === 'refresh' ? refresh : page.getByRole('button', { name: '🦊 반응 2개, 내 반응 해제' });
  await target.focus(); await target.press('Enter');
  const pendingRefresh = group.getByRole('button', { name: '반응 다시 조회', exact: true });
  await expect(pendingRefresh).toBeFocused(); await expect(pendingRefresh).toBeDisabled();
  await expect(page.getByRole('button', { name: /반응 2개/ })).toHaveCount(0);
  await pendingRefresh.press('Enter'); expect(reactions.calls).toHaveLength(2);
  release(); reactions.hold = null;
  await expect(refresh).toBeFocused(); await expect(refresh).toBeEnabled();
  if (action === 'refresh') await expect(page.getByRole('button', { name: '🦊 반응 2개, 내 반응 해제' })).toBeVisible();
  else await expect(page.getByText('아직 반응이 없습니다.')).toBeVisible();
  expect(reactions.calls).toEqual(['GET', action === 'refresh' ? 'GET' : 'DELETE']);
});

test('outgoing PRIVATE reply selects counterpart and equal-version false hint removes reply', async ({ page }) => {
  const { state, hint } = await chatApi(page);
  state.messages = [{ ...incoming, author: { ...incoming.author, actorId: TEST_ACTOR_ID, nickname: '테스트 팬' }, allowedActions: { reply: true, publish: false, delete: true } }];
  await page.goto('/chat');
  await page.getByTestId('chat-reply').click();
  await expect(page.getByTestId('chat-composer-target')).toContainText('테스트 스트리머');
  await expect(page.getByTestId('chat-quote-preview')).toContainText(incoming.content.text);
  state.messages = [{ ...state.messages[0]!, counterpart: null, allowedActions: { reply: false, publish: false, delete: true } }];
  hint();
  await expect(page.getByTestId('chat-reply')).toHaveCount(0);
  await expect(page.getByTestId('chat-quote-preview')).toHaveCount(0);
});

test('new identical composer submissions create separate command identities', async ({ page }) => {
  const { state } = await chatApi(page);
  await page.goto('/chat'); const input = page.getByTestId('chat-composer-input');
  await input.fill('의도한 새 메시지'); await input.press('Enter'); await expect(input).toHaveValue('');
  await input.fill('의도한 새 메시지'); await input.press('Enter'); await expect(input).toHaveValue('');
  expect(state.posts).toHaveLength(2); expect(state.posts[0]?.clientMessageId).not.toBe(state.posts[1]?.clientMessageId);
});

test('auth-gate pagehide/pageshow unmount preserves same-authority draft quote and exact retry command', async ({ page }) => {
  const { state } = await chatApi(page); state.failSend = true;
  await page.goto('/chat'); const input = page.getByTestId('chat-composer-input');
  await page.getByTestId('chat-reply').click(); await input.fill('복귀 뒤에도 같은 명령'); await input.press('Enter');
  await expect(page.getByTestId('chat-composer-error')).toContainText('전송 결과가 확인되지 않았습니다');
  const id = state.posts[0]?.clientMessageId;
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await expect(input).toHaveCount(0); await expect(page.getByText(incoming.content.text, { exact: true })).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await expect(input).toHaveValue('복귀 뒤에도 같은 명령');
  await expect(page.getByTestId('chat-quote-preview')).toContainText(incoming.content.text);
  for (let i = 0; i < 2; i++) {
    const before = state.snapshots;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect.poll(() => state.snapshots).toBeGreaterThan(before);
    await expect(input).toHaveValue('복귀 뒤에도 같은 명령');
  }
  await expect(page.getByTestId('chat-composer-send')).toBeEnabled();
  state.failSend = false; await input.press('Enter'); await expect(input).toHaveValue('');
  await expect.poll(() => state.posts.length).toBe(2); expect(state.posts[1]?.clientMessageId).toBe(id);
});

test('confirmed session loss scrubs parked drafts before same-token account access returns', async ({ page }) => {
  const { account } = await chatApi(page);
  await page.goto('/chat'); const input = page.getByTestId('chat-composer-input'); await input.fill('재인증 후 남으면 안 되는 초안');
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide'))); await expect(input).toHaveCount(0);
  account.sessionStatus = 401;
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await expect(page.getByRole('heading', { name: '로그인 후 이용할 수 있어요' })).toBeVisible();
  await expect(input).toHaveCount(0);
  account.sessionStatus = 200;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(input).toHaveValue('');
});

for (const churn of ['profiles', 'manifest', 'events-reset'] as const) test(`${churn} churn takes a fresh snapshot and preserves draft quote and retry command`, async ({ page }) => {
  const { state, hint } = await chatApi(page); state.failSend = true;
  await page.goto('/chat'); const input = page.getByTestId('chat-composer-input');
  await page.getByTestId('chat-reply').click(); await input.fill('세대 변경에도 같은 초안'); await input.press('Enter');
  await expect(page.getByTestId('chat-composer-error')).toContainText('전송 결과가 확인되지 않았습니다');
  const id = state.posts[0]?.clientMessageId; const snapshots = state.snapshots;
  if (churn === 'profiles') state.profileGeneration = 'profiles-after-unrelated-join';
  else if (churn === 'manifest') state.manifestGeneration = 'manifest-after-unrelated-change';
  else state.resetEvents = true;
  hint(); await expect.poll(() => state.snapshots).toBeGreaterThan(snapshots);
  await expect(input).toHaveValue('세대 변경에도 같은 초안');
  await expect(page.getByTestId('chat-quote-preview')).toContainText(incoming.content.text);
  await expect(page.getByTestId('chat-composer-send')).toBeEnabled();
  state.failSend = false; await input.press('Enter'); await expect(input).toHaveValue('');
  await expect.poll(() => state.posts.length).toBe(2); expect(state.posts[1]?.clientMessageId).toBe(id);
});

test('auth-gate resume rebuilds a parked quote from the newly authorized message body', async ({ page }) => {
  const { state } = await chatApi(page);
  await page.goto('/chat'); const input = page.getByTestId('chat-composer-input');
  await page.getByTestId('chat-reply').click(); await input.fill('유지할 초안');
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide'))); await expect(input).toHaveCount(0);
  state.messages = [{ ...incoming, version: '2', content: { type: 'TEXT', text: '수정된 인용 본문' } }];
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await expect(input).toHaveValue('유지할 초안');
  await expect(page.getByTestId('chat-quote-preview')).toContainText('수정된 인용 본문');
  await expect(page.getByTestId('chat-quote-preview')).not.toContainText(incoming.content.text);
});

test('live redaction refreshes the visible quote while preserving draft and explicit retry identity', async ({ page }) => {
  const { state, hint } = await chatApi(page); state.failSend = true;
  await page.goto('/chat'); const input = page.getByTestId('chat-composer-input');
  await page.getByTestId('chat-reply').click(); await input.fill('본문이 바뀌어도 같은 전송'); await input.press('Enter');
  await expect(page.getByTestId('chat-composer-error')).toContainText('전송 결과가 확인되지 않았습니다');
  const id = state.posts[0]?.clientMessageId;
  state.messages = [{ ...incoming, version: '2', content: { type: 'TEXT', text: '현재 허가된 인용 본문' } }]; hint();
  await expect(page.getByTestId('chat-quote-preview')).toContainText('현재 허가된 인용 본문');
  await expect(page.getByTestId('chat-quote-preview')).not.toContainText(incoming.content.text);
  await expect(input).toHaveValue('본문이 바뀌어도 같은 전송');
  await expect(page.getByTestId('chat-composer-send')).toBeEnabled();
  state.failSend = false; await input.press('Enter'); await expect(input).toHaveValue('');
  await expect.poll(() => state.posts.length).toBe(2); expect(state.posts[1]?.clientMessageId).toBe(id);
});

test('room loss from reaction during held SEND scrubs before late send settles and never restores the draft', async ({ page }) => {
  const { state, reactions } = await reactionApi(page); let release!: () => void;
  state.holdSend = new Promise<void>(resolve => { release = resolve; }); state.failSend = true;
  await page.goto('/chat'); const input = page.getByTestId('chat-composer-input');
  await page.getByRole('button', { name: '반응 보기', exact: true }).click(); await expect(page.getByText('아직 반응이 없습니다.')).toBeVisible();
  await input.fill('권한 상실 후 남으면 안 되는 전송'); await input.press('Enter'); await expect.poll(() => state.posts.length).toBe(1);
  reactions.status = 403; state.revoked = true;
  await page.getByRole('button', { name: '좋아요 반응', exact: true }).click();
  await expect(page.getByText('채팅 접근 권한이 변경되었습니다. 다시 확인해 주세요.', { exact: true })).toBeVisible(); await expect(input).toHaveCount(0);
  state.revoked = false; reactions.status = 200;
  await page.getByRole('button', { name: '다시 시도', exact: true }).click();
  await expect(input).toHaveValue('');
  await expect(page.getByRole('button', { name: '전송 1 같은 전송 다시 시도', exact: true })).toHaveCount(0);
  release(); await expect(page.getByRole('button', { name: '전송 1 결과 조회', exact: true })).toBeEnabled();
  await expect(input).toHaveValue(''); expect(state.posts).toHaveLength(1);
});

test('catalog sticker selection sends its exact ID, retains selection on failure and preserves text', async ({ page }) => {
  const { account, state } = await chatApi(page); account.sessionToken = MEDIA_CSRF;
  const media = await installMedia(page); const stickerId = '88888888-8888-4888-8888-888888888888';
  let fail = true;
  await page.route(`**/v1/rooms/${TEST_ROOM_ID}/stickers*`, route => json(route, { items: [{ id: stickerId, assetId: MEDIA_ASSET, label: '카탈로그 스티커' }], nextCursor: null }));
  await page.route(`**/v1/rooms/${TEST_ROOM_ID}/messages`, async route => {
    if (route.request().method() === 'OPTIONS') return json(route, null, 204);
    const body = route.request().postDataJSON() as Record<string, unknown>; state.posts.push(body);
    if (fail) return json(route, {}, 503);
    return json(route, { clientMessageId: body.clientMessageId, messageId: incoming.id, status: 'committed', version: '1' });
  });
  await page.goto('/chat'); await page.getByTestId('chat-composer-input').fill('별도 글');
  await page.getByRole('button', { name: '스티커 선택', exact: true }).click();
  await expect(page.getByRole('button', { name: '스티커 보내기', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '카탈로그 스티커', exact: true }).click();
  await expect(page.getByRole('img', { name: '선택한 스티커: 카탈로그 스티커' })).toBeVisible();
  await page.getByRole('button', { name: '스티커 보내기', exact: true }).click();
  await expect(page.getByText('전송 결과가 확인되지 않았습니다. 다시 보내기는 같은 전송 기록을 조회하고 현재 권한으로 재확인합니다.')).toBeVisible();
  fail = false; await page.getByRole('button', { name: '스티커 보내기', exact: true }).click();
  await expect(page.getByRole('button', { name: '스티커 보내기', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('chat-composer-input')).toHaveValue('별도 글');
  await expect.poll(() => state.posts.length).toBe(2); expect(state.posts[0]).toEqual(state.posts[1]);
  expect(state.posts[0]?.content).toEqual({ type: 'STICKER', stickerId });
  expect(media.accesses).toContainEqual({ variant: 'image', roomId: TEST_ROOM_ID, stickerId });
});

test('READY video sends one real asset reference and mounted timeline plays scoped validated ranges', async ({ page }) => {
  const { movie, poster } = await codecFixture();
  const { account, state, hint } = await chatApi(page); account.sessionToken = MEDIA_CSRF;
  let ready = false; const accesses: Record<string, unknown>[] = [];
  await page.route('https://api.qa.rogi.chat/v1/media/**', async route => {
    if (route.request().method() === 'OPTIONS') return json(route, null, 204);
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/upload-intents')) { expect(route.request().postDataJSON()).toEqual({ kind: 'VIDEO', contentType: 'video/mp4', byteLength: movie.length, roomId: TEST_ROOM_ID }); return json(route, { assetId: MEDIA_ASSET, status: 'reserved' }, 201); }
    if (path.endsWith('/content')) { expect(route.request().postDataBuffer()).toEqual(movie); return json(route, { assetId: MEDIA_ASSET, status: 'processing' }, 202); }
    if (path.endsWith('/access')) { const body = route.request().postDataJSON(); accesses.push(body); return json(route, { url: `https://media.test.invalid/${body.variant}`, expiresIn: 60 }); }
    return json(route, { assetId: MEDIA_ASSET, status: ready ? 'ready' : 'processing' });
  });
  await page.route('https://media.test.invalid/**', async route => {
    const bytes = new URL(route.request().url()).pathname === '/video' ? movie : poster;
    const [, from, to] = /^bytes=(\d+)-(\d+)$/.exec(route.request().headers()['range']!)!;
    return route.fulfill({ status: 206, headers: { ETag: '"video-journey"', 'Content-Type': bytes === movie ? 'video/mp4' : 'image/webp', 'Content-Range': `bytes ${from}-${to}/${bytes.length}`, 'Content-Length': String(Number(to) - Number(from) + 1), 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Content-Range, Content-Length, ETag' }, body: bytes.subarray(Number(from), Number(to) + 1) });
  });
  const savedId = '66666666-6666-4666-8666-666666666666';
  await page.route(`**/v1/rooms/${TEST_ROOM_ID}/messages`, async route => {
    if (route.request().method() === 'OPTIONS') return json(route, null, 204);
    const body = route.request().postDataJSON(); state.posts.push(body);
    state.messages.push({ ...incoming, id: savedId, author: { ...incoming.author, actorId: TEST_ACTOR_ID }, content: { type: 'VIDEO', attachments: ['video', 'poster'].map(variant => ({ assetId: MEDIA_ASSET, width: 160, height: 90, variant })) } });
    return json(route, { clientMessageId: body.clientMessageId, messageId: savedId, status: 'committed', version: '1' });
  });
  await page.goto('/chat'); await page.getByRole('button', { name: '영상 첨부', exact: true }).click();
  await page.getByLabel('영상 선택', { exact: true }).setInputFiles({ name: 'test.mp4', mimeType: 'video/mp4', buffer: movie });
  await expect(page.getByRole('button', { name: '영상 보내기', exact: true })).toBeDisabled(); expect(state.posts).toHaveLength(0);
  ready = true; await page.getByRole('button', { name: '이 영상 사용', exact: true }).click();
  await page.getByRole('button', { name: '영상 보내기', exact: true }).click();
  await expect(page.getByRole('button', { name: '영상 보내기', exact: true })).toHaveCount(0);
  await expect.poll(() => state.posts[0]?.content).toEqual({ type: 'VIDEO', assetIds: [MEDIA_ASSET] });
  await page.getByRole('button', { name: '영상 불러오기', exact: true }).click();
  const video = page.getByLabel('첨부 영상 재생', { exact: true });
  await expect.poll(() => video.evaluate(v => (v as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(2);
  await video.evaluate(v => { (v as HTMLVideoElement).currentTime = 1.25; });
  await expect.poll(() => video.evaluate(v => (v as HTMLVideoElement).currentTime)).toBeCloseTo(1.25, 1);
  expect(accesses).toContainEqual({ variant: 'video', roomId: TEST_ROOM_ID, messageId: savedId });
  expect(accesses).toContainEqual({ variant: 'poster', roomId: TEST_ROOM_ID, messageId: savedId });
  const blob = await video.getAttribute('src'); state.messages = [incoming]; state.deletedIds = [savedId]; hint();
  await expect(video).toHaveCount(0);
  expect(await page.evaluate(async url => fetch(url!).then(() => true, () => false), blob)).toBe(false);
});

for (const providerImage of [
  { type: 'image/webp', bytes: TEST_IMAGE.buffer },
  // Synthetic one-pixel GIF, isolated from production and unrelated to user images.
  { type: 'image/gif', bytes: Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64') },
]) {
test(`chat provider avatars decode ${providerImage.type}, use scoped tickets, deduplicate, and vanish on pagehide`, async ({ page }) => {
  const { account, state } = await chatApi(page); account.sessionToken = MEDIA_CSRF;
  state.messages.push({ ...incoming, id: '66666666-6666-4666-8666-666666666666' });
  let admissions = 0;
  await page.route('**/profile-sync*', route => json(route, { schemaVersion: 2, resetRequired: false, ...TEST_SCOPES, generation: state.profileGeneration, profiles: [{ actorId: TEST_ACTOR_ID, nickname: '테스트 팬', role: 'FAN', avatar: null }, { actorId: streamerId, nickname: '테스트 스트리머', role: 'STREAMER', avatar: null, providerAvatarAvailable: true }], nextCursor: null, complete: true }));
  await page.route('**/provider-avatar/access', route => {
    if (route.request().method() === 'OPTIONS') return json(route, null, 204);
    admissions++;
    expect(route.request().headers()['x-csrf-token']).toBe(MEDIA_CSRF);
    expect(route.request().postDataJSON()).toEqual({});
    return json(route, { url: 'https://api.qa.rogi.chat/v1/profile-images?ticket=' + 'A'.repeat(64), expiresIn: 60 });
  });
  await page.route('**/v1/profile-images?*', route => {
    expect(route.request().headers()['x-csrf-token']).toBeUndefined();
    expect(route.request().headers().cookie).toBeUndefined();
    expect(route.request().headers().referer).toBeUndefined();
    return route.fulfill({ status: 200, headers: { 'Content-Type': providerImage.type, 'Access-Control-Allow-Origin': '*' }, body: providerImage.bytes });
  });
  await page.goto('/chat');
  const images = page.getByRole('img', { name: '참여자 프로필 사진' });
  await expect(images).toHaveCount(2);
  await expect(images.first()).toHaveAttribute('src', /^blob:/);
  await expect.poll(() => images.first().evaluate(img => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  expect(await images.first().evaluate(async img => (await (await fetch((img as HTMLImageElement).src)).blob()).type)).toBe(providerImage.type);
  expect(admissions).toBe(1);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  await expect(images).toHaveCount(0);
});
}


test('fan enters the real ready catalog before any owner exists and persists an owner-inbox send across reload', async ({ page }) => {
  const { account, state } = await chatApi(page); account.joined = false;
  state.ownerPresent = false; state.recipients = []; state.messages = [];
  await page.route('**/v1/rooms', route => json(route, { rooms: [{ roomId: TEST_ROOM_ID, name: '후로기', mode: 'FAN', joined: account.joined, isDefault: true, availability: 'READY' }], next: null }));
  await page.goto('/');
  await page.getByRole('region', { name: '후로기 기본 채팅방' }).getByRole('link', { name: '채팅방 확인' }).click();
  expect(account.joined).toBe(false);
  await page.getByRole('button', { name: '채팅방 입장', exact: true }).click();
  await expect(page.getByTestId('chat-room')).toBeVisible();
  await expect(page.getByText('아직 메시지가 없습니다. 첫 메시지를 보내면 여기에 표시됩니다.')).toBeVisible();
  const input = page.getByTestId('chat-composer-input');
  await input.fill('방장이 가입하기 전 보관할 메시지'); await input.press('Enter');
  await expect(input).toHaveValue('');
  expect(state.posts).toHaveLength(1);
  expect(state.posts[0]).toMatchObject({ intent: 'ROOM_OWNER', content: { type: 'TEXT', text: '방장이 가입하기 전 보관할 메시지' } });
  expect(state.posts[0]).not.toHaveProperty('recipientActorId');
  expect(state.posts[0]).not.toHaveProperty('quoteId');
  await expect(page.getByText('방장이 가입하기 전 보관할 메시지', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('방장이 가입하기 전 보관할 메시지', { exact: true })).toBeVisible();
  expect(account.joined).toBe(true); expect(state.posts).toHaveLength(1);
  await page.goto('/settings');
  await expect(page.getByTestId('settings-room-membership')).toHaveText('참여 중');
});
