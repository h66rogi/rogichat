import { MessagesQueryService } from '../../dist/modules/messages/messages-query.service.js';
import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Inject, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import ts from 'typescript';
import { ApiError } from '../../dist/modules/auth/auth-primitives.js';
import { Transactions } from '../../dist/infrastructure/database/transactions.js';
import { AuthService } from '../../dist/modules/auth/auth.service.js';
import { AUTH_CONFIG } from '../../dist/modules/auth/auth.tokens.js';
import { MessagesCoreModule } from '../../dist/modules/messages/messages-core.module.js';
import { MessagesCoreService } from '../../dist/modules/messages/messages-core.service.js';
import { MessagesRepository } from '../../dist/modules/messages/messages.repository.js';
import { MessagesModule } from '../../dist/modules/messages/messages.module.js';
import { MessagesService } from '../../dist/modules/messages/messages.service.js';
import { MessagesController } from '../../dist/modules/messages/messages.controller.js';
import { sendInput } from '../../dist/modules/messages/dto/send-message.dto.js';

async function fixture(t, options = {}) {
  const calls = [], handles = []; let committedCharges = 0, revoked = false;
  const settings = { key: randomBytes(32), origin: 'http://localhost:3001', secure: false };
  const principal = { userId: randomUUID(), sessionId: randomUUID(), soopLinked: true };
  const roomId = randomUUID(), messageId = randomUUID();
  const credentials = Object.freeze({ token: 'a'.repeat(43), csrf: 'b'.repeat(43) });
  const input = sendInput({ membershipScope: 'A'.repeat(43), clientMessageId: randomUUID(), intent: 'SHARED', content: { type: 'TEXT', text: '합성 모듈 메시지' } });
  const run = async (writable, operation) => {
    let pendingCharges = 0;
    const tx = { writable, id: handles.length + 1,
      async rows(sql, values) {
        calls.push({ kind: 'rows', tx, sql, values });
        if (sql.startsWith('SELECT used,expires_at')) return [{ used: options.rateDenied ? 60 : 0, expired: 0 }];
        if (sql.startsWith('SELECT id FROM room_members')) return [{ id: randomUUID() }];
        throw new Error('unexpected fixture query');
      },
      async execute(sql, values) {
        calls.push({ kind: 'execute', tx, sql, values });
        if (sql.startsWith('UPDATE rate_buckets SET used=used+1')) pendingCharges++;
        else assert.ok(sql.startsWith('INSERT INTO rate_buckets'));
        return { affectedRows: 1 };
      },
    };
    tx.now = async () => new Date('2026-09-20T00:00:00Z');
    tx.prisma = { room_members: { findMany: async input => { calls.push({ kind: 'prisma.findMany', tx, input }); return [{ id: randomUUID() }]; } }, rate_buckets: {
      createMany: async input => { calls.push({ kind: 'prisma.createMany', tx, input }); return { count: 1 }; },
      updateMany: async input => { calls.push({ kind: 'prisma.updateMany', tx, input }); if (input.data.used?.increment === 1) pendingCharges++; return { count: 1 }; },
    } };
    handles.push(tx); calls.push({ kind: writable ? 'write.begin' : 'read.begin', tx });
    try {
      const result = await operation(tx);
      committedCharges += pendingCharges; calls.push({ kind: 'commit', tx });
      if (options.revokeAfterRate && tx.id === 1) revoked = true;
      return result;
    } catch (error) { calls.push({ kind: 'rollback', tx }); throw error; }
  };
  const transactions = { write: operation => run(true, operation), read: operation => run(false, operation) };
  const auth = { async require(tx, supplied, requireSoop = false) {
    calls.push({ kind: 'require', tx, credentials: supplied, requireSoop });
    assert.ok(handles.includes(tx));
    if (revoked || options.authDenied) throw new ApiError('UNAUTHENTICATED', 401);
    return { ...principal };
  } };
  class InfrastructureFixture {} class AuthFixture {}
  Module({})(InfrastructureFixture); Module({})(AuthFixture);
  const infrastructure = { module: InfrastructureFixture, providers: [{ provide: Transactions, useValue: transactions }], exports: [Transactions] };
  const authModule = { module: AuthFixture, providers: [{ provide: AuthService, useValue: auth }, { provide: AUTH_CONFIG, useValue: settings }], exports: [AuthService, AUTH_CONFIG] };
  // Real Nest module graph/constructors, with explicit fake external boundaries. Core
  // methods are spied below; SQL/domain semantics remain real-MySQL integration tests.
  const module = MessagesModule.register(infrastructure, authModule);
  const app = await NestFactory.createApplicationContext(module, { logger: false, abortOnError: false });
  t.after(() => app.close());
  const core = app.get(MessagesCoreService);
  core.send = async (tx, room, userId, content, key) => {
    calls.push({ kind: 'send', tx, room, userId, content, key });
    if (options.commandDenied) throw new ApiError('NOT_FOUND', 404);
    return { clientMessageId: content.clientMessageId, messageId, status: 'committed', version: '1' };
  };
  core.get = async (tx, room, userId, id) => { calls.push({ kind: 'get', tx, room, userId, id }); return { id }; };
  core.remove = async (tx, room, userId, id) => { calls.push({ kind: 'remove', tx, room, userId, id }); return { requestId: 'synthetic-request', status: 'blocked' }; };
  return { app, module, calls, handles, principal, roomId, messageId, credentials, input, settings,
    service: app.get(MessagesService), controller: app.get(MessagesController), charges: () => committedCharges };
}

