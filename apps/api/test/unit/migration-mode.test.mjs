import assert from 'node:assert/strict';
import { test } from 'node:test';
import { migrationMode } from '../support/migration-mode.mjs';

test('ordinary and specialized suites retain drift validation by default', () => {
  assert.equal(migrationMode([]), 'dev');
  assert.equal(migrationMode(['--quality']), 'dev');
  assert.equal(migrationMode(['--migration-only']), 'dev');
  assert.equal(migrationMode(['--migration-mode=dev', '--shard-index=1', '--shard-count=4']), 'dev');
  assert.equal(migrationMode(['--shard-index=0', '--shard-count=4'], false), 'dev');
  assert.equal(migrationMode(['--shard-index=0', '--shard-count=3'], true), 'dev');
});

test('CI uses one drift check across its four isolated integration shards', () => {
  assert.deepEqual([0, 1, 2, 3].map(index =>
    migrationMode([`--shard-index=${index}`, '--shard-count=4'], true)),
  ['deploy', 'dev', 'deploy', 'deploy']);
  assert.equal(migrationMode(['--quality', '--shard-index=0', '--shard-count=4'], true), 'dev');
});

test('explicit deploy preparation is confined to an ordinary integration shard', () => {
  assert.equal(migrationMode(['--migration-mode=deploy', '--shard-index=0', '--shard-count=4']), 'deploy');
  for (const args of [
    ['--migration-mode=deploy'],
    ['--migration-mode=deploy', '--migration-only', '--shard-index=0', '--shard-count=4'],
    ['--migration-mode=deploy', '--restore', '--shard-index=0', '--shard-count=4'],
    ['--migration-mode=unknown', '--shard-index=0', '--shard-count=4'],
    ['--migration-mode=dev', '--migration-mode=deploy', '--shard-index=0', '--shard-count=4'],
  ]) assert.throws(() => migrationMode(args));
});
