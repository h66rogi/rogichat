import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiClient } from '../../core/api/client';
import { MediaSessionScope } from './session-scope';
import { MediaImageResource } from './image-resource';

const origin = 'https://api.qa.rogi.chat';
const assetId = '22222222-2222-4222-8222-222222222222';
const csrf = 'A'.repeat(43);
void test('account changes during image transfer abort the scope before any blob can display', async t => {
  let changed = false; let invalidations = 0;
  const api = new ApiClient(origin, async () => Response.json({ authenticated: true, soopLinkStatus: 'VERIFIED', csrfToken: changed ? 'B'.repeat(43) : csrf }));
  t.mock.method(globalThis, 'fetch', async (input: unknown) => {
    if (String(input).startsWith(origin)) return Response.json({ url: 'https://storage.example/image', expiresIn: 60 });
    changed = true;
    return new Response(new Blob(['image'], { type: 'image/png' }));
  });
  const scope = new MediaSessionScope(api, csrf, ['https://storage.example'], () => { invalidations++; });
  const image = new MediaImageResource(scope.client);
  await image.load(assetId, { variant: 'image' });
  assert.equal(scope.lifetime.signal.aborted, true);
  assert.equal(image.getSnapshot().objectUrl, undefined);
  assert.equal(invalidations, 1); image.dispose(); scope.dispose();
});
void test('parent room invalidation synchronously revokes displayed bytes', async t => {
  const parent = new AbortController();
  const api = new ApiClient(origin, async () => Response.json({ authenticated: true, soopLinkStatus: 'VERIFIED', csrfToken: csrf }));
  t.mock.method(globalThis, 'fetch', async (input: unknown) => String(input).startsWith(origin) ? Response.json({ url: 'https://storage.example/image', expiresIn: 60 }) : new Response(new Blob(['image'], { type: 'image/png' })));
  const scope = new MediaSessionScope(api, csrf, ['https://storage.example'], () => {}, { signal: parent.signal, isCurrent: () => !parent.signal.aborted });
  const image = new MediaImageResource(scope.client);
  await image.load(assetId, { variant: 'image' }); assert.ok(image.getSnapshot().objectUrl);
  parent.abort(); assert.equal(image.getSnapshot().objectUrl, undefined); assert.equal(scope.lifetime.isCurrent(), false);
  image.dispose(); scope.dispose();
});
void test('empty signer configuration cannot attempt private image admission', async t => {
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => { requests++; throw new Error('unexpected'); });
  const scope = new MediaSessionScope(new ApiClient(origin), csrf, [], () => {});
  assert.equal(scope.configured, false);
  await assert.rejects(scope.client.image(assetId, { variant: 'image' }, new AbortController().signal));
  assert.equal(requests, 0); scope.dispose();
});
