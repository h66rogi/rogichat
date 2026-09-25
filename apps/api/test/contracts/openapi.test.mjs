import SwaggerParser from '@apidevtools/swagger-parser';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { RequestMethod } from '@nestjs/common';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { ModulesContainer } from '@nestjs/core';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { openApiFixture } from '../support/openapi-fixture.mjs';
import { createOpenApiDocument } from '../../dist/infrastructure/openapi/openapi.js';
import { sendInput } from '../../dist/modules/messages/dto/send-message.dto.js';
import { sendRequest, deletionReceipt } from '../../dist/modules/messages/dto/message.openapi.js';
import { projectMessageDto } from '../../dist/modules/messages/message-projection.js';
import { projectActorProfileDto } from '../../dist/modules/users/profile-projection.js';
import { reactionEmoji } from '../../dist/modules/reactions/dto/reaction.dto.js';
import { syncInput } from '../../dist/modules/sync/dto/sync.dto.js';
import { nativeStartRequest, nativeExchangeRequest } from '../../dist/modules/auth/dto/native-auth.openapi.js';
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
const check = (schema, value, valid = true) => { const validate = ajv.compile(schema); assert.equal(validate(value), valid, JSON.stringify(validate.errors)); };
test('initial SOOP metadata stays self-only; default discovery and provider avatar leases are documented', async t => {
  const { app, config } = await openApiFixture(); t.after(() => app.close());
  const doc = createOpenApiDocument(app, config);
  const response = (path, method = 'get') => doc.paths[path][method].responses['200'].content['application/json'].schema;
  const self = { id: randomUUID(), nickname: '별명', avatar: null, birthday: null, birthdayVisibleToStreamers: false, soop: { displayId: 'isolated' }, providerAvatarUrl: null };
  check(response('/v1/me/profile', 'patch'), self);
  check(response('/v1/me/profile', 'patch'), { ...self, accessToken: 'forbidden' }, false);
  const profile = projectActorProfileDto({ actorId: randomUUID(), nickname: '별명', avatar: null, role: 'STREAMER', providerAvatarAvailable: true });
  check(response('/v1/rooms/{roomId}/actors/{actorId}/profile'), { replace: true, profile: { ...profile, revision: 'opaque' } });
  check(response('/v1/rooms/{roomId}/actors/{actorId}/profile'), { replace: true, profile: { ...profile, revision: 'opaque', soop: self.soop } }, false);
  for (const path of ['/v1/me/provider-avatar/access', '/v1/rooms/{roomId}/actors/{actorId}/provider-avatar/access']) {
    check(response(path, 'post'), { url: 'https://api.example/v1/profile-images?ticket=opaque', expiresIn: 60 });
    assert.deepEqual(doc.paths[path].post.security, [{ browserSession: [], csrf: [] }, { nativeBearer: [], nativeClient: [] }]);
  }
  assert.deepEqual(doc.paths['/v1/profile-images'].get.security, []);
  for (const availability of ['OWNER_PENDING', 'READY']) check(response('/v1/rooms'), { rooms: [{ roomId: randomUUID(), name: '후로기', mode: 'FAN', joined: false, isDefault: true, availability }], next: null });
});
test('native push OpenAPI declares exact provider union, secret proofs and owner-free recovery', async t => {
  const { app, config } = await openApiFixture(); t.after(() => app.close());
  const doc = createOpenApiDocument(app, config), path = '/v1/me/native-push-subscriptions';
  const register = doc.paths[path].post, recover = doc.paths[`${path}/resolve`].post;
  const schema = register.requestBody.content['application/json'].schema;
  const base = { provider: 'APNS', token: randomBytes(32).toString('hex'), installationId: randomUUID(), bindingSecret: randomBytes(32).toString('base64url') };
  check(schema, base); check(schema, { ...base, generation: '18446744073709551615' });
  check(schema, { ...base, provider: 'FCM', token: 'isolated:token_0123456789' });
  for (const patch of [{ provider: 'WEB' }, { token: 'https://example.com/token' }, { bindingSecret: 'a'.repeat(42) + '_' },
    { generation: '01' }, { generation: '18446744073709551616' }, { userId: randomUUID() }, { endpoint: 'https://example.com' }]) check(schema, { ...base, ...patch }, false);
  for (const operation of [register, recover, doc.paths[`${path}/{id}`].delete, doc.paths['/v1/me/native-push-capabilities'].get]) {
    assert.deepEqual(operation.security, [{ nativeBearer: [], nativeClient: [] }]);
    assert.ok(operation.responses['503']);
  }
  const response = recover.responses['200'].content['application/json'].schema;
  check(response, { binding: null });
  const binding = { id: randomUUID(), generation: '1', revoked: false };
  check(response, { binding }); check(response, { binding: { ...binding, userId: randomUUID() } }, false);
  assert.equal(doc.paths[`${path}/{id}`].delete.responses['204'].content, undefined);
});
function inventory(app) {
  const routes = [];
  for (const module of app.get(ModulesContainer).values()) for (const wrapper of module.controllers.values()) {
    const controller = wrapper.metatype;
    const prefix = Reflect.getMetadata(PATH_METADATA, controller) ?? '';
    for (const name of Object.getOwnPropertyNames(controller.prototype)) {
      const method = controller.prototype[name];
      if (typeof method !== 'function') continue;
      const verb = Reflect.getMetadata(METHOD_METADATA, method);
      if (verb === undefined) continue;
      const path = Reflect.getMetadata(PATH_METADATA, method) ?? '';
      routes.push(`${RequestMethod[verb].toLowerCase()} /${[prefix, path].join('/').split('/').filter(Boolean).join('/').replace(/:([A-Za-z0-9_]+)/g, '{$1}')}`);
    }
  }
  return routes.sort();
}
for (const shape of ['health', 'auth', 'full']) test(`OpenAPI matches the actual ${shape} graph without lifecycle or external I/O`, async t => {
  const { app, config, calls } = await openApiFixture(shape);
  t.after(() => app.close());
  const doc = createOpenApiDocument(app, config);
  await SwaggerParser.validate(JSON.parse(JSON.stringify(doc)), { resolve: { external: false } });
  const operations = Object.entries(doc.paths).flatMap(([path, value]) => Object.entries(value).map(([verb, operation]) => ({ path, verb, operation })));
  assert.deepEqual(operations.map(({ path, verb }) => `${verb} ${path}`).sort(), inventory(app));
  assert.equal(new Set(operations.map(x => x.operation.operationId)).size, operations.length);
  assert.ok(operations.length >= (shape === 'health' ? 2 : 20));
  assert.equal(Boolean(doc.paths['/v1/media/upload-intents']), shape === 'full');
  assert.equal(Boolean(doc.paths['/v1/rooms/{roomId}/stickers']), shape === 'full');
  assert.equal(Boolean(doc.paths['/v1/auth/session']), shape !== 'health');
  assert.equal(doc.paths['/v1/realtime'], undefined);
  for (const { operation } of operations) {
    assert.ok(operation.summary && operation.description && operation.tags.length);
    assert.ok(operation.responses['200'] || operation.responses['201'] || operation.responses['202'] || operation.responses['204'] || operation.responses['303']);
    for (const response of Object.values(operation.responses)) for (const content of Object.values(response.content ?? {})) ajv.compile(content.schema);
    for (const content of Object.values(operation.requestBody?.content ?? {})) {
      if (content.schema.format !== 'binary') ajv.compile(content.schema);
    }
  }
  assert.deepEqual(calls, []);
  assert.equal(app.getHttpServer().listening, false);
  const serialized = JSON.stringify(doc);
  assert.doesNotMatch(serialized, /object_key|token_digest|private-db|example\.invalid|clientSecret/);
});

