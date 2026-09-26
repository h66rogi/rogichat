import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { installApi, json } from './api-fixture';
test('profile edits use CSRF and are restored from persisted server response', async ({ page }) => {
  const state = await installApi(page, true);
  await page.goto('/settings');
  // Unavailable capabilities remain an explained, disabled control. Opening settings never prompts.
  const notifications = page.getByTestId('settings-notifications-toggle');
  await expect(notifications).toBeVisible();
  await expect(notifications).toBeDisabled();
  await page.getByLabel('닉네임', { exact: true }).fill('저장된 이름');
  await page.getByRole('button', { name: '변경 내용 저장' }).click();
  await expect(page.getByText('프로필을 저장했습니다.')).toBeVisible();
  expect(state.profile.nickname).toBe('저장된 이름');
  await page.reload();
  await expect(page.getByLabel('닉네임', { exact: true })).toHaveValue('저장된 이름');
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).not.toContain('저장된 이름');
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(results.violations.filter(item => ['critical', 'serious'].includes(item.impact ?? ''))).toEqual([]);
});
test('logged-in devices can be reviewed and remotely signed out with keyboard and screen reader labels', async ({ page }) => {
  const state = await installApi(page, true);
  const current = '44444444-4444-4444-8444-444444444444';
  const other = '55555555-5555-4555-8555-555555555555';
  const devices = [
    { id: current, kind: 'web', createdAt: '2026-09-26T10:00:00.000Z', expiresAt: '2026-10-03T10:00:00.000Z', current: true },
    { id: other, kind: 'android', createdAt: '2026-09-25T10:00:00.000Z', expiresAt: '2026-10-02T10:00:00.000Z', current: false },
  ];
  await page.route('https://api.qa.rogi.chat/v1/auth/sessions**', route => {
    if (route.request().method() === 'DELETE') {
      expect(route.request().headers()['x-csrf-token']).toBe(state.sessionToken);
      expect(new URL(route.request().url()).pathname).toBe(`/v1/auth/sessions/${other}`);
      devices.pop();
      return json(route, null, 204);
    }
    return json(route, { sessions: devices, next: null });
  });
  await page.goto('/settings');
  const region = page.getByRole('region', { name: '로그인된 기기' });
  await expect(region.getByText('현재 기기')).toBeVisible();
  const action = region.getByRole('button', { name: 'Android 기기 로그아웃' });
  await action.focus(); await page.keyboard.press('Enter');
  await expect(region.getByRole('button', { name: 'Android 기기 로그아웃 확인' })).toBeVisible();
  await region.getByRole('button', { name: 'Android 기기 로그아웃 확인' }).click();
  await expect(region.getByText('기기에서 로그아웃했어요.')).toBeVisible();
  await expect(action).toHaveCount(0);
  const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(accessibility.violations.filter(item => ['critical', 'serious'].includes(item.impact ?? ''))).toEqual([]);
  await page.setViewportSize({ width: 320, height: 700 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});
test('failed profile save never reports success and preserves input', async ({ page }) => {
  const state = await installApi(page, true);
  await page.goto('/settings');
  await page.getByLabel('닉네임', { exact: true }).fill('아직 저장 안 됨');
  state.profileStatus = 503;
  await page.getByRole('button', { name: '변경 내용 저장' }).click();
  await expect(page.getByText('요청을 완료하지 못했습니다. 다시 시도해 주세요.')).toBeVisible();
  await expect(page.getByLabel('닉네임', { exact: true })).toHaveValue('아직 저장 안 됨');
  await expect(page.getByText('프로필을 저장했습니다.')).toHaveCount(0);
});
test('network failure is visible and retry checks the session again', async ({ page }) => {
  const state = await installApi(page, true); state.sessionStatus = 503;
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: '연결을 확인할 수 없어요' })).toBeVisible();
  await expect(page.getByTestId('settings-view')).toHaveCount(0);
  state.sessionStatus = 200;
  await page.getByRole('button', { name: '다시 확인' }).click();
  await expect(page.getByTestId('settings-view')).toBeVisible();
});
test('empty room directory is an honest unavailable state', async ({ page }) => {
  const state = await installApi(page, true); state.rooms = false;
  await page.goto('/chat');
  await expect(page.getByRole('heading', { name: /지금은 채팅방에 접근할 수 없어요|아직 채팅방이 열리지 않았어요/ })).toBeVisible();
  await expect(page.getByTestId('chat-room')).toHaveCount(0);
});
test('session expiry during room entry returns to the login gate', async ({ page }) => {
  const state = await installApi(page, true);
  await page.goto('/chat');
  await expect(page.getByRole('button', { name: '채팅방 입장', exact: true })).toBeVisible();
  await page.route('**/v1/rooms/*/join', route => {
    state.authenticated = false;
    return json(route, { error: { code: 'UNAUTHENTICATED' } }, 401);
  });
  await page.getByRole('button', { name: '채팅방 입장', exact: true }).click();
  await expect(page.getByRole('heading', { name: '로그인 후 이용할 수 있어요' })).toBeVisible();
  await expect(page.getByRole('button', { name: '채팅방 입장', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('chat-room')).toHaveCount(0);
});
test('logout locks immediately, survives reload, and retries only the same session', async ({ page }) => {
  const state = await installApi(page, true); state.logoutStatus = 503;
  await page.goto('/settings');
  await page.getByRole('button', { name: '로그아웃', exact: true }).click();
  await expect(page.getByTestId('settings-view')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '로그아웃 확인이 필요해요' })).toBeVisible();
  await expect.poll(() => state.logoutCount).toBe(1);
  await page.reload();
  await expect(page.getByRole('heading', { name: '로그아웃 확인이 필요해요' })).toBeVisible();
  state.logoutStatus = 204;
  await page.getByRole('button', { name: '다시 시도' }).click();
  await expect(page.getByRole('heading', { name: '로그인 후 이용할 수 있어요' })).toBeVisible();
  expect(state.logoutCount).toBe(2);
});
test('logout recovery never revokes a different login session', async ({ page }) => {
  const state = await installApi(page, true); state.logoutStatus = 503;
  await page.goto('/settings');
  await page.getByRole('button', { name: '로그아웃', exact: true }).click();
  await expect.poll(() => state.logoutCount).toBe(1);
  state.sessionToken = 'synthetic-csrf-session-B';
  await page.getByRole('button', { name: '다시 시도' }).click();
  await expect(page.getByText(/로그인 상태가 달라졌어요/)).toBeVisible();
  expect(state.logoutCount).toBe(1);
  await page.getByRole('button', { name: '현재 계정으로 계속하기' }).click();
  await expect(page.getByTestId('settings-view')).toBeVisible();
});
test('page restoration discards old private content before fresh authorization', async ({ page }) => {
  const state = await installApi(page, true);
  await page.goto('/settings');
  await expect(page.getByTestId('settings-view')).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  await expect(page.getByTestId('settings-view')).toBeHidden();
  state.authenticated = false;
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await expect(page.getByRole('heading', { name: '로그인 후 이용할 수 있어요' })).toBeVisible();
});
test('SOOP-link required state never fabricates a profile', async ({ page }) => {
  await installApi(page, true);
  await page.route('**/v1/auth/session', route => json(route, { authenticated: true, accountPartition: 'C'.repeat(42) + 'A', csrfToken: 'synthetic-csrf-session-A', soopLinkStatus: 'REQUIRED' }));
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'SOOP 계정 연결이 필요해요' })).toBeVisible();
  await expect(page.getByTestId('settings-view')).toHaveCount(0);
});
test('room leave is explicit and updates only after server confirmation', async ({ page }) => {
  const state = await installApi(page, true); state.joined = true;
  await page.goto('/settings');
  await page.getByRole('button', { name: '채팅방 나가기', exact: true }).click();
  expect(state.joined).toBe(true);
  await page.getByRole('button', { name: '나가기', exact: true }).click();
  await expect(page.getByTestId('settings-room-membership')).toHaveText('나감');
  expect(state.joined).toBe(false);
});
test('two visible windows reauthorize when a new login publishes its session binding', async ({ page, context }) => {
  await context.addInitScript(() => Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }));
  const first = await installApi(page, true);
  await page.goto('/settings');
  await expect(page.getByLabel('닉네임', { exact: true })).toHaveValue('테스트 팬');
  first.sessionToken = 'synthetic-csrf-session-B'; first.profile.nickname = '다른 계정';
  const other = await context.newPage();
  const second = await installApi(other, true); second.sessionToken = first.sessionToken; second.profile.nickname = first.profile.nickname;
  await other.goto('/auth/complete');
  await expect(other.getByRole('heading', { name: '로그인되어 있어요' })).toBeVisible();
  await expect(page.getByLabel('닉네임', { exact: true })).toHaveValue('다른 계정');
  await expect(page.getByText('테스트 팬', { exact: true })).toHaveCount(0);
});
test('a cookie changing between session and profile reads stays private until a stable session is confirmed', async ({ page }) => {
  await installApi(page, true);
  await page.addInitScript(() => {
    const observer = new MutationObserver(() => {
      if (document.querySelector('[data-testid="settings-view"]')) document.documentElement.dataset.privateLeaked = 'true';
    });
    observer.observe(document, { subtree: true, childList: true });
    document.addEventListener('stop-private-race-observer', () => observer.disconnect(), { once: true });
  });
  let reads = 0;
  let unstable = true;
  await page.route('**/v1/auth/session', route => {
    reads++;
    return json(route, { authenticated: true, accountPartition: 'C'.repeat(42) + 'A', csrfToken: unstable ? `synthetic-csrf-session-${reads}` : 'synthetic-csrf-stable', soopLinkStatus: 'VERIFIED' });
  });
  await page.goto('/settings');
  await expect.poll(() => reads).toBeGreaterThanOrEqual(2);
  await expect(page.getByTestId('settings-view')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.dataset.privateLeaked)).toBeUndefined();
  await page.evaluate(() => document.dispatchEvent(new Event('stop-private-race-observer')));
  unstable = false;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByTestId('settings-view')).toBeVisible();
});

