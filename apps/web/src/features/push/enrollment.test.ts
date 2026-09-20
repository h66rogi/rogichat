import assert from 'node:assert/strict';
import test from 'node:test';

import { PushApi } from './api';
import { PUSH_BINDING_KEY } from './binding';
import type { BindingStorage } from './binding';
import type { BrowserSubscription, PushBrowser, PushPermission, PushSupport } from './browser';
import { toBase64Url } from './contract';
import { PushEnrollment } from './enrollment';
import { PushScope } from './scope';
import type { PushHttp, PushHttpRequest, PushHttpResponse } from './transport';
import type { SettingsNotificationsModel } from '../settings/types';

// The settings screen consumes the model directly; this assignment fails typecheck if either
// shape drifts. It is erased at runtime.
type ModelMatchesSettings = PushEnrollment extends { model(): SettingsNotificationsModel } ? true : never;
const MODEL_MATCHES_SETTINGS: ModelMatchesSettings = true;
void MODEL_MATCHES_SETTINGS;

const KEY = toBase64Url(Uint8Array.from([4, ...Array.from({ length: 64 }, (_, index) => (index * 5 + 3) & 0xff)]));
const P256DH = toBase64Url(Uint8Array.from([4, ...Array.from({ length: 64 }, (_, index) => (index * 3 + 11) & 0xff)]));
const AUTH = toBase64Url(Uint8Array.from(Array.from({ length: 16 }, (_, index) => (index * 13 + 2) & 0xff)));
const ID = '2f1a4b6c-8d3e-4f10-92a7-5c6d7e8f9a0b';
const OTHER_ID = '7b3c9d1e-4a5f-4c2b-8e7d-1f2a3b4c5d6e';
const IDENTITY = { account: 'account-one', session: 'session-one' };

const available = (): PushHttpResponse => ({ status: 200, json: { available: true, applicationServerKey: KEY } });
const preference = (pushEnabled: boolean, generation: string): PushHttpResponse => ({ status: 200, json: { pushEnabled, generation } });
const registered = (id: string, generation: string): PushHttpResponse => ({ status: 201, json: { id, generation } });
const failure = (status: number, code: string): PushHttpResponse => ({ status, json: { error: { code } } });
const NETWORK = Symbol('network failure');

class TestBrowser implements PushBrowser {
  supportValue: PushSupport = 'supported';
  permissionValue: PushPermission = 'granted';
  promptResult: PushPermission = 'granted';
  prompts = 0;
  subscribes = 0;
  unsubscribes = 0;
  subscription: BrowserSubscription | null = null;
  private readonly endpoints: string[];

  constructor(endpoints: string[] = ['https://push.example/a']) {
    this.endpoints = [...endpoints];
  }

  support(): PushSupport { return this.supportValue; }
  permission(): PushPermission { return this.permissionValue; }

  async requestPermission(): Promise<PushPermission> {
    this.prompts += 1;
    this.permissionValue = this.promptResult;
    return this.promptResult;
  }

  async current(): Promise<BrowserSubscription | null> { return this.subscription; }

  async subscribe(applicationServerKey: string): Promise<BrowserSubscription> {
    this.subscribes += 1;
    const endpoint = this.endpoints.length > 1 ? this.endpoints.shift() : this.endpoints[0];
    this.subscription = { endpoint: endpoint ?? 'https://push.example/a', keys: { p256dh: P256DH, auth: AUTH }, applicationServerKey };
    return this.subscription;
  }

  async unsubscribe(): Promise<boolean> {
    this.unsubscribes += 1;
    const had = this.subscription !== null;
    this.subscription = null;
    return had;
  }
}

function harness(script: (PushHttpResponse | typeof NETWORK)[], options: { stored?: string; endpoints?: string[] } = {}) {
  const sent: PushHttpRequest[] = [];
  const queue = [...script];
  const http: PushHttp = async request => {
    sent.push(request);
    const next = queue.shift();
    if (next === undefined) throw new Error(`unscripted request: ${request.method} ${request.path}`);
    if (next === NETWORK) throw new TypeError('connection reset');
    return next;
  };
  const values: Record<string, string> = options.stored === undefined ? {} : { [PUSH_BINDING_KEY]: options.stored };
  const storage: BindingStorage = {
    getItem: key => values[key] ?? null,
    setItem: (key, value) => { values[key] = value; },
    removeItem: key => { delete values[key]; },
  };
  const browser = new TestBrowser(options.endpoints ?? ['https://push.example/a']);
  const scope = new PushScope(IDENTITY);
  const enrollment = new PushEnrollment({ api: new PushApi(http), browser, storage, scope });
  const routes = () => sent.map(request => `${request.method} ${request.path}`);
  return { enrollment, browser, scope, storage, sent, routes, values, remaining: () => queue.length };
}

