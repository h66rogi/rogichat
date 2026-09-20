import { expect, test } from '@playwright/test';

const BANNER = 'QA · 화면 미리보기 / 샘플 데이터 · 실제 로그인 및 전송 안 됨';

test.describe('QA preview screens', () => {
  test('preview index explains the sample and shows the banner', async ({ page }) => {
    await page.goto('/preview');
    await expect(page.getByRole('status').filter({ hasText: BANNER })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: '화면 미리보기' })).toBeVisible();
  });

  test('fan preview addresses only the room owner privately', async ({ page }) => {
    await page.goto('/preview/chat/fan');
    await expect(page.getByRole('status').filter({ hasText: BANNER })).toBeVisible();
    const summary = page.locator('[data-preview-role="fan"]');
    await expect(summary).toBeVisible();
    const recipients = summary.locator('[data-preview-recipients]');
    await expect(recipients).toContainText('개인 메시지 → 후로기 (샘플)');
    await expect(recipients).not.toContainText('전체');
    await expect(recipients).not.toContainText('팬 B');
  });

  test('streamer preview offers SHARED and the authorised fans only', async ({ page }) => {
    await page.goto('/preview/chat/streamer');
    const recipients = page.locator('[data-preview-role="streamer"] [data-preview-recipients]');
    await expect(recipients).toContainText('전체 (방 참여자)');
    await expect(recipients).toContainText('개인답장 → 팬 A (샘플)');
    await expect(recipients).toContainText('개인답장 → 팬 B (샘플)');
  });

  test('switching to the other room changes the owner and the authorised fans', async ({ page }) => {
    await page.goto('/preview/chat/fan?room=other');
    await expect(page.locator('[data-preview-role="fan"]')).toContainText('다른 채널 채팅방 (샘플)');
    await expect(page.locator('[data-preview-recipients]')).toContainText('개인 메시지 → 다른 스트리머 (샘플)');
    await page.goto('/preview/chat/streamer?room=other');
    const recipients = page.locator('[data-preview-recipients]');
    await expect(recipients).toContainText('개인답장 → 팬 B (샘플)');
    await expect(recipients).not.toContainText('팬 A');
  });

  test('the real chat and home never carry preview markers', async ({ page }) => {
    for (const route of ['/', '/chat', '/settings']) {
      await page.goto(route);
      await expect(page.locator('[data-preview-root]')).toHaveCount(0);
      await expect(page.getByText(BANNER)).toHaveCount(0);
      await expect(page.getByText('(샘플)')).toHaveCount(0);
    }
  });
});
