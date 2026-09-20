/** Synthetic image bytes and responses only for isolated browser tests. */
import { expect, type Page } from '@playwright/test';
import { json } from './api-fixture';
export const MEDIA_ASSET = '77777777-7777-4777-8777-777777777777';
export const MEDIA_CSRF = 'A'.repeat(43);
export const TEST_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64');
export const TEST_IMAGE = { name: 'test.png', mimeType: 'image/png', buffer: TEST_PNG };
export async function installMedia(page: Page) {
  const state = { ready: false, statusReads: 0, reserves: [] as Record<string, unknown>[], accesses: [] as Record<string, unknown>[] };
  await page.route('https://api.qa.rogi.chat/v1/media/**', async route => {
    if (route.request().method() === 'OPTIONS') return json(route, null, 204);
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === 'POST') expect(route.request().headers()['x-csrf-token']).toBe(MEDIA_CSRF);
    if (path.endsWith('/upload-intents')) {
      state.reserves.push(route.request().postDataJSON() as Record<string, unknown>);
      return json(route, { assetId: MEDIA_ASSET, status: 'reserved' }, 201);
    }
    if (path.endsWith('/content')) {
      expect(route.request().headers()['content-type']).toBe('application/octet-stream');
      expect(route.request().postDataBuffer()).toEqual(TEST_PNG);
      return json(route, { assetId: MEDIA_ASSET, status: 'processing' }, 202);
    }
    if (path.endsWith('/access')) {
      state.accesses.push(route.request().postDataJSON() as Record<string, unknown>);
      return json(route, { url: 'https://media.test.invalid/image', expiresIn: 60 });
    }
    state.statusReads++;
    return json(route, { assetId: MEDIA_ASSET, status: state.ready ? 'ready' : 'processing' });
  });
  await page.route('https://media.test.invalid/**', route => {
    expect(route.request().headers()['x-csrf-token']).toBeUndefined();
    expect(route.request().headers()['cookie']).toBeUndefined();
    return route.fulfill({ status: 200, headers: { 'Content-Type': 'image/png', 'Access-Control-Allow-Origin': '*' }, body: TEST_PNG });
  });
  return state;
}