void test('enabling registers the endpoint first and only then stores the preference', async () => {
  const { enrollment, browser, routes, sent, values } = harness([available(), preference(false, '1'), registered(ID, '1'), preference(true, '2')]);
  await enrollment.enable();
  assert.deepEqual(routes(), [
    'GET /v1/me/push-capabilities',
    'GET /v1/me/notification-preferences',
    'POST /v1/me/push-subscriptions',
    'PUT /v1/me/notification-preferences',
  ]);
  assert.deepEqual(sent[2]?.body, { endpoint: 'https://push.example/a', keys: { p256dh: P256DH, auth: AUTH } }, 'a new endpoint carries no generation');
  assert.deepEqual(sent[3]?.body, { pushEnabled: true, expectedGeneration: '1' });
  assert.equal(browser.prompts, 0, 'an already granted permission is not asked again');
  assert.equal(values[PUSH_BINDING_KEY], `v1:account-one:session-one:${ID}:1`);
  assert.deepEqual(enrollment.model(), { support: 'supported', permission: 'granted', enabled: true, toggle: { enabled: true } });
});

void test('the permission prompt happens only inside the user action, and denial stores nothing', async () => {
  const { enrollment, browser, routes } = harness([available(), preference(false, '1')]);
  browser.permissionValue = 'not-asked';
  browser.promptResult = 'denied';
  await enrollment.enable();
  assert.equal(browser.prompts, 1);
  assert.equal(browser.subscribes, 0);
  assert.deepEqual(routes(), ['GET /v1/me/push-capabilities', 'GET /v1/me/notification-preferences'], 'no registration and no preference write');
  const model = enrollment.model();
  assert.equal(model.enabled, false);
  assert.equal(model.permission, 'denied');
  assert.deepEqual(model.toggle, { enabled: false, reason: '브라우저에서 알림이 차단되어 있습니다. 브라우저 설정에서 허용해 주세요.' });
});

void test('an unavailable server capability never prompts, registers or reports success', async () => {
  const { enrollment, browser, routes } = harness([{ status: 200, json: { available: false } }, preference(false, '1')]);
  browser.permissionValue = 'not-asked';
  await enrollment.enable();
  assert.equal(browser.prompts, 0);
  assert.equal(browser.subscribes, 0);
  assert.deepEqual(routes(), ['GET /v1/me/push-capabilities']);
  assert.equal(enrollment.getState().serverAvailable, false);
  assert.equal(enrollment.getState().notice, '서버에서 웹 푸시가 아직 준비되지 않아 알림을 켤 수 없습니다.');
});

void test('a 503 from the capability call is an unavailable state, not an enabled toggle', async () => {
  const { enrollment } = harness([failure(503, 'AUTH_UNAVAILABLE')]);
  await enrollment.enable();
  assert.equal(enrollment.getState().notice, '지금은 알림을 켤 수 없습니다. 서버의 웹 푸시 설정이 준비되면 다시 시도해 주세요.');
  assert.equal(enrollment.model().enabled, null);
});

void test('an unsupported browser never reaches the network', async () => {
  const { enrollment, browser, routes } = harness([]);
  browser.supportValue = 'install-required';
  await enrollment.enable();
  assert.deepEqual(routes(), []);
  assert.equal(browser.prompts, 0);
  assert.equal(enrollment.getState().notice, '홈 화면에 로기챗을 추가한 뒤 알림을 켤 수 있습니다.');
});

void test('a preference conflict re-reads the stored value and never replays the desired one', async () => {
  const { enrollment, routes, sent } = harness([
    available(), preference(false, '1'), registered(ID, '1'),
    failure(409, 'CONFLICT'),
    preference(false, '9'),
  ]);
  await enrollment.enable();
  assert.deepEqual(routes(), [
    'GET /v1/me/push-capabilities',
    'GET /v1/me/notification-preferences',
    'POST /v1/me/push-subscriptions',
    'PUT /v1/me/notification-preferences',
    'GET /v1/me/notification-preferences',
  ]);
  assert.equal(sent.filter(request => request.method === 'PUT').length, 1, 'the stale desired value is not retried');
  const state = enrollment.getState();
  assert.ok(state.needsDecision, 'the user has to choose again against the current value');
  assert.equal(state.preferenceEnabled, false);
  assert.equal(state.preferenceGeneration, '9');
  assert.equal(enrollment.model().enabled, false, 'the toggle shows the stored value, not the attempt');
});

