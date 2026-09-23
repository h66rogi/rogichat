/* eslint-disable no-console */
import * as fs from 'fs';
import { PrismaClient } from '@prisma/client';
import OpenAI from 'openai';

/**
 * LLM-based judge for Tier-A4 artist-merge candidates.
 *
 * Tier A4 = canonical_name dup groups where the song-count distribution is
 * balanced (winner < 80% of total). These could legitimately be the same
 * artist (typing variants/collaborations) or distinct people sharing a name.
 *
 * For each A4 group:
 *   1. Pull each row's norm_key + up to 5 sample song titles from DB
 *   2. Ask the LLM (Claude Haiku 4.5 via OpenRouter) to judge: SAME / SPLIT / ABSTAIN
 *   3. Build a merge plan (one or more sub-groups per canonical_name)
 *   4. Emit a verdict file consumable by run-artist-merges.ts
 *
 * Output shape (compatible with run-artist-merges.ts as a "candidates" file):
 *   {
 *     generatedAt, summary: { same, split, abstain, ... },
 *     llmDetails: [...],
 *     candidates: [{ canonicalName, winnerId, loserIds, ..., tier: "A4-llm" }]
 *   }
 *
 * Run:
 *   DATABASE_URL=$(grep ^DATABASE_URL .env.prod | cut -d= -f2-) \
 *     OPENROUTER_API_KEY=$(kubectl -n meloming-prod get secret meloming-back-api-secrets -o jsonpath='{.data.OPENROUTER_API_KEY}' | base64 -d) \
 *     pnpm tsx src/global-song/scripts/judge-artist-merge-tier-a4.ts \
 *     --input /tmp/artist_candidates.json \
 *     --output /tmp/artist_candidates_a4_verdicts.json
 */

interface A4Candidate {
  canonicalName: string;
  winnerId: number;
  winnerNormKey: string;
  loserIds: number[];
  winnerSongCount: number;
  loserSongCounts: number[];
  totalSongs: number;
  gsize: number;
  tier: string;
}

interface ArtistRowEnriched {
  id: number;
  normKey: string;
  songCount: number;
  sampleTitles: string[];
}

interface CliArgs {
  input: string;
  output: string;
  limit: number;
  startFrom: number;
  sampleTitles: number;
  model: string;
}

interface LlmVerdict {
  canonicalName: string;
  rows: ArtistRowEnriched[];
  verdict: 'SAME' | 'SPLIT' | 'ABSTAIN' | 'PARSE_ERROR';
  groups: number[][]; // each group is a set of artist IDs that should be merged together
  raw: string;
}

interface MergePlanItem {
  canonicalName: string;
  winnerId: number;
  winnerNormKey: string;
  loserIds: number[];
  winnerSongCount: number;
  loserSongCounts: number[];
  totalSongs: number;
  gsize: number;
  tier: 'A4-llm-same' | 'A4-llm-split-subset';
}

function parseArgs(argv: string[]): CliArgs {
  const opts: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (!t.startsWith('--')) continue;
    const k = t.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) opts[k] = true;
    else {
      opts[k] = next;
      i++;
    }
  }
  const intOr = (k: string, d: number) => {
    const v = opts[k];
    if (v === undefined || typeof v === 'boolean') return d;
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : d;
  };
  return {
    input: (opts.input as string | undefined) ?? '/tmp/artist_candidates.json',
    output:
      (opts.output as string | undefined) ??
      '/tmp/artist_candidates_a4_verdicts.json',
    limit: intOr('limit', Number.MAX_SAFE_INTEGER),
    startFrom: intOr('start-from', 0),
    sampleTitles: intOr('sample-titles', 5),
    model: (opts.model as string | undefined) ?? 'anthropic/claude-haiku-4.5',
  };
}

async function enrichGroup(
  prisma: PrismaClient,
  c: A4Candidate,
  sampleTitleCount: number,
): Promise<ArtistRowEnriched[]> {
  const allIds = [c.winnerId, ...c.loserIds];
  const rows = await prisma.globalArtist.findMany({
    where: { id: { in: allIds } },
    select: { id: true, normKey: true },
  });
  // For each, pull top-N song titles by channelCount.
  const out: ArtistRowEnriched[] = [];
  for (const r of rows) {
    const sc =
      r.id === c.winnerId
        ? c.winnerSongCount
        : (c.loserSongCounts[c.loserIds.indexOf(r.id)] ?? 0);
    const titles = await prisma.globalSong.findMany({
      where: { globalArtistId: r.id },
      select: { title: true },
      orderBy: { channelCount: 'desc' },
      take: sampleTitleCount,
    });
    out.push({
      id: r.id,
      normKey: r.normKey,
      songCount: sc,
      sampleTitles: titles.map((t) => t.title),
    });
  }
  // Stable order: winner first, then by song count desc, then by id asc
  out.sort((a, b) => {
    if (a.id === c.winnerId) return -1;
    if (b.id === c.winnerId) return 1;
    if (b.songCount !== a.songCount) return b.songCount - a.songCount;
    return a.id - b.id;
  });
  return out;
}

