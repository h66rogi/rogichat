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

test('persisted SOOP self profile shows display ID and authorized avatar on home and settings without overwriting nickname', async ({ page }) => {
  const account = await installApi(page, true); account.sessionToken = MEDIA_CSRF;
  const media = await installMedia(page);
  const profile = { ...TEST_PROFILE, nickname: '직접 정한 이름', soop: { displayId: 'synthetic_soop_fan' }, avatar: { assetId: MEDIA_ASSET } };
  let writes = 0;
  await page.route('**/v1/me/profile', route => {
    if (route.request().method() !== 'GET') writes++;
    return json(route, profile);
  });
  for (const path of ['/', '/settings']) {
    await page.goto(path);
    await expect(page.getByText('SOOP ID · synthetic_soop_fan', { exact: true })).toBeVisible();
    const image = page.getByRole('img', { name: '저장된 프로필 사진' });
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBeGreaterThan(0);
    await expect(image).toHaveAttribute('src', /^blob:/);
    await expect(page.getByText(profile.id, { exact: false })).toHaveCount(0);
  }
  await expect(page.getByLabel('닉네임', { exact: true })).toHaveValue('직접 정한 이름');
  await page.reload();
  await expect(page.getByTestId('settings-soop-display-id')).toHaveText('SOOP ID · synthetic_soop_fan');
  expect(writes).toBe(0);
  expect(media.reserves).toEqual([]);
  expect(media.accesses.length).toBeGreaterThanOrEqual(2);
  expect(media.accesses.every(context => JSON.stringify(context) === JSON.stringify({ variant: 'image' }))).toBe(true);
});

test('provider-only avatar renders without storage, retries failure, and explicit deletion suppresses fallback', async ({ page }) => {
  const account = await installApi(page, true); account.sessionToken = MEDIA_CSRF;
  const profile = { ...TEST_PROFILE, providerAvatarUrl: 'https://stimg.sooplive.com/LOGO/sy/synthetic_fan/synthetic_fan.jpg' as string | null };
  let failed = true;
  await page.route('https://stimg.sooplive.com/**', route => {
    expect(route.request().headers().referer).toBeUndefined();
    return failed ? route.abort() : route.fulfill({ status: 200, contentType: 'image/png', body: TEST_IMAGE.buffer });
  });
  await page.route('**/v1/me/profile', route => {
    if (route.request().method() === 'OPTIONS') return json(route, null, 204);
    if (route.request().method() === 'PATCH') {
      const patch = route.request().postDataJSON();
      expect(route.request().headers()['x-csrf-token']).toBe(MEDIA_CSRF);
      if ('nickname' in patch) {
        expect(patch).toEqual({ nickname: '새로 정한 이름' });
        profile.nickname = patch.nickname;
      } else {
        expect(patch).toEqual({ avatarAssetId: null });
        profile.providerAvatarUrl = null;
      }
    }
    return json(route, profile);
  });
  await page.goto('/settings');
  await expect(page.getByText('프로필 사진을 불러오지 못했습니다.')).toBeVisible();
  failed = false;
  await page.getByRole('button', { name: '사진 다시 보기' }).click();
  await expect(page.getByRole('img', { name: '저장된 프로필 사진' })).toBeVisible();
  await page.getByLabel('닉네임', { exact: true }).fill('새로 정한 이름');
  await page.getByRole('button', { name: '변경 내용 저장' }).click();
  await expect(page.getByText('프로필을 저장했습니다.')).toBeVisible();
  expect(profile.providerAvatarUrl).not.toBeNull();
  await expect(page.getByRole('img', { name: '저장된 프로필 사진' })).toBeVisible();
  await page.getByRole('button', { name: '프로필 사진 삭제' }).click();
  await expect(page.getByRole('img', { name: '등록된 프로필 사진 없음' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('img', { name: '저장된 프로필 사진' })).toHaveCount(0);
});
