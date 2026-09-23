import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { openApiFixture } from '../support/openapi-fixture.mjs';
import { createOpenApiDocument } from '../../dist/infrastructure/openapi/openapi.js';

test('admin/password OpenAPI exposes exact real routes and no credential, identity or owner widening', async t => {
  const { app, config } = await openApiFixture('full'); t.after(() => app.close());
  const doc = createOpenApiDocument(app, config), ajv = new Ajv({ strict: false }); addFormats(ajv);
  for (const [path, methods] of [
    ['/v1/me/capabilities', ['get']], ['/v1/rooms/{roomId}/capabilities', ['get']],
    ['/v1/admin/rooms/{roomId}/test-grants', ['get', 'post']],
    ['/v1/admin/rooms/{roomId}/test-grants/{grantId}/revoke', ['post']],
    ['/v1/auth/password/login', ['post']], ['/v1/auth/password/change', ['post']],
  ]) for (const method of methods) assert.ok(doc.paths[path]?.[method]);
  const grantPath = doc.paths['/v1/admin/rooms/{roomId}/test-grants'].post;
  const request = ajv.compile(grantPath.requestBody.content['application/json'].schema);
  const body = { requestId: randomUUID(), durationSeconds: 60, reason: 'isolated contract test' };
  assert.equal(request(body), true);
  for (const field of ['userId', 'actorId', 'ownerActorId', 'role']) assert.equal(request({ ...body, [field]: randomUUID() }), false);
  const response = ajv.compile(grantPath.responses['201'].content['application/json'].schema);
  const receipt = { grantId: randomUUID(), roomId: randomUUID(), expiresAt: new Date().toISOString(), revokedAt: null };
  assert.equal(response(receipt), true);
  for (const field of ['userId', 'providerSubject', 'reason', 'passwordHash', 'periodId']) assert.equal(response({ ...receipt, [field]: 'forbidden' }), false);
  const login = doc.paths['/v1/auth/password/login'].post;
  assert.equal(login.requestBody.content['application/json'].schema.properties.password.writeOnly, true);
  assert.equal(ajv.compile(login.requestBody.content['application/json'].schema)({ clientId: 'ios', loginId: 'review-account', password: 'isolated-long-password', termsVersion: '2026-09-20', role: 'STREAMER' }), false);
  assert.equal(doc.paths['/v1/auth/password/register'], undefined);
  assert.equal(doc.paths['/v1/admin/bootstrap'], undefined);
});
