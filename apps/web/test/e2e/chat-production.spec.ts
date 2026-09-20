import { expect, test, type Page, type WebSocketRoute } from '@playwright/test';
import type { ServerMessage } from '../../src/features/chat/contract';
import AxeBuilder from '@axe-core/playwright';
import { installApi, json, TEST_ACTOR_ID, TEST_ROOM_ID } from './api-fixture';

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
