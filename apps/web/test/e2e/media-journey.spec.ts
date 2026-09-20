import { expect, test } from '@playwright/test';
import { installApi, json, TEST_PROFILE } from './api-fixture';
import { installMedia, MEDIA_ASSET, MEDIA_CSRF, TEST_IMAGE } from './media-fixture';

test('avatar requires READY, reconciles persisted profile, survives failed save and removes explicitly', async ({ page }) => {
  const account = await installApi(page, true); account.sessionToken = MEDIA_CSRF;
  const media = await installMedia(page);
  const profile = { ...TEST_PROFILE, avatar: null as { assetId: string } | null };
  let fail = true; let patches = 0; let reads = 0;
  await page.route('**/v1/me/profile', async route => {
    if (route.request().method() === 'OPTIONS') return json(route, null, 204);
    if (route.request().method() === 'PATCH') {
      patches++; expect(route.request().headers()['x-csrf-token']).toBe(MEDIA_CSRF);
      if (fail) return json(route, {}, 503);
      const patch = route.request().postDataJSON() as { avatarAssetId: string | null };
      profile.avatar = patch.avatarAssetId === null ? null : { assetId: patch.avatarAssetId };
    } else reads++;
    return json(route, profile);
  });
  await page.goto('/settings');
  await page.getByLabel('이미지 선택', { exact: true }).setInputFiles(TEST_IMAGE);
  await expect.poll(() => media.statusReads).toBeGreaterThan(0);
  await expect(page.getByRole('button', { name: '이 이미지 사용' })).toHaveCount(0);
  expect(patches).toBe(0); media.ready = true;
  await page.getByRole('button', { name: '이 이미지 사용' }).click();
  await expect(page.getByText('요청을 완료하지 못했습니다. 다시 시도해 주세요.')).toBeVisible();
  await expect(page.getByText('프로필을 저장했습니다.')).toHaveCount(0);
  fail = false;
  await page.getByRole('button', { name: '이 이미지 사용' }).click();
  await expect(page.getByText('프로필을 저장했습니다.')).toBeVisible();
  expect(profile.avatar).toEqual({ assetId: MEDIA_ASSET }); expect(reads).toBeGreaterThan(1);
  const image = page.getByRole('img', { name: '저장된 프로필 사진' });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBeGreaterThan(0);
  await page.getByRole('button', { name: '프로필 사진 삭제' }).click();
  await expect.poll(() => profile.avatar).toBe(null);
  await expect(image).toHaveCount(0);
  expect(media.reserves).toEqual([{ kind: 'AVATAR', contentType: 'image/png', byteLength: TEST_IMAGE.buffer.length }]);
});
