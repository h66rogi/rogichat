import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, randomBytes, randomUUID } from 'node:crypto';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { openApiFixture } from '../support/openapi-fixture.mjs';
import { createOpenApiDocument } from '../../dist/infrastructure/openapi/openapi.js';
import { parseNotificationPreferences, parsePushSubscription, parseSubscriptionGeneration, parseReadState } from '../../dist/modules/notifications/notification-contract.js';

const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
const prefs = '/v1/me/notification-preferences';
const subscriptions = '/v1/me/push-subscriptions';
const removal = `${subscriptions}/{id}`;
const read = '/v1/rooms/{roomId}/read-state';
const requestSchema = operation => operation.requestBody.content['application/json'].schema;
const responseSchema = (operation, status = '200') => operation.responses[status].content['application/json'].schema;
function check(schema, value, valid = true) {
  const validate = ajv.compile(schema);
  assert.equal(validate(value), valid, JSON.stringify(validate.errors));
}
async function document(t) {
  const { app, config, calls } = await openApiFixture();
  t.after(() => app.close());
  const doc = createOpenApiDocument(app, config);
  assert.deepEqual(calls, []);
  return doc;
}

test('registered M11 routes expose web/native proof alternatives and honest availability', async t => {
  const doc = await document(t);
  for (const [path, method, id] of [
    ['/v1/me/push-capabilities', 'get', 'getPushCapabilities'],
    [prefs, 'get', 'getNotificationPreferences'], [prefs, 'put', 'putNotificationPreferences'],
    [subscriptions, 'post', 'registerWebPushSubscription'], [removal, 'delete', 'removeWebPushSubscription'],
    [read, 'get', 'getOwnReadState'], [read, 'put', 'putOwnReadState'],
  ]) {
    const operation = doc.paths[path][method];
    assert.equal(operation.operationId, id);
    assert.ok(operation.tags.length);
    assert.deepEqual(operation.security, [method === 'get' ? { browserSession: [] } : { browserSession: [], csrf: [] }, { nativeBearer: [], nativeClient: [] }]);
    const client = operation.parameters.find(parameter => parameter.name === 'X-Rogi-Client');
    assert.equal(client.required, false);
    assert.deepEqual(client.schema.enum, ['ios', 'android']);
    if (method !== 'get') assert.equal(operation.parameters.find(parameter => parameter.name === 'Origin').required, false);
    for (const status of ['400', '401', '503']) check(responseSchema(operation, status), { error: { code: status === '503' ? 'AUTH_UNAVAILABLE' : 'INVALID_REQUEST' } });
  }
  assert.equal(doc.components.securitySchemes.nativeClient.name, 'X-Rogi-Client');
  assert.match(doc.paths[prefs].put.description, /Native enable requires verified SOOP\/current terms, a configured provider/);
  assert.match(doc.paths[prefs].put.description, /current native subscription bound to this session and account generation/);
  assert.match(doc.paths[prefs].put.description, /Provider unavailable returns 503 for web or native/);
  assert.match(doc.paths[prefs].put.description, /Disable remains available without Push configuration/);
  assert.match(doc.paths[subscriptions].post.description, /Cross-account endpoints return 404 NOT_FOUND even after revoke/);
  assert.match(doc.paths[removal].delete.description, /Native returns 503 AUTH_UNAVAILABLE/);
  assert.match(doc.paths[removal].delete.description, /without Web Push configuration/);
  assert.equal(doc.paths[removal].delete.responses['204'].content, undefined);
  assert.equal(doc.paths[removal].delete.requestBody.required, true);
  assert.ok(doc.paths[read].put.responses['409']);
  assert.match(doc.paths[read].put.description, /discard queued updates, GET a fresh context/);
  for (const [path, name] of [[removal, 'id'], [read, 'roomId']]) {
    const operation = doc.paths[path][path === read ? 'get' : 'delete'];
    const parameter = operation.parameters.find(parameter => parameter.name === name);
    assert.equal(parameter.required, true);
    check(parameter.schema, randomUUID()); check(parameter.schema, 'invalid', false);
  }
});

