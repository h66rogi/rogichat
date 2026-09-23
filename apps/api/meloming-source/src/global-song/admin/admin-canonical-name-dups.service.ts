import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import OpenAI from 'openai';
import { PrismaService } from '../../prisma/prisma.service';
import { GlobalArtistMergeService } from '../global-artist-merge.service';
import {
  CanonicalNameDupDetailResponseDto,
  CanonicalNameDupListItemDto,
  CanonicalNameDupListQueryDto,
  CanonicalNameDupListResponseDto,
  CanonicalNameDupMergeRequestDto,
  CanonicalNameDupMergeResponseDto,
  CanonicalNameDupMergeResultDto,
  CanonicalNameDupRowDto,
  LlmJudgeResponseDto,
} from './dto/admin-canonical-name-dups.dto';

/**
 * Admin 화면 — canonical_name 중복 GlobalArtist 그룹 조회/검토/머지.
 *
 * 잔여 dup (LLM ABSTAIN / PARSE_ERROR / 신규 등록분) 을 사람이 직접
 * 확인 후 머지하기 위한 backend.
 */
@Injectable()
export class AdminCanonicalNameDupsService {
  private readonly logger = new Logger(AdminCanonicalNameDupsService.name);
  private readonly llmModel =
    process.env.OPENROUTER_MODEL ?? 'anthropic/claude-haiku-4.5';

  constructor(
    private readonly prisma: PrismaService,
    private readonly artistMergeService: GlobalArtistMergeService,
  ) {}

  async list(
    query: CanonicalNameDupListQueryDto,
  ): Promise<CanonicalNameDupListResponseDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const search = query.search?.trim() ?? '';
    const sort = query.sort ?? 'gsize_desc';

    const all = await this.queryAllDups(search);

    if (sort === 'gsize_desc') {
      all.sort((a, b) => {
        if (b.groupSize !== a.groupSize) return b.groupSize - a.groupSize;
        return b.totalSongs - a.totalSongs;
      });
    } else if (sort === 'songs_desc') {
      all.sort((a, b) => b.totalSongs - a.totalSongs);
    } else {
      all.sort((a, b) => a.canonicalName.localeCompare(b.canonicalName));
    }

    const total = all.length;
    const data = all.slice((page - 1) * limit, (page - 1) * limit + limit);