test('MessagesCoreModule boots standalone without auth, HTTP or UnitOfWork providers and keeps its repository private', async t => {
  const app = await NestFactory.createApplicationContext(MessagesCoreModule, { logger: false, abortOnError: false });
  t.after(() => app.close());
  assert.ok(app.get(MessagesCoreService) instanceof MessagesCoreService);
  assert.deepEqual(Reflect.getMetadata('exports', MessagesCoreModule), [MessagesCoreService, MessagesQueryService]);
  assert.deepEqual(Reflect.getMetadata('controllers', MessagesCoreModule) ?? [], []);
  for (const token of [AuthService, AUTH_CONFIG, Transactions, MessagesService, MessagesController]) assert.throws(() => app.get(token));
  class InvalidConsumer { constructor(repository) { this.repository = repository; } }
  Inject(MessagesRepository)(InvalidConsumer, undefined, 0);
  class ConsumerModule {}
  Module({ imports: [MessagesCoreModule], providers: [InvalidConsumer] })(ConsumerModule);
  await assert.rejects(NestFactory.createApplicationContext(ConsumerModule, { logger: false, abortOnError: false }));
});

test('MessagesService send independently commits rate charge then reauthenticates on the exact command transaction', async t => {
  const f = await fixture(t);
  assert.deepEqual(f.module.exports, [MessagesService]); assert.ok(f.controller instanceof MessagesController);
  const result = await f.service.send(f.credentials, f.roomId, f.input);
  assert.deepEqual(result, { clientMessageId: f.input.clientMessageId, messageId: f.messageId, status: 'committed', version: '1' });
  assert.equal(f.handles.length, 2); assert.notEqual(f.handles[0], f.handles[1]);
  assert.ok(f.handles.every(tx => tx.writable)); assert.equal(f.charges(), 3);
  const checks = f.calls.filter(call => call.kind === 'require'); assert.equal(checks.length, 2);
  for (const [index, check] of checks.entries()) { assert.equal(check.tx, f.handles[index]); assert.equal(check.credentials, f.credentials); assert.equal(check.requireSoop, true); }
  const sent = f.calls.find(call => call.kind === 'send'); assert.equal(sent.tx, checks[1].tx);
  assert.equal(sent.userId, f.principal.userId); assert.equal(sent.content, f.input); assert.equal(sent.key, f.settings.key);
  assert.ok(f.calls.findIndex(call => call.kind === 'commit' && call.tx === f.handles[0]) < f.calls.findIndex(call => call.kind === 'write.begin' && call.tx === f.handles[1]));
  assert.ok(f.calls.filter(call => ['rows', 'execute', 'prisma.createMany', 'prisma.updateMany', 'prisma.findMany'].includes(call.kind)).every(call => call.tx === f.handles[0]));
});

test('a revoked second authentication prevents the command without refunding the committed rate charge', async t => {
  const f = await fixture(t, { revokeAfterRate: true });
  await assert.rejects(f.service.send(f.credentials, f.roomId, f.input), { code: 'UNAUTHENTICATED' });
  assert.equal(f.handles.length, 2); assert.equal(f.charges(), 3);
  assert.equal(f.calls.filter(call => call.kind === 'require').length, 2);
  assert.equal(f.calls.some(call => call.kind === 'send'), false);
  assert.deepEqual(f.calls.filter(call => ['commit', 'rollback'].includes(call.kind)).map(call => [call.kind, call.tx.id]), [['commit', 1], ['rollback', 2]]);
});

test('first authentication or rate denial never begins a command; domain failure cannot refund rate', async t => {
  for (const [options, code, transactions, charges] of [
    [{ authDenied: true }, 'UNAUTHENTICATED', 1, 0],
    [{ rateDenied: true }, 'RATE_LIMITED', 1, 0],
    [{ commandDenied: true }, 'NOT_FOUND', 2, 3],
  ]) {
    const f = await fixture(t, options);
    await assert.rejects(f.service.send(f.credentials, f.roomId, f.input), { code });
    assert.equal(f.handles.length, transactions); assert.equal(f.charges(), charges);
    assert.equal(f.calls.filter(call => call.kind === 'send').length, options.commandDenied ? 1 : 0);
    if (options.authDenied) assert.equal(f.calls.some(call => ['rows', 'execute', 'prisma.createMany', 'prisma.updateMany', 'prisma.findMany'].includes(call.kind)), false);
  }
});

