import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reactionSummary } from './reactions';
void test('reaction projection rejects malformed aggregates and drops extra identity data', () => {
  for (const value of [{}, { counts: [], mine: '👍' }, { counts: [{ emoji: '👍', count: 0 }], mine: null }, { counts: [{ emoji: '👍', count: 1.5 }], mine: null }, { counts: [{ emoji: '👍', count: 1 }, { emoji: '👍', count: 2 }], mine: null }]) assert.throws(() => reactionSummary(value));
  assert.deepEqual(reactionSummary({ counts: [{ emoji: '👍🏽', count: 2, userId: 'not-rendered' }], mine: '👍🏽', users: ['not-rendered'] }), { counts: [{ emoji: '👍🏽', count: 2 }], mine: '👍🏽' });
});
