import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { migrationManifest } from '../../dist/schema-manifest.js';

test('readiness manifest matches every generated migration, with no silent schema drift', async () => {
  const entries = (await readdir('prisma/migrations', { withFileTypes: true })).filter(x => x.isDirectory()).map(x => x.name).sort();
  assert.deepEqual(entries, migrationManifest.map(x => x.name));
  for (const entry of migrationManifest) {
    const sql = await readFile(`prisma/migrations/${entry.name}/migration.sql`);
    assert.equal(createHash('sha256').update(sql).digest('hex'), entry.checksum);
    assert.doesNotMatch(sql.toString(), /AUTO_INCREMENT/);
  }
});
