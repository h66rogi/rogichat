/** Isolated API interception around actual product mounts; no fixture routes. */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import type { ServerMessage } from '../../src/features/chat/contract';
import { installApi, json, TEST_ACTOR_ID, TEST_PARTITION, TEST_ROOM_ID, TEST_SCOPES } from './api-fixture';

const csrf = 'A'.repeat(43);
const requestId = '77777777-7777-4777-8777-777777777777';
const sourceId = '55555555-5555-4555-8555-555555555555';
const publicationId = '66666666-6666-4666-8666-666666666666';
const fanId = '44444444-4444-4444-8444-444444444444';
async function deletionApi(page: Page) {
  const account = await installApi(page, true); account.sessionToken = csrf;
  const state = { deletes: 0, status: 200, code: 'RECENT_AUTH_REQUIRED', lost: false, partition: TEST_PARTITION, starts: 0 };
  await page.route('**/v1/auth/session', route => json(route, { authenticated: true, accountPartition: state.partition, csrfToken: account.sessionToken, soopLinkStatus: 'VERIFIED', onboardingState: 'READY', capabilities: { chat: true } }));
  await page.route('**/v1/me/account', async route => {
    if (route.request().method() === 'OPTIONS') return json(route, null, 204);
    state.deletes++; expect(route.request().method()).toBe('DELETE'); expect(route.request().postDataJSON()).toEqual({});
    expect(route.request().headers()['x-csrf-token']).toBe(account.sessionToken);
    if (state.lost) return route.abort('failed');
    return json(route, state.status === 200 ? { requestId, status: 'blocked' } : { error: { code: state.code } }, state.status);
  });
  await page.route('**/v1/auth/soop/start', async route => {
    if (route.request().method() === 'OPTIONS') return json(route, null, 204);
    state.starts++; expect(route.request().postDataJSON()).toEqual({ intent: 'login', termsVersion: '2026-09-20' });
    return json(route, { authorizeUrl: 'https://example.invalid/privacy-auth' });
  });
  return { account, state };
}
async function confirmDeletion(page: Page) {
  await page.getByLabel('계정 접근 차단과 삭제 요청 내용을 이해하고 탈퇴를 요청합니다.').check();
  await page.getByRole('button', { name: '계정 탈퇴 요청', exact: true }).click();
}

test('account deletion requires disclosure and only blocked receipt hides private settings', async ({ page }) => {
  const { state } = await deletionApi(page); await page.goto('/settings');
  await expect(page.getByRole('button', { name: '계정 탈퇴 요청', exact: true })).toBeDisabled(); expect(state.deletes).toBe(0);
  await confirmDeletion(page);
  await expect(page.getByText('탈퇴 요청이 접수되어 계정 접근이 차단되었습니다. 데이터의 물리 삭제가 완료되었다는 뜻은 아닙니다.')).toBeVisible();
  await expect(page.getByTestId('settings-view')).toHaveCount(0); expect(state.deletes).toBe(1);
  await page.reload(); await expect(page.getByRole('heading', { name: '계정 탈퇴 요청 확인' })).toBeVisible(); expect(state.deletes).toBe(1);
  const persisted = await page.evaluate(() => localStorage.getItem('rogichat.account-deletion.v1'));
  expect(persisted).not.toContain(csrf); expect(persisted).not.toContain(TEST_PARTITION); expect(persisted).not.toContain(requestId);
  const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(audit.violations.filter(value => ['critical', 'serious'].includes(value.impact ?? ''))).toEqual([]);
});

test('lost deletion ACK survives reload as uncertain without automatic retry', async ({ page }) => {
  const { state } = await deletionApi(page); state.lost = true; await page.goto('/settings'); await confirmDeletion(page);
  await expect(page.getByRole('heading', { name: '계정 탈퇴 요청 확인' })).toBeVisible();
  await expect(page.getByText(/이전 탈퇴 요청의 취소나 실패를 뜻하지 않습니다/)).toBeVisible();
  await page.reload(); await expect(page.getByRole('heading', { name: '계정 탈퇴 요청 확인' })).toBeVisible();
  expect(state.deletes).toBe(1); await expect(page.getByText(/계정 접근이 차단되었습니다/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: '탈퇴 다시 요청', exact: true })).toBeDisabled();
});

