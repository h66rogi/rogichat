/* eslint-disable no-console */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

/**
 * Fast SQL-side backfill for Song.titleSearchable / Artist.nameSearchable.
 *
 * Uses MySQL 8 REGEXP_REPLACE (ICU regex) so a single round-trip processes
 * all remaining rows. ICU `\s` matches Unicode `White_Space` property —
 * ASCII whitespace, NBSP (U+00A0), ideographic space (U+3000), narrow NBSP
 * (U+202F), U+2028/U+2029 등. application 의 normalizeForSearch() 가 추가로
 * 잡는 U+200B/U+200C/U+200D (ZW family) 와 U+FEFF (BOM) 는 일반 `\s` 에 안
 * 들어가므로 이 fast backfill 단독으로는 strip 되지 않는다. ZW/BOM 이 들어간
 * row 는 새 application mutation 이 일어날 때 정확한 값으로 덮어쓴다.
 *
 * NFKC compatibility normalization (fullwidth → halfwidth, Roman numerals,
 * CJK 단위 등) 도 SQL 에서 못한다. prod 진단 결과 fullwidth ASCII 포함 row
 * 가 songs 71,111 / artists 42,316 (전체 약 34%) 으로 비중이 크기 때문에,
 * 이 fast backfill 만 단독으로 돌리지 말고 곧바로
 * `backfill-search-normalize-fullwidth.ts` 를 이어서 실행해 NFKC 누락을
 * 보정해야 한다.
 *
 * Idempotent: only touches rows where searchable column is NULL.
 *
 * Usage:
 *   pnpm exec ts-node -r tsconfig-paths/register \
 *     src/song/scripts/backfill-search-normalize-fast.ts
 *   pnpm exec ts-node -r tsconfig-paths/register \
 *     src/song/scripts/backfill-search-normalize-fullwidth.ts
 */

async function main() {
  const p = new PrismaClient();
  try {
    console.log('▶ Backfilling songs.title_searchable (raw SQL) ...');
    const songsUpdated = await p.$executeRawUnsafe(
      "UPDATE `songs` SET `title_searchable` = LOWER(REGEXP_REPLACE(`title`, '\\\\s+', '')) WHERE `title_searchable` IS NULL",
    );
    console.log(`✓ songs done — ${songsUpdated} rows updated`);

    console.log('▶ Backfilling artists.name_searchable (raw SQL) ...');
    const artistsUpdated = await p.$executeRawUnsafe(
      "UPDATE `artists` SET `name_searchable` = LOWER(REGEXP_REPLACE(`name`, '\\\\s+', '')) WHERE `name_searchable` IS NULL",
    );
    console.log(`✓ artists done — ${artistsUpdated} rows updated`);
  } finally {
    await p.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