test('request schemas agree with parsers on message union, forbidden fields and null semantics', () => {
  const base = { membershipScope: 'A'.repeat(43), clientMessageId: randomUUID(), intent: 'SHARED', content: { type: 'TEXT', text: '안녕하세요' } };
  for (const body of [base, { ...base, intent: 'ROOM_OWNER' }, { ...base, content: { type: 'STICKER', stickerId: randomUUID() } }, { ...base, intent: 'PRIVATE', recipientActorId: randomUUID() }, { ...base, content: { type: 'PHOTO', assetIds: [randomUUID()] } }, { ...base, quoteId: null }]) {
    check(sendRequest, body); assert.doesNotThrow(() => sendInput(body));
  }
  for (const body of [{ ...base, recipientActorId: null }, { ...base, unexpected: true }, { ...base, content: { type: 'STICKER', assetIds: [randomUUID()] } }, { ...base, content: { type: 'TEXT', text: 'hello', stickerId: randomUUID() } }, { ...base, intent: 'PRIVATE' }, { ...base, clientMessageId: base.clientMessageId.toUpperCase() }]) {
    check(sendRequest, body, false); assert.throws(() => sendInput(body));
  }
});

test('native issuance contract preserves strict proofs and native-only admission', async t => {
  const proof = 'a'.repeat(43);
  const base = { clientId: 'ios', intent: 'login', codeChallenge: proof, codeChallengeMethod: 'S256', returnState: proof };
  check(nativeStartRequest, base);
  check(nativeStartRequest, { ...base, intent: 'link' });
  for (const body of [{ ...base, codeChallengeMethod: 'plain' }, { ...base, unexpected: true }, { ...base, returnUrl: 'https://untrusted.invalid' }]) check(nativeStartRequest, body, false);
  const exchange = { clientId: 'android', transactionId: randomUUID(), code: proof, codeVerifier: 'v'.repeat(128) };
  check(nativeExchangeRequest, exchange);
  for (const body of [{ ...exchange, codeVerifier: 'v'.repeat(129) }, { ...exchange, codeVerifier: 'short' }, { ...exchange, code: null }, { ...exchange, clientId: 'web' }, { ...exchange, subject: 'injected' }]) check(nativeExchangeRequest, body, false);
  const { app, config } = await openApiFixture('auth'); t.after(() => app.close());
  const doc = createOpenApiDocument(app, config);
  for (const path of ['/v1/auth/native/soop/transactions', '/v1/auth/native/completions/exchange']) {
    const operation = doc.paths[path].post;
    assert.deepEqual(operation.security, [{ nativeClient: [] }, { nativeBearer: [], nativeClient: [] }]);
    assert.equal(operation.parameters.find(x => x.name === 'X-Rogi-Client').required, true);
    assert.equal(operation.parameters.find(x => x.name === 'Origin'), undefined);
    assert.ok(operation.responses['503']);
  }
  const launch = doc.paths['/v1/auth/native/soop/launch'].get;
  assert.deepEqual(launch.security, []);
  assert.ok(launch.responses['303'].headers.Location);
  assert.equal(launch.responses['303'].content, undefined);
  const issued = { tokenType: 'Bearer', accessToken: proof, expiresAt: new Date().toISOString(), session: {
    authenticated: true, account: { userId: randomUUID(), nickname: '사용자', avatarAssetId: null }, soopLinkStatus: 'VERIFIED',
    onboardingState: 'READY', expiresAt: new Date().toISOString(), accountGeneration: proof, accountPartition: proof, capabilities: { chat: true },
  } };
  const schema = doc.paths['/v1/auth/native/completions/exchange'].post.responses['200'].content['application/json'].schema;
  check(schema, issued);
  check(schema, { ...issued, session: { ...issued.session, providerSubject: 'hidden' } }, false);
});