test('home shows the configured real room without joining, and preserves unavailable and retry states', async ({ page }) => {
  const state = await installApi(page, true);
  await page.goto('/');
  const room = page.getByRole('region', { name: '후로기 기본 채팅방' });
  await expect(room.getByRole('link', { name: '채팅방 확인' })).toBeVisible();
  expect(state.joined).toBe(false);
  await room.getByRole('link', { name: '채팅방 확인' }).click();
  await expect(page.getByRole('button', { name: '채팅방 입장', exact: true })).toBeVisible();
  expect(state.joined).toBe(false);
  state.joined = true;
  await page.goto('/');
  await expect(room.getByRole('link', { name: '대화 이어가기' })).toBeVisible();
  state.rooms = false;
  await page.reload();
  await expect(room.getByText('지금은 채팅방에 접근할 수 없습니다.')).toBeVisible();
  await expect(room.getByRole('link')).toHaveCount(0);
  state.rooms = true;
  await room.getByRole('button', { name: '채팅방 다시 확인' }).click();
  await expect(room.getByRole('link', { name: '대화 이어가기' })).toBeVisible();
});

test('owner-pending genuine default room is visible but cannot be joined', async ({ page }) => {
  const state = await installApi(page, true);
  await page.route('**/v1/rooms', route => json(route, { rooms: [{ roomId: '11111111-1111-4111-8111-111111111111', name: '후로기', mode: 'FAN', joined: false, isDefault: true, availability: 'OWNER_PENDING' }], next: null }));
  await page.goto('/');
  const room = page.getByRole('region', { name: '후로기 기본 채팅방' });
  await expect(room.getByText(/방장 계정을 확인하고 있습니다/)).toBeVisible();
  await expect(room.getByRole('link')).toHaveCount(0);
  await page.goto('/chat');
  await expect(page.getByRole('heading', { name: '후로기 채팅방을 준비하고 있어요' })).toBeVisible();
  await expect(page.getByRole('button', { name: '채팅방 입장', exact: true })).toHaveCount(0);
  expect(state.joined).toBe(false);
});
