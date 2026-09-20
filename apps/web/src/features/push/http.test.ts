import assert from 'node:assert/strict';
import test from 'node:test';

import { PushError } from './errors';
import { pushHttp } from './http';

const ORIGIN = 'https://api.qa.rogi.chat';
const ID = '2f1a4b6c-8d3e-4f10-92a7-5c6d7e8f9a0b';
// Synthetic 43-character base64url values in the shape the server issues. Not real tokens.
const CSRF = 'synthetic-test-only'.padEnd(43, '0');
const ROTATED = 'synthetic-test-rotated'.padEnd(43, '0');

function capture(handler: (url: string, init: RequestInit | undefined) => Response) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const transport: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    return handler(url, init);
  };
  return { transport, calls };
}

const json = (body: unknown, status = 200): Response => Response.json(body, { status });

void test('reads use API cookies, no cache, no redirects and no CSRF header', async () => {
  const { transport, calls } = capture(() => json({ available: false }));
  const http = pushHttp({ apiOrigin: ORIGIN, csrf: () => CSRF, transport });
  assert.deepEqual(await http({ path: '/v1/me/push-capabilities', method: 'GET' }), { status: 200, json: { available: false } });
  const init = calls[0]?.init;
  assert.equal(calls[0]?.url, `${ORIGIN}/v1/me/push-capabilities`);
  assert.equal(init?.credentials, 'include');
  assert.equal(init?.cache, 'no-store');
  assert.equal(init?.redirect, 'error');
  assert.equal(init?.body, undefined);
  assert.equal(new Headers(init?.headers).get('X-CSRF-Token'), null);
});

void test('every mutation carries the current CSRF token and a JSON body, DELETE included', async () => {
  let issued = CSRF;
  const { transport, calls } = capture((_url, init) => (init?.method === 'DELETE' ? new Response(null, { status: 204 }) : json({ pushEnabled: true, generation: '2' })));
  const http = pushHttp({ apiOrigin: ORIGIN, csrf: () => issued, transport });

  await http({ path: '/v1/me/notification-preferences', method: 'PUT', body: { pushEnabled: true, expectedGeneration: '1' } });
  issued = ROTATED;
  assert.deepEqual(await http({ path: `/v1/me/push-subscriptions/${ID}`, method: 'DELETE', body: { generation: '2' } }), { status: 204, json: null });

  assert.equal(calls[0]?.init?.method, 'PUT');
  assert.equal(new Headers(calls[0]?.init?.headers).get('X-CSRF-Token'), CSRF);
  assert.equal(new Headers(calls[0]?.init?.headers).get('Content-Type'), 'application/json');
  assert.equal(calls[0]?.init?.body, '{"pushEnabled":true,"expectedGeneration":"1"}');
  assert.equal(calls[1]?.init?.method, 'DELETE');
  assert.equal(calls[1]?.init?.body, '{"generation":"2"}', 'the removal generation travels in the body');
  assert.equal(new Headers(calls[1]?.init?.headers).get('X-CSRF-Token'), issued, 'the token is read per request, not captured once');
});

void test('a failure resolves with its real status and its allowlisted code', async () => {
  for (const [status, code] of [[400, 'INVALID_REQUEST'], [401, 'UNAUTHENTICATED'], [403, 'SOOP_LINK_REQUIRED'], [403, 'FORBIDDEN'], [404, 'NOT_FOUND'], [409, 'CONFLICT'], [503, 'AUTH_UNAVAILABLE']] as const) {
    const { transport } = capture(() => json({ error: { code } }, status));
    const http = pushHttp({ apiOrigin: ORIGIN, csrf: () => CSRF, transport });
    assert.deepEqual(await http({ path: '/v1/me/push-capabilities', method: 'GET' }), { status, json: { error: { code } } });
  }
});

void test('a code the contract does not define for that status is not trusted', async () => {
  for (const [status, code] of [[403, 'CONFLICT'], [409, 'FORBIDDEN'], [500, 'INTERNAL_ERROR'], [401, 'NOT_A_CODE']] as const) {
    const { transport } = capture(() => json({ error: { code } }, status));
    const http = pushHttp({ apiOrigin: ORIGIN, csrf: () => CSRF, transport });
    const response = await http({ path: '/v1/me/push-capabilities', method: 'GET' });
    assert.equal(response.status, status, 'the status is always the response status');
    assert.equal(response.json, null);
  }
});

void test('bodies that are not bounded JSON are reported as no body at all', async () => {
  const cases: Response[] = [
    new Response('<html>private</html>', { status: 200, headers: { 'content-type': 'text/html' } }),
    new Response('{not json', { status: 200, headers: { 'content-type': 'application/json' } }),
    new Response(JSON.stringify({ pad: 'x'.repeat(9000) }), { status: 200, headers: { 'content-type': 'application/json' } }),
    new Response('{}', { status: 200, headers: { 'content-type': 'application/json', 'content-length': '99999' } }),
  ];
  for (const response of cases) {
    const { transport } = capture(() => response);
    const http = pushHttp({ apiOrigin: ORIGIN, csrf: () => CSRF, transport });
    assert.deepEqual(await http({ path: '/v1/me/notification-preferences', method: 'GET' }), { status: 200, json: null });
  }
});

void test('a session without a usable token never reaches the network', async () => {
  const { transport, calls } = capture(() => json({}));
  const http = pushHttp({ apiOrigin: ORIGIN, csrf: () => '', transport });
  await assert.rejects(
    http({ path: '/v1/me/notification-preferences', method: 'PUT', body: { pushEnabled: false, expectedGeneration: '1' } }),
    (error: unknown) => error instanceof PushError && error.kind === 'unauthenticated',
  );
  assert.equal(calls.length, 0);
});

void test('transport failures and aborts reject instead of resolving', async () => {
  const failing: typeof fetch = async () => { throw new TypeError('connection reset'); };
  await assert.rejects(pushHttp({ apiOrigin: ORIGIN, csrf: () => CSRF, transport: failing })({ path: '/v1/me/push-capabilities', method: 'GET' }), TypeError);

  const controller = new AbortController();
  const hanging: typeof fetch = (_input, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => { reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); });
  });
  const pending = pushHttp({ apiOrigin: ORIGIN, csrf: () => CSRF, transport: hanging })({ path: '/v1/me/push-capabilities', method: 'GET', signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, (error: unknown) => error instanceof Error && error.name === 'AbortError');
});

void test('only approved origins and the five enrollment paths are allowed', async () => {
  assert.throws(() => pushHttp({ apiOrigin: 'https://api.other.example', csrf: () => CSRF }), TypeError);
  const { transport, calls } = capture(() => json({}));
  const http = pushHttp({ apiOrigin: ORIGIN, csrf: () => CSRF, transport });
  for (const path of ['/v1/auth/session', '/v1/me/push-subscriptions/../auth', '/v1/me/profile', 'https://other.example/v1/me/push-capabilities']) {
    await assert.rejects(http({ path, method: 'GET' }), TypeError, path);
  }
  assert.equal(calls.length, 0);
});