    return { data, total, page, limit };
  }

  private async queryAllDups(
    search: string,
  ): Promise<CanonicalNameDupListItemDto[]> {
    // Single round-trip via Prisma. We pull each row's canonical_name + id +
    // song_count, then aggregate in JS. The dataset is small (≤ low thousands
    // of rows even before merges), so this is fine for an admin endpoint.
    const rows = await this.prisma.$queryRaw<
      Array<{
        canonical_name: string;
        id: number;
        song_count: bigint;
      }>
    >`
      SELECT
        ga.canonical_name,
        ga.id,
        (SELECT COUNT(*) FROM global_songs WHERE global_artist_id = ga.id) AS song_count
      FROM global_artists ga
      WHERE ga.canonical_name IN (
        SELECT canonical_name
        FROM global_artists
        GROUP BY canonical_name
        HAVING COUNT(*) > 1
      )
    `;

    const grouped = new Map<string, Array<{ id: number; songCount: number }>>();
    for (const r of rows) {
      const sc = Number(r.song_count);
      const list = grouped.get(r.canonical_name) ?? [];
      list.push({ id: r.id, songCount: sc });
      grouped.set(r.canonical_name, list);
    }

    const out: CanonicalNameDupListItemDto[] = [];
    const needle = search.toLowerCase();
    for (const [name, members] of grouped) {
      if (search && !name.toLowerCase().includes(needle)) continue;
      members.sort((a, b) => {
        if (b.songCount !== a.songCount) return b.songCount - a.songCount;
        return a.id - b.id;
      });
      const winner = members[0];
      out.push({
        canonicalName: name,
        groupSize: members.length,
        totalSongs: members.reduce((s, m) => s + m.songCount, 0),
        winnerId: winner.id,
        winnerSongCount: winner.songCount,
      });
    }
    return out;
  }

  async detail(
    canonicalName: string,
    sampleTitles = 5,
  ): Promise<CanonicalNameDupDetailResponseDto> {
    const artistRows = await this.prisma.globalArtist.findMany({
      where: { canonicalName },
      select: { id: true, normKey: true },
    });
    if (artistRows.length === 0) {
      throw new NotFoundException(
        `canonical_name="${canonicalName}" not found`,
      );
    }
    if (artistRows.length === 1) {
      throw new NotFoundException(
        `canonical_name="${canonicalName}" is not a duplicate group (gsize=1)`,
      );
    }

    const rows: CanonicalNameDupRowDto[] = [];
    for (const r of artistRows) {
      const [songCount, titles] = await Promise.all([
        this.prisma.globalSong.count({ where: { globalArtistId: r.id } }),
        this.prisma.globalSong.findMany({
          where: { globalArtistId: r.id },
          select: { title: true },
          orderBy: { channelCount: 'desc' },
          take: sampleTitles,
        }),
      ]);
      rows.push({
        id: r.id,
        normKey: r.normKey,
        songCount,
        sampleTitles: titles.map((t) => t.title),
      });
    }

    rows.sort((a, b) => {
      if (b.songCount !== a.songCount) return b.songCount - a.songCount;
      return a.id - b.id;
    });

    return { canonicalName, rows };
  }

  async llmJudge(canonicalName: string): Promise<LlmJudgeResponseDto> {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return {
        canonicalName,
        verdict: 'PARSE_ERROR',
        groups: [],
        rawResponse: 'OPENROUTER_API_KEY not configured',
        model: this.llmModel,
      };
    }

    const detail = await this.detail(canonicalName, 5);
    const allIds = detail.rows.map((r) => r.id);

    const prompt = this.buildJudgePrompt(canonicalName, detail.rows);

    const client = new OpenAI({
      apiKey,
      baseURL:
        process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer': 'https://meloming.com',
        'X-Title': 'Meloming Admin Artist Merge',
      },
    });

    let raw = '';
    try {
      const resp = await client.chat.completions.create({
        model: this.llmModel,
        user: 'meloming-back:admin-canonical-name-dups',
        max_tokens: 2000,
        temperature: 0,
        messages: [{ role: 'user', content: prompt }],
      });
      raw = resp.choices[0]?.message?.content ?? '';
    } catch (error) {
      this.logger.error(
        `LLM call failed for canonical_name="${canonicalName}": ${
          error instanceof Error ? error.message : error
        }`,
      );
      return {
        canonicalName,
        verdict: 'PARSE_ERROR',
        groups: [],
        rawResponse: error instanceof Error ? error.message : String(error),
        model: this.llmModel,
      };
    }

    const { verdict, groups } = this.parseVerdict(raw, allIds);
    return {
      canonicalName,
      verdict,
      groups,
      rawResponse: raw,
      model: this.llmModel,
    };
  }

  async mergeBatches(
    canonicalName: string,
    body: CanonicalNameDupMergeRequestDto,
  ): Promise<CanonicalNameDupMergeResponseDto> {
    // Validate all referenced artists actually exist under this canonical_name
    // (defense-in-depth: even if frontend follows the rules, an admin could
    // post stale ids).
    const allIds = new Set<number>();
    for (const b of body.batches) {
      allIds.add(b.winnerId);
      for (const l of b.loserIds) allIds.add(l);
    }
    const found = await this.prisma.globalArtist.findMany({
      where: { id: { in: [...allIds] } },
      select: { id: true, canonicalName: true },
    });
    const foundMap = new Map(found.map((r) => [r.id, r.canonicalName]));
    for (const id of allIds) {
      const cn = foundMap.get(id);
      if (cn !== canonicalName) {
        throw new NotFoundException(
          `artist ${id} not in canonical_name="${canonicalName}" (got "${cn ?? 'missing'}")`,
        );
      }
    }

    const results: CanonicalNameDupMergeResultDto[] = [];
    for (const b of body.batches) {
      try {
        const report = await this.artistMergeService.merge({
          winnerId: b.winnerId,
          loserIds: b.loserIds,
          reason:
            b.reason || `admin canonical-name-dup name="${canonicalName}"`,
          dryRun: false,
        });
        results.push({
          winnerId: b.winnerId,
          loserIds: b.loserIds,
          ok: true,
          songsReassigned: report.songsReassigned,
          conflictSongsAutoMerged: report.conflictSongsAutoMerged,
          losersDeleted: report.losersDeleted,
          redisSyncOk: report.redisSyncOk,
        });
      } catch (error) {
        results.push({
          winnerId: b.winnerId,
          loserIds: b.loserIds,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const okCount = results.filter((r) => r.ok).length;
    const failCount = results.length - okCount;
    return {
      results,
      okCount,
      failCount,
      totalLosersDeleted: results.reduce(
        (s, r) => s + (r.losersDeleted ?? 0),
        0,
      ),
      totalSongsReassigned: results.reduce(
        (s, r) => s + (r.songsReassigned ?? 0),
        0,
      ),
      totalConflictsAutoMerged: results.reduce(
        (s, r) => s + (r.conflictSongsAutoMerged ?? 0),
        0,
      ),
    };
  }

  /* ====================================================================== */
  /*  LLM helpers — same prompt + parser as judge-artist-merge-tier-a4.ts    */
  /* ====================================================================== */

  private buildJudgePrompt(
    canonicalName: string,
    rows: {
      id: number;
      normKey: string;
      songCount: number;
      sampleTitles: string[];
    }[],
  ): string {
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

If split into distinct artists, list one group per line as space-separated ids (USE THE id= VALUES, NOT the [N] index numbers; each id appears in exactly one group; singletons are allowed):
SPLIT
<id> <id> <id>
<id> <id>

If ambiguous (insufficient evidence, or you suspect contamination but can't tell precisely):
ABSTAIN

Be conservative — prefer ABSTAIN over a wrong merge. Only return SAME when confident.`;
  }

  private parseVerdict(
    raw: string,
    allIds: number[],
  ): { verdict: LlmJudgeResponseDto['verdict']; groups: number[][] } {
    const lines = raw
      .trim()
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (lines.length === 0) return { verdict: 'PARSE_ERROR', groups: [] };

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
    // SPLIT
    const groups: number[][] = [];
    const seen = new Set<number>();
    for (const line of lines.slice(verdictLineIdx + 1)) {
      const ids = line
        .replace(/[,\[\]\(\)]/g, ' ')
        .split(/\s+/)
        .map((s) => parseInt(s, 10))
        .filter((n) => Number.isFinite(n));
      if (ids.length === 0) {
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
}
