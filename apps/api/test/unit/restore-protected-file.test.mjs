import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, writeFile, chmod, link, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readProtectedRestoreFile } from '../../dist/modules/restore-gate/restore-gate.command.js';

test('operator proof files require canonical paths, private single-link regular files and bounded bytes', async t => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'rg-restore-file-')));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'proof'); await writeFile(path, 'proof', { mode: 0o600 });
  assert.equal(readProtectedRestoreFile(path, 5).toString(), 'proof');
  assert.throws(() => readProtectedRestoreFile(path, 4));
  assert.throws(() => readProtectedRestoreFile('relative', 5));
  await symlink(path, join(directory, 'alias')); assert.throws(() => readProtectedRestoreFile(join(directory, 'alias'), 5));
  await symlink(directory, join(directory, 'parent')); assert.throws(() => readProtectedRestoreFile(join(directory, 'parent', 'proof'), 5));
  await chmod(path, 0o644); assert.throws(() => readProtectedRestoreFile(path, 5)); await chmod(path, 0o400);
  assert.equal(readProtectedRestoreFile(path, 5).toString(), 'proof');
  await link(path, join(directory, 'hardlink')); assert.throws(() => readProtectedRestoreFile(path, 5));
});