void test('a lost registration response is retried once with the identical initial request', async () => {
  const { enrollment, sent, routes } = harness([
    available(), preference(false, '1'),
    NETWORK,
    registered(ID, '1'),
    preference(true, '2'),
  ]);
  await enrollment.enable();
  const posts = sent.filter(request => request.method === 'POST');
  assert.equal(posts.length, 2);
  assert.deepEqual(posts[0]?.body, posts[1]?.body, 'the retry is byte-identical');
  assert.equal((posts[1]?.body as { generation?: string }).generation, undefined, 'the retry stays generation-free');
  assert.equal(routes().filter(route => route.startsWith('PUT')).length, 1);
  assert.equal(enrollment.model().enabled, true);
});

void test('a repeated transport failure fails the enrollment instead of looping', async () => {
  const { enrollment, sent } = harness([available(), preference(false, '1'), NETWORK, NETWORK]);
  await enrollment.enable();
  assert.equal(sent.filter(request => request.method === 'POST').length, 2);
  assert.equal(enrollment.getState().subscriptionId, null);
  assert.equal(enrollment.getState().notice, '서버에 연결하지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.');
});

void test('a session change during enrollment discards the result and stores no binding', async () => {
  const { enrollment, scope, values, sent } = harness([available(), preference(false, '1'), registered(ID, '1')]);
  const pending = enrollment.enable();
  scope.end();
  await pending;
  assert.equal(values[PUSH_BINDING_KEY], undefined, 'no subscription is recorded for a session that ended');
  assert.ok(sent.every(request => request.method !== 'PUT'), 'the preference of a stale session is not written');
  assert.equal(enrollment.getState().subscriptionId, null);
});

void test('an endpoint the server refuses for this account is replaced by a fresh one', async () => {
  const { enrollment, browser, sent, values } = harness(
    [available(), preference(false, '1'), failure(404, 'NOT_FOUND'), registered(ID, '1'), preference(true, '2')],
    { endpoints: ['https://push.example/new'] },
  );
  browser.subscription = { endpoint: 'https://push.example/old', keys: { p256dh: P256DH, auth: AUTH }, applicationServerKey: KEY };
  await enrollment.enable();
  const posts = sent.filter(request => request.method === 'POST');
  assert.equal((posts[0]?.body as { endpoint: string }).endpoint, 'https://push.example/old');
  assert.equal((posts[1]?.body as { endpoint: string }).endpoint, 'https://push.example/new');
  assert.equal(browser.unsubscribes, 1, 'the refused endpoint is withdrawn from the push service');
  assert.equal(values[PUSH_BINDING_KEY], `v1:account-one:session-one:${ID}:1`);
});

void test('a push service that re-issues the same endpoint leaves enrollment unavailable', async () => {
  const { enrollment, browser, sent, values } = harness(
    [available(), preference(false, '1'), failure(404, 'NOT_FOUND')],
    { endpoints: ['https://push.example/same'] },
  );
  browser.subscription = { endpoint: 'https://push.example/same', keys: { p256dh: P256DH, auth: AUTH }, applicationServerKey: KEY };
  await enrollment.enable();
  assert.equal(sent.filter(request => request.method === 'POST').length, 1, 'the same endpoint is not sent again');
  assert.ok(sent.every(request => request.method !== 'PUT'));
  assert.equal(values[PUSH_BINDING_KEY], undefined);
  assert.equal(enrollment.getState().subscriptionId, null);
  assert.match(enrollment.getState().notice, /같은 알림 주소/);
});

void test('a rotated application server key resubscribes before registering', async () => {
  const { enrollment, browser, sent } = harness(
    [available(), preference(false, '1'), registered(ID, '1'), preference(true, '2')],
    { endpoints: ['https://push.example/rotated'] },
  );
  browser.subscription = { endpoint: 'https://push.example/stale', keys: { p256dh: P256DH, auth: AUTH }, applicationServerKey: P256DH };
  await enrollment.enable();
  assert.equal(browser.unsubscribes, 1);
  assert.equal(browser.subscribes, 1);
  assert.equal((sent[2]?.body as { endpoint: string }).endpoint, 'https://push.example/rotated');
});

void test('a binding left by another account is released before this account enrolls', async () => {
  const { enrollment, browser, values } = harness(
    [available(), preference(false, '1')],
    { stored: `v1:account-two:session-nine:${OTHER_ID}:4` },
  );
  browser.subscription = { endpoint: 'https://push.example/previous', keys: { p256dh: P256DH, auth: AUTH }, applicationServerKey: KEY };
  await enrollment.refresh();
  assert.equal(browser.unsubscribes, 1, 'the previous account keeps no live subscription here');
  assert.equal(values[PUSH_BINDING_KEY], undefined);
  assert.equal(enrollment.getState().subscriptionId, null);
});

