import { expect, test, type Page, type WebSocketRoute } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installApi, json, TEST_ACTOR_ID, TEST_ROOM_ID } from './api-fixture';

// All synthetic payloads live in test code, behind interception of the real API paths.
const streamerId = '44444444-4444-4444-8444-444444444444';
const incoming = { id: '55555555-5555-4555-8555-555555555555', version: '1', createdAt: '2026-09-20T01:00:00.000Z', audience: 'PRIVATE', author: { kind: 'member', actorId: streamerId, nickname: '테스트 스트리머', avatar: null }, content: { type: 'TEXT', text: '실제 계약 형식의 개인 메시지' }, quote: null };
async function chatApi(page: Page) {
  const account = await installApi(page, true); account.joined = true;
  const state = { messages: [incoming], failSnapshot: false, revoked: false, canSend: true, posts: [] as Record<string, unknown>[], failSend: false, holdSend: null as Promise<void> | null, sockets: [] as WebSocketRoute[] };
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
    if (path.endsWith('/private-recipients')) { await json(route, { recipients: state.canSend ? [{ actorId: streamerId, nickname: '테스트 스트리머', avatar: null }] : [], next: null }); return; }
    if (path.endsWith('/snapshot')) { await json(route, { ...envelope, messages: state.messages, nextCursor: 'test-events', historyCursor: null }, state.failSnapshot ? 503 : 200); return; }
    if (path.endsWith('/events')) { await json(route, { ...envelope, events: state.messages.map(message => ({ type: 'message.upsert', message })), hasMore: false, nextCursor: 'test-events' }); return; }
    if (path.endsWith('/messages')) {
      expect(route.request().headers()['x-csrf-token']).toBe(account.sessionToken);
      const body = route.request().postDataJSON() as Record<string, unknown>; state.posts.push(body);
      if (state.holdSend) await state.holdSend;
      if (state.failSend) { await json(route, {}, 503); return; }
      const sent = { ...incoming, id: '66666666-6666-4666-8666-666666666666', author: { ...incoming.author, actorId: TEST_ACTOR_ID, nickname: '테스트 팬' }, content: body.content as { type: string; text: string } };
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
