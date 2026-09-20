import assert from 'node:assert/strict';
import test from 'node:test';

import { PushApi } from './api';
import { PUSH_BINDING_KEY, subscriptionFingerprint } from './binding';
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
const ROTATED_KEY = toBase64Url(Uint8Array.from([4, ...Array.from({ length: 64 }, (_, index) => (index * 9 + 17) & 0xff)]));
const P256DH = toBase64Url(Uint8Array.from([4, ...Array.from({ length: 64 }, (_, index) => (index * 3 + 11) & 0xff)]));
const AUTH = toBase64Url(Uint8Array.from(Array.from({ length: 16 }, (_, index) => (index * 13 + 2) & 0xff)));
const ID = '2f1a4b6c-8d3e-4f10-92a7-5c6d7e8f9a0b';
const OTHER_ID = '7b3c9d1e-4a5f-4c2b-8e7d-1f2a3b4c5d6e';
const IDENTITY = { account: 'account-one', session: 'session-one' };
const KEYS = { p256dh: P256DH, auth: AUTH };

const available = (): PushHttpResponse => ({ status: 200, json: { available: true, applicationServerKey: KEY } });
const unavailable = (): PushHttpResponse => ({ status: 200, json: { available: false } });
const preference = (pushEnabled: boolean, generation: string): PushHttpResponse => ({ status: 200, json: { pushEnabled, generation } });
const registered = (id: string, generation: string): PushHttpResponse => ({ status: 201, json: { id, generation } });
const failure = (status: number, code: string): PushHttpResponse => ({ status, json: { error: { code } } });
const NETWORK = Symbol('network failure');

const subscription = (endpoint: string, applicationServerKey: string | null = KEY): BrowserSubscription => ({ endpoint, keys: KEYS, applicationServerKey });

/** The record this browser would have written after registering `endpoint` under `key`. */
async function record(endpoint: string, generation = '2', session = 'session-one', key = KEY, account = 'account-one'): Promise<string> {
  return `v3:${account}:${session}:${ID}:${generation}:${await subscriptionFingerprint(endpoint, KEYS, key)}`;
}

class TestBrowser implements PushBrowser {
  supportValue: PushSupport = 'supported';
  permissionValue: PushPermission = 'granted';
  promptResult: PushPermission = 'granted';
  prompts = 0;
  subscribes = 0;
  unsubscribes = 0;
  live: BrowserSubscription | null = null;
  readonly order: string[];
  private readonly endpoints: string[];

  constructor(endpoints: string[], order: string[]) {
    this.endpoints = [...endpoints];
    this.order = order;
  }

  support(): PushSupport { return this.supportValue; }
  permission(): PushPermission { return this.permissionValue; }

  async requestPermission(): Promise<PushPermission> {
    this.prompts += 1;
    this.order.push('prompt');
    this.permissionValue = this.promptResult;
    return this.promptResult;
  }

  async current(): Promise<BrowserSubscription | null> { return this.live; }

  async subscribe(applicationServerKey: string): Promise<BrowserSubscription> {
    this.subscribes += 1;
    const endpoint = this.endpoints.length > 1 ? this.endpoints.shift() : this.endpoints[0];
    this.live = subscription(endpoint ?? 'https://push.example/a', applicationServerKey);
    return this.live;
  }

  async unsubscribe(): Promise<boolean> {
    this.unsubscribes += 1;
    const had = this.live !== null;
    this.live = null;
    return had;
  }
}

interface Options {
  stored?: string;
  endpoints?: string[];
  subscription?: BrowserSubscription;
  permission?: PushPermission;
  promptResult?: PushPermission;
  support?: PushSupport;
}

