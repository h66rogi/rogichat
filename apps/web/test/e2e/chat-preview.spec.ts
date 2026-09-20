import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Chat presentation wired through the QA preview harness. The composer, targets and drafts belong to the
 * chat feature; the harness supplies synthetic fixtures and an in-memory submit that never reports "saved".
 */
test.describe('chat preview composer', () => {
  for (const role of ['fan', 'streamer']) {
    test(`${role} timeline preserves accessible list semantics`, async ({ page }) => {
      await page.goto(`/preview/chat/${role}`);
      await expect(page.getByTestId('chat-room')).toBeVisible();
      const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      expect(result.violations.filter((issue) => ['serious', 'critical'].includes(issue.impact ?? ''))).toEqual([]);
    });
  }

  test('target arrows retain focus through consecutive selections and Tab reaches input', async ({ page }) => {
    await page.goto('/preview/chat/streamer');
    const options = page.getByTestId('chat-target-option');
    await options.nth(0).focus();
    for (const index of [1, 2, 0]) {
      // Radix selects on asynchronously moved focus while the arrow remains held.
      await page.keyboard.press('ArrowRight', { delay: 120 });
      await expect(options.nth(index)).toBeFocused();
      await expect(options.nth(index)).toHaveAttribute('aria-checked', 'true');
    }
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('chat-composer-input')).toBeFocused();
  });

  test('late SHARED acceptance preserves a new PRIVATE draft and quote', async ({ page }) => {
    await page.goto('/preview/chat/streamer');
    const input = page.getByTestId('chat-composer-input');
    await input.fill('[지연] 전체에게 보내는 샘플');
    await page.getByTestId('chat-composer-send').click();
    await expect(input).toBeFocused();
    await expect(input).toHaveAttribute('readonly', '');
    await page.getByTestId('chat-timeline-item').filter({ hasText: '방송 시작 알림은 어디서 받을 수 있나요?' }).getByTestId('chat-reply').click();
    await expect(page.getByTestId('chat-quote-preview')).toContainText('방송 시작 알림');
    await input.fill('팬 B에게만 쓰는 새 초안');
    const sent = page.getByTestId('chat-timeline-item').filter({ hasText: '[지연] 전체에게 보내는 샘플' });
    await expect(sent).toHaveCount(1, { timeout: 6000 });
    await expect(input).toHaveValue('팬 B에게만 쓰는 새 초안');
    await expect(page.getByTestId('chat-quote-preview')).toContainText('방송 시작 알림');
    await expect(page.getByTestId('chat-target-option').filter({ hasText: '팬 B' })).toHaveAttribute('aria-checked', 'true');
    await expect(sent).not.toContainText('저장 완료');
  });

  test('fan composer is locked to a PRIVATE message for the room owner', async ({ page }) => {
    await page.goto('/preview/chat/fan');
    await expect(page.getByTestId('chat-room')).toBeVisible();
    await expect(page.getByTestId('chat-preview-notice')).toContainText('실제 로그인 및 전송 안 됨');
    const target = page.getByTestId('chat-composer-target');
    await expect(target).toContainText('후로기 (샘플)');
    await expect(target).not.toContainText('전체');
    await expect(page.getByTestId('chat-target-option')).toHaveCount(0);
  });

  test('streamer can choose SHARED or an authorised fan, never an unauthorised one', async ({ page }) => {
    await page.goto('/preview/chat/streamer?room=other');
    await expect(page.getByTestId('chat-room')).toBeVisible();
    const options = page.getByTestId('chat-target-option');
    await expect(options).toHaveCount(2);
    await expect(options.filter({ hasText: '전체' })).toHaveCount(1);
    await expect(options.filter({ hasText: '팬 B (샘플)' })).toHaveCount(1);
    await expect(options.filter({ hasText: '팬 A' })).toHaveCount(0);
  });

  test('Enter during Korean IME composition does not send', async ({ page }) => {
    await page.goto('/preview/chat/fan');
    const input = page.getByTestId('chat-composer-input');
    await input.click();
    const before = await page.getByTestId('chat-timeline-item').count();
    // Simulate an active IME composition: keydown Enter with isComposing must be ignored.
    await input.evaluate((element) => {
      const textarea = element as HTMLTextAreaElement;
      textarea.value = '한글 조합 중';
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    });
    await expect(page.getByTestId('chat-timeline-item')).toHaveCount(before);
    await input.evaluate((element) => {
      const textarea = element as HTMLTextAreaElement;
      textarea.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    });
    await expect(input).toHaveValue('한글 조합 중');
  });

  test('sending shows pending, then unknown, never saved', async ({ page }) => {
    await page.goto('/preview/chat/fan');
    const input = page.getByTestId('chat-composer-input');
    await input.fill('미리보기에서 보내는 메시지');
    await page.getByTestId('chat-composer-send').click();
    const item = page.getByTestId('chat-timeline-item').filter({ hasText: '미리보기에서 보내는 메시지' });
    await expect(item).toHaveCount(1);
    await expect(item).toContainText('결과 확인 중', { timeout: 6000 });
    await expect(item).not.toContainText('저장 완료');
    await expect(input).toHaveValue('');
  });

  test('a draft does not leak into another room scope', async ({ page }) => {
    await page.goto('/preview/chat/fan');
    await page.getByTestId('chat-composer-input').fill('첫 번째 방의 초안');
    await page.goto('/preview/chat/fan?room=other');
    await expect(page.getByTestId('chat-composer-target')).toContainText('다른 스트리머 (샘플)');
    await expect(page.getByTestId('chat-composer-input')).toHaveValue('');
    await expect(page.getByTestId('chat-timeline')).not.toContainText('후로기 채팅방');
  });

  test('a late rejection after switching target is announced and kept with its own draft', async ({ page }) => {
    await page.goto('/preview/chat/streamer');
    const options = page.getByTestId('chat-target-option');
    await options.filter({ hasText: '팬 A (샘플)' }).click();
    const input = page.getByTestId('chat-composer-input');
    await input.fill('[거부] 지연 거부 시연');
    await page.getByTestId('chat-composer-send').click();
    // Switch to SHARED while the send is still in flight (rejection arrives after ~2s).
    await options.filter({ hasText: '전체' }).click();
    await expect(page.getByTestId('chat-composer-status')).toContainText('거부', { timeout: 6000 });
    await expect(input).toHaveValue('');
    // Returning to fan A shows the rejection reason and the preserved draft.
    await options.filter({ hasText: '팬 A (샘플)' }).click();
    await expect(page.getByTestId('chat-composer-error')).toContainText('지연 거부 시연');
    await expect(input).toHaveValue('[거부] 지연 거부 시연');
  });

  test('settings preview renders every section disabled with a reason', async ({ page }) => {
    await page.goto('/preview/settings');
    await expect(page.getByTestId('settings-view')).toBeVisible();
    await expect(page.getByTestId('settings-preview-notice')).toContainText('샘플 데이터');
    for (const id of ['settings-soop-link', 'settings-logout', 'settings-room-leave', 'settings-account-delete']) {
      await expect(page.getByTestId(id)).toBeDisabled();
    }
    await expect(page.getByTestId('settings-action-reason').first()).toContainText('미리보기에서 실행되지 않아요');
  });
});
