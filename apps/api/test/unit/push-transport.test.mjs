import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import webpush from 'web-push';
import { PushTransport, PushEndpointPolicy, publicPushAddress, readPushConfig, validatePushKeys } from '../../dist/modules/notifications/push-transport.js';

const keys = webpush.generateVAPIDKeys();
const config = readPushConfig({ APP_ENV: 'test', PUSH_TEST_VAPID_PUBLIC_KEY: keys.publicKey, PUSH_TEST_VAPID_PRIVATE_KEY: keys.privateKey, PUSH_TEST_VAPID_SUBJECT: 'mailto:push@example.com' });
const point = createECDH('prime256v1'); point.generateKeys();
const subscription = { endpoint: 'https://fcm.googleapis.com/send/private-token', p256dh: point.getPublicKey().toString('base64url'), auth_secret: randomBytes(16).toString('base64url') };
const policy = () => new PushEndpointPolicy(async () => [{ address: '142.250.1.1', family: 4 }]);

test('environment-specific VAPID pair and exact auth audience; absent provider explicit', async () => {
  assert.equal(config.audience, 'rogi-test');
  assert.deepEqual(readPushConfig({ APP_ENV: 'qa', PUSH_TEST_VAPID_PUBLIC_KEY: keys.publicKey }), { audience: 'rogi-qa', vapid: null });
  assert.throws(() => readPushConfig({ APP_ENV: 'qa', PUSH_QA_VAPID_PUBLIC_KEY: keys.publicKey }), /invalid_push_vapid/);
  assert.throws(() => readPushConfig({ APP_ENV: 'test', PUSH_TEST_VAPID_PUBLIC_KEY: keys.publicKey, PUSH_TEST_VAPID_PRIVATE_KEY: webpush.generateVAPIDKeys().privateKey, PUSH_TEST_VAPID_SUBJECT: 'mailto:push@example.com' }), /invalid_push_vapid/);
  const transport = new PushTransport(readPushConfig({ APP_ENV: 'test' }), policy(), () => assert.fail('network unavailable'));
  assert.deepEqual(await transport.send(subscription), { kind: 'unavailable' });
  assert.throws(() => transport.assertAvailable(), error => error.code === 'AUTH_UNAVAILABLE');
  assert.throws(() => validatePushKeys(Buffer.concat([Buffer.from([4]), Buffer.alloc(64)]).toString('base64url'), subscription.auth_secret), error => error.code === 'INVALID_REQUEST');
});

test('IPv4/v6 reserved addresses and provider/DNS attacks fail closed', async () => {
  for (const address of ['0.0.0.0', '127.0.0.1', '10.1.2.3', '100.64.1.1', '169.254.169.254', '172.31.0.1', '192.168.1.1', '192.0.0.1', '192.0.2.1', '198.18.0.1', '198.51.100.1', '203.0.113.1', '224.0.0.1', '255.255.255.255', '::1', '::', '::ffff:127.0.0.1', '::ffff:7f00:1', 'fc00::1', 'fe80::1', 'ff02::1', '2001:db8::1', '2001:20::1', '2002:7f00:1::1', '64:ff9b::a00:1', '3fff::1']) assert.equal(publicPushAddress(address), false, address);
  for (const address of ['8.8.8.8', '142.250.1.1', '2606:4700:4700::1111', '2001:4860:4860::8888']) assert.equal(publicPushAddress(address), true, address);
  for (const endpoint of ['http://fcm.googleapis.com/a', 'https://fcm.googleapis.com:444/a', 'https://fcm.googleapis.com.evil.example/a', 'https://evil.push.apple.com.evil.example/a', 'https://user@fcm.googleapis.com/a', 'https://fcm.googleapis.com/a#fragment', 'https://127.1/a', 'https://[::1]/a', 'https://2130706433/a']) await assert.rejects(policy().validate(endpoint), /invalid_push_endpoint/);
  const mixed = new PushEndpointPolicy(async () => [{ address: '8.8.8.8', family: 4 }, { address: '::1', family: 6 }]);
  await assert.rejects(mixed.validate(subscription.endpoint), /invalid_push_endpoint/);
});

function fakeRequest(status, chunks = [], inspect = () => {}) {
  return (options, callback) => {
    inspect(options);
    const req = new EventEmitter(); req.destroy = () => {};
    req.end = body => {
      assert.ok(Buffer.isBuffer(body));
      assert.ok(!body.includes(Buffer.from('sync_required')));
      globalThis.queueMicrotask(() => {
        const response = new EventEmitter(); response.statusCode = status; response.destroy = () => {};
        callback(response); for (const chunk of chunks) response.emit('data', chunk); response.emit('end');
      });
    };
    return req;
  };
}
test('real WebPush encryption, DNS pinning, no redirects and bounded response classification', async () => {
  let lookups = 0;
  const rebinding = new PushEndpointPolicy(async () => { lookups++; return [{ address: lookups === 1 ? '8.8.8.8' : '127.0.0.1', family: 4 }]; });
  const transport = new PushTransport(config, rebinding, fakeRequest(201, [], options => {
    assert.equal(options.hostname, '8.8.8.8'); assert.equal(options.servername, 'fcm.googleapis.com'); assert.equal(options.headers.Host, 'fcm.googleapis.com'); assert.equal(options.agent, false); assert.equal(options.rejectUnauthorized, true); assert.equal(options.lookup, undefined);
  }));
  const prepared = await transport.prepare(subscription);
  assert.deepEqual(await prepared.send(), { kind: 'accepted' }); assert.equal(lookups, 1);
  for (const [status, kind] of [[302, 'rejected'], [404, 'gone'], [410, 'gone'], [401, 'rejected'], [403, 'rejected'], [429, 'retry'], [503, 'retry']]) {
    let requests = 0;
    assert.deepEqual(await new PushTransport(config, policy(), fakeRequest(status, [], () => requests++)).send(subscription), { kind }); assert.equal(requests, 1);
  }
  assert.deepEqual(await new PushTransport(config, policy(), fakeRequest(201, [Buffer.alloc(8193)])).send(subscription), { kind: 'retry' });
});

test('hard deadline destroys stalled request and never reports acceptance', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let destroyed = false;
  const transport = new PushTransport(config, policy(), () => { const req = new EventEmitter(); req.end = () => {}; req.destroy = () => { destroyed = true; }; return req; });
  const prepared = await transport.prepare(subscription);
  const pending = prepared.send(); t.mock.timers.tick(5001);
  assert.deepEqual(await pending, { kind: 'retry' }); assert.equal(destroyed, true);
});