test('recent auth keeps same account binding and requires explicit retry after login', async ({ page }) => {
  const { state, account } = await deletionApi(page); state.status = 403;
  await page.goto('/settings'); await confirmDeletion(page);
  await expect(page.getByText(/최근 15분 이내 인증이 필요합니다/)).toBeVisible();
  await expect(page.getByRole('button', { name: '같은 SOOP 계정으로 다시 로그인' })).toBeDisabled();
  // Intercept the external provider only inside this test, then visit the real settings route.
  const returnTo = new URL('/settings', page.url()).href;
  await page.route('https://example.invalid/privacy-auth', route => {
    account.sessionToken = 'B'.repeat(42) + 'A'; state.status = 200;
    return route.fulfill({ status: 302, headers: { location: returnTo } });
  });
  await page.getByLabel(/같은 SOOP 계정으로 로그인합니다/).check();
  await page.getByRole('button', { name: '같은 SOOP 계정으로 다시 로그인' }).click();
  await expect(page.getByText(/같은 계정의 로그인 상태를 확인했습니다/)).toBeVisible(); expect(state.starts).toBe(1);
  expect(state.deletes).toBe(1);
  await page.getByLabel('이전 요청이 접수되었을 수 있음을 이해하며 같은 계정의 탈퇴를 다시 요청합니다.').check();
  await page.getByRole('button', { name: '탈퇴 다시 요청', exact: true }).click();
  await expect(page.getByText(/계정 접근이 차단되었습니다/)).toBeVisible(); expect(state.deletes).toBe(2);
});

test('different-account reauthentication never deletes the replacement account', async ({ page }) => {
  const { state, account } = await deletionApi(page); state.status = 403;
  await page.goto('/settings'); await confirmDeletion(page); await expect(page.getByText(/최근 15분 이내 인증이 필요합니다/)).toBeVisible();
  state.partition = 'D'.repeat(42) + 'A'; account.sessionToken = 'B'.repeat(42) + 'A'; await page.reload();
  await expect(page.getByText(/탈퇴를 요청한 계정과 현재 로그인 계정이 다르거나/)).toBeVisible();
  await expect(page.getByRole('button', { name: '탈퇴 다시 요청', exact: true })).toHaveCount(0); expect(state.deletes).toBe(1);
});

