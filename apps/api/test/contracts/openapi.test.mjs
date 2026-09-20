import SwaggerParser from '@apidevtools/swagger-parser';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { RequestMethod } from '@nestjs/common';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { ModulesContainer } from '@nestjs/core';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { openApiFixture } from '../support/openapi-fixture.mjs';
import { createOpenApiDocument } from '../../dist/infrastructure/openapi/openapi.js';
import { sendInput } from '../../dist/modules/messages/dto/send-message.dto.js';
import { sendRequest } from '../../dist/modules/messages/dto/message.openapi.js';
import { projectMessageDto } from '../../dist/modules/messages/message-projection.js';
import { projectActorProfileDto } from '../../dist/modules/users/profile-projection.js';
import { reactionEmoji } from '../../dist/modules/reactions/dto/reaction.dto.js';
import { syncInput } from '../../dist/modules/sync/dto/sync.dto.js';
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
const check = (schema, value, valid = true) => { const validate = ajv.compile(schema); assert.equal(validate(value), valid, JSON.stringify(validate.errors)); };
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
  const base = { clientMessageId: randomUUID(), intent: 'SHARED', content: { type: 'TEXT', text: '안녕하세요' } };
  for (const body of [base, { ...base, content: { type: 'STICKER', stickerId: randomUUID() } }, { ...base, intent: 'PRIVATE', recipientActorId: randomUUID() }, { ...base, content: { type: 'PHOTO', assetIds: [randomUUID()] } }, { ...base, quoteId: null }]) {
    check(sendRequest, body); assert.doesNotThrow(() => sendInput(body));
  }
  for (const body of [{ ...base, recipientActorId: null }, { ...base, unexpected: true }, { ...base, content: { type: 'STICKER', assetIds: [randomUUID()] } }, { ...base, content: { type: 'TEXT', text: 'hello', stickerId: randomUUID() } }, { ...base, intent: 'PRIVATE' }, { ...base, clientMessageId: base.clientMessageId.toUpperCase() }]) {
    check(sendRequest, body, false); assert.throws(() => sendInput(body));
  }
});

test('OpenAPI describes real projections, auth alternatives, binary transport and bodyless status codes', async t => {
  const { app, config } = await openApiFixture(); t.after(() => app.close());
  const doc = createOpenApiDocument(app, config);
  const response = (path, verb = 'get', status = '200') => doc.paths[path][verb].responses[status].content['application/json'].schema;
  const id = randomUUID();
  const dto = projectMessageDto({ id, version: 1n, createdAt: new Date(), audience: 'SHARED', author: { kind: 'anonymous' }, content: { type: 'STICKER', stickerId: randomUUID(), assetId: randomUUID(), width: 128, height: 128 }, quote: null });
  check(response('/v1/rooms/{roomId}/messages/{messageId}'), dto);
  check(response('/v1/rooms/{roomId}/messages/{messageId}'), { ...dto, author: { kind: 'anonymous', actorId: id } }, false);
  const profile = projectActorProfileDto({ actorId: id, nickname: '사용자', avatar: null, role: 'FAN' });
  const actorSchema = response('/v1/rooms/{roomId}/actors/{actorId}/profile');
  check(actorSchema, { replace: true, profile: { ...profile, revision: 'visible-revision' } });
  check(actorSchema, { replace: true, profile: { ...profile, birthday: null, revision: 'visible-revision' } }, false);
  assert.deepEqual(doc.paths['/v1/rooms/{roomId}/messages'].post.security, [{ browserSession: [], csrf: [] }]);
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
