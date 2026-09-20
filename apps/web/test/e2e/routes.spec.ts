import { expect, test } from '@playwright/test';

test.describe('public routes', () => {
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
    await expect(page.getByRole('heading', { level: 1, name: '이용 안내' })).toBeVisible();
    await expect(page.getByText('개인답장이 공개될 수 있어요')).toBeVisible();
  });

  test('/chat renders the unavailable gate without a timeline', async ({ page }) => {
    await page.goto('/chat');
    const gate = page.locator('[data-session-gate]');
    await expect(gate).toHaveAttribute('data-session-gate', 'unavailable');
    await expect(page.getByRole('heading', { level: 1, name: '로그인이 아직 연결되지 않았어요' })).toBeVisible();
    await expect(page.getByTestId('chat-room')).toHaveCount(0);
    await expect(page.getByRole('link', { name: '로그인 화면 보기' })).toHaveAttribute('href', '/login');
  });

  test('/settings renders the unavailable gate', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.locator('[data-session-gate]')).toHaveAttribute('data-session-gate', 'unavailable');
    await expect(page.getByTestId('settings-view')).toHaveCount(0);
  });

  test('/login shows only unavailable auth methods and safe reasons', async ({ page }) => {
    await page.goto('/login?reason=cancelled');
    await expect(page.getByRole('button', { name: 'SOOP으로 로그인' })).toBeDisabled();
    // Next's route announcer is also role=alert; the login reason is the only <p role="alert">.
    await expect(page.locator('p[role="alert"]')).toHaveText('로그인을 취소했어요. 다시 시도할 수 있어요.');
    await page.goto('/login?reason=<script>alert(1)</script>');
    await expect(page.locator('p[role="alert"]')).toHaveCount(0);
  });

  test('/auth/login forwards an enumerated reason only', async ({ request }) => {
    const response = await request.get('/auth/login?error=access_denied&code=SECRET-QUERY-VALUE', { maxRedirects: 0 });
    expect(response.status()).toBe(303);
    const location = response.headers()['location'] ?? '';
    expect(location.endsWith('/login?reason=cancelled')).toBe(true);
    expect(location).not.toContain('SECRET-QUERY-VALUE');
  });

  test('/auth/complete is a placeholder that does not claim success', async ({ page }) => {
    await page.goto('/auth/complete');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('준비하고 있어요');
    await expect(page.getByText('로그인 성공으로 표시하지 않아요')).toBeVisible();
  });

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
    expect(body).not.toMatch(/addEventListener\('(fetch|push|notificationclick)'/);
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
