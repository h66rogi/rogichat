import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { migrationManifest } from '../../dist/infrastructure/database/schema-manifest.js';

test('readiness manifest matches every generated migration, with no silent schema drift', async () => {
  const entries = (await readdir('prisma/migrations', { withFileTypes: true })).filter(x => x.isDirectory()).map(x => x.name).sort();
  assert.deepEqual(entries, migrationManifest.map(x => x.name));
  for (const entry of migrationManifest) {
    const sql = await readFile(`prisma/migrations/${entry.name}/migration.sql`);
    assert.equal(createHash('sha256').update(sql).digest('hex'), entry.checksum);
    // Meloming's copied song media tables allocate IDs in
    // MySQL. Keep that source behavior while preserving the original guard for
    // every other Rogichat migration.
    if (entry.name === '20260923214500_meloming_content_models') {
      const tables = [...sql.toString().matchAll(/CREATE TABLE `([^`]+)` \(([\s\S]*?)\) DEFAULT CHARACTER SET/g)]
        .filter(([, , body]) => body.includes('AUTO_INCREMENT'))
        .map(([, name]) => name)
        .sort();
      assert.deepEqual(tables, ['SongSheetMusic', 'song_video_preferences']);
      assert.equal((sql.toString().match(/AUTO_INCREMENT/g) ?? []).length, tables.length);
    } else if (entry.name === '20260924041000_overlay_theme_layout') {
      assert.match(sql.toString(), /ALTER TABLE `channel_overlay_layouts` MODIFY `id` INTEGER NOT NULL AUTO_INCREMENT;/);
      assert.equal((sql.toString().match(/AUTO_INCREMENT/g) ?? []).length, 1);
    } else {
      assert.doesNotMatch(sql.toString(), /AUTO_INCREMENT/);
    }
  }
});