test('OpenAPI describes real projections, auth alternatives, binary transport and bodyless status codes', async t => {
  const { app, config } = await openApiFixture(); t.after(() => app.close());
  const doc = createOpenApiDocument(app, config);
  const response = (path, verb = 'get', status = '200') => doc.paths[path][verb].responses[status].content['application/json'].schema;
  const id = randomUUID();
  const dto = projectMessageDto({ counterpart: null, allowedActions: { reply: false, publish: false, delete: false }, id, version: 1n, createdAt: new Date(), audience: 'SHARED', author: { kind: 'anonymous' }, content: { type: 'STICKER', stickerId: randomUUID(), assetId: randomUUID(), width: 128, height: 128 }, quote: null });
  check(response('/v1/rooms/{roomId}/messages/{messageId}'), dto);
  check(response('/v1/rooms/{roomId}/messages/{messageId}'), { ...dto, author: { kind: 'anonymous', actorId: id } }, false);
  const profile = projectActorProfileDto({ actorId: id, nickname: '사용자', avatar: null, role: 'FAN' });
  const actorSchema = response('/v1/rooms/{roomId}/actors/{actorId}/profile');
  check(actorSchema, { replace: true, profile: { ...profile, revision: 'visible-revision' } });
  check(actorSchema, { replace: true, profile: { ...profile, birthday: null, revision: 'visible-revision' } }, false);
  assert.deepEqual(doc.paths['/v1/rooms/{roomId}/messages'].post.security, [{ browserSession: [], csrf: [] }, { nativeBearer: [], nativeClient: [] }]);
  assert.equal(doc.paths['/v1/rooms/{roomId}/messages'].post.parameters.find(x => x.name === 'Origin').required, false);
  assert.equal(doc.components.securitySchemes.nativeClient.name, 'X-Rogi-Client');
  check(response('/v1/auth/session'), { authenticated: true, account: { userId: id, nickname: '사용자', avatarAssetId: null }, soopLinkStatus: 'REQUIRED', onboardingState: 'SOOP_LINK_REQUIRED', expiresAt: new Date().toISOString(), accountGeneration: 'a'.repeat(43), accountPartition: 'b'.repeat(43), capabilities: { chat: false } });
  assert.deepEqual(doc.paths['/v1/auth/soop/start'].post.security, []);
  assert.equal(doc.components.securitySchemes.browserSession.name, '__Host-rogi_session');
  assert.ok(doc.paths['/v1/auth/soop/callback'].get.responses['303'].headers.Location);
  assert.equal(doc.paths['/v1/auth/logout'].post.responses['204'].content, undefined);
  assert.equal(doc.paths['/v1/rooms/{roomId}/leave'].post.responses['204'].content, undefined);
  const upload = doc.paths['/v1/media/upload-intents/{assetId}/content'].post;
  assert.deepEqual(Object.keys(upload.requestBody.content), ['application/octet-stream']);
  assert.equal(upload.requestBody.content['application/octet-stream'].schema.format, 'binary');
  assert.equal(upload.responses['202'].description, '처리 결과');
  const emojiSchema = doc.paths['/v1/rooms/{roomId}/messages/{messageId}/reactions/me'].put.requestBody.content['application/json'].schema;
  for (const emoji of ['👍', null]) { check(emojiSchema, { emoji }); assert.doesNotThrow(() => reactionEmoji(emoji)); }
  const sync = { deviceId: randomUUID(), cacheId: randomUUID(), limit: '100' };
  assert.equal(syncInput(sync).limit, 100);
  assert.ok(doc.paths['/v1/rooms/{roomId}/history'].get.parameters.find(x => x.name === 'cursor').required);
  assert.ok(!doc.paths['/v1/rooms/{roomId}/snapshot'].get.parameters.some(x => x.name === 'cursor'));
});

