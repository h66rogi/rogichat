/* eslint-disable no-console */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

/**
 * raw SQL backfill 은 NFKC fullwidth -> halfwidth 변환을 못해서, 기존 row 중
 * title 안에 fullwidth ASCII (U+FF01..U+FF5E) 가 포함된 경우 title_searchable
 * 정확도가 떨어질 수 있다. 이 스크립트는 그 row 수만 SELECT 로 집계한다.
 */
async function main() {
  const p = new PrismaClient();
  try {
    const songs = await p.$queryRaw<{ c: bigint }[]>`
      SELECT COUNT(*) AS c FROM songs WHERE title REGEXP '[\\uFF01-\\uFF5E]'
    `;
    const artists = await p.$queryRaw<{ c: bigint }[]>`
      SELECT COUNT(*) AS c FROM artists WHERE name REGEXP '[\\uFF01-\\uFF5E]'
    `;
    console.log(`songs with fullwidth ASCII in title: ${songs[0].c}`);
    console.log(`artists with fullwidth ASCII in name: ${artists[0].c}`);
  } finally {
    await p.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
