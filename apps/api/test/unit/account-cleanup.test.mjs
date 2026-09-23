import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AccountCleanupService } from '../../dist/modules/deletion/account-cleanup.service.js';
import { AccountCleanupModule } from '../../dist/modules/deletion/account-cleanup.module.js';
import { AccountContentService } from '../../dist/modules/deletion/account-content.service.js';
import { AccountCleanupRepository } from '../../dist/modules/deletion/account-cleanup.repository.js';
import { NotificationsModule } from '../../dist/modules/notifications/notifications.module.js';
import { ReadStateCoreModule } from '../../dist/modules/read-state/read-state-core.module.js';

const requestId = '00000000-0000-4000-8000-000000000001';
function fixture(readResult, pushResult, authResult = { changed: 0, hasMore: false }, contentResult = null, moderation = { changed: 0, done: true }) {
  const calls = []; let inTransaction = false;
  const ledger = { environment: 'qa', async readByKey() {
    assert.equal(inTransaction, false); calls.push('external'); return { intent: { scope: 'ACCOUNT', targetId: 'isolated' } };
  } };
  const transactions = { async write(fn) { inTransaction = true; try { return await fn({}); } finally { inTransaction = false; } } };
  const repository = {
    async authorize() { assert.equal(inTransaction, true); calls.push('authorize'); },
    async privateFields() { calls.push('private'); return 0; },
    async channelContent() { calls.push('channel'); return 0; },
    async memberPage() { calls.push('member'); return null; },
    async mediaUsage() { return 0; },
    async profileChanges() { return 0; },
    async sessions() { calls.push('sessions'); return 0; },
  };
  const read = { async purgeAccount(_tx, _userId, limit) { assert.equal(limit, 100); calls.push('read'); return readResult; } };
  const push = { async purgeAccount(_tx, _userId, limit) { assert.equal(limit, 100); calls.push('push'); return pushResult; } };
  return { calls, service: new AccountCleanupService(transactions, ledger, repository, read, push, { async page() { calls.push('content'); return contentResult; } }, { async page() { calls.push('media'); return false; } }, { async clearForAccount() { return moderation; } }, { async purgeAccount() { calls.push('auth'); return authResult; } }) };
}

test('read-state hasMore and push done are distinct continuation barriers, including zero-deletion passes', async () => {
  for (const [read, push, phase, expected] of [
    [{ deleted: 0, hasMore: true }, { deleted: 0, done: true }, 'read-state', ['external', 'authorize', 'private', 'channel', 'read']],
    [{ deleted: 100, hasMore: false }, { deleted: 0, done: true }, 'read-state', ['external', 'authorize', 'private', 'channel', 'read']],
    [{ deleted: 0, hasMore: false }, { deleted: 0, done: false }, 'push', ['external', 'authorize', 'private', 'channel', 'read', 'member', 'push']],
    [{ deleted: 0, hasMore: false }, { deleted: 1, done: true }, 'push', ['external', 'authorize', 'private', 'channel', 'read', 'member', 'push']],
  ]) {
    const f = fixture(read, push); const result = await f.service.step(requestId);
    assert.equal(result.phase, phase); assert.equal(result.hasMore, true); assert.deepEqual(f.calls, expected);
  }
  const f = fixture({ deleted: 0, hasMore: false }, { deleted: 0, done: true });
  assert.deepEqual(await f.service.step(requestId), { phase: 'subset-drained', changed: 0, hasMore: false });
  assert.deepEqual(f.calls.slice(-4), ['sessions', 'auth', 'content', 'media']);
});

test('cleanup module exports only its internal service and consumes existing domain ports without installing a runner', () => {
  const module = AccountCleanupModule.register({ module: class Infrastructure {} }, { ledger: {} });
  assert.deepEqual(module.exports, [AccountCleanupService, AccountContentService]);
  assert.ok(module.providers.includes(AccountCleanupRepository));
  assert.ok(module.imports.includes(ReadStateCoreModule)); assert.ok(module.imports.includes(NotificationsModule));
  assert.equal(module.controllers, undefined);
  assert.equal(module.providers.some(provider => /Lifecycle|Reconciler|Worker/.test(provider.name ?? '')), false);
});


test('moderation detail cleanup remains inside the account transaction and zero-change pending work cannot complete', async () => {
  for (const result of [{ changed: 2, done: true }, { changed: 0, done: false }]) {
    const f = fixture({ deleted: 0, hasMore: false }, { deleted: 0, done: true }, undefined, null, result);
    assert.deepEqual(await f.service.step(requestId), { phase: 'moderation', changed: result.changed, hasMore: true });
    assert.deepEqual(f.calls, ['external', 'authorize', 'private', 'channel']);
  }
});

test('provider revocation and auth grace waits permit independent content and media cleanup', async () => {
  for (const providerPending of [true, false]) {
    const pending = { changed: 0, hasMore: true, providerPending };
    const f = fixture({ deleted: 0, hasMore: false }, { deleted: 0, done: true }, pending);
    assert.deepEqual(await f.service.step(requestId), { phase: providerPending ? 'provider-revocation' : 'auth', changed: 0, hasMore: true });
    assert.deepEqual(f.calls.slice(-3), ['auth', 'content', 'media']);
    const content = { phase: 'content', changed: 1, hasMore: true };
    const active = fixture({ deleted: 0, hasMore: false }, { deleted: 0, done: true }, pending, content);
    assert.deepEqual(await active.service.step(requestId), content);
  }
});
