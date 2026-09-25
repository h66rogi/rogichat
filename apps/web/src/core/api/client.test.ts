import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiClient, ApiError } from './client';
const origin = 'https://api.qa.rogi.chat';
void test('session accepts the current API cookie projection and validates its admission fields', async () => {
  const base = { authenticated: true, accountPartition: 'A'.repeat(43), csrfToken: 'synthetic-test-only', soopLinkStatus: 'VERIFIED' };
  for (const linked of [true, false]) {
    const value = { ...base, soopLinkStatus: linked ? 'VERIFIED' : 'REQUIRED', onboardingState: linked ? 'READY' : 'SOOP_LINK_REQUIRED', capabilities: { chat: linked } };
    const client = new ApiClient(origin, async () => Response.json(value));
    assert.equal((await client.session()).soopLinkStatus, value.soopLinkStatus);
  }
  for (const value of [
    { ...base, onboardingState: 'READY' },
    { ...base, capabilities: { chat: true } },
    { ...base, onboardingState: 'READY', capabilities: { chat: false } },
    { ...base, onboardingState: 'SOOP_LINK_REQUIRED', capabilities: { chat: true } },
    { ...base, onboardingState: 'READY', capabilities: { chat: 'true' } },
    { ...base, onboardingState: 'READY', capabilities: { chat: true, admin: true } },
    { ...base, unexpected: true },
    { ...base, soopLinkStatus: ['VERIFIED'] },
    { authenticated: true, csrfToken: base.csrfToken, soopLinkStatus: 'VERIFIED' },
  ]) {
    await assert.rejects(new ApiClient(origin, async () => Response.json(value)).session(), (error: unknown) => error instanceof ApiError && error.code === 'INVALID_SESSION');
  }
});
void test('reads use API host cookies without CSRF and never HTTP cache', async () => {
  let options: RequestInit | undefined;
  const client = new ApiClient(origin, async (url, init) => { assert.equal(url, origin + '/v1/auth/session'); options = init; return Response.json({ authenticated: true, accountPartition: 'A'.repeat(43), csrfToken: 'synthetic-test-only', soopLinkStatus: 'VERIFIED' }); });
  await client.session();
  assert.equal(options?.credentials, 'include'); assert.equal(options?.cache, 'no-store'); assert.equal(options?.redirect, 'error');
  assert.equal(new Headers(options?.headers).get('X-CSRF-Token'), null);
});
void test('mutations fail closed without CSRF and serialize server contracts', async () => {
  let count = 0;
  const client = new ApiClient(origin, async (_url, init) => { count++; assert.equal(new Headers(init?.headers).get('X-CSRF-Token'), 'synthetic-test-only'); assert.equal(init?.body, '{}'); return new Response(null, { status: 204 }); });
  await assert.rejects(client.request('/v1/auth/logout', { method: 'POST' }), /Missing CSRF/);
  assert.equal(count, 0);
  assert.equal(await client.request('/v1/auth/logout', { method: 'POST', csrf: 'synthetic-test-only' }), undefined);
});
void test('OAuth login start sends only the login intent with credentials', async () => {
  const client = new ApiClient(origin, async (_url, init) => { assert.deepEqual(JSON.parse(String(init?.body)), { intent: 'login' }); assert.equal(init?.credentials, 'include'); return Response.json({ authorizeUrl: 'https://provider.example/authorize' }); });
  assert.equal(await client.authorize('login'), 'https://provider.example/authorize');
});
void test('HTTP error bodies never leak private text or server HTML', async () => {
  for (const status of [400, 401, 403, 404, 429, 503]) {
    const client = new ApiClient(origin, async () => new Response('private upstream body', { status }));
    await assert.rejects(client.session(), (error: unknown) => error instanceof ApiError && error.status === status && !error.message.includes('private'));
  }
});
void test('unapproved origin/path and unexpected successful HTML fail closed', async () => {
  assert.throws(() => new ApiClient('https://other.example'));
  const client = new ApiClient(origin, async () => new Response('<html>private</html>'));
  await assert.rejects(client.request('//other.example/v1/session'));
  await assert.rejects(client.request('/v1/../auth/session'));
  await assert.rejects(client.session(), (error: unknown) => error instanceof ApiError && error.code === 'INVALID_RESPONSE');
});
void test('unsafe OAuth redirect rejected', async () => {
  const client = new ApiClient(origin, async () => Response.json({ authorizeUrl: 'javascript:alert(1)' }));
  await assert.rejects(client.authorize('login'));
});