async function privacyChat(page: Page) {
  const account = await installApi(page, true); account.sessionToken = csrf; account.joined = true;
  const source: ServerMessage = { id: sourceId, version: '1', createdAt: '2026-09-20T01:00:00.000Z', audience: 'PRIVATE', author: { kind: 'member', actorId: fanId, nickname: '격리 테스트 팬', avatar: null }, content: { type: 'TEXT', text: '공개 전 개인 메시지' }, quote: null, counterpart: { actorId: fanId }, allowedActions: { reply: true, publish: true, delete: false } };
  const state = { publication: 'preparing' as 'preparing' | 'published' | 'revoked', unknown: false, writes: 0, reads: 0, snapshots: 0, syncReads: 0, reports: 0, reportLost: false, reportKey: '', blocked: false, blockDisplayName: '현재 차단 표시 이름' as string | null, blockReadStatus: 200, sessionStatus: 200, revision: TEST_SCOPES.authorizationRevision, messages: [source] };
  await page.routeWebSocket('**/v1/realtime/**', socket => {
    socket.send('0' + JSON.stringify({ sid: 'privacy-isolated-engine', upgrades: [], pingInterval: 25000, pingTimeout: 20000, maxPayload: 1024 }));
    socket.onMessage(packet => { if (typeof packet === 'string' && packet.startsWith('40')) socket.send('40' + JSON.stringify({ sid: 'privacy-isolated-socket' })); });
  });
  await page.route('https://api.qa.rogi.chat/v1/**', async route => {
    const path = new URL(route.request().url()).pathname; const method = route.request().method();
    if (method === 'OPTIONS') return json(route, null, 204);
    if (path === '/v1/auth/session' && state.sessionStatus !== 200) return json(route, {}, state.sessionStatus);
    const scopes = { ...TEST_SCOPES, authorizationRevision: state.revision };
    const envelope = { schemaVersion: 2, resetRequired: false, ...scopes };
    if (path === '/v1/sync') return json(route, { schemaVersion: 2, resetRequired: false, generation: `privacy-membership-${state.revision}`, rooms: [{ roomId: TEST_ROOM_ID, name: '후로기', actorId: TEST_ACTOR_ID, mode: 'FAN', role: 'STREAMER', ...scopes }], nextCursor: null, complete: true });
    if (path.endsWith('/profile-sync')) return json(route, { ...envelope, generation: 'privacy-profiles', profiles: [{ actorId: TEST_ACTOR_ID, nickname: '격리 스트리머', role: 'STREAMER', avatar: null }, { actorId: fanId, nickname: '격리 테스트 팬', role: 'FAN', avatar: null }], nextCursor: null, complete: true });
    if (path.endsWith('/private-recipients')) return json(route, { recipients: [{ actorId: fanId, nickname: '격리 테스트 팬', avatar: null }], next: null });
    if (path.endsWith('/snapshot')) { state.snapshots++; state.syncReads++; return json(route, { ...envelope, messages: state.messages, nextCursor: 'privacy-events', historyCursor: null }); }
    if (path.endsWith('/events')) { state.syncReads++; return json(route, { ...envelope, events: state.messages.map(message => ({ type: 'message.upsert', message })), hasMore: false, nextCursor: 'privacy-events' }); }
    if (path.endsWith(`/messages/${sourceId}/publications`)) { state.writes++; expect(method).toBe('POST'); expect(route.request().postDataJSON()).toEqual({}); return json(route, { publicationId, status: 'preparing' }, 202); }
    if (path.endsWith(`/publications/${publicationId}`)) { state.reads++; return json(route, state.unknown ? {} : { publicationId, status: state.publication, ...(state.publication === 'published' ? { messageId: requestId } : {}) }, state.unknown ? 404 : 200); }
    if (path.endsWith(`/messages/${sourceId}/reports`)) { state.reports++; state.reportKey = (route.request().postDataJSON() as { idempotencyKey: string }).idempotencyKey; if (state.reportLost) return route.abort('failed'); return json(route, { reportId: requestId, status: 'received', createdAt: '2026-09-20T00:00:00.000Z' }); }
    if (path === `/v1/report-receipts/${state.reportKey}`) return json(route, { reportId: requestId, status: 'received', createdAt: '2026-09-20T00:00:00.000Z' });
    if (path.endsWith(`/blocks/${fanId}`)) { state.blocked = method === 'PUT'; state.revision = (state.blocked ? 'D' : 'E').repeat(42) + 'A'; return json(route, { actorId: fanId, blocked: state.blocked, resetRequired: true }); }
    if (path === '/v1/blocked-rooms') return json(route, { rooms: state.blocked ? [{ roomId: TEST_ROOM_ID, displayName: '현재 차단 방' }] : [], nextCursor: null });
    if (path.endsWith('/blocks') && state.blockReadStatus !== 200) return json(route, {}, state.blockReadStatus);
    if (path.endsWith('/blocks')) return json(route, { blocks: state.blocked ? [{ actorId: fanId, blockedAt: '2026-09-20T00:00:00.000Z', displayName: state.blockDisplayName }] : [], next: null });
    return route.fallback();
  });
  return state;
}

