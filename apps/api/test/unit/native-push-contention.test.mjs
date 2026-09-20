import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NativePushRepository } from '../../dist/modules/notifications/native-push.repository.js';

test('native previous-account NOWAIT recognizes only exact MySQL contention and preserves other failures', async () => {
  const repository = new NativePushRepository();
  assert.equal(await repository.lockPreviousAccount({ rows: async () => [] }, 'fixture-user'), true);
  for (const error of [
    { code: 'P2010', meta: { code: '3572' } },
    { meta: { driverAdapterError: { cause: { kind: 'mysql', code: 3572, originalCode: '3572' } } } },
  ]) assert.equal(await repository.lockPreviousAccount({ rows: async () => { throw error; } }, 'fixture-user'), false);
  for (const error of [new TypeError('programmer-error'), { code: '3572' }, { code: 'P2010', meta: { code: '1064' } },
    { meta: { driverAdapterError: { cause: { kind: 'mysql', code: 1205, originalCode: '1205' } } } }]) {
    await assert.rejects(repository.lockPreviousAccount({ rows: async () => { throw error; } }, 'fixture-user'), actual => actual === error);
  }
});
