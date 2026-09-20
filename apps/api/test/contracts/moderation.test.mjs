import { test } from 'node:test';
import assert from 'node:assert/strict';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { randomUUID } from 'node:crypto';
import { openApiFixture } from '../support/openapi-fixture.mjs';
import { createOpenApiDocument } from '../../dist/infrastructure/openapi/openapi.js';

test('moderation OpenAPI exposes exact actor-scoped methods, durable receipt recovery and strict output allowlists', async t => {
  const { app, config } = await openApiFixture('full'); t.after(() => app.close());
  const doc = createOpenApiDocument(app, config); const ajv = new Ajv({ strict: false }); addFormats(ajv);
  const routes = [
    ['post', '/v1/rooms/{roomId}/messages/{messageId}/reports'], ['get', '/v1/reports/{reportId}'],
    ['get', '/v1/report-receipts/{idempotencyKey}'], ['get', '/v1/rooms/{roomId}/blocks'],
    ['put', '/v1/rooms/{roomId}/blocks/{actorId}'], ['delete', '/v1/rooms/{roomId}/blocks/{actorId}'],
    ['get', '/v1/rooms/{roomId}/bans'], ['post', '/v1/rooms/{roomId}/bans/{actorId}'], ['delete', '/v1/rooms/{roomId}/bans/{actorId}'],
    ['get', '/v1/admin/reports'], ['post', '/v1/admin/reports/{reportId}/resolve'],
  ];
  for (const [method, path] of routes) assert.ok(doc.paths[path]?.[method], `${method} ${path}`);
  const report = doc.paths[routes[0][1]].post;
  const request = ajv.compile(report.requestBody.content['application/json'].schema);
  assert.equal(request({ idempotencyKey: randomUUID(), reason: 'spam' }), true);
  assert.equal(request({ idempotencyKey: randomUUID(), reason: 'spam', userId: randomUUID() }), false);
  const response = ajv.compile(report.responses['200'].content['application/json'].schema);
  const receipt = { reportId: randomUUID(), status: 'received', createdAt: new Date().toISOString() };
  assert.equal(response(receipt), true); assert.equal(response({ ...receipt, messageId: randomUUID() }), false);
  assert.equal(response({ ...receipt, status: 'reviewing' }), false);
  for (const key of ['userId', 'contentOwnerUserId', 'rootMessageId', 'providerSubject']) assert.equal(response({ ...receipt, [key]: randomUUID() }), false);
});
