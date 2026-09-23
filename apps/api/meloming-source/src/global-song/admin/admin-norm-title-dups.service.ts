import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import OpenAI from 'openai';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { GlobalSongMergeService } from '../global-song-merge.service';
import {
  NormTitleDupDetailResponseDto,
  NormTitleDupListItemDto,
  NormTitleDupListQueryDto,
  NormTitleDupListResponseDto,
  NormTitleDupMergeRequestDto,
  NormTitleDupMergeResponseDto,
  NormTitleDupMergeResultDto,
  NormTitleDupRowDto,
  NormTitleLlmJudgeResponseDto,
} from './dto/admin-norm-title-dups.dto';

/**
 * Cross-artist 같은 norm_title GlobalSong 그룹 검토/머지.
 *
 * Use case: jane doe 55건 (요네즈 켄시 콜라보 표기변주), butterfly 32건
 * (디지몬 + 동명이곡) 같은 잔여 cross-artist 중복 정리.
 *
 * 같은 artist 안 norm_title 중복은 UNIQUE 제약으로 0 — 여기 안 다룸.
 */
@Injectable()
export class AdminNormTitleDupsService {
  private readonly logger = new Logger(AdminNormTitleDupsService.name);
  private readonly llmModel =
    process.env.OPENROUTER_MODEL ?? 'anthropic/claude-haiku-4.5';
  private static readonly SAMPLE_CHANNELS_PER_ROW = 5;

  constructor(
    private readonly prisma: PrismaService,
    private readonly songMergeService: GlobalSongMergeService,
  ) {}

  async list(
    query: NormTitleDupListQueryDto,
  ): Promise<NormTitleDupListResponseDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 30;
    const search = query.search?.trim() ?? '';
    const sort = query.sort ?? 'gsize_desc';

    // Pull all dup norm_titles + their group size + total channels in one trip.
    // Dataset is small (~1k groups even before fix).
    const rows = await this.prisma.$queryRaw<
      Array<{ norm_title: string; gsize: bigint; total_channels: bigint }>
    >`
      SELECT norm_title,
        COUNT(*) AS gsize,
        SUM(channel_count) AS total_channels
      FROM global_songs
      GROUP BY norm_title
      HAVING COUNT(*) > 1
    `;

    const items: NormTitleDupListItemDto[] = rows.map((r) => ({
      normTitle: r.norm_title,
      groupSize: Number(r.gsize),
      totalChannels: Number(r.total_channels),
    }));

    // Filter
    const filtered = search
      ? items.filter((i) =>
          i.normTitle.toLowerCase().includes(search.toLowerCase()),
        )
      : items;

    // Sort
    if (sort === 'gsize_desc') {
      filtered.sort((a, b) => {
        if (b.groupSize !== a.groupSize) return b.groupSize - a.groupSize;
        return b.totalChannels - a.totalChannels;
      });
    } else if (sort === 'channels_desc') {
      filtered.sort((a, b) => b.totalChannels - a.totalChannels);
    } else {
      filtered.sort((a, b) => a.normTitle.localeCompare(b.normTitle));
    }

    const total = filtered.length;
    const data = filtered.slice((page - 1) * limit, (page - 1) * limit + limit);