function buildPrompt(canonicalName: string, rows: ArtistRowEnriched[]): string {
  const rowLines = rows
    .map((r, i) => {
      const titles =
        r.sampleTitles.length > 0
          ? r.sampleTitles.map((t) => `"${t}"`).join(', ')
          : '(no songs)';
      return `[${i + 1}] id=${r.id}  norm_key="${r.normKey}"  songs=${r.songCount}  sample=[${titles}]`;
    })
    .join('\n');

  return `You are an entity-resolution judge for music artist records (K-pop, J-pop, Vocaloid, Korean indie etc).

The system has multiple GlobalArtist rows sharing canonical_name="${canonicalName}". They were registered separately because their normalized alias keys differ (typing variants like "feat./with/x" placement, language order, mixed scripts, romanization, …). Decide whether they actually represent the same real-world artist or whether distinct people happen to share the name.

Rows:
${rowLines}

Use song titles as ground truth. If different rows share the same songs, they're the same artist. If song catalogs are clearly disjoint (different genres, different language, different actual people), split them.

Respond in EXACTLY this format (no other text, no markdown fences):

If all rows are the same artist:
SAME

If split into distinct artists, list one group per line as space-separated ids (each id appears in exactly one group; singletons are allowed):
SPLIT
<id> <id> <id>
<id> <id>

If ambiguous (insufficient evidence, or you suspect contamination but can't tell precisely):
ABSTAIN

Be conservative — prefer ABSTAIN over a wrong merge. Only return SAME when confident. Korean artist names that look identical but specific song catalogs reveal distinct careers (e.g. two different "지수" people) → SPLIT.`;
}

function parseVerdict(
  raw: string,
  allIds: number[],
): { verdict: LlmVerdict['verdict']; groups: number[][] } {
  const lines = raw
    .trim()
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return { verdict: 'PARSE_ERROR', groups: [] };

  // Claude Haiku often prefixes the verdict with reasoning text; scan all
  // lines and take the FIRST line that EXACTLY matches one of the three
  // verdict keywords (case-insensitive, optional ** markdown wrapping).
  const cleanLine = (s: string) =>
    s.replace(/^[*_`#>\s-]+|[*_`\s]+$/g, '').toUpperCase();
  let verdictLineIdx = -1;
  let verdictWord: 'SAME' | 'SPLIT' | 'ABSTAIN' | null = null;
  for (let i = 0; i < lines.length; i++) {
    const c = cleanLine(lines[i]);
    if (c === 'SAME' || c === 'SPLIT' || c === 'ABSTAIN') {
      verdictLineIdx = i;
      verdictWord = c;
      break;
    }
  }
  if (verdictWord === null) return { verdict: 'PARSE_ERROR', groups: [] };

  if (verdictWord === 'SAME') {
    return { verdict: 'SAME', groups: [allIds.slice()] };
  }
  if (verdictWord === 'ABSTAIN') {
    return { verdict: 'ABSTAIN', groups: [] };
  }
  // SPLIT: look at lines AFTER the SPLIT marker for ID groups (each line: ids)
  const groups: number[][] = [];
  const seen = new Set<number>();
  for (const line of lines.slice(verdictLineIdx + 1)) {
    // Stop at any line that doesn't look like a list of integers (allows
    // optional "**Reasoning:**" trailer)
    const ids = line
      .replace(/[,\[\]\(\)]/g, ' ')
      .split(/\s+/)
      .map((s) => parseInt(s, 10))
      .filter((n) => Number.isFinite(n));
    if (ids.length === 0) {
      // If we've already collected at least one group, treat as end of list
      if (groups.length > 0) break;
      continue;
    }
    groups.push(ids);
    for (const id of ids) seen.add(id);
  }
  if (groups.length === 0) return { verdict: 'PARSE_ERROR', groups: [] };
  const inputSet = new Set(allIds);
  const allCovered = allIds.every((id) => seen.has(id));
  const allValid = [...seen].every((id) => inputSet.has(id));
  if (!allCovered || !allValid) {
    return { verdict: 'PARSE_ERROR', groups: [] };
  }
  return { verdict: 'SPLIT', groups };
}