test('get requires SOOP on its read handle while author removal uses its write handle without SOOP admission', async t => {
  const f = await fixture(t);
  assert.deepEqual(await f.service.get(f.credentials, f.roomId, f.messageId), { id: f.messageId });
  assert.deepEqual(await f.service.remove(f.credentials, f.roomId, f.messageId), { requestId: 'synthetic-request', status: 'blocked' });
  assert.deepEqual(f.handles.map(tx => tx.writable), [false, true]);
  const checks = f.calls.filter(call => call.kind === 'require');
  assert.deepEqual(checks.map(call => call.requireSoop), [true, false]);
  assert.equal(f.calls.find(call => call.kind === 'get').tx, checks[0].tx);
  assert.equal(f.calls.find(call => call.kind === 'remove').tx, checks[1].tx);
  assert.equal(f.calls.some(call => ['rows', 'execute', 'prisma.createMany', 'prisma.updateMany', 'prisma.findMany'].includes(call.kind)), false);
});

test('application commands reject missing or malformed CSRF before opening any transaction', async t => {
  const f = await fixture(t);
  for (const csrf of [undefined, '', 'invalid', ['b'.repeat(43)]]) {
    const credentials = { token: f.credentials.token, csrf };
    await assert.rejects(f.service.send(credentials, f.roomId, f.input), { code: 'INVALID_REQUEST' });
    assert.throws(() => f.service.remove(credentials, f.roomId, f.messageId), { code: 'INVALID_REQUEST' });
  }
  assert.equal(f.handles.length, 0); assert.deepEqual(f.calls, []);
});

test('real controller maps cookies and CSRF into explicit credentials without accepting actor IDs or extra delete fields', async t => {
  const f = await fixture(t); const received = [];
  f.service.send = async (...args) => { received.push(['send', ...args]); return { status: 'committed' }; };
  f.service.get = async (...args) => { received.push(['get', ...args]); return { id: f.messageId }; };
  f.service.remove = async (...args) => { received.push(['remove', ...args]); return { status: 'blocked' }; };
  const headers = { cookie: `rogi_session=${f.credentials.token}`, origin: f.settings.origin, 'x-csrf-token': f.credentials.csrf };
  const body = { membershipScope: f.input.membershipScope, clientMessageId: f.input.clientMessageId, intent: 'SHARED', content: { type: 'TEXT', text: '합성 모듈 메시지' } };
  await f.controller.send({ headers, body }, f.roomId);
  await f.controller.get({ headers: { cookie: headers.cookie } }, f.roomId, f.messageId);
  await f.controller.remove({ headers, body: {} }, f.roomId, f.messageId);
  assert.deepEqual(received[0], ['send', f.credentials, f.roomId, f.input]);
  assert.deepEqual(received[1], ['get', { token: f.credentials.token }, f.roomId, f.messageId]);
  assert.deepEqual(received[2], ['remove', f.credentials, f.roomId, f.messageId]);
  for (const input of [{ headers: { ...headers, origin: 'https://evil.invalid' }, body },
    { headers: { cookie: headers.cookie, origin: headers.origin }, body }, { headers, body: { ...body, userId: randomUUID() } }]) {
    assert.throws(() => f.controller.send(input, f.roomId));
  }
  assert.throws(() => f.controller.remove({ headers, body: { actorId: randomUUID() } }, f.roomId, f.messageId));
  assert.equal(received.length, 3); assert.equal(f.handles.length, 0);
});

test('controller/application/core services have no direct SQL calls; repository cannot create hidden transactions', async () => {
  for (const [file, repository] of [['messages.controller.ts', false], ['messages.service.ts', false], ['messages-core.service.ts', false], ['messages.repository.ts', true]]) {
    const source = await readFile(new URL(`../../src/modules/messages/${file}`, import.meta.url), 'utf8');
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const violations = [];
    const visit = node => {
      if (!repository && ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ['rows', 'execute', 'query'].includes(node.expression.name.text)) violations.push(node.getText(ast));
      if (!repository && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node)) && /^\s*(SELECT|INSERT|UPDATE|DELETE|START TRANSACTION)\b/i.test(node.text)) violations.push(node.getText(ast));
      if (repository && ts.isImportDeclaration(node) && node.importClause && !node.importClause.isTypeOnly) {
        const path = node.moduleSpecifier.text;
        if (/mysql2|(^|\/)database(?:\.module)?\.js$|(^|\/)transactions\.js$/.test(path)) violations.push(node.getText(ast));
      }
      if (repository && ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ['read', 'write', 'getConnection', 'beginTransaction', 'commit', 'rollback'].includes(node.expression.name.text)) violations.push(node.getText(ast));
      ts.forEachChild(node, visit);
    };
    visit(ast); assert.deepEqual(violations, [], file);
  }
});
