import assert from 'node:assert/strict';
import test from 'node:test';

import { PushApi } from './api';
import { toBase64Url } from './contract';
import { PushError } from './errors';
import type { PushHttp, PushHttpRequest, PushHttpResponse } from './transport';

const P256DH = toBase64Url(Uint8Array.from([4, ...Array.from({ length: 64 }, (_, index) => (index * 5 + 3) & 0xff)]));
const AUTH = toBase64Url(Uint8Array.from(Array.from({ length: 16 }, (_, index) => (index * 13 + 2) & 0xff)));
const ID = '2f1a4b6c-8d3e-4f10-92a7-5c6d7e8f9a0b';
const KEYS = { p256dh: P256DH, auth: AUTH };

function recorder(responses: PushHttpResponse[]): { http: PushHttp; sent: PushHttpRequest[] } {
  const sent: PushHttpRequest[] = [];
  const http: PushHttp = async request => {
    sent.push(request);
    const response = responses.shift();
    if (response === undefined) throw new Error('unexpected request');
    return response;
  };
  return { http, sent };
}

void test('each enrollment call uses the documented route, method and body', async () => {
  const { http, sent } = recorder([
    { status: 200, json: { available: true, applicationServerKey: P256DH } },
    { status: 200, json: { pushEnabled: false, generation: '1' } },
    { status: 200, json: { pushEnabled: true, generation: '2' } },
    { status: 201, json: { id: ID, generation: '1' } },
    { status: 204, json: null },
  ]);
  const api = new PushApi(http);
  assert.deepEqual(await api.capabilities(), { available: true, applicationServerKey: P256DH });
  assert.deepEqual(await api.preferences(), { pushEnabled: false, generation: '1' });
  assert.deepEqual(await api.setPreferences(true, '1'), { pushEnabled: true, generation: '2' });
  assert.deepEqual(await api.register({ endpoint: 'https://push.example/a', keys: KEYS }), { id: ID, generation: '1' });
  await api.remove(ID, '1');
  assert.deepEqual(sent.map(request => `${request.method} ${request.path}`), [
    'GET /v1/me/push-capabilities',
    'GET /v1/me/notification-preferences',
    'PUT /v1/me/notification-preferences',
    'POST /v1/me/push-subscriptions',
    `DELETE /v1/me/push-subscriptions/${ID}`,
  ]);
  assert.deepEqual(sent[2]?.body, { pushEnabled: true, expectedGeneration: '1' });
  assert.deepEqual(sent[3]?.body, { endpoint: 'https://push.example/a', keys: KEYS });
  assert.deepEqual(sent[4]?.body, { generation: '1' });
  assert.equal(sent[0]?.body, undefined);
});

void test('a rotation sends the current generation for compare-and-set', async () => {
  const { http, sent } = recorder([{ status: 201, json: { id: ID, generation: '3' } }]);
  await new PushApi(http).register({ endpoint: 'https://push.example/a', keys: KEYS, generation: '2' });
  assert.deepEqual(sent[0]?.body, { endpoint: 'https://push.example/a', keys: KEYS, generation: '2' });
});

void test('error statuses map to distinct states, including the platform link requirement', async () => {
  const cases: [number, string, string][] = [
    [400, 'INVALID_REQUEST', 'invalid-request'],
    [401, 'UNAUTHENTICATED', 'unauthenticated'],
    [403, 'FORBIDDEN', 'forbidden'],
    [403, 'SOOP_LINK_REQUIRED', 'soop-link-required'],
    [404, 'NOT_FOUND', 'not-found'],
    [409, 'CONFLICT', 'conflict'],
    [503, 'AUTH_UNAVAILABLE', 'unavailable'],
  ];
  for (const [status, code, kind] of cases) {
    const { http } = recorder([{ status, json: { error: { code } } }]);
    await assert.rejects(new PushApi(http).capabilities(), (error: unknown) => error instanceof PushError && error.kind === kind && error.status === status);
  }
});

void test('a failed request never becomes an enabled-looking result', async () => {
  const { http } = recorder([{ status: 503, json: { error: { code: 'AUTH_UNAVAILABLE' } } }]);
  await assert.rejects(new PushApi(http).setPreferences(true, '1'), (error: unknown) => error instanceof PushError && error.kind === 'unavailable');
});

void test('unexpected success shapes and statuses fail instead of being trusted', async () => {
  for (const response of [
    { status: 200, json: { available: true } },
    { status: 200, json: null },
    { status: 201, json: { available: false } },
  ]) {
    const { http } = recorder([response]);
    await assert.rejects(new PushApi(http).capabilities(), (error: unknown) => error instanceof PushError);
  }
  const removal = recorder([{ status: 204, json: { id: ID } }]);
  await assert.rejects(new PushApi(removal.http).remove(ID, '1'), (error: unknown) => error instanceof PushError && error.kind === 'invalid-response');
});

void test('a transport failure is a network state and an abort stays an abort', async () => {
  const failing: PushHttp = async () => { throw new TypeError('connection reset'); };
  await assert.rejects(new PushApi(failing).preferences(), (error: unknown) => error instanceof PushError && error.kind === 'network' && error.status === 0);
  const aborted: PushHttp = async () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }); };
  await assert.rejects(new PushApi(aborted).preferences(), (error: unknown) => error instanceof Error && error.name === 'AbortError');
});

void test('locally invalid arguments never reach the network', async () => {
  const { http, sent } = recorder([]);
  const api = new PushApi(http);
  await assert.rejects(api.setPreferences(true, '0'), (error: unknown) => error instanceof PushError && error.kind === 'invalid-request');
  await assert.rejects(api.remove(ID, 'x'), (error: unknown) => error instanceof PushError && error.kind === 'invalid-request');
  await assert.rejects(api.register({ endpoint: 'http://push.example/a', keys: KEYS }), TypeError);
  assert.equal(sent.length, 0);
});

void test('the request signal is forwarded so an account change can abort in flight', async () => {
  const { http, sent } = recorder([{ status: 200, json: { pushEnabled: false, generation: '1' } }]);
  const controller = new AbortController();
  await new PushApi(http).preferences(controller.signal);
  assert.equal(sent[0]?.signal, controller.signal);
});
