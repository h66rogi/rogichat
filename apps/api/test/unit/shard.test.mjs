import assert from 'node:assert/strict';
import test from 'node:test';
import { selectShard } from '../support/shard.mjs';

test('integration shards cover each sorted file exactly once', () => {
  const files = Array.from({ length: 53 }, (_, index) => `file-${index}`);
  const groups = Array.from({ length: 4 }, (_, index) =>
    selectShard(files, [`--shard-index=${index}`, '--shard-count=4']));
  assert.deepEqual(groups.flat().sort(), [...files].sort());
  assert.deepEqual(groups.map(group => group.length), [14, 13, 13, 13]);
});

test('invalid or ambiguous shard selection fails', () => {
  for (const args of [
    ['--shard-index=0'], ['--shard-index=-1', '--shard-count=4'],
    ['--shard-index=4', '--shard-count=4'], ['--shard-index=0', '--shard-count=9'],
    ['--shard-index=0', '--shard-count=4', '--test-file=one.test.mjs'],
  ]) assert.throws(() => selectShard(['one.test.mjs'], args), /invalid integration shard/);
});