async function openOwnedBlocks(page: Page) {
  await page.getByRole('button', { name: '차단한 방 찾기', exact: true }).click();
  await page.getByRole('button', { name: '차단 목록 열기: 현재 차단 방', exact: true }).click();
  await page.getByRole('button', { name: '차단 목록 확인', exact: true }).click();
}

async function openPrivacyActions(page: Page) {
  await page.getByTestId('chat-message-options').first().click();
}

test('PRIVATE TEXT publication requires disclosure, 202 is preparing and published refreshes sync', async ({ page }) => {
  const state = await privacyChat(page); await page.goto('/chat');
  await openPrivacyActions(page);
  const publish = page.getByRole('button', { name: '익명으로 전체 공개' }); await expect(publish).toBeDisabled();
  await page.getByLabel('이 메시지의 방 전체 공개 범위를 확인했습니다.').check(); await publish.click();
  await expect(page.getByText('공개 준비 중입니다. 아직 공개 완료가 아닙니다.')).toBeVisible(); expect(state.writes).toBe(1);
  const before = state.syncReads; state.publication = 'published';
  await page.getByRole('button', { name: '공개 상태 다시 확인' }).click();
  await expect.poll(() => state.syncReads).toBeGreaterThan(before); expect(state.writes).toBe(1);
  await expect(page.getByText('공개 전 개인 메시지', { exact: true })).toHaveCount(1);
});

test('publication ambiguous 404 does not repost and revoked receipt is explicit', async ({ page }) => {
  const state = await privacyChat(page); await page.goto('/chat');
  await openPrivacyActions(page);
  await page.getByLabel('이 메시지의 방 전체 공개 범위를 확인했습니다.').check(); await page.getByRole('button', { name: '익명으로 전체 공개' }).click();
  state.unknown = true; await page.getByRole('button', { name: '공개 상태 다시 확인' }).click();
  await expect(page.getByText('공개 결과를 확인하지 못했습니다. 요청을 자동으로 다시 보내지 않습니다.')).toBeVisible(); expect(state.writes).toBe(1);
  state.unknown = false; state.publication = 'revoked'; await page.getByRole('button', { name: '공개 상태 다시 확인' }).click();
  await expect(page.getByText('공개가 철회되었습니다.')).toBeVisible(); expect(state.writes).toBe(1);
});

test('report lost ACK recovers stored receipt without re-sending after settings reload', async ({ page }) => {
  const state = await privacyChat(page); state.reportLost = true; await page.goto('/chat');
  await openPrivacyActions(page);
  await page.getByText('메시지 신고', { exact: true }).click();
  await page.getByLabel('상세 내용 (선택, 최대 1,000자)').fill('격리 테스트 상세 내용');
  await page.getByLabel('선택한 사유와 내용을 신고로 제출합니다.').check(); await page.getByRole('button', { name: '신고 제출', exact: true }).click();
  await expect(page.getByText('신고 접수 여부를 확인하지 못했습니다. 접수 상태를 다시 확인해 주세요.')).toBeVisible();
  await page.goto('/settings'); await expect(page.getByText('신고가 저장되었습니다. 담당자의 확인이나 연락이 시작되었다는 뜻은 아닙니다.')).toBeVisible(); expect(state.reports).toBe(1);
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).not.toContain('격리 테스트 상세 내용');
});

test('visible actor block requires confirmation and settings can explicitly unblock', async ({ page }) => {
  const state = await privacyChat(page); await page.goto('/chat');
  await openPrivacyActions(page);
  await page.getByText('이 사용자 차단', { exact: true }).click();
  await expect(page.getByRole('button', { name: '사용자 차단', exact: true })).toBeDisabled();
  await page.getByLabel('이 방에서 해당 사용자를 차단합니다.').check();
  await page.getByRole('button', { name: '사용자 차단', exact: true }).click(); await expect.poll(() => state.blocked).toBe(true);
  await page.goto('/settings'); await openOwnedBlocks(page);
  await expect(page.getByText(/현재 차단 표시 이름 · 차단 항목/)).toBeVisible();
  await page.getByRole('button', { name: '차단 항목 1 해제', exact: true }).click();
  expect(state.blocked).toBe(true); await page.getByRole('button', { name: '차단 해제 확인', exact: true }).click();
  await expect.poll(() => state.blocked).toBe(false);
});