void test('a stored binding without a live browser subscription is not reported as enrolled', async () => {
  const { enrollment } = harness([available(), preference(true, '5')], { stored: `v1:account-one:session-one:${ID}:2` });
  await enrollment.refresh();
  assert.equal(enrollment.getState().subscriptionId, null);
  assert.equal(enrollment.model().enabled, false, 'a server preference alone is not a working browser subscription');
});

void test('a session rebinding on the same account sends the current generation', async () => {
  const { enrollment, sent } = harness(
    [available(), preference(false, '3'), registered(ID, '5'), preference(true, '4')],
    { stored: `v1:account-one:session-zero:${ID}:4` },
  );
  await enrollment.enable();
  assert.deepEqual(sent[2]?.body, { endpoint: 'https://push.example/a', keys: { p256dh: P256DH, auth: AUTH }, generation: '4' });
});

void test('disabling stops the preference, withdraws the subscription and unsubscribes', async () => {
  const { enrollment, browser, routes, sent, values } = harness(
    [preference(true, '6'), preference(false, '7'), { status: 204, json: null }],
    { stored: `v1:account-one:session-one:${ID}:2` },
  );
  browser.subscription = { endpoint: 'https://push.example/a', keys: { p256dh: P256DH, auth: AUTH }, applicationServerKey: KEY };
  await enrollment.disable();
  assert.deepEqual(routes(), ['GET /v1/me/notification-preferences', 'PUT /v1/me/notification-preferences', `DELETE /v1/me/push-subscriptions/${ID}`]);
  assert.deepEqual(sent[1]?.body, { pushEnabled: false, expectedGeneration: '6' });
  assert.deepEqual(sent[2]?.body, { generation: '2' }, 'removal is a compare-and-set on the stored generation');
  assert.equal(browser.unsubscribes, 1);
  assert.equal(values[PUSH_BINDING_KEY], undefined);
  assert.equal(enrollment.model().enabled, false);
});

void test('a subscription owned by another session is not removed by this one', async () => {
  const { enrollment, browser, routes, values } = harness(
    [preference(true, '6'), preference(false, '7')],
    { stored: `v1:account-one:session-zero:${ID}:2` },
  );
  browser.subscription = { endpoint: 'https://push.example/a', keys: { p256dh: P256DH, auth: AUTH }, applicationServerKey: KEY };
  await enrollment.disable();
  assert.deepEqual(routes(), ['GET /v1/me/notification-preferences', 'PUT /v1/me/notification-preferences'], 'only the owning session may withdraw it');
  assert.equal(browser.unsubscribes, 1);
  assert.equal(values[PUSH_BINDING_KEY], undefined);
  assert.match(enrollment.getState().notice, /다른 로그인 세션/);
});

void test('a server record that already moved on is reported, not presented as a clean removal', async () => {
  const { enrollment, browser, values } = harness(
    [preference(true, '6'), preference(false, '7'), failure(409, 'CONFLICT')],
    { stored: `v1:account-one:session-one:${ID}:2` },
  );
  browser.subscription = { endpoint: 'https://push.example/a', keys: { p256dh: P256DH, auth: AUTH }, applicationServerKey: KEY };
  await enrollment.disable();
  assert.match(enrollment.getState().notice, /이미 변경되어/);
  assert.equal(browser.unsubscribes, 1);
  assert.equal(values[PUSH_BINDING_KEY], undefined);
});

void test('a second action is refused while one is running', async () => {
  const { enrollment, sent } = harness([available(), preference(false, '1'), registered(ID, '1'), preference(true, '2')]);
  const first = enrollment.enable();
  await enrollment.enable();
  await first;
  assert.equal(sent.filter(request => request.path === '/v1/me/push-capabilities').length, 1);
});

void test('refresh reports real state without prompting or writing', async () => {
  const { enrollment, browser, routes } = harness([available(), preference(true, '4')], { stored: `v1:account-one:session-one:${ID}:2` });
  browser.subscription = { endpoint: 'https://push.example/a', keys: { p256dh: P256DH, auth: AUTH }, applicationServerKey: KEY };
  await enrollment.refresh();
  assert.deepEqual(routes(), ['GET /v1/me/push-capabilities', 'GET /v1/me/notification-preferences']);
  assert.equal(browser.prompts, 0);
  assert.equal(browser.subscribes, 0);
  assert.deepEqual(enrollment.model(), { support: 'supported', permission: 'granted', enabled: true, toggle: { enabled: true } });
});
