import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomBytes, randomUUID, verify } from 'node:crypto';
import { mkdtempSync, writeFileSync, chmodSync, symlinkSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { URLSearchParams } from 'node:url';
import tls from 'node:tls';
import { createServer } from 'node:net';
import { parseNativePushConfig, readNativePushConfig } from '../../dist/modules/notifications/native-push-config.js';
import { parseNativePush, sealNativeToken, openNativeToken, nativeBindingSecret, nativeTokenDigest } from '../../dist/modules/notifications/native-push-contract.js';
import { NativePushTransport, classifyNativePush } from '../../dist/modules/notifications/native-push-transport.js';
import { NativePushController } from '../../dist/modules/notifications/native-push.controller.js';

const ec = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
const secret = () => ({ environment: 'test', encryptionKey: randomBytes(32).toString('hex'),
  apnsTeamId: 'ABCDEFGHIJ', apnsKeyId: '0123456789', apnsTopic: 'chat.example.tests', apnsEnvironment: 'sandbox',
  apnsPrivateKey: ec.privateKey.export({ type: 'pkcs8', format: 'pem' }),
  fcmProjectId: 'isolated-project', fcmClientEmail: 'sender@isolated-project.iam.gserviceaccount.com',
  fcmPrivateKey: rsa.privateKey.export({ type: 'pkcs8', format: 'pem' }), fcmApplicationId: 'chat.example.tests' });
const config = () => parseNativePushConfig(Buffer.from(JSON.stringify(secret())), 'test');
const input = () => ({ provider: 'APNS', token: randomBytes(32).toString('hex'), installationId: randomUUID(), bindingSecret: randomBytes(32).toString('base64url') });

test('native config validates exact environment, complete provider groups, key types and duplicate keys', () => {
  assert.ok(config().apns); assert.ok(config().fcm);
  for (const patch of [{ environment: 'qa' }, { encryptionKey: 'a' }, { apnsEnvironment: 'qa' }, { apnsPrivateKey: secret().fcmPrivateKey },
    { fcmPrivateKey: secret().apnsPrivateKey }, { fcmClientEmail: 'user@example.com' },
    { fcmClientEmail: 'sender@other-project.iam.gserviceaccount.com' }, { fcmApplicationId: '../other' }, { extra: 'value' }]) {
    assert.throws(() => parseNativePushConfig(Buffer.from(JSON.stringify({ ...secret(), ...patch })), 'test'), /invalid_native_push_config/);
  }
  const text = JSON.stringify(secret());
  assert.throws(() => parseNativePushConfig(Buffer.from(text.replace('{', '{"environment":"test",')), 'test'));
  assert.throws(() => parseNativePushConfig(Buffer.from(text.replace('"environment"', '"environ\\u006dent"')), 'test'));
  assert.throws(() => parseNativePushConfig(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text)]), 'test'));
});
test('native config absent is unavailable, supplied bad file is fatal, no symlink/world-readable secret', t => {
  assert.equal(readNativePushConfig({ APP_ENV: 'test' }), undefined);
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'native-push-secret-'))); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'config.json'); writeFileSync(file, JSON.stringify(secret()), { mode: 0o600 });
  assert.ok(readNativePushConfig({ APP_ENV: 'test', PUSH_NATIVE_SECRET_FILE: file }).fcm);
  assert.throws(() => readNativePushConfig({ APP_ENV: 'qa', PUSH_NATIVE_SECRET_FILE: file }));
  symlinkSync(file, join(dir, 'link')); assert.throws(() => readNativePushConfig({ APP_ENV: 'test', PUSH_NATIVE_SECRET_FILE: join(dir, 'link') }));
  chmodSync(file, 0o644); assert.throws(() => readNativePushConfig({ APP_ENV: 'test', PUSH_NATIVE_SECRET_FILE: file }));
});
test('strict native token and binding grammar; no provider URL or arbitrary user selector', () => {
  const valid = input(); assert.deepEqual(parseNativePush(valid), valid);
  for (const patch of [{ provider: 'WEB' }, { token: 'https://example.com' }, { token: valid.token.toUpperCase() },
    { bindingSecret: 'a'.repeat(42) + '_' }, { generation: '01' }, { generation: '18446744073709551616' },
    { installationId: 'device-id' }, { userId: randomUUID() }]) assert.throws(() => parseNativePush({ ...valid, ...patch }));
  assert.equal(nativeBindingSecret(valid.bindingSecret), valid.bindingSecret);
  assert.equal(parseNativePush({ ...valid, provider: 'FCM', token: 'isolated:token_' + 'A'.repeat(40) }).provider, 'FCM');
});
test('native tokens encrypted with row audience and generation binding', () => {
  const token = input().token, key = randomBytes(32), aad = `rogi-test:${randomUUID()}:1`;
  const sealed = sealNativeToken(token, key, aad);
  assert.equal(sealed.includes(Buffer.from(token)), false); assert.equal(openNativeToken(sealed, key, aad), token);
  assert.throws(() => openNativeToken(sealed, key, aad + '2')); assert.throws(() => openNativeToken(sealed, randomBytes(32), aad));
  sealed[15] ^= 1; assert.throws(() => openNativeToken(sealed, key, aad));
  assert.notDeepEqual(nativeTokenDigest('rogi-test', 'ios', 'APNS', token), nativeTokenDigest('rogi-qa', 'ios', 'APNS', token));
});
test('provider error classification never invalidates on generic 404/configuration/auth failure', () => {
  const b = value => Buffer.from(JSON.stringify(value));
  for (const provider of ['APNS', 'FCM']) {
    assert.equal(classifyNativePush(provider, 404, b({ error: {} })).kind, 'rejected');
    assert.equal(classifyNativePush(provider, 403, b({})).kind, 'unavailable');
    assert.equal(classifyNativePush(provider, 429, b({})).kind, 'retry');
    assert.equal(classifyNativePush(provider, 500, b({})).kind, 'retry');
    assert.equal(classifyNativePush(provider, 200, Buffer.from('not-json')).kind, 'retry');
  }
  assert.equal(classifyNativePush('APNS', 200, Buffer.alloc(0)).kind, 'accepted');
  assert.equal(classifyNativePush('APNS', 410, b({ reason: 'Unregistered' })).kind, 'gone');
  assert.equal(classifyNativePush('APNS', 400, b({ reason: 'BadDeviceToken' })).kind, 'rejected');
  assert.equal(classifyNativePush('APNS', 400, b({ reason: 'DeviceTokenNotForTopic' })).kind, 'rejected');
  assert.equal(classifyNativePush('FCM', 404, b({ error: { details: [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: 'UNREGISTERED' }] } })).kind, 'gone');
  assert.equal(classifyNativePush('FCM', 200, b({ name: 'projects/isolated-project/messages/receipt' })).kind, 'accepted');
});
test('real ES256 APNs signature and visible generic alert with fixed topic/environment', async () => {
  const c = config(), transport = new NativePushTransport(c), token = input().token;
  let call;
  transport.post = async (...args) => { call = args; return { status: 200, body: Buffer.alloc(0) }; };
  const prepared = await transport.prepare('APNS', token); assert.equal((await prepared.send()).kind, 'accepted');
  assert.equal(call[0], 'api.sandbox.push.apple.com'); assert.equal(call[1], `/3/device/${token}`); assert.equal(call[4], true);
  assert.equal(call[2]['apns-push-type'], 'alert'); assert.equal(call[2]['apns-priority'], '10');
  assert.ok(Number(call[2]['apns-expiration']) > Date.now() / 1000);
  assert.deepEqual(JSON.parse(call[3]), { aps: { alert: { title: '로기챗', body: '확인할 내용이 있는지 로기챗에서 확인해 주세요.' }, sound: 'default', 'content-available': 1 }, type: 'sync_required', version: 1 });
  const jwt = call[2].authorization.slice(7).split('.');
  assert.ok(verify('sha256', Buffer.from(jwt.slice(0, 2).join('.')), { key: ec.publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(jwt[2], 'base64url')));
  assert.equal(JSON.parse(Buffer.from(jwt[0], 'base64url')).alg, 'ES256');
});
test('FCM uses actual service-account JWT OAuth and high-priority data-only request, caches bounded token', async () => {
  const c = config(), transport = new NativePushTransport(c), calls = [];
  transport.post = async (...args) => {
    calls.push(args);
    return args[0] === 'oauth2.googleapis.com' ? { status: 200, body: Buffer.from(JSON.stringify({ access_token: 'isolated_access_token_1234', token_type: 'Bearer', expires_in: 3600 })) }
      : { status: 200, body: Buffer.from(JSON.stringify({ name: 'projects/isolated-project/messages/receipt' })) };
  };
  for (let i = 0; i < 2; i++) assert.equal((await (await transport.prepare('FCM', 'isolated:token_' + 'A'.repeat(40))).send()).kind, 'accepted');
  assert.equal(calls.filter(call => call[0] === 'oauth2.googleapis.com').length, 1);
  const jwt = new URLSearchParams(calls[0][3].toString()).get('assertion').split('.');
  assert.ok(verify('RSA-SHA256', Buffer.from(jwt.slice(0, 2).join('.')), rsa.publicKey, Buffer.from(jwt[2], 'base64url')));
  assert.equal(JSON.parse(Buffer.from(jwt[1], 'base64url')).aud, 'https://oauth2.googleapis.com/token');
  const message = JSON.parse(calls[1][3]).message;
  assert.deepEqual(message.data, { type: 'sync_required', version: '1' }); assert.equal(message.notification, undefined);
  assert.equal(message.android.ttl, '60s'); assert.equal(message.android.priority, 'high'); assert.equal(message.android.restricted_package_name, 'chat.example.tests');
  transport.onModuleDestroy(); assert.equal(transport.available('FCM'), false); assert.equal(await transport.prepare('FCM', 'A'.repeat(32)), null);
});
test('native fixed provider DNS rejects private addresses and unknown destinations without network', async () => {
  const transport = new NativePushTransport(config(), async () => [{ address: '127.0.0.1', family: 4 }]);
  await assert.rejects(transport.destination('fcm.googleapis.com'));
  await assert.rejects(transport.destination('attacker.example'));
});
test('actual APNs HTTP2 socket construction honors pinned family without all-address callback mismatch', async t => {
  let accepted = false, inspected;
  const server = createServer(socket => { accepted = true; socket.destroy(); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const connect = tls.connect;
  // Only route the real TLS socket to this isolated TCP endpoint. No provider
  // network or TLS bypass: its intentional handshake failure must remain failure.
  t.mock.method(tls, 'connect', function (...args) {
    const options = args.find(value => value && typeof value === 'object');
    inspected = options;
    const host = typeof args[1] === 'string' ? args[1] : options.host;
    return connect.call(this, { ...options, host, port: server.address().port });
  });
  const transport = new NativePushTransport(config()); t.after(() => transport.onModuleDestroy());
  transport.destination = async () => ({ address: '127.0.0.1', family: 4 });
  await assert.rejects(transport.post('api.sandbox.push.apple.com', '/3/device/' + input().token, {}, Buffer.from('{}'), true), /native_push_unavailable/);
  assert.equal(accepted, true);
  assert.equal(inspected.family, 4); assert.equal(inspected.autoSelectFamily, false);
  assert.equal(inspected.servername, 'api.sandbox.push.apple.com'); assert.equal(inspected.rejectUnauthorized, true);
});
test('shutdown destroys real stalled TLS requests for both HTTP2 and HTTPS', async t => {
  for (const http2 of [false, true]) await t.test(http2 ? 'APNs HTTP2' : 'Google HTTPS', async t => {
    let accepted; const connected = new Promise(resolve => { accepted = resolve; });
    const sockets = new Set();
    const server = createServer(socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); accepted(); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); });
    const connect = tls.connect;
    t.mock.method(tls, 'connect', function (...args) {
      const options = args.find(value => value && typeof value === 'object');
      const host = typeof args[1] === 'string' ? args[1] : options.host;
      return connect.call(this, { ...options, host, port: server.address().port });
    });
    const transport = new NativePushTransport(config()); t.after(() => transport.onModuleDestroy());
    transport.destination = async () => ({ address: '127.0.0.1', family: 4 });
    const pending = assert.rejects(transport.post(http2 ? 'api.sandbox.push.apple.com' : 'oauth2.googleapis.com', '/', {}, Buffer.from('{}'), http2), /native_push_unavailable/);
    await connected; transport.onModuleDestroy(); await pending;
    assert.equal(transport.active.size, 0); assert.equal(transport.available('APNS'), false);
  });
});
test('native controller forbids cookie/origin/CSRF mixtures and query payloads', () => {
  const controller = new NativePushController({ capabilities: () => true }, {});
  const base = { method: 'GET', query: {}, headers: { authorization: `Bearer ${randomBytes(32).toString('base64url')}`, 'x-rogi-client': 'ios' } };
  assert.equal(controller.capabilities(base), true);
  for (const key of ['cookie', 'origin', 'x-csrf-token']) assert.throws(() => controller.capabilities({ ...base, headers: { ...base.headers, [key]: 'forbidden' } }));
  assert.throws(() => controller.capabilities({ ...base, query: { bindingSecret: 'private' } }));
});
