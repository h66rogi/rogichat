/* eslint-disable no-console */
import * as fs from 'fs';

/**
 * HTTP batch driver for `POST /global-songs/artist-merge`.
 *
 * Reads the JSON produced by `extract-artist-merge-candidates.ts` and calls
 * the merge endpoint once per candidate batch. Designed to be killed and
 * resumed at any time — pass `--start-from N` and `--limit M` to slice.
 *
 * Run:
 *   API_BASE_URL=http://localhost:8090 INTERNAL_API_KEY=... \
 *     pnpm tsx src/global-song/scripts/run-artist-merges.ts \
 *     --candidates /tmp/artist_candidates.json \
 *     --tier A1,A2,A3 \
 *     --dry-run --limit 5
 *
 * Exit codes: 0 all ok, 1 fatal setup error, 2 one or more merges failed.
 */

interface Candidate {
  canonicalName: string;
  winnerId: number;
  loserIds: number[];
  winnerSongCount: number;
  loserSongCounts: number[];
  totalSongs: number;
  gsize: number;
  tier: 'A1' | 'A2' | 'A3' | 'A4';
}

interface CandidateFile {
  candidates: Candidate[];
}

interface CliArgs {
  candidates: string;
  tierFilter: Set<string> | null;
  dryRun: boolean;
  startFrom: number;
  limit: number;
  logEvery: number;
  concurrency: number;
  reasonPrefix: string;
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
  const intOrDefault = (k: string, fallback: number): number => {
    const v = opts[k];
    if (v === undefined || typeof v === 'boolean') return fallback;
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : fallback;
  };
  const tierStr = typeof opts.tier === 'string' ? opts.tier : '';
  return {
    candidates:
      (opts.candidates as string | undefined) ?? '/tmp/artist_candidates.json',
    tierFilter: tierStr
      ? new Set(tierStr.split(',').map((s) => s.trim()))
      : null,
    dryRun: opts['dry-run'] === true || opts.dryRun === true,
    startFrom: intOrDefault('start-from', 0),
    limit: intOrDefault('limit', Number.MAX_SAFE_INTEGER),
    logEvery: intOrDefault('log-every', 25),
    concurrency: intOrDefault('concurrency', 1),
    reasonPrefix:
      (opts['reason-prefix'] as string | undefined) ??
      'canonical-name-dup auto-merge',
  };
}

interface MergeBody {
  winnerId: number;
  loserIds: number[];
  reason: string;
  dryRun: boolean;
}

interface MergeResponse {
  songsReassigned: number;
  conflictSongsAutoMerged: number;
  aliasesMoved: number;
  aliasesDropped: number;
  losersDeleted: number;
  redisSyncOk: boolean;
}

async function callArtistMerge(
  baseUrl: string,
  apiKey: string,
  body: MergeBody,
): Promise<MergeResponse> {
  const res = await fetch(
    `${baseUrl.replace(/\/$/, '')}/global-songs/artist-merge`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-api-key': apiKey,
      },
      body: JSON.stringify(body),
    },
  );
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  return JSON.parse(text) as MergeResponse;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseUrl = process.env.API_BASE_URL;
  const apiKey = process.env.INTERNAL_API_KEY;
  if (!baseUrl || !apiKey) {
    console.error('API_BASE_URL and INTERNAL_API_KEY env vars are required.');
    process.exit(1);
  }

  const file: CandidateFile = JSON.parse(
    fs.readFileSync(args.candidates, 'utf8'),
  );
  let pool = file.candidates;
  if (args.tierFilter) {
    pool = pool.filter((c) => args.tierFilter.has(c.tier));
  }
  const sliced = pool.slice(args.startFrom, args.startFrom + args.limit);

  console.log(
    `[run-artist-merges] base=${baseUrl} dryRun=${args.dryRun} ` +
      `tier=${args.tierFilter ? [...args.tierFilter].join(',') : 'all'} ` +
      `pool=${pool.length} sliced=${sliced.length} ` +
      `startFrom=${args.startFrom} limit=${args.limit} concurrency=${args.concurrency}`,
  );

  let succeeded = 0;
  let failed = 0;
  let losersDeleted = 0;
  let songsReassigned = 0;
  let conflictsAutoMerged = 0;
  const failures: Array<{ idx: number; canonicalName: string; error: string }> =
    [];
  const startedAt = Date.now();
  let nextIndex = 0;

  const workers = Array.from(
    { length: Math.max(1, args.concurrency) },
    async () => {
      while (true) {
        const idx = nextIndex++;
        if (idx >= sliced.length) break;
        const c = sliced[idx];
        const body: MergeBody = {
          winnerId: c.winnerId,
          loserIds: c.loserIds,
          reason:
            `${args.reasonPrefix} tier=${c.tier} ` +
            `name="${c.canonicalName.slice(0, 60)}" ` +
            `gsize=${c.gsize} winSc=${c.winnerSongCount}`,
          dryRun: args.dryRun,
        };
        try {
          const report = await callArtistMerge(baseUrl, apiKey, body);
          succeeded++;
          losersDeleted += report.losersDeleted;
          songsReassigned += report.songsReassigned;
          conflictsAutoMerged += report.conflictSongsAutoMerged;
          if ((idx + 1) % args.logEvery === 0 || idx + 1 === sliced.length) {
            const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
            console.log(
              `[${idx + 1}/${sliced.length}] ok=${succeeded} fail=${failed} ` +
                `losers=${losersDeleted} songs=${songsReassigned} ` +
                `conflicts=${conflictsAutoMerged} elapsed=${elapsed}s — ` +
                `last name="${c.canonicalName}" tier=${c.tier} ` +
                `redisOk=${report.redisSyncOk}`,
            );
          }
        } catch (error) {
          failed++;
          const message =
            error instanceof Error ? error.message : String(error);
          failures.push({
            idx: idx + 1,
            canonicalName: c.canonicalName,
            error: message,
          });
          console.error(
            `FAIL [${idx + 1}] tier=${c.tier} name="${c.canonicalName}" ` +
              `winner=${c.winnerId} losers=${c.loserIds.join(',')}: ${message}`,
          );
        }
      }
    },
  );
  await Promise.all(workers);

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `[run-artist-merges] done ok=${succeeded} fail=${failed} ` +
      `losersDeleted=${losersDeleted} songsReassigned=${songsReassigned} ` +
      `conflictsAutoMerged=${conflictsAutoMerged} elapsed=${elapsed}s`,
  );
  if (failures.length > 0) {
    const failPath = '/tmp/artist_merge_failures.json';
    fs.writeFileSync(failPath, JSON.stringify(failures, null, 2));
    console.log(`[run-artist-merges] failures written to ${failPath}`);
  }
  process.exit(failed > 0 ? 2 : 0);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`unhandled: ${message}`);
  process.exit(1);
});
