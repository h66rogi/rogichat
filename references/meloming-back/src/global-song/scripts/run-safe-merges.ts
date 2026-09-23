/* eslint-disable no-console */
import * as fs from 'fs';

/**
 * HTTP batch driver for automated Global Song merges.
 *
 * Calls `POST {API_BASE_URL}/global-songs/merge` for each pre-computed
 * safe component (overlap=0 connected component from the offline analysis).
 *
 * This runs AGAINST A DEPLOYED ENVIRONMENT so the merging pod handles the
 * Redis sync itself — avoiding the split between local Redis and the
 * environment's Redis.
 *
 * Inputs:
 *   --components <path>  JSON: { components: [{ nt, members: number[] }] }
 *   --details    <path>  TSV:  gs_id\treal_channels\tsongs_rows\tartist_id
 *
 * Auth + target:
 *   API_BASE_URL     e.g. https://api.qa.meloming.app  (or http://localhost:3000)
 *   INTERNAL_API_KEY same secret the GlobalSongController uses
 *
 * Examples:
 *   API_BASE_URL=https://api.qa... INTERNAL_API_KEY=... \
 *     pnpm run merge:safe -- --dry-run --size-max 2
 *   API_BASE_URL=... INTERNAL_API_KEY=... \
 *     pnpm run merge:safe -- --size-min 3 --size-max 5 --limit 500
 *
 * Exit codes: 0 all ok, 1 fatal setup error, 2 one or more merges failed.
 */

interface ComponentIn {
  nt: string;
  members: number[];
}

interface DetailRow {
  realChannels: number;
  songsRows: number;
  artistId: number;
}

interface CliArgs {
  components: string;
  details: string;
  dryRun: boolean;
  sizeMin: number;
  sizeMax: number;
  startFrom: number;
  limit: number;
  logEvery: number;
  concurrency: number;
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

  return {
    components:
      (opts.components as string | undefined) ?? '/tmp/safe_members.json',
    details:
      (opts.details as string | undefined) ?? '/tmp/safe_members_details.tsv',
    dryRun: opts['dry-run'] === true || opts.dryRun === true,
    sizeMin: intOrDefault('size-min', 2),
    sizeMax: intOrDefault('size-max', Number.MAX_SAFE_INTEGER),
    startFrom: intOrDefault('start-from', 0),
    limit: intOrDefault('limit', Number.MAX_SAFE_INTEGER),
    logEvery: intOrDefault('log-every', 50),
    concurrency: intOrDefault('concurrency', 1),
  };
}

function loadDetails(path: string): Map<number, DetailRow> {
  const map = new Map<number, DetailRow>();
  const raw = fs.readFileSync(path, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith('gs_id')) continue;
    const parts = line.split('\t');
    if (parts.length < 4) continue;
    const gsId = parseInt(parts[0], 10);
    const rc = parseInt(parts[1], 10);
    const sc = parseInt(parts[2], 10);
    const artistId = parseInt(parts[3], 10);
    if (!Number.isFinite(gsId)) continue;
    map.set(gsId, {
      realChannels: Number.isFinite(rc) ? rc : 0,
      songsRows: Number.isFinite(sc) ? sc : 0,
      artistId: Number.isFinite(artistId) ? artistId : 0,
    });
  }
  return map;
}

function pickWinner(
  members: number[],
  details: Map<number, DetailRow>,
): number {
  let winner = members[0];
  let winnerRc = details.get(winner)?.realChannels ?? 0;
  for (let i = 1; i < members.length; i++) {
    const c = members[i];
    const cRc = details.get(c)?.realChannels ?? 0;
    if (cRc > winnerRc || (cRc === winnerRc && c < winner)) {
      winner = c;
      winnerRc = cRc;
    }
  }
  return winner;
}

interface MergeBody {
  winnerId: number;
  loserIds: number[];
  reason: string;
  dryRun: boolean;
}
interface MergeResponseBody {
  aliasesMoved: number;
  aliasesDropped: number;
  songsReassigned: number;
  chainsFlattened: number;
  winnerChannelCountAfter: number;
  losersDeleted: number;
  redisSyncOk: boolean;
}

