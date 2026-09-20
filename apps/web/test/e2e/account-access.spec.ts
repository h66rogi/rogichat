import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installApi, json, TEST_PARTITION, TEST_ROOM_ID } from './api-fixture';

test('password login confirms a real server session while reviewer SOOP linkage remains absent', async ({ page }) => {
  const state = await installApi(page);
  const session = () => ({ authenticated: true, accountPartition: TEST_PARTITION, csrfToken: state.sessionToken, soopLinkStatus: 'REQUIRED', onboardingState: 'READY', capabilities: { chat: true } });
  await page.route('**/v1/auth/session', route => json(route, state.authenticated ? session() : {}, state.authenticated ? 200 : 401));
  let attempts = 0;
  await page.route('**/v1/auth/password/login', async route => {
    attempts++;
    expect(route.request().postDataJSON()).toEqual({ clientId: 'web', loginId: 'synthetic-reviewer', password: 'isolated-test-password', termsVersion: '2026-09-20' });
    expect(route.request().headers()['x-csrf-token']).toBeUndefined();
    if (attempts === 1) { await json(route, { error: { code: 'AUTH_FAILED' } }, 401); return; }
    state.authenticated = true; await json(route, session());
  });
  await page.goto('/login');
  await page.getByText('아이디·비밀번호로 로그인', { exact: true }).click();
  await page.getByLabel('아이디', { exact: true }).fill('synthetic-reviewer');
  await page.getByLabel('비밀번호', { exact: true }).fill('isolated-test-password');
  await page.locator('input[name="terms"]').check();
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await page.getByRole('button', { name: '아이디로 로그인' }).click();
  await expect(page.locator('form [role="alert"]')).toHaveText('아이디 또는 비밀번호를 확인해 주세요.');
  await expect(page.getByLabel('비밀번호', { exact: true })).toHaveValue('');
  await page.getByLabel('비밀번호', { exact: true }).fill('isolated-test-password');
  await page.getByRole('button', { name: '아이디로 로그인' }).click();
  await expect(page.getByRole('heading', { name: '로그인되어 있어요' })).toBeVisible();
  await page.goto('/settings');
  await expect(page.getByTestId('settings-view')).toBeVisible();
  await expect(page.getByRole('button', { name: 'SOOP 계정 연결', exact: true })).toBeEnabled();
  await expect(page.getByRole('link', { name: '관리자 페이지' })).toHaveCount(0);
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).not.toContain('isolated-test-password');
  await page.reload(); await expect(page.getByTestId('settings-view')).toBeVisible();
});

test('ordinary account cannot display administrator controls even at direct route', async ({ page }) => {
  await installApi(page, true);
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: '관리자 권한이 필요합니다' })).toBeVisible();
  await expect(page.getByRole('button', { name: '내 계정에 임시 권한 발급' })).toHaveCount(0);
});

test('administrator must explicitly join the actual room before requesting a grant', async ({ page }) => {
  await installApi(page, true);
  await page.route('**/v1/me/capabilities', route => json(route, { chat: true, admin: { enabled: true, manageTestAccess: true, manageReviewers: false }, password: { enabled: false } }));
  let grants = 0;
  page.on('request', request => { if (request.url().includes('/test-grants')) grants++; });
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: '채팅방에 먼저 참여해 주세요' })).toBeVisible();
  await expect(page.getByRole('link', { name: '채팅방 참여하기' })).toHaveAttribute('href', '/chat');
  expect(grants).toBe(0);
});

test('admin grant uses server state, original requestId on ambiguity, revoke and page restoration authorization', async ({ page }) => {
  const state = await installApi(page, true);
  state.joined = true;
  let allowed = true;
  await page.route('**/v1/me/capabilities', route => json(route, { chat: true, admin: { enabled: allowed, manageTestAccess: allowed, manageReviewers: false }, password: { enabled: false } }));
  const grantId = '44444444-4444-4444-8444-444444444444';
  const expiresAt = new Date(Date.now() + 900000).toISOString();
  let grant: { grantId: string; roomId: string; expiresAt: string; revokedAt: string | null; createdAt: string } | null = null;
  const commands: unknown[] = [];
  await page.route(`**/v1/rooms/${TEST_ROOM_ID}/capabilities`, route => json(route, { effectiveRole: grant && !grant.revokedAt ? 'STREAMER' : 'FAN', canSendShared: !!grant && !grant.revokedAt, canSendToOwner: !grant || !!grant.revokedAt, canReadFanInbox: !!grant && !grant.revokedAt, canPublish: !!grant && !grant.revokedAt, canModerate: !!grant && !grant.revokedAt, temporaryStreamer: grant && !grant.revokedAt ? { grantId, expiresAt } : null }));
  await page.route(`**/v1/admin/rooms/${TEST_ROOM_ID}/test-grants`, async route => {
    if (route.request().method() === 'POST') {
      expect(route.request().headers()['x-csrf-token']).toBe(state.sessionToken);
      commands.push(route.request().postDataJSON());
      grant = { grantId, roomId: TEST_ROOM_ID, expiresAt, revokedAt: null, createdAt: new Date().toISOString() };
      if (commands.length === 1) { await json(route, {}, 503); return; }
      await json(route, { grantId, roomId: TEST_ROOM_ID, expiresAt, revokedAt: null }, 201); return;
    }
    await json(route, { grants: grant ? [grant] : [], next: null });
  });
  await page.route(`**/v1/admin/rooms/${TEST_ROOM_ID}/test-grants/${grantId}/revoke`, async route => {
    expect(route.request().headers()['x-csrf-token']).toBe(state.sessionToken);
    grant!.revokedAt = new Date().toISOString(); await json(route, null, 204);
  });
  await page.goto('/settings');
  await page.getByRole('link', { name: '관리자 페이지' }).click();
  await expect(page.getByText('발급된 임시 권한이 없습니다.')).toBeVisible();
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await page.getByLabel('발급 사유').fill('격리 자동 테스트');
  await page.getByRole('button', { name: '내 계정에 임시 권한 발급' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByRole('button', { name: '동일 요청 다시 확인' }).click();
  await expect(page.getByText('현재 역할: 스트리머', { exact: true })).toBeVisible();
  expect(commands).toHaveLength(2); expect(commands[0]).toEqual(commands[1]);
  await page.getByRole('button', { name: '권한 회수', exact: true }).click();
  await expect(page.getByText('현재 역할: 팬', { exact: true })).toBeVisible();
  await expect(page.getByText('회수됨', { exact: true })).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  await expect(page.getByRole('heading', { name: '관리자 페이지', exact: true })).toHaveCount(0);
  allowed = false;
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await expect(page.getByRole('heading', { name: '관리자 권한이 필요합니다' })).toBeVisible();
});
