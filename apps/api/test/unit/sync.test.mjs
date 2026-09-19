import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { syncInput, resetSync } from '../../dist/sync.js';

test('sync query uses exact fields, UUID device/cache bindings and bounded decimal string limits', () => {
  const input = { deviceId: randomUUID(), cacheId: randomUUID() };
  assert.deepEqual(syncInput(input), { ...input, limit: 50 });
  for (const limit of ['1', '50', '100']) assert.equal(syncInput({ ...input, limit }).limit, Number(limit));
  for (const bad of [null, [], {}, { ...input, userId: randomUUID() }, { ...input, deviceId: '1' },
    { ...input, cacheId: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA' }, { ...input, cursor: [] }, { ...input, cursor: 'x'.repeat(4097) },
    ...['0', '101', '-1', '01', '1.0', '1e1', ' 1', 1, ['1']].map(limit => ({ ...input, limit })),
  ]) assert.throws(() => syncInput(bad), { code: 'INVALID_REQUEST' });
  assert.deepEqual(resetSync(), { schemaVersion: 1, resetRequired: true, events: [], nextCursor: null, hasMore: false });
});