test('M11 preference and subscription schemas preserve required CAS and positive uint64 limits', async t => {
  const doc = await document(t);
  const preference = requestSchema(doc.paths[prefs].put);
  const deletion = requestSchema(doc.paths[removal].delete);
  const registration = requestSchema(doc.paths[subscriptions].post);
  const point = createECDH('prime256v1'); point.generateKeys();
  const subscription = { endpoint: 'https://fcm.googleapis.com/contracts/test', keys: { p256dh: point.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') } };
  for (const generation of ['1', '9999999999999999999', '10000000000000000000', '18446744073709551614', '18446744073709551615']) {
    for (const [schema, parser, input] of [
      [preference, parseNotificationPreferences, { pushEnabled: false, expectedGeneration: generation }],
      [deletion, parseSubscriptionGeneration, { generation }],
      [registration, parsePushSubscription, { ...subscription, generation }],
    ]) { check(schema, input); assert.doesNotThrow(() => parser(input)); }
  }
  for (const generation of ['0', '-1', '01', '+1', '1.0', '1e1', ' 1', '18446744073709551616', '99999999999999999999', '100000000000000000000', 1, null]) {
    for (const [schema, parser, input] of [
      [preference, parseNotificationPreferences, { pushEnabled: false, expectedGeneration: generation }],
      [deletion, parseSubscriptionGeneration, { generation }],
      [registration, parsePushSubscription, { ...subscription, generation }],
    ]) { check(schema, input, false); assert.throws(() => parser(input)); }
  }
  for (const input of [{ pushEnabled: false }, { pushEnabled: 'false', expectedGeneration: '1' }, { pushEnabled: true, expectedGeneration: '1', userId: randomUUID() }, null, []]) {
    check(preference, input, false); assert.throws(() => parseNotificationPreferences(input));
  }
  check(registration, subscription); assert.doesNotThrow(() => parsePushSubscription(subscription));
  for (const input of [{ ...subscription, extra: true }, { ...subscription, keys: { ...subscription.keys, extra: true } }, { ...subscription, keys: { auth: subscription.keys.auth } }, { ...subscription, endpoint: 'http://fcm.googleapis.com/test' }, { ...subscription, keys: { ...subscription.keys, auth: 'A'.repeat(21) + 'B' } }, { ...subscription, keys: { ...subscription.keys, p256dh: 'A'.repeat(87) } }]) {
    check(registration, input, false); assert.throws(() => parsePushSubscription(input));
  }
  for (const input of [{}, { generation: '1', userId: randomUUID() }]) {
    check(deletion, input, false); assert.throws(() => parseSubscriptionGeneration(input));
  }
  const preferenceResponse = responseSchema(doc.paths[prefs].get);
  check(preferenceResponse, { pushEnabled: false, generation: '1' });
  check(preferenceResponse, { pushEnabled: false, generation: '0' }, false);
  check(preferenceResponse, { pushEnabled: false, generation: '1', userId: randomUUID() }, false);
  const registered = responseSchema(doc.paths[subscriptions].post, '201');
  check(registered, { id: randomUUID(), generation: '1' });
  check(registered, { id: randomUUID(), generation: '1', ...subscription }, false);
});

test('M11 read-state schemas enforce canonical context, filtered bounded rows and no internal fields', async t => {
  const doc = await document(t);
  const inputSchema = requestSchema(doc.paths[read].put);
  const output = responseSchema(doc.paths[read].put);
  const snapshot = responseSchema(doc.paths[read].get);
  const input = { messageId: randomUUID(), readContext: randomBytes(32).toString('base64url') };
  check(inputSchema, input); assert.deepEqual(parseReadState(input), input);
  for (const invalid of [{ messageId: input.messageId }, { ...input, messageId: null }, { ...input, messageId: input.messageId.toUpperCase() }, { ...input, readContext: 'A'.repeat(42) + 'B' }, { ...input, readContext: 'A'.repeat(42) }, { ...input, readContext: 'A'.repeat(44) }, { ...input, readContext: null }, { ...input, last_read_order: '1' }, { ...input, streamId: randomUUID() }]) {
    check(inputSchema, invalid, false); assert.throws(() => parseReadState(invalid));
  }
  check(output, { messageId: input.messageId }); check(output, { messageId: null });
  const snapshotBase = { readContext: input.readContext, firstUnreadMessageId: null };
  check(snapshot, { ...snapshotBase, items: [] });
  const rows = Array.from({ length: 100 }, () => ({ messageId: randomUUID() }));
  check(snapshot, { ...snapshotBase, items: rows, firstUnreadMessageId: rows[0].messageId });
  for (const invalid of [{ items: [] }, { readContext: input.readContext, items: [] }, { ...snapshotBase, items: [...rows, rows[0]] }, { ...snapshotBase, items: [{ messageId: null }] }, { ...snapshotBase, items: [{ messageId: input.messageId, streamId: randomUUID() }] }, { ...snapshotBase, items: [], firstUnreadMessageId: 'invalid' }, { ...snapshotBase, items: [], nextCursor: randomUUID() }]) check(snapshot, invalid, false);
  for (const field of ['last_read_order', 'stream_id', 'period_id', 'userId']) check(output, { messageId: input.messageId, [field]: 'hidden' }, false);
});


test('capability schema is identical in controller and standalone artifact and rejects excess fields', async t => {
  const doc = await document(t);
  const { m11OpenApi } = await import('../../../../packages/contracts/generate-m11-openapi.mjs');
  const schema = responseSchema(doc.paths['/v1/me/push-capabilities'].get);
  assert.deepEqual(schema, m11OpenApi.components.schemas.PushCapabilities);
  const key = createECDH('prime256v1'); key.generateKeys();
  const applicationServerKey = key.getPublicKey().toString('base64url');
  check(schema, { available: false }); check(schema, { available: true, applicationServerKey });
  for (const value of [{}, { available: true }, { available: false, applicationServerKey }, { available: true, applicationServerKey, subject: 'mailto:push@example.com' }, { available: true, applicationServerKey: 'invalid' }, { available: 'false' }]) check(schema, value, false);
  assert.ok(doc.paths['/v1/me/push-capabilities'].get.responses['403']);
});
