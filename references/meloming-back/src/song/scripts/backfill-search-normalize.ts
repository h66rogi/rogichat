/* eslint-disable no-console */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { normalizeForSearch } from '../utils/search-normalize';

/**
 * Backfill Song.titleSearchable / Artist.nameSearchable for existing rows.
 *
 * Idempotent — only processes rows where the searchable column is NULL.
 * Run once after applying migration 20260510235318_add_songbook_search_normalize.
 *
 * Usage:
 *   pnpm exec ts-node -r tsconfig-paths/register \
 *     src/song/scripts/backfill-search-normalize.ts
 *
 * DATABASE_URL is read from .env (must point to the target environment's DB).
 */

const BATCH_SIZE = 500;

async function backfillSongs(prisma: PrismaClient): Promise<number> {
  let processed = 0;
  while (true) {
    const rows = await prisma.song.findMany({
      where: { titleSearchable: null },
      select: { id: true, title: true },
      take: BATCH_SIZE,
    });
    if (rows.length === 0) break;

    await prisma.$transaction(
      rows.map((row) =>
        prisma.song.update({
          where: { id: row.id },
          data: { titleSearchable: normalizeForSearch(row.title) },
        }),
      ),
    );

    processed += rows.length;
    console.log(`[songs] processed ${processed} rows`);
  }
  return processed;
}

async function backfillArtists(prisma: PrismaClient): Promise<number> {
  let processed = 0;
  while (true) {
    const rows = await prisma.artist.findMany({
      where: { nameSearchable: null },
      select: { id: true, name: true },
      take: BATCH_SIZE,
    });
    if (rows.length === 0) break;

    await prisma.$transaction(
      rows.map((row) =>
        prisma.artist.update({
          where: { id: row.id },
          data: { nameSearchable: normalizeForSearch(row.name) },
        }),
      ),
    );

    processed += rows.length;
    console.log(`[artists] processed ${processed} rows`);
  }
  return processed;
}

async function main() {
  const prisma = new PrismaClient();
  try {
    console.log('▶ Backfilling songs.title_searchable ...');
    const songs = await backfillSongs(prisma);
    console.log(`✓ songs done — ${songs} rows updated`);

    console.log('▶ Backfilling artists.name_searchable ...');
    const artists = await backfillArtists(prisma);
    console.log(`✓ artists done — ${artists} rows updated`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
