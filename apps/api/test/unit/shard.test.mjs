import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import test from 'node:test';
import { selectShard } from '../support/shard.mjs';

test('integration shards cover each sorted file exactly once', () => {
  const files = Array.from({ length: 53 }, (_, index) => `file-${index}`);
  const groups = Array.from({ length: 4 }, (_, index) =>
    selectShard(files, [`--shard-index=${index}`, '--shard-count=4']));
  assert.deepEqual(groups.flat().sort(), [...files].sort());
  assert.deepEqual(groups.map(group => group.length), [14, 13, 13, 13]);
});

test('four integration shards separate the two longest files and retain full coverage', () => {
  const files = readdirSync(new URL('../integration/', import.meta.url))
    .filter(name => name.endsWith('.test.mjs')).sort().map(name => `test/integration/${name}`);
  const groups = Array.from({ length: 4 }, (_, index) =>
    selectShard(files, [`--shard-index=${index}`, '--shard-count=4']));
  assert.deepEqual(groups.flat().sort(), files);
  assert.equal(groups[2].includes('test/integration/channel-content.test.mjs'), true);
  assert.equal(groups[3].includes('test/integration/owner-bootstrap.test.mjs'), true);
  assert.equal(groups[3].includes('test/integration/channel-content.test.mjs'), false);
});

test('invalid or ambiguous shard selection fails', () => {
  for (const args of [
    ['--shard-index=0'], ['--shard-index=-1', '--shard-count=4'],
    ['--shard-index=4', '--shard-count=4'], ['--shard-index=0', '--shard-count=9'],
    ['--shard-index=0', '--shard-count=4', '--test-file=one.test.mjs'],
  ]) assert.throws(() => selectShard(['one.test.mjs'], args), /invalid integration shard/);
});