test('own command and account partition contracts reject widened or incomplete projections', async t => {
  const { app, config } = await openApiFixture('auth'); t.after(() => app.close());
  const doc = createOpenApiDocument(app, config);
  const operation = doc.paths['/v1/rooms/{roomId}/message-commands/{clientMessageId}'].get;
  assert.equal(operation.requestBody, undefined);
  assert.deepEqual(operation.security, [{ browserSession: [] }, { nativeBearer: [], nativeClient: [] }]);
  const schema = operation.responses['200'].content['application/json'].schema;
  const id = randomUUID();
  check(schema, { clientMessageId: id, status: 'committed', messageId: randomUUID(), version: '2' });
  check(schema, { clientMessageId: id, status: 'deleted' });
  for (const value of [
    { clientMessageId: id, status: 'deleted', messageId: randomUUID() },
    { clientMessageId: id, status: 'deleted', text: 'hidden' },
    { clientMessageId: id, status: 'committed', messageId: randomUUID(), version: 2 },
    { clientMessageId: id, status: 'committed', messageId: randomUUID() },
  ]) check(schema, value, false);
  const session = doc.paths['/v1/auth/session'].get.responses['200'].content['application/json'].schema;
  const web = { authenticated: true, soopLinkStatus: 'VERIFIED', onboardingState: 'READY', capabilities: { chat: true }, csrfToken: 'a'.repeat(43), accountPartition: 'b'.repeat(43) };
  check(session, web);
  check(session, { ...web, accountPartition: undefined }, false);
  check(session, { ...web, accountPartition: id }, false);
  check(session, { ...web, userId: id }, false);
});

test('C05 shared fixtures require minimal action fields only on complete live DTOs, never tombstones', async t => {
  const { readFile } = await import('node:fs/promises');
  const fixtures = JSON.parse(await readFile(new URL('../fixtures/message-projection.json', import.meta.url), 'utf8'));
  const { app, config } = await openApiFixture(); t.after(() => app.close());
  const doc = createOpenApiDocument(app, config);
  const schema = doc.paths['/v1/rooms/{roomId}/messages/{messageId}'].get.responses['200'].content['application/json'].schema;
  for (const value of [fixtures.privateOutgoing, fixtures.anonymousPublisher, fixtures.stalePrivateOutgoing]) {
    check(schema, value);
    for (const field of ['counterpart', 'allowedActions']) {
      const missing = { ...value }; delete missing[field]; check(schema, missing, false);
    }
  }
  check(schema, { ...fixtures.privateOutgoing, counterpart: { actorId: fixtures.privateOutgoing.counterpart.actorId, peerStatus: 'ACTIVE' } }, false);
  check(schema, { ...fixtures.privateOutgoing, counterpart: { actorId: 'AAAAAAAA-0000-4000-8000-000000000003' } }, false);
  check(schema, { ...fixtures.privateOutgoing, allowedActions: { ...fixtures.privateOutgoing.allowedActions, sourceActorId: randomUUID() } }, false);
  for (const counterpart of [{}, { actorId: null }, { actorId: 'not-a-uuid' }, []]) check(schema, { ...fixtures.privateOutgoing, counterpart }, false);
  for (const allowedActions of [null, {}, { reply: true, publish: false }, { reply: 'true', publish: false, delete: false },
    { reply: null, publish: false, delete: false }]) check(schema, { ...fixtures.privateOutgoing, allowedActions }, false);
  const event = doc.paths['/v1/rooms/{roomId}/events'].get.responses['200'].content['application/json'].schema.oneOf[0].properties.events.items;
  check(event, fixtures.tombstone);
  check(event, { ...fixtures.tombstone, allowedActions: fixtures.privateOutgoing.allowedActions }, false);
  assert.equal(fixtures.privateOutgoing.version, fixtures.stalePrivateOutgoing.version);
  assert.notDeepEqual(fixtures.privateOutgoing.allowedActions, fixtures.stalePrivateOutgoing.allowedActions);
});

