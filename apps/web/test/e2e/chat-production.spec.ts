import { expect, test, type Page, type WebSocketRoute } from '@playwright/test';
import type { ServerMessage } from '../../src/features/chat/contract';
import AxeBuilder from '@axe-core/playwright';
import { installApi, json, TEST_ACTOR_ID, TEST_ROOM_ID } from './api-fixture';
import { installMedia, MEDIA_ASSET, MEDIA_CSRF, TEST_IMAGE } from './media-fixture';

// All synthetic payloads live in test code, behind interception of the real API paths.
const streamerId = '44444444-4444-4444-8444-444444444444';
const incoming = { id: '55555555-5555-4555-8555-555555555555', version: '1', createdAt: '2026-09-20T01:00:00.000Z', audience: 'PRIVATE' as const, author: { kind: 'member' as const, actorId: streamerId, nickname: '테스트 스트리머', avatar: null }, content: { type: 'TEXT' as const, text: '실제 계약 형식의 개인 메시지' }, quote: null };
async function chatApi(page: Page) {
  const account = await installApi(page, true); account.joined = true;
  const state = { messages: [incoming] as ServerMessage[], recipients: [{ actorId: streamerId, nickname: '테스트 스트리머', avatar: null }], deletedIds: [] as string[], deleteCalls: 0, failDelete: false, holdDelete: null as Promise<void> | null, failSnapshot: false, revoked: false, canSend: true, posts: [] as Record<string, unknown>[], failSend: false, holdSend: null as Promise<void> | null, sockets: [] as WebSocketRoute[] };
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
    const envelope = { schemaVersion: 1, resetRequired: false };
    if (path === '/v1/sync') { await json(route, { ...envelope, generation: 'test-membership', rooms: [{ roomId: TEST_ROOM_ID, name: '후로기', actorId: TEST_ACTOR_ID, mode: 'FAN', role: 'FAN' }], nextCursor: null, complete: true }); return; }
    if (path.endsWith('/profile-sync')) { await json(route, { ...envelope, generation: 'test-profiles', profiles: [{ actorId: TEST_ACTOR_ID, nickname: '테스트 팬', role: 'FAN', avatar: null }, { actorId: streamerId, nickname: '테스트 스트리머', role: 'STREAMER', avatar: null }], nextCursor: null, complete: true }); return; }
    if (path.endsWith('/private-recipients')) { await json(route, { recipients: state.canSend ? state.recipients : [], next: null }); return; }
    if (path.endsWith('/snapshot')) { await json(route, { ...envelope, messages: state.messages, nextCursor: 'test-events', historyCursor: null }, state.failSnapshot ? 503 : 200); return; }
    if (path.endsWith('/events')) { await json(route, { ...envelope, events: [...state.deletedIds.map(messageId => ({ type: 'message.deleted', messageId, version: '2' })), ...state.messages.map(message => ({ type: 'message.upsert', message }))], hasMore: false, nextCursor: 'test-events' }); return; }
    if (path.endsWith('/delete')) {
      state.deleteCalls++; expect(route.request().headers()['x-csrf-token']).toBe(account.sessionToken);
      expect(route.request().postDataJSON()).toEqual({});
      if (state.holdDelete) await state.holdDelete;
      if (state.failDelete) { await json(route, {}, 503); return; }
      const id = path.split('/').at(-2);
      state.messages = state.messages.filter(message => message.id !== id).map(message => message.quote?.id === id ? { ...message, quote: null } : message);
      await json(route, { requestId: 'test-delete-request', status: 'blocked' }); return;
    }
    if (path.endsWith('/messages')) {
      expect(route.request().headers()['x-csrf-token']).toBe(account.sessionToken);
      const body = route.request().postDataJSON() as Record<string, unknown>; state.posts.push(body);
      if (state.holdSend) await state.holdSend;
      if (state.failSend) { await json(route, {}, 503); return; }
      const sent = { ...incoming, id: '66666666-6666-4666-8666-666666666666', author: { ...incoming.author, actorId: TEST_ACTOR_ID, nickname: '테스트 팬' }, content: body.content as { type: 'TEXT'; text: string } };
      state.messages = [...state.messages, sent];
      await json(route, { clientMessageId: body.clientMessageId, messageId: sent.id, status: 'committed', version: '1' }); return;
    }
    await route.fallback();
  });
  return { account, state, hint: () => { for (const socket of state.sockets) socket.send('42["sync.required",{"schemaVersion":1}]'); } };
}

