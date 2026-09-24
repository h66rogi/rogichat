import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { installApi } from './api-fixture';
test.beforeEach(async ({ page }) => { await installApi(page); });

test.describe('channel shell', () => {
  test('mounts the content tree exactly once', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-shell-root]')).toHaveCount(1);
    await expect(page.locator('[data-shell-main]')).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 1, name: '후로기' })).toHaveCount(1);
    // The channel menu is in the DOM once (desktop aside, hidden on mobile); the drawer mounts on demand.
    await expect(page.locator('nav[aria-label="채널 메뉴"]')).toHaveCount(1);
  });

  test('menu links to the copied channel pages without obsolete placeholders', async ({ page, isMobile }) => {
    await page.goto('/rules');
    if (isMobile) {
      await page.getByRole('button', { name: '채널 메뉴 열기' }).click();
    }
    const menu = page.getByRole('navigation', { name: '채널 메뉴' }).last();
    await expect(menu.getByRole('link')).toHaveText(['프로필', '채팅', '규칙·이용 안내', '일정', '옷장', '노래책', '내 설정']);
    await expect(menu.getByRole('link', { name: '규칙·이용 안내' })).toHaveAttribute('aria-current', 'page');
    for (const [label, href] of [
      ['일정', '/channel/hurogi/schedule'],
      ['옷장', '/channel/hurogi/wardrobe'],
      ['노래책', '/channel/hurogi/musicbook'],
    ]) {
      await expect(menu.getByRole('link', { name: label })).toHaveAttribute('href', href);
    }
    await expect(menu).not.toContainText('준비 중');
    await expect(menu).not.toContainText('후원');
  });

  test('home exposes the available channel content without opening the menu', async ({ page }) => {
    await page.goto('/');
    const main = page.locator('[data-shell-main]');
    for (const [name, href] of [
      ['일정', '/channel/hurogi/schedule'],
      ['옷장', '/channel/hurogi/wardrobe'],
      ['노래책', '/channel/hurogi/musicbook'],
    ]) {
      await expect(main.getByRole('link', { name: new RegExp(name!) })).toHaveAttribute('href', href!);
    }
  });

  test('uses the official channel image and keeps chat in a narrow column on desktop', async ({ page, isMobile }) => {
    test.skip(isMobile, 'desktop layout only');
    await page.goto('/');
    const avatar = page.locator('[data-shell-aside] img[alt="후로기 프로필 사진"]');
    await expect(avatar).toBeVisible();
    await expect.poll(() => avatar.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
    await expect(page.locator('[data-shell-aside]')).not.toContainText('SOOP 스트리머');

    await page.goto('/chat');
    const column = await page.locator('[data-chat-column]').boundingBox();
    const main = await page.locator('[data-shell-main]').boundingBox();
    expect(column).not.toBeNull();
    expect(main).not.toBeNull();
    expect(column!.width).toBeLessThanOrEqual(768);
    expect(column!.width).toBeLessThan(main!.width);
  });

  test('has no horizontal overflow on any screen', async ({ page }) => {
    for (const route of ['/', '/chat', '/rules', '/settings', '/login']) {
      await page.goto(route);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${route} overflows horizontally`).toBeLessThanOrEqual(0);
    }
  });

  test('mobile drawer opens with keyboard and closes on navigation', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'mobile only');
    await page.goto('/');
    const trigger = page.getByRole('button', { name: '채널 메뉴 열기' });
    await trigger.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: '채널 메뉴' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('link', { name: '채팅' }).click();
    await expect(page).toHaveURL(/\/chat$/);
    await expect(dialog).toHaveCount(0);
    // Compact header on the chat screen keeps a way back to the home.
    await expect(page.getByRole('link', { name: '채널 홈으로 이동' })).toBeVisible();
  });

  test('desktop keeps the aside sticky and the top bar visible', async ({ page, isMobile }) => {
    test.skip(isMobile, 'desktop only');
    await page.goto('/');
    await expect(page.locator('[data-shell-aside]')).toBeVisible();
    await expect(page.locator('[data-shell-top-bar]')).toBeVisible();
    await expect(page.locator('[data-shell-mobile-top-bar]')).toBeHidden();
  });

  for (const route of ['/', '/rules', '/chat', '/login']) {
    test(`axe: ${route} has no serious or critical violations`, async ({ page }) => {
      await page.goto(route);
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      const serious = results.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical');
      expect(serious, JSON.stringify(serious.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })), null, 2)).toEqual([]);
    });
  }
});
