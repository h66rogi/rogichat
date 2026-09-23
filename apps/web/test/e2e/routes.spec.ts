import { expect, test } from '@playwright/test';
import { installApi } from './api-fixture';
test.beforeEach(async ({ page }) => { await installApi(page); });

test.describe('public routes', () => {
  test('NanumSquare Neo is the application-wide default font', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(async () => {
      await document.fonts.load('400 16px nanumSquareNeo', '로기챗');
      await document.fonts.ready;
    });
    const font = await page.evaluate(() => ({
      variable: getComputedStyle(document.documentElement).getPropertyValue('--font-nanum-square-neo'),
      body: getComputedStyle(document.body).fontFamily,
      loaded: document.fonts.check('400 16px nanumSquareNeo', '로기챗'),
    }));
    expect(font.variable).toContain('nanumSquareNeo');
    expect(font.body).toMatch(/^nanumSquareNeo,/);
    expect(font.loaded).toBe(true);
  });

  test('/ is 후로기 home and does not redirect', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBe(200);
    expect(new URL(page.url()).pathname).toBe('/');
    await expect(page.getByRole('heading', { level: 1, name: '후로기' })).toBeVisible();
    await expect(page.getByRole('link', { name: '채팅 들어가기' })).toBeVisible();
    // No channel directory, search or switcher on the home.
    await expect(page.getByRole('searchbox')).toHaveCount(0);
  });

  test('/rules is public content', async ({ page }) => {
    await page.goto('/rules');
    await expect(page.getByRole('heading', { level: 1, name: '규칙' })).toBeVisible();
    await expect(page.getByText('개인답장이 공개될 수 있어요')).toBeVisible();
  });

  for (const route of ['/chat', '/settings']) {
    test(`${route} requires real authentication`, async ({ page }) => {
      await page.goto(route);
      await expect(page.getByRole('heading', { name: '로그인 후 이용할 수 있어요' })).toBeVisible();
      await expect(page.getByTestId('chat-room')).toHaveCount(0);
      await expect(page.getByTestId('settings-view')).toHaveCount(0);
    });
  }
  test('/login requires terms and reports provider failure truthfully', async ({ page }) => {
    await page.goto('/login?reason=cancelled');
    await expect(page.getByText('로그인을 취소했어요. 다시 시도할 수 있어요.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'SOOP으로 로그인' })).toBeDisabled();
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'SOOP으로 로그인' }).click();
    await expect(page.getByRole('alert').filter({ hasText: '요청을 완료하지 못했습니다' })).toBeVisible();
    await expect(page).toHaveURL(/login/);
  });

  test('/auth/login forwards an enumerated reason only', async ({ request }) => {
    const response = await request.get('/auth/login?error=access_denied&code=SECRET-QUERY-VALUE', { maxRedirects: 0 });
    expect(response.status()).toBe(303);
    const location = response.headers()['location'] ?? '';
    expect(location.endsWith('/login?reason=cancelled')).toBe(true);
    expect(location).not.toContain('SECRET-QUERY-VALUE');
  });

  test('/auth/complete verifies the session instead of claiming success', async ({ page }) => {
    await page.goto('/auth/complete');
    await expect(page.getByRole('heading', { name: '로기챗 로그인' })).toBeVisible();
  });
  for (const route of ['/preview', '/preview/chat/fan', '/preview/chat/streamer', '/preview/settings', '/demo', '/mock', '/fixtures']) {
    test(`${route} is absent from the production application`, async ({ request }) => {
      expect((await request.get(route)).status()).toBe(404);
    });
  }

  test('unknown paths render the 404 page', async ({ page }) => {
    const response = await page.goto('/channel/anything');
    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1, name: '페이지를 찾을 수 없어요' })).toBeVisible();
  });
});

test.describe('service worker and manifest', () => {
  test('/sw.js is JavaScript with a revalidating cache policy', async ({ request }) => {
    const response = await request.get('/sw.js');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('javascript');
    expect(response.headers()['cache-control']).toMatch(/no-cache|must-revalidate/);
    const body = await response.text();
    // The worker handles wakes and nothing else: no request interception, no private caching.
    expect(body).toMatch(/addEventListener\('push'/);
    expect(body).toMatch(/addEventListener\('notificationclick'/);
    expect(body).not.toMatch(/addEventListener\('fetch'/);
    expect(body).not.toContain('caches');
  });

  test('/manifest.webmanifest names 로기챗', async ({ request }) => {
    const response = await request.get('/manifest.webmanifest');
    expect(response.status()).toBe(200);
    const manifest = (await response.json()) as { name: string; icons: { src: string }[] };
    expect(manifest.name).toBe('로기챗');
    expect(manifest.icons.length).toBeGreaterThan(0);
  });

  test('no service worker is registered automatically', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const registrations = await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length);
    expect(registrations).toBe(0);
  });
});