test('READY photo retries the same command, preserves text draft and clears bytes on deletion', async ({ page }) => {
  const { account, state, hint } = await chatApi(page); account.sessionToken = MEDIA_CSRF;
  const media = await installMedia(page); let fail = true;
  const savedId = '66666666-6666-4666-8666-666666666666';
  await page.route(`**/v1/rooms/${TEST_ROOM_ID}/messages`, async route => {
    if (route.request().method() === 'OPTIONS') return json(route, null, 204);
    const body = route.request().postDataJSON() as Record<string, unknown>; state.posts.push(body);
    if (fail) return json(route, {}, 503);
    state.messages.push({ ...incoming, id: savedId, author: { kind: 'member', actorId: TEST_ACTOR_ID, nickname: '테스트 팬' }, content: { type: 'PHOTO', attachments: [{ assetId: MEDIA_ASSET, width: 1, height: 1, variant: 'image' }] } });
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
  await expect(page.getByRole('alert').filter({ hasText: '전송을 확인하지 못했습니다' })).toBeVisible();
  fail = false; await page.getByRole('button', { name: '사진 보내기', exact: true }).click();
  const image = page.getByRole('img', { name: '대화 사진 1' });
  await expect(image).toBeVisible();
  await expect(page.getByTestId('chat-composer-input')).toHaveValue('별도로 보낼 글');
  expect(state.posts).toHaveLength(2); expect(state.posts[0]).toEqual(state.posts[1]);
  expect(state.posts[0]).toMatchObject({ intent: 'PRIVATE', recipientActorId: streamerId, content: { type: 'PHOTO', assetIds: [MEDIA_ASSET] } });
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
  await expect(page.getByTestId('chat-composer-error')).toContainText('전송을 확인하지 못했습니다');
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

test('visible profile without send grant locks composer and access change purges private text', async ({ page }) => {
  const { state, hint } = await chatApi(page); state.canSend = false;
  await page.goto('/chat'); await expect(page.getByText(incoming.content.text, { exact: true })).toBeVisible();
  await expect(page.getByTestId('chat-composer-input')).toHaveCount(0);
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
  const own = { ...incoming, id: '77777777-7777-4777-8777-777777777777', author: { ...incoming.author, actorId: TEST_ACTOR_ID }, content: { type: 'TEXT' as const, text: '삭제할 내 메시지' } };
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


test('multiple permitted streamers require explicit target selection and send to that actor only', async ({ page }) => {
  const { state } = await chatApi(page);
  const second = { actorId: '88888888-8888-4888-8888-888888888888', nickname: '두 번째 스트리머', avatar: null };
  state.recipients.push(second);
  await page.goto('/chat');
  await expect(page.getByRole('radio')).toHaveCount(2);
  await expect(page.getByTestId('chat-composer-input')).toHaveCount(0);
  await expect(page.getByText('메시지를 보낼 대상을 선택해 주세요.', { exact: true })).toBeVisible();
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
  await expect(page.getByTestId('chat-composer-error')).toContainText('전송을 확인하지 못했습니다');
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
  await expect(input).toHaveCount(0); // Fresh epoch requires explicit target selection.
  await page.getByRole('radio', { name: '테스트 스트리머님에게만', exact: true }).click();
  await expect(input).toHaveValue(''); await expect(page.getByTestId('chat-quote-preview')).toHaveCount(0);
  await page.getByRole('radio', { name: '두 번째 스트리머님에게만', exact: true }).click();
  await expect(input).toHaveValue(''); await expect(page.getByTestId('chat-quote-preview')).toHaveCount(0);
  state.deletedIds = []; state.failSend = false;
  await input.fill('결과 미확인 메시지'); await input.press('Enter'); await expect(input).toHaveValue('');
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
  state.messages = [{ ...incoming, audience: 'SHARED', author: { kind: 'anonymous' } }];
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
  await expect(page.getByText('전송을 확인하지 못했습니다. 같은 내용으로 다시 보내면 중복 없이 재확인합니다.')).toBeVisible();
  fail = false; await page.getByRole('button', { name: '스티커 보내기', exact: true }).click();
  await expect(page.getByRole('button', { name: '스티커 보내기', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('chat-composer-input')).toHaveValue('별도 글');
  expect(state.posts).toHaveLength(2); expect(state.posts[0]).toEqual(state.posts[1]);
  expect(state.posts[0]?.content).toEqual({ type: 'STICKER', stickerId });
  expect(media.accesses).toContainEqual({ variant: 'image', roomId: TEST_ROOM_ID, stickerId });
});
