/* eslint-disable no-console */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { normalizeForSearch } from '../utils/search-normalize';

/**
 * NFKC 보정 backfill — fullwidth ASCII (U+FF01..U+FF5E) 또는 다른
 * compatibility 문자가 포함되어 application normalize 와 결과가 다를 수 있는
 * 기존 row 만 다시 채운다.
 *
 * raw SQL backfill (backfill-search-normalize-fast.ts) 은 한 번에 빠르게
 * 전체 row 를 채우지만 NFKC 를 못 적용해서 fullwidth 가 그대로 남는다.
 * 이 스크립트는 그 결손을 application normalize 로 보정한다.
 *
 * 안전성:
 *   - WHERE title REGEXP '...' 으로 후보 row 만 SELECT
 *   - 각 row 의 title_searchable 을 normalizeForSearch(title) 결과로 덮어쓰되
 *     CONCURRENT live mutation 과의 race 방어를 위해 `WHERE id=? AND title=?`
 *     로 update 한다 (사이에 title 이 바뀌었으면 skip — 그 row 는 새 mutation
 *     이 이미 정확한 값을 넣었거나 다음 mutation 때 채워진다).
 *   - songs 와 artists 모두 처리.
 *
 * Usage:
 *   DATABASE_URL="..." pnpm exec ts-node -r tsconfig-paths/register \
 *     src/song/scripts/backfill-search-normalize-fullwidth.ts
 */

const BATCH = 1000;
const FULLWIDTH_REGEXP = '[\\uFF01-\\uFF5E\\uFFE0-\\uFFEE\\u2160-\\u217F\\u3380-\\u33FF]';

async function backfillSongs(p: PrismaClient): Promise<number> {
  let lastId = 0;
  let processed = 0;
  let updated = 0;
  while (true) {
    const rows = await p.$queryRaw<{ id: number; title: string }[]>`
      SELECT id, title FROM songs
      WHERE id > ${lastId} AND title REGEXP ${FULLWIDTH_REGEXP}
      ORDER BY id ASC LIMIT ${BATCH}
    `;
    if (rows.length === 0) break;
    for (const row of rows) {
      const expected = normalizeForSearch(row.title);
      const res = await p.$executeRaw`
        UPDATE songs SET title_searchable = ${expected}
        WHERE id = ${row.id} AND title = ${row.title}
      `;
      if (res > 0) updated += 1;
    }
    processed += rows.length;
    lastId = rows[rows.length - 1].id;
    console.log(`[songs] scanned ${processed}, updated ${updated} (lastId=${lastId})`);
  }
  return updated;
}

async function backfillArtists(p: PrismaClient): Promise<number> {
  let lastId = 0;
  let processed = 0;
  let updated = 0;
  while (true) {
    const rows = await p.$queryRaw<{ id: number; name: string }[]>`
      SELECT id, name FROM artists
      WHERE id > ${lastId} AND name REGEXP ${FULLWIDTH_REGEXP}
      ORDER BY id ASC LIMIT ${BATCH}
    `;
    if (rows.length === 0) break;
    for (const row of rows) {
      const expected = normalizeForSearch(row.name);
      const res = await p.$executeRaw`
        UPDATE artists SET name_searchable = ${expected}
        WHERE id = ${row.id} AND name = ${row.name}
      `;
      if (res > 0) updated += 1;
    }
    processed += rows.length;
    lastId = rows[rows.length - 1].id;
    console.log(`[artists] scanned ${processed}, updated ${updated} (lastId=${lastId})`);
  }
  return updated;
}

async function main() {
  const p = new PrismaClient();
  try {
    console.log('Backfilling songs with NFKC correction...');
    const s = await backfillSongs(p);
    console.log(`songs corrected: ${s}`);

    console.log('Backfilling artists with NFKC correction...');
    const a = await backfillArtists(p);
    console.log(`artists corrected: ${a}`);
  } finally {
    await p.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
