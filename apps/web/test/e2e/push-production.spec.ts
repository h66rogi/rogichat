/** Isolated HTTP failures around the actual settings route; no product fixture adapter. */
import { expect, test, type Page } from '@playwright/test';
import { installApi, json } from './api-fixture';

async function setup(page: Page) {
  await installApi(page, true);
  const state = { status: 200, reads: 0, writes: 0 };
  await page.addInitScript(() => {
    let prompts = 0;
    Object.defineProperty(window, '__notificationPrompts', { get: () => prompts });
    if (typeof Notification !== 'undefined') Notification.requestPermission = async () => { prompts++; return 'denied'; };
  });
  await page.route('**/v1/me/push-capabilities', route => {
    state.reads++;
    return json(route, state.status === 200 ? { available: false } : {}, state.status);
  });
  await page.route('**/v1/me/notification-preferences', route => {
    if (route.request().method() !== 'GET') state.writes++;
    return json(route, { pushEnabled: false, generation: '1' });
  });
  return state;
}

test('opening actual settings reads push state without prompting or enrolling', async ({ page }) => {
  const state = await setup(page); await page.goto('/settings');
  await expect(page.getByTestId('settings-notifications-toggle')).toBeDisabled();
  await expect.poll(() => state.reads).toBeGreaterThan(0);
  const denied = await page.evaluate(() => Notification.permission === 'denied');
  await expect(page.getByText(denied ? '브라우저에서 알림이 차단되어 있습니다. 브라우저 설정에서 허용해 주세요.' : '서버에서 웹 푸시가 아직 준비되지 않았습니다.')).toBeVisible();
  expect(state.writes).toBe(0);
  expect(await page.evaluate(() => Reflect.get(window, '__notificationPrompts'))).toBe(0);
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
});

test('push read failure remains unknown and explicit settings retry rereads the server', async ({ page }) => {
  const state = await setup(page); state.status = 503; await page.goto('/settings');
  await expect(page.getByTestId('settings-notifications-notice')).toBeVisible();
  await expect(page.getByTestId('settings-notifications-toggle')).toBeDisabled();
  state.status = 200; const before = state.reads;
  await page.getByTestId('settings-notifications-retry').click();
  await expect.poll(() => state.reads).toBeGreaterThan(before);
  const denied = await page.evaluate(() => Notification.permission === 'denied');
  await expect(page.getByText(denied ? '브라우저에서 알림이 차단되어 있습니다. 브라우저 설정에서 허용해 주세요.' : '서버에서 웹 푸시가 아직 준비되지 않았습니다.')).toBeVisible();
  expect(state.writes).toBe(0);
  expect(await page.evaluate(() => Reflect.get(window, '__notificationPrompts'))).toBe(0);
});