    return { data, total, page, limit };
  }

  async detail(normTitle: string): Promise<NormTitleDupDetailResponseDto> {
    const songs = await this.prisma.globalSong.findMany({
      where: { normTitle },
      select: {
        id: true,
        title: true,
        globalArtistId: true,
        channelCount: true,
        globalArtist: { select: { canonicalName: true, normKey: true } },
      },
      orderBy: [{ channelCount: 'desc' }, { id: 'asc' }],
    });
    if (songs.length === 0) {
      throw new NotFoundException(`norm_title="${normTitle}" not found`);
    }
    if (songs.length === 1) {
      throw new NotFoundException(
        `norm_title="${normTitle}" is not a duplicate group (gsize=1)`,
      );
    }

    // Sample channels per row
    const rows: NormTitleDupRowDto[] = await Promise.all(
      songs.map(async (s) => {
        const sampleSongs = await this.prisma.song.findMany({
          where: { globalSongId: s.id },
          select: {
            channelId: true,
            channel: { select: { name: true } },
          },
          orderBy: { id: 'asc' },
          take: AdminNormTitleDupsService.SAMPLE_CHANNELS_PER_ROW,
          distinct: ['channelId'],
        });
        return {
          id: s.id,
          title: s.title,
          globalArtistId: s.globalArtistId,
          artistCanonicalName: s.globalArtist?.canonicalName ?? '',
          artistNormKey: s.globalArtist?.normKey ?? '',
          channelCount: s.channelCount,
          sampleChannels: sampleSongs.map((ss) => ({
            channelId: ss.channelId,
            channelName: ss.channel?.name ?? '',
          })),
        };
      }),
    );

    // Pairwise channel overlap.
    const overlap = await this.computeOverlapMatrix(songs.map((s) => s.id));

    return { normTitle, rows, overlap };
  }

  /**
   * For each pair (i, j), return the number of channels that have both
   * GlobalSong[i] AND GlobalSong[j] registered. 0 → cross-artist 라도 같은 곡
   * 일 가능성 ↑ (어떤 채널도 둘 다 등록 안 함). > 0 → 동명이곡 가능성 ↑
   * (한 채널이 두 행 다 등록 = 별개 곡).
   */
  private async computeOverlapMatrix(ids: number[]): Promise<number[][]> {
    if (ids.length === 0) return [];
    // channel_id × global_song_id 매핑 (DISTINCT). 그룹이 작으니 in-memory.
    const rows = await this.prisma.song.findMany({
      where: { globalSongId: { in: ids } },
      select: { channelId: true, globalSongId: true },
      distinct: ['channelId', 'globalSongId'],
    });
    const channelToSongs = new Map<number, Set<number>>();
    for (const r of rows) {
      if (r.globalSongId === null) continue;
      const set = channelToSongs.get(r.channelId) ?? new Set<number>();
      set.add(r.globalSongId);
      channelToSongs.set(r.channelId, set);
    }
    const indexOfId = new Map(ids.map((id, i) => [id, i]));
    const matrix: number[][] = ids.map(() => ids.map(() => 0));
    // diagonal = channelCount per row
    for (const [, songSet] of channelToSongs) {
      const present = [...songSet].filter((id) => indexOfId.has(id));
      for (const a of present) matrix[indexOfId.get(a)][indexOfId.get(a)]++;
      for (let i = 0; i < present.length; i++) {
        for (let j = i + 1; j < present.length; j++) {
          const ai = indexOfId.get(present[i]);
          const bi = indexOfId.get(present[j]);
          matrix[ai][bi]++;
          matrix[bi][ai]++;
        }
      }
    }
    return matrix;
  }

  async llmJudge(normTitle: string): Promise<NormTitleLlmJudgeResponseDto> {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return {
        normTitle,
        verdict: 'PARSE_ERROR',
        groups: [],
        rawResponse: 'OPENROUTER_API_KEY not configured',
        model: this.llmModel,
      };
    }

    const detail = await this.detail(normTitle);
    const allIds = detail.rows.map((r) => r.id);
    const prompt = this.buildJudgePrompt(detail);

    const client = new OpenAI({
      apiKey,
      baseURL:
        process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer': 'https://meloming.com',
        'X-Title': 'Meloming Admin Song Dup Judge',
      },
    });

    let raw = '';
    try {
      const resp = await client.chat.completions.create({
        model: this.llmModel,
        user: 'meloming-back:admin-norm-title-dups',
        max_tokens: 2000,
        temperature: 0,
        messages: [{ role: 'user', content: prompt }],
      });
      raw = resp.choices[0]?.message?.content ?? '';
    } catch (error) {
      this.logger.error(
        `LLM call failed for norm_title="${normTitle}": ${
          error instanceof Error ? error.message : error
        }`,
      );
      return {
        normTitle,
        verdict: 'PARSE_ERROR',
        groups: [],
        rawResponse: error instanceof Error ? error.message : String(error),
        model: this.llmModel,
      };
    }

    const { verdict, groups } = this.parseVerdict(raw, allIds);
    return {
      normTitle,
      verdict,
      groups,
      rawResponse: raw,
      model: this.llmModel,
    };
  }

  async mergeBatches(
    normTitle: string,
    body: NormTitleDupMergeRequestDto,
  ): Promise<NormTitleDupMergeResponseDto> {
    // Validate referenced GlobalSong rows all share this normTitle
    const allIds = new Set<number>();
    for (const b of body.batches) {
      allIds.add(b.winnerId);
      for (const l of b.loserIds) allIds.add(l);
    }
    const found = await this.prisma.globalSong.findMany({
      where: { id: { in: [...allIds] } },
      select: { id: true, normTitle: true },
    });
    const foundMap = new Map(found.map((r) => [r.id, r.normTitle]));
    for (const id of allIds) {
      const nt = foundMap.get(id);
      if (nt !== normTitle) {
        throw new NotFoundException(
          `globalSong ${id} not in norm_title="${normTitle}" (got "${nt ?? 'missing'}")`,
        );
      }
    }

    const results: NormTitleDupMergeResultDto[] = [];
    for (const b of body.batches) {
      try {
        const report = await this.songMergeService.merge({
          winnerId: b.winnerId,
          loserIds: b.loserIds,
          reason:
            b.reason ||
            `admin norm-title-dup norm_title="${normTitle.slice(0, 60)}"`,
          dryRun: false,
        });
        results.push({
          winnerId: b.winnerId,
          loserIds: b.loserIds,
          ok: true,
          songsReassigned: report.songsReassigned,
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
    return {
      results,
      okCount,
      failCount: results.length - okCount,
      totalLosersDeleted: results.reduce(
        (s, r) => s + (r.losersDeleted ?? 0),
        0,
      ),
      totalSongsReassigned: results.reduce(
        (s, r) => s + (r.songsReassigned ?? 0),
        0,
      ),
    };
  }

  /* ---------- LLM helpers ---------- */

  private buildJudgePrompt(detail: NormTitleDupDetailResponseDto): string {
    const rowLines = detail.rows
      .map((r, i) => {
        const channels =
          r.sampleChannels.length > 0
            ? r.sampleChannels
                .map((c) => `${c.channelName || `ch#${c.channelId}`}`)
                .join(', ')
            : '(no channels)';
        return `[${i + 1}] id=${r.id}  title="${r.title}"  artist="${r.artistCanonicalName}" (artist_id=${r.globalArtistId}, normKey="${r.artistNormKey}")  channels=${r.channelCount}  sampleChannels=[${channels}]`;
      })
      .join('\n');

    // Pairwise overlap summary (compact)
    const overlapLines: string[] = [];
    for (let i = 0; i < detail.rows.length; i++) {
      for (let j = i + 1; j < detail.rows.length; j++) {
        const o = detail.overlap[i][j];
        if (o > 0) {
          overlapLines.push(
            `  - row[${i + 1}] ↔ row[${j + 1}]: ${o} channels overlap`,
          );
        }
      }
    }
    const overlapBlock =
      overlapLines.length === 0
        ? '  (none — no channel registered any two of these rows together)'
        : overlapLines.join('\n');

    return `You are an entity-resolution judge for music recordings (K-pop, J-pop, Vocaloid, Korean indie, anime OST).

Multiple GlobalSong rows share the **same normalized title** but belong to **different artists**. Decide whether they are:
  (a) the SAME song typed differently (collaboration permutations, language variants, OST attribution to the work vs. the actual performer),
  (b) GENUINELY DIFFERENT songs that happen to share a title (homonyms — common in Korean: "고백", "love", "rain" 등), or
  (c) ambiguous — split into clear sub-groups.

normTitle: "${detail.normTitle}"

Rows:
${rowLines}

Pairwise channel overlap (key signal — if 0, no streamer registered both rows together → likely same song typed differently; if >0, distinct entities):
${overlapBlock}

Use channel overlap + artist names + raw titles to decide.

Respond in EXACTLY this format (no other text, no markdown fences):

If all rows are the same song:
SAME

If split into distinct songs (subgroups), one group per line as space-separated **id values** (USE the id= numbers, NOT the [N] index; each id appears in exactly one group; singletons allowed):
SPLIT
<id> <id> <id>
<id> <id>

If ambiguous:
ABSTAIN

Be conservative — when in doubt, ABSTAIN rather than wrong-merging.`;
  }

  private parseVerdict(
    raw: string,
    allIds: number[],
  ): { verdict: NormTitleLlmJudgeResponseDto['verdict']; groups: number[][] } {
    const lines = raw
      .trim()
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (lines.length === 0) return { verdict: 'PARSE_ERROR', groups: [] };

    const cleanLine = (s: string) =>
      s.replace(/^[*_`#>\s-]+|[*_`\s]+$/g, '').toUpperCase();
    let verdictIdx = -1;
    let verdictWord: 'SAME' | 'SPLIT' | 'ABSTAIN' | null = null;
    for (let i = 0; i < lines.length; i++) {
      const c = cleanLine(lines[i]);
      if (c === 'SAME' || c === 'SPLIT' || c === 'ABSTAIN') {
        verdictIdx = i;
        verdictWord = c;
        break;
      }
    }
    if (verdictWord === null) return { verdict: 'PARSE_ERROR', groups: [] };

    if (verdictWord === 'SAME')
      return { verdict: 'SAME', groups: [allIds.slice()] };
    if (verdictWord === 'ABSTAIN') return { verdict: 'ABSTAIN', groups: [] };

    const groups: number[][] = [];
    const seen = new Set<number>();
    for (const line of lines.slice(verdictIdx + 1)) {
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
    if (!allCovered || !allValid) return { verdict: 'PARSE_ERROR', groups: [] };
    return { verdict: 'SPLIT', groups };
  }
}
