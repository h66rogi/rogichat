import { expect, test, type Page } from '@playwright/test';
import { installApi, json, TEST_PARTITION, TEST_ROOM_ID } from './api-fixture';
async function signedIn(page: Page) {
  const account = await installApi(page, true); account.rooms = false; account.sessionToken = 'A'.repeat(43); return account;
}
test('own block discovery traverses empty pages without an active room and uses only current nullable labels', async ({ page }) => {
  await signedIn(page); const cursors: (string | null)[] = [];
  await page.route('**/v1/blocked-rooms*', route => {
    const cursor = new URL(route.request().url()).searchParams.get('cursor'); cursors.push(cursor);
    return json(route, cursor === 'middle-2' ? { rooms: [{ roomId: TEST_ROOM_ID, displayName: null }], nextCursor: null } : { rooms: [], nextCursor: cursor === null ? 'middle-1' : 'middle-2' });
  });
  await page.route('**/v1/rooms/*/blocks', route => json(route, { blocks: [], next: null }));
  await page.goto('/settings'); await page.getByRole('button', { name: '차단한 방 찾기', exact: true }).click();
  const open = page.getByRole('button', { name: '차단 목록 열기: 이름을 확인할 수 없는 방 1', exact: true }); await expect(open).toBeVisible();
  expect(cursors).toEqual([null, 'middle-1', 'middle-2']); await expect(page.getByText(TEST_ROOM_ID, { exact: true })).toHaveCount(0);
  await open.click(); await page.getByRole('button', { name: '차단 목록 확인', exact: true }).click();
  await expect(page.getByText('이 페이지에 차단한 사용자가 없습니다.')).toBeVisible();
});
test('expired discovery cursor restarts and replaces previous room labels', async ({ page }) => {
  await signedIn(page); let roots = 0;
  await page.route('**/v1/blocked-rooms*', route => {
    if (new URL(route.request().url()).searchParams.has('cursor')) return json(route, { error: { code: 'INVALID_CURSOR' } }, 400);
    roots++; return json(route, { rooms: [{ roomId: TEST_ROOM_ID, displayName: roots === 1 ? '이전 조회 이름' : '갱신된 현재 이름' }], nextCursor: roots === 1 ? 'expired-opaque' : null });
  });
  await page.goto('/settings'); await page.getByRole('button', { name: '차단한 방 찾기', exact: true }).click();
  await expect(page.getByRole('button', { name: '차단 목록 열기: 이전 조회 이름', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '다음 차단 방', exact: true }).click();
  await expect(page.getByRole('button', { name: '차단 목록 열기: 갱신된 현재 이름', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '차단 목록 열기: 이전 조회 이름', exact: true })).toHaveCount(0);
  await expect(page.getByText('목록 연결이 만료되어 처음부터 다시 확인했습니다.')).toBeVisible(); expect(roots).toBe(2);
});
test('discovery failure is retryable and only a completed traversal shows empty state', async ({ page }) => {
  await signedIn(page); let status = 503;
  await page.route('**/v1/blocked-rooms*', route => json(route, status === 200 ? { rooms: [], nextCursor: null } : {}, status));
  await page.goto('/settings'); await page.getByRole('button', { name: '차단한 방 찾기', exact: true }).click();
  await expect(page.getByText('차단한 방을 확인하지 못했습니다. 차단한 방 찾기를 눌러 다시 확인해 주세요.')).toBeVisible();
  await expect(page.getByText('더 표시할 차단 목록이 없습니다.')).toHaveCount(0);
  status = 200; await page.getByRole('button', { name: '차단한 방 찾기', exact: true }).click();
  await expect(page.getByText('더 표시할 차단 목록이 없습니다.')).toBeVisible();
});
test('late discovery response cannot expose the previous account room label', async ({ page }) => {
  const account = await signedIn(page); let started = false; let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/v1/blocked-rooms*', async route => { started = true; await held; return json(route, { rooms: [{ roomId: TEST_ROOM_ID, displayName: '이전 계정 비공개 이름' }], nextCursor: null }); });
  await page.goto('/settings'); await page.getByRole('button', { name: '차단한 방 찾기', exact: true }).click();
  await expect.poll(() => started).toBe(true); account.sessionToken = 'B'.repeat(42) + 'A';
  await page.route('**/v1/auth/session', route => json(route, { authenticated: true, accountPartition: TEST_PARTITION, csrfToken: account.sessionToken, soopLinkStatus: 'VERIFIED' }));
  release();
  await expect(page.getByText('차단한 방을 확인하지 못했습니다. 차단한 방 찾기를 눌러 다시 확인해 주세요.')).toBeVisible();
  await expect(page.getByText('이전 계정 비공개 이름', { exact: false })).toHaveCount(0);
});


test('empty last discovery page does not claim earlier owned blocks no longer exist', async ({ page }) => {
  await signedIn(page);
  await page.route('**/v1/blocked-rooms*', route => json(route, new URL(route.request().url()).searchParams.has('cursor')
    ? { rooms: [], nextCursor: null } : { rooms: [{ roomId: TEST_ROOM_ID, displayName: '앞 페이지 방' }], nextCursor: 'last-page' }));
  await page.goto('/settings'); await page.getByRole('button', { name: '차단한 방 찾기', exact: true }).click();
  await expect(page.getByRole('button', { name: '차단 목록 열기: 앞 페이지 방', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '다음 차단 방', exact: true }).click();
  await expect(page.getByText('더 표시할 차단 목록이 없습니다.')).toBeVisible();
  await expect(page.getByText('이 계정에 남아 있는 차단이 없습니다.')).toHaveCount(0);
});
