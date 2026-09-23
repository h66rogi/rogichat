/* eslint-disable no-console */
import * as fs from 'fs';
import { PrismaClient } from '@prisma/client';

/**
 * Build artist-merge candidate batches from the live DB.
 *
 * Groups GlobalArtist rows by `canonical_name`. Each group with size ≥ 2 is
 * one merge candidate: winner = highest song_count (tie → lowest id), losers
 * = the rest. Each group is classified into a tier based on how lopsided the
 * song-count distribution is — tiers A1/A2/A3 are safe for unattended merge,
 * A4 needs LLM/human review.
 *
 * Output JSON shape:
 *   {
 *     generatedAt, totals: {...},
 *     candidates: [
 *       { canonicalName, winnerId, loserIds, winnerSongCount,
 *         loserSongCounts, tier, totalSongs, gsize }
 *     ]
 *   }
 *
 * Run:
 *   DATABASE_URL=$(grep ^DATABASE_URL .env.prod | cut -d= -f2-) \
 *     pnpm tsx src/global-song/scripts/extract-artist-merge-candidates.ts \
 *     --output /tmp/artist_candidates.json
 */

interface CliArgs {
  output: string;
  tierFilter: Set<string> | null;
  maxLosersPerCall: number;
}

interface Candidate {
  canonicalName: string;
  winnerId: number;
  winnerNormKey: string;
  loserIds: number[];
  winnerSongCount: number;
  loserSongCounts: number[];
  totalSongs: number;
  gsize: number;
  tier: 'A1' | 'A2' | 'A3' | 'A4';
}

interface ArtistRow {
  id: number;
  canonical_name: string;
  norm_key: string;
  song_count: number;
}

function parseArgs(argv: string[]): CliArgs {
  const opts: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      opts[key] = true;
    } else {
      opts[key] = next;
      i++;
    }
  }
  const tierStr = typeof opts.tier === 'string' ? opts.tier : '';
  return {
    output:
      (opts.output as string | undefined) ?? '/tmp/artist_candidates.json',
    tierFilter: tierStr
      ? new Set(tierStr.split(',').map((s) => s.trim()))
      : null,
    maxLosersPerCall: 19, // service caps at 20; keep 1 headroom
  };
}

function classifyTier(
  winnerSongCount: number,
  totalSongs: number,
  loserSongCounts: number[],
): 'A1' | 'A2' | 'A3' | 'A4' {
  if (winnerSongCount === totalSongs) return 'A1';
  const losersAllLeq1 = loserSongCounts.every((sc) => sc <= 1);
  if (losersAllLeq1 && totalSongs - winnerSongCount <= 2) return 'A2';
  if (winnerSongCount >= totalSongs * 0.8) return 'A3';
  return 'A4';
}

function chunk<T>(arr: T[], size: number): T[][] {
  if (arr.length <= size) return [arr];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();
  console.log(
    `[extract] output=${args.output} tierFilter=${args.tierFilter ? [...args.tierFilter].join(',') : 'all'}`,
  );

  // Pull every artist row that belongs to a duplicate canonical_name group,
  // along with that artist's current song_count. Single SQL trip.
  const rows = await prisma.$queryRaw<ArtistRow[]>`
    WITH dup AS (
      SELECT canonical_name
      FROM global_artists
      GROUP BY canonical_name
      HAVING COUNT(*) > 1
    )
    SELECT
      ga.id,
      ga.canonical_name,
      ga.norm_key,
      (SELECT COUNT(*) FROM global_songs WHERE global_artist_id = ga.id) AS song_count
    FROM global_artists ga
    JOIN dup ON ga.canonical_name = dup.canonical_name
  `;

  console.log(
    `[extract] fetched ${rows.length} artist rows in duplicate groups`,
  );

  // Group by canonical_name
  const byName = new Map<string, ArtistRow[]>();
  for (const r of rows) {
    // BigInt → number guard (mysql2 may return BIGINT for COUNT)
    const sc =
      typeof r.song_count === 'bigint' ? Number(r.song_count) : r.song_count;
    const normalized: ArtistRow = { ...r, song_count: sc };
    const list = byName.get(r.canonical_name) ?? [];
    list.push(normalized);
    byName.set(r.canonical_name, list);
  }

  const candidates: Candidate[] = [];
  let aboveCallCap = 0;
  for (const [name, members] of byName) {
    if (members.length < 2) continue;
    members.sort((a, b) => {
      if (b.song_count !== a.song_count) return b.song_count - a.song_count;
      return a.id - b.id;
    });
    const winner = members[0];
    const losers = members.slice(1);
    const totalSongs = members.reduce((s, m) => s + m.song_count, 0);
    const loserSongCounts = losers.map((l) => l.song_count);
    const tier = classifyTier(winner.song_count, totalSongs, loserSongCounts);

    if (args.tierFilter && !args.tierFilter.has(tier)) continue;

    // Split if losers exceed per-call cap (rare; max group seen is 16).
    const loserChunks = chunk(losers, args.maxLosersPerCall);
    if (loserChunks.length > 1) aboveCallCap += 1;
    for (const lc of loserChunks) {
      candidates.push({
        canonicalName: name,
        winnerId: winner.id,
        winnerNormKey: winner.norm_key,
        loserIds: lc.map((l) => l.id),
        winnerSongCount: winner.song_count,
        loserSongCounts: lc.map((l) => l.song_count),
        totalSongs,
        gsize: members.length,
        tier,
      });
    }
  }

  // Stable order: tier A1→A4, then by totalSongs DESC, then canonicalName
  const tierOrder: Record<string, number> = { A1: 0, A2: 1, A3: 2, A4: 3 };
  candidates.sort((a, b) => {
    if (a.tier !== b.tier) return tierOrder[a.tier] - tierOrder[b.tier];
    if (b.totalSongs !== a.totalSongs) return b.totalSongs - a.totalSongs;
    return a.canonicalName.localeCompare(b.canonicalName);
  });

  const totals = {
    A1: candidates.filter((c) => c.tier === 'A1').length,
    A2: candidates.filter((c) => c.tier === 'A2').length,
    A3: candidates.filter((c) => c.tier === 'A3').length,
    A4: candidates.filter((c) => c.tier === 'A4').length,
    losers_A1_to_A3: candidates
      .filter((c) => c.tier !== 'A4')
      .reduce((s, c) => s + c.loserIds.length, 0),
    losers_A4: candidates
      .filter((c) => c.tier === 'A4')
      .reduce((s, c) => s + c.loserIds.length, 0),
  };

  const output = {
    generatedAt: new Date().toISOString(),
    totals,
    notes: {
      aboveCallCap: aboveCallCap,
      maxLosersPerCall: args.maxLosersPerCall,
    },
    candidates,
  };

  fs.writeFileSync(args.output, JSON.stringify(output, null, 2));
  console.log(
    `[extract] wrote ${candidates.length} candidate batches to ${args.output}`,
  );
  console.log(`[extract] totals: ${JSON.stringify(totals)}`);
  console.log(`[extract] split-due-to-cap groups: ${aboveCallCap}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