void test('aborts preserve cancellation and never synthesize authenticated data', async () => {
  const controller = new AbortController();
  controller.abort();
  const client = new ApiClient(origin, async (_url, init) => { init?.signal?.throwIfAborted(); throw new Error('unreachable'); });
  await assert.rejects(client.session(controller.signal), { name: 'AbortError' });
});
void test('malformed successful session responses never unlock private UI', async () => {
  for (const value of [null, {}, { authenticated: false }, { authenticated: true, accountPartition: 'A'.repeat(43), csrfToken: 'short', soopLinkStatus: 'VERIFIED' }, { authenticated: true, accountPartition: 'A'.repeat(43), csrfToken: 'synthetic-long-enough', soopLinkStatus: 'UNKNOWN' }]) {
    const client = new ApiClient(origin, async () => Response.json(value));
    await assert.rejects(client.session(), (error: unknown) => error instanceof ApiError && error.code === 'INVALID_SESSION');
  }
});
void test('native transport is called without an ApiClient receiver', async () => {
  const client = new ApiClient(origin, function (this: unknown) {
    assert.equal(this, undefined);
    return Promise.resolve(Response.json({ authenticated: true, accountPartition: 'A'.repeat(43), csrfToken: 'synthetic-csrf-session-A', soopLinkStatus: 'VERIFIED' }));
  });
  await client.session();
});

void test('only exact status-bound safe codes survive; raw fields, expected scope and unknown codes never escape', async () => {
  for (const [status, body, expected] of [
    [409, { error: { code: 'MEMBERSHIP_SCOPE_MISMATCH' } }, 'MEMBERSHIP_SCOPE_MISMATCH'],
    [404, { error: { code: 'NOT_FOUND' } }, 'NOT_FOUND'],
    [409, { error: { code: 'CONFLICT' } }, 'CONFLICT'],
    [409, { error: { code: 'MEMBERSHIP_SCOPE_MISMATCH' }, requestId: 'synthetic' }, 'REQUEST_FAILED'],
    [400, { error: { code: 'MEMBERSHIP_SCOPE_MISMATCH' } }, 'REQUEST_FAILED'],
    [409, { error: { code: 'MEMBERSHIP_SCOPE_MISMATCH', expectedScope: 'private' } }, 'REQUEST_FAILED'],
    [409, { error: { code: 'private arbitrary text' } }, 'REQUEST_FAILED'],
    [409, { error: { code: 'MEMBERSHIP_SCOPE_MISMATCH' }, message: 'private' }, 'REQUEST_FAILED'],
  ] as const) {
    const client = new ApiClient(origin, async () => Response.json(body, { status }));
    await assert.rejects(client.request('/v1/example'), (error: unknown) => error instanceof ApiError && error.status === status && error.code === expected && !JSON.stringify(error).includes('private'));
  }
});

void test('self profile separates provider display ID from internal ID and accepts legacy responses', async () => {
  const profile = { id: '33333333-3333-4333-8333-333333333333', nickname: '직접 설정한 이름', avatar: null, birthday: null, birthdayVisibleToStreamers: false };
  for (const extra of [{}, { soop: null }, { soop: { displayId: 'synthetic_fan' } }, { soop: { displayId: 'legacy:fan' } }]) {
    const value = { ...profile, ...extra };
    const result = await new ApiClient(origin, async () => Response.json(value)).profile();
    assert.deepEqual(result, value);
    assert.equal(result.nickname, profile.nickname);
  }
  for (const soop of ['', [], {}, { displayId: '' }, { displayId: 123 }, { displayId: 'x'.repeat(129) }, { displayId: 'https://example.com' }, { displayId: 'fan', token: 'synthetic' }]) {
    await assert.rejects(new ApiClient(origin, async () => Response.json({ ...profile, soop })).profile(), (e: unknown) => e instanceof ApiError && e.code === 'INVALID_PROFILE');
  }
});

void test('provider avatars accept only bounded canonical SOOP CDN URLs', async () => {
  const profile = { id: 'synthetic-internal', nickname: '수동 이름', avatar: null, birthday: null, birthdayVisibleToStreamers: false };
  const canonical = 'https://stimg.sooplive.com/LOGO/sy/synthetic_fan/synthetic_fan.jpg';
  for (const providerAvatarUrl of [null, canonical, 'https://profile.img.sooplive.co.kr/LOGO/sy/synthetic_fan/m/synthetic_fan.webp?t=123']) {
    assert.equal((await new ApiClient(origin, async () => Response.json({ ...profile, providerAvatarUrl })).profile()).providerAvatarUrl, providerAvatarUrl);
  }
  for (const providerAvatarUrl of [false, 'https://evil.example/image.jpg', canonical + '\n', canonical + '?token=x', canonical.replace('/sy/', '/zz/'), canonical.replace('synthetic_fan.jpg', 'other.jpg'), canonical.replace('https:', 'http:')]) {
    await assert.rejects(new ApiClient(origin, async () => Response.json({ ...profile, providerAvatarUrl })).profile(), (e: unknown) => e instanceof ApiError && e.code === 'INVALID_PROFILE');
  }
});
