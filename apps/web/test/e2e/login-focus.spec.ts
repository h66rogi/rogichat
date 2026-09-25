import { expect, test } from '@playwright/test';
import { installApi, json } from './api-fixture';

for (const path of ['/chat', '/settings']) {
  test(`${path} public login link survives focus revalidation`, async ({ page }) => {
    await installApi(page, false);
    await page.goto(path);
    const login = page.getByRole('link', { name: 'SOOP으로 로그인', exact: true });
    await expect(login).toBeVisible();
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/v1/auth/session', async route => { await pending; await json(route, {}, 401); });
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    try {
      await expect(login).toBeVisible();
      await login.click();
      await expect(page).toHaveURL(/\/login$/);
    } finally { release(); }
  });
}

test('first login pointer activation survives focus and page restoration', async ({ page }) => {
  await installApi(page, false);
  await page.goto('/login');
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/v1/auth/session', async route => { await pending; await json(route, {}, 401); });
  let starts = 0;
  await page.route('**/v1/auth/soop/start', async route => { starts++; await json(route, {}, 503); });
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    window.dispatchEvent(new Event('online'));
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    window.dispatchEvent(new Event('focus'));
  });
  try {
    await expect(page.getByRole('button', { name: 'SOOP으로 로그인', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'SOOP으로 로그인', exact: true }).click();
    await expect.poll(() => starts).toBe(1);
    await expect(page.getByRole('alert').filter({ hasText: '요청을 완료하지 못했습니다.' })).toBeVisible();
  } finally { release(); }
});

test('focus keeps the mounted account view while revalidating and removes it if revoked', async ({ page }) => {
  await installApi(page, true);
  await page.goto('/settings');
  await expect(page.getByTestId('settings-view')).toBeVisible();
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/v1/auth/session', async route => { await pending; await json(route, {}, 401); });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  try {
    await expect(page.getByTestId('settings-view')).toBeVisible();
  } finally { release(); }
  await expect(page.getByRole('heading', { name: '로그인 후 이용할 수 있어요' })).toBeVisible();
});
