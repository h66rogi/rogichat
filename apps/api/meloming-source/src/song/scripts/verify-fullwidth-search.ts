/* eslint-disable no-console */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { normalizeForSearch, escapeForLike } from '../utils/search-normalize';

/**
 * SELECT-only sanity check: pick songs whose title contains fullwidth Latin
 * letters, and verify that a halfwidth user query matches via
 * `titleSearchable contains` (which is what the running query path does).
 */
async function main() {
  const p = new PrismaClient();
  try {
    const samples = await p.$queryRawUnsafe<
      { id: number; title: string; title_searchable: string }[]
    >(
      "SELECT id, title, title_searchable FROM songs " +
        "WHERE title REGEXP '[\\uFF21-\\uFF3A\\uFF41-\\uFF5A]' " +
        "LIMIT 5",
    );
    console.log(`fullwidth-letter sample count: ${samples.length}`);
    for (const r of samples) {
      console.log(`  id=${r.id} title='${r.title}' searchable='${r.title_searchable}'`);
    }

    if (samples.length > 0) {
      const sample = samples[0];
      const halfwidthFromTitle = sample.title.normalize('NFKC').toLowerCase();
      const queryWord =
        halfwidthFromTitle
          .replace(/[^a-z0-9]+/g, ' ')
          .split(/\s+/)
          .filter((w) => w.length >= 2)[0] || halfwidthFromTitle.slice(0, 3);
      const searchKey = normalizeForSearch(queryWord);
      const escaped = escapeForLike(searchKey);
      const match = await p.song.findFirst({
        where: { id: sample.id, titleSearchable: { contains: escaped } },
        select: { id: true },
      });
      console.log(
        `match check: sample id=${sample.id} query='${queryWord}' -> norm='${searchKey}' match=${match ? 'YES' : 'NO'}`,
      );
    }
  } finally {
    await p.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