test('report predispatch failure has an actionable read-only recovery button', async ({ page }) => {
  const state = await privacyChat(page); await page.goto('/chat');
  await openPrivacyActions(page);
  await page.getByText('메시지 신고', { exact: true }).click();
  await page.getByLabel('선택한 사유와 내용을 신고로 제출합니다.').check(); state.sessionStatus = 503;
  await page.getByRole('button', { name: '신고 제출', exact: true }).click();
  await expect(page.getByText('신고 복구 상태를 저장하거나 로그인 상태를 확인할 수 없습니다. 다시 확인해 주세요.')).toBeVisible();
  state.sessionStatus = 200; await page.getByRole('button', { name: '신고 접수 확인', exact: true }).click();
  await expect(page.getByRole('button', { name: '신고 제출', exact: true })).toBeDisabled(); expect(state.reports).toBe(0);
});


test('unlinked authenticated settings permits deletion without a fabricated profile', async ({ page }) => {
  const { state, account } = await deletionApi(page);
  let profileReads = 0;
  await page.route('**/v1/auth/session', route => json(route, { authenticated: true, accountPartition: state.partition, csrfToken: account.sessionToken, soopLinkStatus: 'REQUIRED' }));
  await page.route('**/v1/me/profile', route => { profileReads++; return json(route, {}, 403); });
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'SOOP 계정 연결이 필요해요' })).toBeVisible();
  await confirmDeletion(page);
  await expect(page.getByText('탈퇴 요청이 접수되어 계정 접근이 차단되었습니다. 데이터의 물리 삭제가 완료되었다는 뜻은 아닙니다.')).toBeVisible();
  expect(state.deletes).toBe(1); expect(profileReads).toBe(0);
});


test('left room keeps own block recovery and null label never falls back to profile cache', async ({ page }) => {
  const state = await privacyChat(page); state.blocked = true; state.blockDisplayName = null;
  await page.route('**/v1/rooms', route => json(route, { rooms: [], next: null }));
  await page.goto('/settings'); await openOwnedBlocks(page);
  await expect(page.getByText(/표시 이름을 확인할 수 없음 · 차단 항목 1/)).toBeVisible();
  await expect(page.getByText('격리 테스트 팬', { exact: true })).toHaveCount(0);
  await expect(page.getByText(fanId, { exact: false })).toHaveCount(0);
  await page.getByRole('button', { name: '차단 항목 1 해제', exact: true }).click();
  await page.getByRole('button', { name: '차단 해제 확인', exact: true }).click();
  await expect.poll(() => state.blocked).toBe(false);
  await expect(page.getByRole('region', { name: '채팅방 참여', exact: true }).getByText('이용 불가', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '채팅방 나가기', exact: true })).toHaveCount(0);
});


for (const failure of ['authorization', 'list'] as const) test(`block reload clears current labels when ${failure} fails`, async ({ page }) => {
  const state = await privacyChat(page); state.blocked = true;
  await page.goto('/settings'); await openOwnedBlocks(page);
  await expect(page.getByText(/현재 차단 표시 이름 · 차단 항목/)).toBeVisible();
  if (failure === 'authorization') state.sessionStatus = 403;
  else state.blockReadStatus = 503;
  await page.getByRole('button', { name: '차단 목록 확인' }).click();
  await expect(page.getByText('차단 목록을 확인하지 못했습니다. 다시 시도해 주세요.')).toBeVisible();
  await expect(page.getByText(/현재 차단 표시 이름 · 차단 항목/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: '차단 항목 1 해제', exact: true })).toHaveCount(0);
});