function harness(script: (PushHttpResponse | typeof NETWORK)[], options: Options = {}) {
  const sent: PushHttpRequest[] = [];
  const order: string[] = [];
  const queue = [...script];
  const http: PushHttp = async request => {
    sent.push(request);
    order.push(`${request.method} ${request.path}`);
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
  const browser = new TestBrowser(options.endpoints ?? ['https://push.example/a'], order);
  if (options.subscription !== undefined) browser.live = options.subscription;
  if (options.permission !== undefined) browser.permissionValue = options.permission;
  if (options.promptResult !== undefined) browser.promptResult = options.promptResult;
  if (options.support !== undefined) browser.supportValue = options.support;
  const scope = new PushScope(IDENTITY);
  const enrollment = new PushEnrollment({ api: new PushApi(http), browser, storage, scope });
  const routes = (): string[] => sent.map(request => `${request.method} ${request.path}`);
  return { enrollment, browser, scope, storage, sent, routes, order, values };
}

/**
 * The real flow: settings opens and reads state, and only then can the user press the toggle.
 * Priming consumes the capability and preference reads, so the recorded request and prompt
 * order afterwards describes the click alone.
 */
async function primed(script: (PushHttpResponse | typeof NETWORK)[], options: Options = {}, capability: PushHttpResponse = available()) {
  const context = harness([capability, preference(false, '1'), ...script], options);
  await context.enrollment.refresh();
  context.sent.length = 0;
  context.order.length = 0;
  return context;
}

void test('the permission prompt runs before any request, inside the user action', async () => {
  const context = await primed([available(), preference(false, '2'), registered(ID, '1'), preference(true, '3')], { permission: 'not-asked' });
  await context.enrollment.enable();
  assert.equal(context.order[0], 'prompt', 'no HTTP round trip may consume the transient activation first');
  assert.equal(context.browser.prompts, 1);
  assert.deepEqual(context.order.slice(1), [
    'GET /v1/me/push-capabilities',
    'GET /v1/me/notification-preferences',
    'POST /v1/me/push-subscriptions',
    'PUT /v1/me/notification-preferences',
  ]);
  assert.equal(context.enrollment.model().enabled, true);
});

void test('enabling registers the endpoint before the preference is stored', async () => {
  const context = await primed([available(), preference(false, '2'), registered(ID, '1'), preference(true, '3')]);
  await context.enrollment.enable();
  assert.deepEqual(context.routes(), [
    'GET /v1/me/push-capabilities',
    'GET /v1/me/notification-preferences',
    'POST /v1/me/push-subscriptions',
    'PUT /v1/me/notification-preferences',
  ]);
  assert.deepEqual(context.sent[2]?.body, { endpoint: 'https://push.example/a', keys: KEYS }, 'a new endpoint carries no generation');
  assert.deepEqual(context.sent[3]?.body, { pushEnabled: true, expectedGeneration: '2' });
  assert.equal(context.browser.prompts, 0, 'an already granted permission is not asked again');
  assert.equal(context.values[PUSH_BINDING_KEY], await record('https://push.example/a', '1'), 'the record binds the exact subscription it registered');
  assert.deepEqual(context.enrollment.model(), { support: 'supported', permission: 'granted', enabled: true, toggle: { enabled: true } });
});

void test('a denied prompt stores nothing and leaves the toggle off', async () => {
  const context = await primed([], { permission: 'not-asked', promptResult: 'denied' });
  await context.enrollment.enable();
  assert.equal(context.browser.prompts, 1);
  assert.equal(context.browser.subscribes, 0);
  assert.deepEqual(context.routes(), [], 'no registration and no preference write');
  const model = context.enrollment.model();
  assert.equal(model.enabled, false);
  assert.equal(model.permission, 'denied');
  assert.deepEqual(model.toggle, { enabled: false, reason: '브라우저에서 알림이 차단되어 있습니다. 브라우저 설정에서 허용해 주세요.' });
});

void test('an unavailable server capability never prompts, registers or reports success', async () => {
  const context = await primed([], { permission: 'not-asked' }, unavailable());
  await context.enrollment.enable();
  assert.equal(context.browser.prompts, 0);
  assert.equal(context.browser.subscribes, 0);
  assert.deepEqual(context.routes(), []);
  assert.equal(context.enrollment.getState().serverAvailable, false);
  assert.equal(context.enrollment.getState().notice, '서버의 웹 푸시 준비 상태를 확인한 뒤 다시 시도해 주세요.');
});

void test('a capability that has not been read yet is never prompted against', async () => {
  const context = harness([], { permission: 'not-asked' });
  await context.enrollment.enable();
  assert.equal(context.browser.prompts, 0, 'the toggle waits for a confirmed capability instead of prompting blindly');
  assert.deepEqual(context.routes(), []);
  assert.deepEqual(context.enrollment.model().toggle, { enabled: false, reason: '알림 설정을 확인하는 중입니다.' });
});

void test('a capability request that fails leaves an unavailable state, not an enabled toggle', async () => {
  const context = harness([failure(503, 'AUTH_UNAVAILABLE')], { permission: 'not-asked' });
  await context.enrollment.refresh();
  assert.equal(context.enrollment.getState().notice, '지금은 알림을 켤 수 없습니다. 서버의 웹 푸시 설정이 준비되면 다시 시도해 주세요.');
  assert.equal(context.enrollment.model().enabled, null);
  await context.enrollment.enable();
  assert.equal(context.browser.prompts, 0);
});

void test('an unsupported browser never reaches the network', async () => {
  const context = harness([], { support: 'install-required' });
  await context.enrollment.enable();
  assert.deepEqual(context.routes(), []);
  assert.equal(context.browser.prompts, 0);
  assert.equal(context.enrollment.getState().notice, '홈 화면에 로기챗을 추가한 뒤 알림을 켤 수 있습니다.');
});

void test('a preference conflict re-reads the stored value and never replays the desired one', async () => {
  const context = await primed([available(), preference(false, '2'), registered(ID, '1'), failure(409, 'CONFLICT'), preference(false, '9')]);
  await context.enrollment.enable();
  assert.deepEqual(context.routes(), [
    'GET /v1/me/push-capabilities',
    'GET /v1/me/notification-preferences',
    'POST /v1/me/push-subscriptions',
    'PUT /v1/me/notification-preferences',
    'GET /v1/me/notification-preferences',
  ]);
  assert.equal(context.sent.filter(request => request.method === 'PUT').length, 1, 'the stale desired value is not retried');
  const state = context.enrollment.getState();
  assert.ok(state.needsDecision, 'the user has to choose again against the current value');
  assert.equal(state.preferenceEnabled, false);
  assert.equal(state.preferenceGeneration, '9');
  assert.equal(context.enrollment.model().enabled, false, 'the toggle shows the stored value, not the attempt');
});

void test('a lost registration response is retried once with the identical initial request', async () => {
  const context = await primed([available(), preference(false, '2'), NETWORK, registered(ID, '1'), preference(true, '3')]);
  await context.enrollment.enable();
  const posts = context.sent.filter(request => request.method === 'POST');
  assert.equal(posts.length, 2);
  assert.deepEqual(posts[0]?.body, posts[1]?.body, 'the retry is byte-identical');
  assert.equal((posts[1]?.body as { generation?: string }).generation, undefined, 'the retry stays generation-free');
  assert.equal(context.routes().filter(route => route.startsWith('PUT')).length, 1);
  assert.equal(context.enrollment.model().enabled, true);
});

void test('a repeated transport failure fails the enrollment instead of looping', async () => {
  const context = await primed([available(), preference(false, '2'), NETWORK, NETWORK]);
  await context.enrollment.enable();
  assert.equal(context.sent.filter(request => request.method === 'POST').length, 2);
  assert.equal(context.enrollment.getState().subscriptionId, null);
  assert.equal(context.enrollment.getState().notice, '서버에 연결하지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.');
});

void test('a session change during enrollment discards the result and stores no binding', async () => {
  const context = await primed([available(), preference(false, '2'), registered(ID, '1')]);
  const pending = context.enrollment.enable();
  context.scope.end();
  await pending;
  assert.equal(context.values[PUSH_BINDING_KEY], undefined, 'no subscription is recorded for a session that ended');
  assert.ok(context.sent.every(request => request.method !== 'PUT'), 'the preference of a stale session is not written');
  assert.equal(context.enrollment.getState().subscriptionId, null);
});

void test('an endpoint the server refuses for this account is replaced by a fresh one', async () => {
  const context = await primed(
    [available(), preference(false, '2'), failure(404, 'NOT_FOUND'), registered(ID, '1'), preference(true, '3')],
    { endpoints: ['https://push.example/new'], subscription: subscription('https://push.example/old') },
  );
  await context.enrollment.enable();
  const posts = context.sent.filter(request => request.method === 'POST');
  assert.equal((posts[0]?.body as { endpoint: string }).endpoint, 'https://push.example/old');
  assert.equal((posts[1]?.body as { endpoint: string }).endpoint, 'https://push.example/new');
  assert.equal(context.browser.unsubscribes, 1, 'the refused endpoint is withdrawn from the push service');
  assert.equal(context.values[PUSH_BINDING_KEY], await record('https://push.example/new', '1'), 'the record binds the endpoint that was accepted');
});

void test('a push service that re-issues the same endpoint leaves enrollment unavailable', async () => {
  const context = await primed(
    [available(), preference(false, '2'), failure(404, 'NOT_FOUND')],
    { endpoints: ['https://push.example/same'], subscription: subscription('https://push.example/same') },
  );
  await context.enrollment.enable();
  assert.equal(context.sent.filter(request => request.method === 'POST').length, 1, 'the same endpoint is not sent again');
  assert.ok(context.sent.every(request => request.method !== 'PUT'));
  assert.equal(context.values[PUSH_BINDING_KEY], undefined);
  assert.equal(context.enrollment.getState().subscriptionId, null);
  assert.match(context.enrollment.getState().notice, /같은 알림 주소/);
});

void test('a rotated application server key resubscribes before registering', async () => {
  const context = await primed(
    [available(), preference(false, '2'), registered(ID, '1'), preference(true, '3')],
    { endpoints: ['https://push.example/rotated'], subscription: subscription('https://push.example/stale', ROTATED_KEY) },
  );
  await context.enrollment.enable();
  assert.equal(context.browser.unsubscribes, 1);
  assert.equal(context.browser.subscribes, 1);
  assert.equal((context.sent[2]?.body as { endpoint: string }).endpoint, 'https://push.example/rotated');
});

void test('a binding left by another account is released before this account enrolls', async () => {
  const context = harness([available(), preference(false, '1')], {
    stored: `v3:account-two:session-nine:${OTHER_ID}:4:${'A'.repeat(43)}`,
    subscription: subscription('https://push.example/previous'),
  });
  await context.enrollment.refresh();
  assert.equal(context.browser.unsubscribes, 1, 'the previous account keeps no live subscription here');
  assert.equal(context.values[PUSH_BINDING_KEY], undefined);
  assert.equal(context.enrollment.getState().subscriptionId, null);
  assert.equal(context.enrollment.getState().ownsBinding, false);
});

void test('a stored binding without a live browser subscription is not reported as enrolled', async () => {
  const context = harness([available(), preference(true, '5')], { stored: await record('https://push.example/a') });
  await context.enrollment.refresh();
  assert.equal(context.enrollment.getState().subscriptionId, null);
  assert.equal(context.enrollment.model().enabled, false, 'a server preference alone is not a working browser subscription');
  assert.deepEqual(context.enrollment.model().toggle, { enabled: true }, 'the user can still clear what the server holds');
});

void test('a binding from an earlier session of this account is not this session enrollment', async () => {
  const context = harness([available(), preference(true, '5')], {
    stored: await record('https://push.example/a', '2', 'session-zero'),
    subscription: subscription('https://push.example/a'),
  });
  await context.enrollment.refresh();
  assert.equal(context.enrollment.getState().subscriptionId, null, 'only the session that registered it is enrolled with it');
  assert.ok(context.enrollment.getState().ownsBinding, 'the record still means there is state to clear');
  assert.equal(context.enrollment.model().enabled, false);
  assert.deepEqual(context.enrollment.model().toggle, { enabled: true });
});

void test('a subscription created with a key the server has rotated away from is not enrolled', async () => {
  const context = harness([available(), preference(true, '5')], {
    stored: await record('https://push.example/a'),
    subscription: subscription('https://push.example/a', ROTATED_KEY),
  });
  await context.enrollment.refresh();
  assert.equal(context.enrollment.getState().subscriptionId, null, 'a rotated key cannot receive anything');
  assert.equal(context.enrollment.model().enabled, false);
  assert.deepEqual(context.enrollment.model().toggle, { enabled: true });
});

void test('a hidden browser key is answered by the subscription the record was written for', async () => {
  const context = harness([available(), preference(true, '5')], {
    stored: await record('https://push.example/a'),
    subscription: subscription('https://push.example/a', null),
  });
  await context.enrollment.refresh();
  assert.equal(context.enrollment.getState().subscriptionId, ID, 'this session registered this exact subscription under the key the server still uses');
  assert.equal(context.enrollment.model().enabled, true);
});

void test('a hidden browser key with no recorded key is unknown, so not enrolled', async () => {
  const context = harness([available(), preference(true, '5')], {
    stored: `v1:account-one:session-one:${ID}:2`,
    subscription: subscription('https://push.example/a', null),
  });
  await context.enrollment.refresh();
  assert.equal(context.enrollment.getState().subscriptionId, null, 'an unknown key is never assumed to be the current one');
  assert.equal(context.enrollment.model().enabled, false);
  assert.ok(context.enrollment.getState().ownsBinding);
  assert.equal(context.enrollment.intent(), 'disable', 'the press must clean up, not enrol');
});

void test('a hidden browser key recorded under a key the server rotated away from is not enrolled', async () => {
  const context = harness([available(), preference(true, '5')], {
    stored: await record('https://push.example/a', '2', 'session-one', ROTATED_KEY),
    subscription: subscription('https://push.example/a', null),
  });
  await context.enrollment.refresh();
  assert.equal(context.enrollment.getState().subscriptionId, null, 'the registration was made under a key the server no longer uses');
  assert.equal(context.enrollment.model().enabled, false);
});

void test('a browser naming a key the server no longer uses is not enrolled', async () => {
  const context = harness([available(), preference(true, '5')], {
    stored: await record('https://push.example/a'),
    subscription: subscription('https://push.example/a', ROTATED_KEY),
  });
  await context.enrollment.refresh();
  assert.equal(context.enrollment.getState().subscriptionId, null, 'the subscription the browser holds is the ground truth');
});

void test('a replaced subscription under the same key is not the registered one', async () => {
  const context = harness([available(), preference(true, '5')], {
    stored: await record('https://push.example/registered'),
    subscription: subscription('https://push.example/replaced'),
  });
  await context.enrollment.refresh();
  assert.equal(context.enrollment.getState().subscriptionId, null, 'the push service replaced the endpoint the server knows');
  assert.equal(context.enrollment.model().enabled, false);
  assert.ok(context.enrollment.getState().ownsBinding);
  assert.equal(context.enrollment.intent(), 'disable', 'the server still holds the old registration to clear');
});

void test('a hidden-key browser whose subscription was replaced is not enrolled either', async () => {
  const context = harness([available(), preference(true, '5')], {
    stored: await record('https://push.example/registered'),
    subscription: subscription('https://push.example/replaced', null),
  });
  await context.enrollment.refresh();
  assert.equal(context.enrollment.getState().subscriptionId, null, 'a hidden key cannot make a different endpoint the registered one');
});

void test('a permission withdrawn after enrollment reports off and still allows turning it off', async () => {
  const context = harness([available(), preference(true, '5')], {
    stored: await record('https://push.example/a'),
    subscription: subscription('https://push.example/a'),
    permission: 'denied',
  });
  await context.enrollment.refresh();
  const model = context.enrollment.model();
  assert.equal(model.enabled, false, 'a blocked permission delivers nothing, whatever the server stored');
  assert.equal(model.permission, 'denied');
  assert.deepEqual(model.toggle, { enabled: true }, 'the user must still be able to release the subscription');
  assert.equal(context.enrollment.intent(), 'disable', 'pressing it cleans up rather than trying to enrol again');
});

void test('a server that lost its Web Push capability is not reported as enrolled', async () => {
  const context = harness([unavailable(), preference(true, '5')], {
    stored: await record('https://push.example/a'),
    subscription: subscription('https://push.example/a'),
  });
  await context.enrollment.refresh();
  assert.equal(context.enrollment.model().enabled, false);
  assert.deepEqual(context.enrollment.model().toggle, { enabled: true });
});

void test('a session rebinding of the recorded endpoint sends its current generation', async () => {
  const context = await primed(
    [available(), preference(false, '3'), registered(ID, '5'), preference(true, '4')],
    { stored: await record('https://push.example/a', '4', 'session-zero'), subscription: subscription('https://push.example/a') },
  );
  await context.enrollment.enable();
  assert.equal(context.browser.subscribes, 0, 'the endpoint the record was written for is kept');
  assert.deepEqual(context.sent[2]?.body, { endpoint: 'https://push.example/a', keys: KEYS, generation: '4' });
});

void test('disabling stops the preference, withdraws the subscription and unsubscribes', async () => {
  const context = harness(
    [available(), preference(true, '6'), preference(false, '7'), { status: 204, json: null }],
    { stored: await record('https://push.example/a'), subscription: subscription('https://push.example/a') },
  );
  await context.enrollment.refresh();
  assert.equal(context.enrollment.model().enabled, true);
  context.sent.length = 0;
  await context.enrollment.disable();
  assert.deepEqual(context.routes(), ['PUT /v1/me/notification-preferences', `DELETE /v1/me/push-subscriptions/${ID}`]);
  assert.deepEqual(context.sent[0]?.body, { pushEnabled: false, expectedGeneration: '6' });
  assert.deepEqual(context.sent[1]?.body, { generation: '2' }, 'removal is a compare-and-set on the stored generation');
  assert.equal(context.browser.unsubscribes, 1);
  assert.equal(context.values[PUSH_BINDING_KEY], undefined);
  assert.equal(context.enrollment.model().enabled, false);
});

void test('a subscription owned by another session is not removed by this one', async () => {
  const context = harness(
    [preference(true, '6'), preference(false, '7')],
    { stored: await record('https://push.example/a', '2', 'session-zero'), subscription: subscription('https://push.example/a') },
  );
  await context.enrollment.disable();
  assert.deepEqual(context.routes(), ['GET /v1/me/notification-preferences', 'PUT /v1/me/notification-preferences'], 'only the owning session may withdraw it');
  assert.equal(context.browser.unsubscribes, 1);
  assert.equal(context.values[PUSH_BINDING_KEY], undefined);
  assert.match(context.enrollment.getState().notice, /다른 로그인 세션/);
});

void test('a server record that already moved on is reported, not presented as a clean removal', async () => {
  const context = harness(
    [preference(true, '6'), preference(false, '7'), failure(409, 'CONFLICT')],
    { stored: await record('https://push.example/a'), subscription: subscription('https://push.example/a') },
  );
  await context.enrollment.disable();
  assert.match(context.enrollment.getState().notice, /이미 변경되어/);
  assert.equal(context.browser.unsubscribes, 1);
  assert.equal(context.values[PUSH_BINDING_KEY], undefined);
});

void test('a second action is refused while one is running', async () => {
  const context = await primed([available(), preference(false, '2'), registered(ID, '1'), preference(true, '3')]);
  const first = context.enrollment.enable();
  await context.enrollment.enable();
  await first;
  assert.equal(context.sent.filter(request => request.path === '/v1/me/push-capabilities').length, 1);
});

void test('refresh reports real state without prompting or writing', async () => {
  const context = harness([available(), preference(true, '4')], {
    stored: await record('https://push.example/a'),
    subscription: subscription('https://push.example/a'),
  });
  await context.enrollment.refresh();
  assert.deepEqual(context.routes(), ['GET /v1/me/push-capabilities', 'GET /v1/me/notification-preferences']);
  assert.equal(context.browser.prompts, 0);
  assert.equal(context.browser.subscribes, 0);
  assert.deepEqual(context.enrollment.model(), { support: 'supported', permission: 'granted', enabled: true, toggle: { enabled: true } });
});

void test('the toggle action is explicit, so a cleanup press never tries to enrol', async () => {
  const context = harness(
    [available(), preference(true, '6'), preference(false, '7'), { status: 204, json: null }],
    {
      stored: await record('https://push.example/a'),
      subscription: subscription('https://push.example/a'),
      permission: 'denied',
    },
  );
  await context.enrollment.refresh();
  assert.equal(context.enrollment.model().enabled, false, 'a blocked permission cannot receive anything');
  assert.equal(context.enrollment.intent(), 'disable');
  context.sent.length = 0;
  await context.enrollment.toggle();
  assert.deepEqual(context.routes(), ['PUT /v1/me/notification-preferences', `DELETE /v1/me/push-subscriptions/${ID}`], 'the press cleaned up instead of prompting');
  assert.deepEqual(context.sent[0]?.body, { pushEnabled: false, expectedGeneration: '6' });
  assert.equal(context.browser.prompts, 0);
  assert.equal(context.values[PUSH_BINDING_KEY], undefined);
  // With nothing left to clear and the permission still blocked in browser settings, there is
  // no action left to offer: enrolling would need a permission this page cannot grant.
  assert.equal(context.enrollment.intent(), null);
  assert.deepEqual(context.enrollment.model().toggle, { enabled: false, reason: '브라우저에서 알림이 차단되어 있습니다. 브라우저 설정에서 허용해 주세요.' });
});

void test('the toggle enrols when there is nothing stored and does nothing while blocked', async () => {
  const eligible = await primed([available(), preference(false, '2'), registered(ID, '1'), preference(true, '3')]);
  assert.equal(eligible.enrollment.intent(), 'enable');
  await eligible.enrollment.toggle();
  assert.ok(eligible.routes().includes('POST /v1/me/push-subscriptions'));
  assert.equal(eligible.enrollment.model().enabled, true);

  const unread = harness([]);
  assert.equal(unread.enrollment.intent(), null, 'an unread capability offers no action');
  await unread.enrollment.toggle();
  assert.deepEqual(unread.routes(), []);
  assert.equal(unread.browser.prompts, 0);
});

void test('an existing subscription of unknown key is replaced instead of labelled current', async () => {
  const context = await primed(
    [available(), preference(false, '2'), registered(ID, '1'), preference(true, '3')],
    { endpoints: ['https://push.example/fresh'], subscription: subscription('https://push.example/unknown', null) },
  );
  await context.enrollment.enable();
  assert.equal(context.browser.subscribes, 1, 'a subscription nothing can place under a key is not registered as-is');
  assert.equal(context.browser.unsubscribes, 1);
  assert.equal((context.sent[2]?.body as { endpoint: string }).endpoint, 'https://push.example/fresh');
  assert.equal(context.values[PUSH_BINDING_KEY], await record('https://push.example/fresh', '1'));
  assert.equal(context.enrollment.model().enabled, true);
});

void test('an existing subscription this browser registered under the current key is reused', async () => {
  const context = await primed(
    [available(), preference(false, '2'), registered(ID, '1'), preference(true, '3')],
    { stored: await record('https://push.example/known'), subscription: subscription('https://push.example/known', null) },
  );
  await context.enrollment.enable();
  assert.equal(context.browser.subscribes, 0, 'its own record places it under the current key');
  assert.equal(context.browser.unsubscribes, 0);
  assert.equal((context.sent[2]?.body as { endpoint: string }).endpoint, 'https://push.example/known');
  assert.equal(context.enrollment.model().enabled, true);
});

void test('a subscription replaced after enrolling stops reporting as enrolled', async () => {
  const context = await primed([available(), preference(false, '2'), registered(ID, '1'), preference(true, '3'), available(), preference(true, '3')]);
  await context.enrollment.enable();
  assert.equal(context.enrollment.model().enabled, true);

  // The push service hands the browser a different endpoint under the same key.
  context.browser.live = subscription('https://push.example/replaced');
  await context.enrollment.refresh();
  assert.equal(context.enrollment.model().enabled, false, 'the server knows the endpoint this browser no longer has');
  assert.equal(context.enrollment.intent(), 'disable');
});

void test('a rebinding sends its generation only for the endpoint the record was written for', async () => {
  const context = await primed(
    [available(), preference(false, '3'), registered(ID, '5'), preference(true, '4')],
    { stored: await record('https://push.example/other', '4', 'session-zero'), endpoints: ['https://push.example/fresh'], subscription: subscription('https://push.example/unknown', null) },
  );
  await context.enrollment.enable();
  assert.equal(context.browser.subscribes, 1, 'the unknown subscription is replaced');
  assert.deepEqual(context.sent[2]?.body, { endpoint: 'https://push.example/fresh', keys: KEYS }, 'a new endpoint is not a rebinding and carries no generation');
});