function buildMergePlan(
  c: A4Candidate,
  rows: ArtistRowEnriched[],
  groups: number[][],
  isSame: boolean,
): MergePlanItem[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out: MergePlanItem[] = [];
  for (const grp of groups) {
    if (grp.length < 2) continue; // singleton — no merge
    // Pick winner = highest song count, tie → lowest id
    const enriched = grp.map((id) => byId.get(id)).filter(Boolean);
    enriched.sort((a, b) => {
      if (b.songCount !== a.songCount) return b.songCount - a.songCount;
      return a.id - b.id;
    });
    const winner = enriched[0];
    const losers = enriched.slice(1);
    out.push({
      canonicalName: c.canonicalName,
      winnerId: winner.id,
      winnerNormKey: winner.normKey,
      loserIds: losers.map((l) => l.id),
      winnerSongCount: winner.songCount,
      loserSongCounts: losers.map((l) => l.songCount),
      totalSongs: enriched.reduce((s, r) => s + r.songCount, 0),
      gsize: enriched.length,
      tier: isSame ? 'A4-llm-same' : 'A4-llm-split-subset',
    });
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error('OPENROUTER_API_KEY env var is required.');
    process.exit(1);
  }

  const file = JSON.parse(fs.readFileSync(args.input, 'utf8')) as {
    candidates: A4Candidate[];
  };
  const a4 = file.candidates.filter((c) => c.tier === 'A4');
  const sliced = a4.slice(args.startFrom, args.startFrom + args.limit);
  console.log(
    `[judge] A4=${a4.length} sliced=${sliced.length} startFrom=${args.startFrom} model=${args.model}`,
  );

  const prisma = new PrismaClient();
  const client = new OpenAI({
    apiKey,
    baseURL: process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1',
    defaultHeaders: {
      'HTTP-Referer': 'https://meloming.com',
      'X-Title': 'Meloming Artist Merge Judge',
    },
  });

  const verdicts: LlmVerdict[] = [];
  const mergePlan: MergePlanItem[] = [];
  let nSame = 0;
  let nSplit = 0;
  let nAbstain = 0;
  let nParseErr = 0;
  const startedAt = Date.now();

  for (let i = 0; i < sliced.length; i++) {
    const c = sliced[i];
    try {
      const rows = await enrichGroup(prisma, c, args.sampleTitles);
      const allIds = rows.map((r) => r.id);
      const prompt = buildPrompt(c.canonicalName, rows);

      const resp = await client.chat.completions.create({
        model: args.model,
        user: 'meloming-back:script-artist-merge-tier-a4',
        max_tokens: 2000,
        temperature: 0,
        messages: [{ role: 'user', content: prompt }],
      });
      const raw = resp.choices[0]?.message?.content ?? '';
      const { verdict, groups } = parseVerdict(raw, allIds);

      const v: LlmVerdict = {
        canonicalName: c.canonicalName,
        rows,
        verdict,
        groups,
        raw,
      };
      verdicts.push(v);
      if (verdict === 'SAME') {
        nSame++;
        mergePlan.push(...buildMergePlan(c, rows, groups, true));
      } else if (verdict === 'SPLIT') {
        nSplit++;
        mergePlan.push(...buildMergePlan(c, rows, groups, false));
      } else if (verdict === 'ABSTAIN') {
        nAbstain++;
      } else {
        nParseErr++;
      }

      if ((i + 1) % 10 === 0 || i + 1 === sliced.length) {
        const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
        console.log(
          `[${i + 1}/${sliced.length}] same=${nSame} split=${nSplit} abstain=${nAbstain} parseErr=${nParseErr} elapsed=${elapsed}s — last="${c.canonicalName}" verdict=${verdict}`,
        );
      }
      // Gentle pacing for OpenRouter
      await new Promise((r) => setTimeout(r, 250));
    } catch (error) {
      console.error(
        `FAIL [${i + 1}] name="${c.canonicalName}": ${error instanceof Error ? error.message : error}`,
      );
      verdicts.push({
        canonicalName: c.canonicalName,
        rows: [],
        verdict: 'PARSE_ERROR',
        groups: [],
        raw: error instanceof Error ? error.message : String(error),
      });
      nParseErr++;
    }
  }

  const out = {
    generatedAt: new Date().toISOString(),
    summary: {
      total: sliced.length,
      same: nSame,
      split: nSplit,
      abstain: nAbstain,
      parseError: nParseErr,
      mergeBatches: mergePlan.length,
      mergeLosers: mergePlan.reduce((s, p) => s + p.loserIds.length, 0),
    },
    llmDetails: verdicts,
    candidates: mergePlan,
  };

  fs.writeFileSync(args.output, JSON.stringify(out, null, 2));
  console.log(`[judge] done. wrote ${args.output}`);
  console.log(`[judge] summary: ${JSON.stringify(out.summary)}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