test('deletion receipt alone permits legacy UUIDv4 or deterministic UUIDv5 and stays minimal', () => {
  const v5 = 'b74685d3-0c46-558e-8b2d-12512b102949';
  for (const requestId of [randomUUID(), v5]) check(deletionReceipt, { requestId, status: 'blocked' });
  for (const requestId of [v5.toUpperCase(), v5.replace('-558e-', '-758e-'), 'invalid']) check(deletionReceipt, { requestId, status: 'blocked' }, false);
  check(deletionReceipt, { requestId: v5, status: 'purged' }, false);
  check(deletionReceipt, { requestId: v5, status: 'blocked', actorUserId: randomUUID() }, false);

});

test('C06 v2 envelopes encode exact scope/reset/discovery shapes and canonical SEND token bits', async t => {
  const { app, config } = await openApiFixture(); t.after(() => app.close());
  const doc = createOpenApiDocument(app, config);
  const response = (path, method = 'get') => doc.paths[path][method].responses['200'].content['application/json'].schema;
  const tokens = { membershipScope: 'A'.repeat(43), authorizationRevision: 'E'.repeat(42) + 'A' };
  const base = { schemaVersion: 2, resetRequired: false, ...tokens };
  check(response('/v1/rooms/{roomId}/snapshot'), { ...base, messages: [], nextCursor: 'opaque', historyCursor: null });
  check(response('/v1/rooms/{roomId}/snapshot'), { ...base, membershipScope: null, messages: [], nextCursor: 'opaque', historyCursor: null }, false);
  for (const [path, field, extra] of [['events', 'events', { hasMore: false }], ['history', 'messages', {}], ['profile-sync', 'profiles', { generation: null, complete: false }]]) {
    const reset = { schemaVersion: 2, resetRequired: true, membershipScope: null, authorizationRevision: null, [field]: [], nextCursor: null, ...extra };
    const schema = response(`/v1/rooms/{roomId}/${path}`);
    check(schema, reset); check(schema, { ...reset, membershipScope: tokens.membershipScope }, false); check(schema, { ...reset, [field]: [{}] }, false);
  }
  const manifest = { schemaVersion: 2, resetRequired: false, generation: 'g', complete: true, nextCursor: null, rooms: [{ roomId: randomUUID(), actorId: randomUUID(), name: 'fixture', mode: 'GROUP', role: 'MEMBER', ...tokens }] };
  check(response('/v1/sync'), manifest); check(response('/v1/sync'), { ...manifest, membershipScope: null }, false);
  check(response('/v1/sync'), { schemaVersion: 2, resetRequired: true, generation: null, complete: false, nextCursor: null, rooms: [] });
  const room = { roomId: randomUUID(), name: 'fixture', mode: 'GROUP', joined: false };
  check(response('/v1/rooms'), { rooms: [room], next: null });
  check(response('/v1/rooms'), { rooms: [{ ...room, ...tokens }], next: null }, false);
  check(response('/v1/rooms'), { rooms: [{ ...room, joined: true, actorId: randomUUID(), ...tokens }], next: null });
  check(response('/v1/rooms'), { rooms: [{ ...room, joined: true, actorId: randomUUID() }], next: null }, false);
  const body = { membershipScope: 'x'.repeat(43), clientMessageId: randomUUID(), intent: 'SHARED', content: { type: 'TEXT', text: 'fixture' } };
  check(sendRequest, body, false); assert.throws(() => sendInput(body));
});
