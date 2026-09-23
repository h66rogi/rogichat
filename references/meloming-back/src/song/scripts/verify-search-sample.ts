/* eslint-disable no-console */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { normalizeForSearch } from '../utils/search-normalize';

/**
 * Sanity check: pick a real song with spaces and verify that a no-space
 * query matches via titleSearchable contains.
 */
async function main() {
  const p = new PrismaClient();
  try {
    const sample = await p.song.findFirst({
      where: {
        title: { contains: ' ' },
        titleSearchable: { not: null },
      },
      select: { id: true, title: true, titleSearchable: true },
    });
    if (!sample) {
      console.log('no sample with spaces');
      return;
    }
    console.log(`sample: id=${sample.id}`);
    console.log(`  title='${sample.title}'`);
    console.log(`  title_searchable='${sample.titleSearchable}'`);
    const stripped = sample.title.replace(/\s+/g, '');
    const queryKey = normalizeForSearch(stripped);
    console.log(`  query (no-space)='${stripped}' → norm='${queryKey}'`);
    const match = await p.song.findFirst({
      where: { id: sample.id, titleSearchable: { contains: queryKey } },
      select: { id: true },
    });
    console.log(`  match found: ${match ? 'YES' : 'NO'}`);
  } finally {
    await p.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