async function callMerge(
  baseUrl: string,
  apiKey: string,
  body: MergeBody,
): Promise<MergeResponseBody> {
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/global-songs/merge`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-api-key': apiKey,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  return JSON.parse(text) as MergeResponseBody;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseUrl = process.env.API_BASE_URL;
  const apiKey = process.env.INTERNAL_API_KEY;
  if (!baseUrl || !apiKey) {
    console.error('API_BASE_URL and INTERNAL_API_KEY env vars are required.');
    process.exit(1);
  }

  console.log(
    `[run-safe-merges] base=${baseUrl} dryRun=${args.dryRun} ` +
      `size=[${args.sizeMin}, ${args.sizeMax}] startFrom=${args.startFrom} ` +
      `limit=${args.limit} concurrency=${args.concurrency}`,
  );

  const components: ComponentIn[] = (() => {
    const raw = JSON.parse(fs.readFileSync(args.components, 'utf8')) as {
      components: ComponentIn[];
    };
    return raw.components;
  })();
  const details = loadDetails(args.details);
  console.log(
    `[run-safe-merges] loaded components=${components.length} details=${details.size}`,
  );

  // Filter + pick tasks first so we can slice cleanly with startFrom/limit
  // and drive concurrency without an awkward index-aware loop.
  const tasks: Array<{
    nt: string;
    winner: number;
    losers: number[];
    size: number;
  }> = [];
  for (const comp of components) {
    const size = comp.members.length;
    if (size < args.sizeMin || size > args.sizeMax) continue;
    const valid = comp.members.filter((m) => details.has(m));
    if (valid.length < 2) continue;
    const winner = pickWinner(valid, details);
    const losers = valid.filter((m) => m !== winner);
    if (losers.length === 0 || losers.length > 50) continue;
    tasks.push({ nt: comp.nt, winner, losers, size: valid.length });
  }
  const sliced = tasks.slice(args.startFrom, args.startFrom + args.limit);
  console.log(
    `[run-safe-merges] eligible=${tasks.length} sliced=${sliced.length}`,
  );

  let succeeded = 0;
  let failed = 0;
  let losersDeleted = 0;
  let songsReassigned = 0;
  const startedAt = Date.now();

  // Simple concurrent workers draining a shared index. Kept trivially small
  // because the merge is write-heavy and we want predictable ordering in logs.
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.max(1, args.concurrency) },
    async () => {
      while (true) {
        const idx = nextIndex++;
        if (idx >= sliced.length) break;
        const task = sliced[idx];
        const body: MergeBody = {
          winnerId: task.winner,
          loserIds: task.losers,
          reason: `safe-auto nt="${task.nt}" overlap0 size=${task.size}`,
          dryRun: args.dryRun,
        };
        try {
          const report = await callMerge(baseUrl, apiKey, body);
          succeeded++;
          losersDeleted += report.losersDeleted;
          songsReassigned += report.songsReassigned;
          if ((idx + 1) % args.logEvery === 0) {
            const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
            console.log(
              `[${idx + 1}/${sliced.length}] ok=${succeeded} fail=${failed} ` +
                `losers=${losersDeleted} songs=${songsReassigned} elapsed=${elapsed}s — ` +
                `last nt="${task.nt}" winner=${task.winner} redisOk=${report.redisSyncOk}`,
            );
          }
        } catch (error) {
          failed++;
          const message =
            error instanceof Error ? error.message : String(error);
          console.error(
            `FAIL [${idx + 1}] nt="${task.nt}" winner=${task.winner} ` +
              `losers=${task.losers.join(',')}: ${message}`,
          );
        }
      }
    },
  );
  await Promise.all(workers);

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `[run-safe-merges] done ok=${succeeded} fail=${failed} ` +
      `losersDeleted=${losersDeleted} songsReassigned=${songsReassigned} elapsed=${elapsed}s`,
  );
  process.exit(failed > 0 ? 2 : 0);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`unhandled: ${message}`);
  process.exit(1);
});
