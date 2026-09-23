import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import OpenAI from 'openai';
import { createHash } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { GlobalSongMergeService } from '../global-song-merge.service';
import { GlobalSongRedisService } from '../global-song-redis.service';
import { jaroWinklerSimilarity } from '../global-song-matcher.service';
import {
  FuzzyClusterAutoMergeBatchResultDto,
  FuzzyClusterAutoMergeResponseDto,
  FuzzyClusterBulkAutoMergeResponseDto,
  FuzzyClusterDetailResponseDto,
  FuzzyClusterDetailRowDto,
  FuzzyClusterListItemDto,
  FuzzyClusterListQueryDto,
  FuzzyClusterListResponseDto,
  FuzzyClusterLlmJudgeResponseDto,
} from './dto/admin-fuzzy-clusters.dto';

interface SongRow {
  id: number;
  title: string;
  normTitle: string;
  globalArtistId: number;
  artistCanonicalName: string;
  channelCount: number;
}

interface ComputedCluster extends FuzzyClusterListItemDto {}

const CACHE_PREFIX = 'admin:fuzzy-clusters:';
const CACHE_TTL_SECONDS = 60 * 60; // 1h

/**
 * GlobalSong fuzzy 클러스터링.
 *
 * normTitle Jaro-Winkler ≥ threshold 인 GlobalSong 들을 union-find 로 묶고,
 * 결과를 Redis 캐시. 같은 query (mode/threshold/minSize/...) 면 cache hit.
 *
 * 모드:
 *  - within-artist: 같은 globalArtistId 안에서만 (typing variant 잡기 — 가장 높은 정밀도)
 *  - cross-artist: artistId 가 달라도 묶음 (cross-language / 콜라보 표기변주)
 *  - all: 둘 다 union (단, 합집합 후 사이즈 조절 필요)
 */
@Injectable()
export class AdminFuzzyClustersService {
  private readonly logger = new Logger(AdminFuzzyClustersService.name);
  private readonly llmModel =
    process.env.OPENROUTER_MODEL ?? 'anthropic/claude-haiku-4.5';

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: GlobalSongRedisService,
    private readonly mergeService: GlobalSongMergeService,
  ) {}

  /* ====================================================================== */
  /*  Auto-merge — LLM judge → apply verdict → merge                        */
  /* ====================================================================== */

  /**
   * Run the LLM judge for a single cluster and execute the resulting merge
   * batches. Returns a structured report so the admin UI can display
   * per-batch outcomes.
   *
   * Safety:
   *   - Hard cap on cluster size (`maxClusterSize`, default 10).
   *   - ABSTAIN / PARSE_ERROR / SAME-with-singleton-group → skipped (not merged).
   *   - SPLIT subgroups of size 1 are dropped (no merge to perform).
   *   - dryRun flag flows through to mergeService.merge().
   */
  async autoMerge(input: {
    memberIds: number[];
    reason?: string;
    dryRun?: boolean;
    maxClusterSize?: number;
    allowSplit?: boolean;
  }): Promise<FuzzyClusterAutoMergeResponseDto> {
    const memberIds = [...new Set(input.memberIds)].sort((a, b) => a - b);
    const maxClusterSize = input.maxClusterSize ?? 10;
    const allowSplit = input.allowSplit ?? true;
    const dryRun = input.dryRun ?? false;
    const reason =
      input.reason?.trim() || 'admin auto-merge via fuzzy-cluster LLM verdict';

    if (memberIds.length < 2) {
      return {
        memberIds,
        verdict: 'ABSTAIN',
        skipped: true,
        skipReason: 'cluster has fewer than 2 members',
        batches: [],
        rawResponse: '',
        model: this.llmModel,
      };
    }
    if (memberIds.length > maxClusterSize) {
      return {
        memberIds,
        verdict: 'ABSTAIN',
        skipped: true,
        skipReason: `cluster size ${memberIds.length} exceeds maxClusterSize ${maxClusterSize}`,
        batches: [],
        rawResponse: '',
        model: this.llmModel,
      };
    }

    const detail = await this.detail(memberIds);
    const judgement = await this.llmJudge(memberIds);

    if (
      judgement.verdict === 'ABSTAIN' ||
      judgement.verdict === 'PARSE_ERROR'
    ) {
      return {
        memberIds,
        verdict: judgement.verdict,
        skipped: true,
        skipReason: `LLM verdict=${judgement.verdict}`,
        batches: [],
        rawResponse: judgement.rawResponse,
        model: judgement.model,
      };
    }

    if (judgement.verdict === 'SPLIT' && !allowSplit) {
      return {
        memberIds,
        verdict: 'SPLIT',
        skipped: true,
        skipReason: 'SPLIT verdict but allowSplit=false',
        batches: [],
        rawResponse: judgement.rawResponse,
        model: judgement.model,
      };
    }

    // Build merge batches. winner = highest channelCount within group, tie → lowest id.
    const channelCountById = new Map(
      detail.rows.map((r) => [r.id, r.channelCount]),
    );
    const groups: number[][] =
      judgement.verdict === 'SAME' ? [memberIds] : judgement.groups;

    const batchPlans: Array<{ winnerId: number; loserIds: number[] }> = [];
    for (const grp of groups) {
      if (grp.length < 2) continue;
      const sorted = [...grp].sort((a, b) => {
        const ca = channelCountById.get(a) ?? 0;
        const cb = channelCountById.get(b) ?? 0;
        if (cb !== ca) return cb - ca;
        return a - b;
      });
      batchPlans.push({ winnerId: sorted[0], loserIds: sorted.slice(1) });
    }

    if (batchPlans.length === 0) {
      return {
        memberIds,
        verdict: judgement.verdict,
        skipped: true,
        skipReason:
          'all SPLIT subgroups had only one member — nothing to merge',
        batches: [],
        rawResponse: judgement.rawResponse,
        model: judgement.model,
      };
    }

    const batchResults: FuzzyClusterAutoMergeBatchResultDto[] = [];
    for (const plan of batchPlans) {
      try {
        const r = await this.mergeService.merge({
          winnerId: plan.winnerId,
          loserIds: plan.loserIds,
          reason,
          dryRun,
        });
        batchResults.push({
          winnerId: plan.winnerId,
          loserIds: plan.loserIds,
          status: 'merged',
          dryRun: r.dryRun,
          songsReassigned: r.songsReassigned,
          losersDeleted: r.loserIds.length,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        this.logger.warn(
          `auto-merge batch failed winnerId=${plan.winnerId} losers=${plan.loserIds.join(',')} : ${message}`,
        );
        batchResults.push({
          winnerId: plan.winnerId,
          loserIds: plan.loserIds,
          status: 'error',
          error: message,
        });
      }
    }

    return {
      memberIds,
      verdict: judgement.verdict,
      skipped: false,
      batches: batchResults,
      rawResponse: judgement.rawResponse,
      model: judgement.model,
    };
  }

  /**
   * Run autoMerge sequentially across multiple clusters. Use when admin
   * wants "이 페이지 클러스터들을 AI 추천대로 일괄 정리" — bounded sequentially
   * (LLM calls run one-at-a-time) to keep cost predictable.
   */
  async bulkAutoMerge(input: {
    clusters: number[][];
    reason?: string;
    dryRun?: boolean;
    maxClusterSize?: number;
    allowSplit?: boolean;
  }): Promise<FuzzyClusterBulkAutoMergeResponseDto> {
    const results: FuzzyClusterAutoMergeResponseDto[] = [];
    let mergedClusters = 0;
    let skippedClusters = 0;
    let totalLosers = 0;
    for (const memberIds of input.clusters) {
      const r = await this.autoMerge({
        memberIds,
        reason: input.reason,
        dryRun: input.dryRun,
        maxClusterSize: input.maxClusterSize,
        allowSplit: input.allowSplit,
      });
      results.push(r);
      if (r.skipped) skippedClusters++;
      else {
        mergedClusters++;
        for (const b of r.batches) {
          if (b.status === 'merged') totalLosers += b.loserIds.length;
        }
      }
    }
    return {
      total: input.clusters.length,
      mergedClusters,
      skippedClusters,
      totalLosers,
      results,
    };
  }

  /* ====================================================================== */
  /*  Cluster discovery + caching                                           */
  /* ====================================================================== */

  async list(
    query: FuzzyClusterListQueryDto,
  ): Promise<FuzzyClusterListResponseDto> {
    const mode = query.mode ?? 'within-artist';
    const threshold = query.threshold ?? 0.85;
    const minSize = query.minSize ?? 2;
    const maxSize = query.maxSize ?? 50;
    const overlapZeroOnly = query.overlapZeroOnly ?? false;
    const sort = query.sort ?? 'size_desc';
    const page = query.page ?? 1;
    const limit = query.limit ?? 30;
    const search = query.search?.trim() ?? '';

    const cacheKey = this.buildCacheKey({
      mode,
      threshold,
      minSize,
      maxSize,
      overlapZeroOnly,
    });

    let computedAt = new Date().toISOString();
    let allClusters: ComputedCluster[];
    if (!query.refresh && this.redis.isReady()) {
      const cached = await this.readCache(cacheKey);
      if (cached) {
        allClusters = cached.clusters;
        computedAt = cached.computedAt;
      } else {
        allClusters = await this.compute({
          mode,
          threshold,
          minSize,
          maxSize,
          overlapZeroOnly,
        });
        await this.writeCache(cacheKey, allClusters, computedAt);
      }
    } else {
      allClusters = await this.compute({
        mode,
        threshold,
        minSize,
        maxSize,
        overlapZeroOnly,
      });
      if (this.redis.isReady()) {
        await this.writeCache(cacheKey, allClusters, computedAt);
      }
    }

    // search filter — anchorTitle / artist 부분 매칭
    const filtered = search
      ? allClusters.filter(
          (c) =>
            c.anchorTitle.toLowerCase().includes(search.toLowerCase()) ||
            c.anchorNormTitle.toLowerCase().includes(search.toLowerCase()) ||
            c.artistCanonicalNames.some((n) =>
              n.toLowerCase().includes(search.toLowerCase()),
            ),
        )
      : allClusters;

    if (sort === 'size_desc') {
      filtered.sort((a, b) => {
        if (b.size !== a.size) return b.size - a.size;
        return b.totalChannels - a.totalChannels;
      });
    } else if (sort === 'channels_desc') {
      filtered.sort((a, b) => b.totalChannels - a.totalChannels);
    } else {
      filtered.sort((a, b) =>
        a.anchorNormTitle.localeCompare(b.anchorNormTitle),
      );
    }

    const total = filtered.length;
    const data = filtered.slice((page - 1) * limit, (page - 1) * limit + limit);

    return { data, total, page, limit, computedAt, cacheKey };
  }

  private buildCacheKey(params: {
    mode: string;
    threshold: number;
    minSize: number;
    maxSize: number;
    overlapZeroOnly: boolean;
  }): string {
    const stable = `${params.mode}|${params.threshold}|${params.minSize}|${params.maxSize}|${params.overlapZeroOnly}`;
    const hash = createHash('sha1').update(stable).digest('hex').slice(0, 12);
    return `${CACHE_PREFIX}${hash}`;
  }

  private async readCache(
    key: string,
  ): Promise<{ clusters: ComputedCluster[]; computedAt: string } | null> {
    try {
      const raw = await this.redis.rawGet(key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      this.logger.warn(
        `cache read failed key=${key}: ${e instanceof Error ? e.message : e}`,
      );
      return null;
    }
  }

  private async writeCache(
    key: string,
    clusters: ComputedCluster[],
    computedAt: string,
  ): Promise<void> {
    try {
      await this.redis.rawSetEx(
        key,
        CACHE_TTL_SECONDS,
        JSON.stringify({ clusters, computedAt }),
      );
    } catch (e) {
      this.logger.warn(
        `cache write failed key=${key}: ${e instanceof Error ? e.message : e}`,
      );
    }
  }

  private async compute(params: {
    mode: 'within-artist' | 'cross-artist' | 'all';
    threshold: number;
    minSize: number;
    maxSize: number;
    overlapZeroOnly: boolean;
  }): Promise<ComputedCluster[]> {
    const start = Date.now();
    this.logger.log(`fuzzy compute start ${JSON.stringify(params)}`);

    const songs = await this.prisma.globalSong.findMany({
      select: {
        id: true,
        title: true,
        normTitle: true,
        globalArtistId: true,
        channelCount: true,
        globalArtist: { select: { canonicalName: true } },
      },
    });
    const rows: SongRow[] = songs.map((s) => ({
      id: s.id,
      title: s.title,
      normTitle: s.normTitle,
      globalArtistId: s.globalArtistId,
      artistCanonicalName: s.globalArtist?.canonicalName ?? '',
      channelCount: s.channelCount,
    }));

    // Union-find
    const parent: number[] = rows.map((_, i) => i);
    const find = (x: number): number => {
      while (parent[x] !== x) {
        parent[x] = parent[parent[x]];
        x = parent[x];
      }
      return x;
    };
    const union = (a: number, b: number) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent[ra] = rb;
    };

    // Within-artist mode: cluster songs that share artistId, with similar normTitle
    if (params.mode === 'within-artist' || params.mode === 'all') {
      const byArtist = new Map<number, number[]>();
      rows.forEach((r, i) => {
        const list = byArtist.get(r.globalArtistId) ?? [];
        list.push(i);
        byArtist.set(r.globalArtistId, list);
      });
      for (const [, indices] of byArtist) {
        if (indices.length < 2) continue;
        for (let i = 0; i < indices.length; i++) {
          for (let j = i + 1; j < indices.length; j++) {
            const a = indices[i];
            const b = indices[j];
            // exact match always passes; otherwise Jaro-Winkler
            if (rows[a].normTitle === rows[b].normTitle) {
              union(a, b);
              continue;
            }
            const sim = jaroWinklerSimilarity(
              rows[a].normTitle,
              rows[b].normTitle,
            );
            if (sim >= params.threshold) union(a, b);
          }
        }
      }
    }

    // Cross-artist mode: cluster across artists. block by length bucket + first char
    if (params.mode === 'cross-artist' || params.mode === 'all') {
      const buckets = new Map<string, number[]>();
      rows.forEach((r, i) => {
        const len = r.normTitle.length;
        const bucket = `${r.normTitle[0] ?? ''}|${Math.floor(len / 3)}`;
        const list = buckets.get(bucket) ?? [];
        list.push(i);
        buckets.set(bucket, list);
      });
      for (const [, indices] of buckets) {
        if (indices.length < 2) continue;
        // hard cap to avoid catastrophic O(N²)
        if (indices.length > 800) continue;
        for (let i = 0; i < indices.length; i++) {
          for (let j = i + 1; j < indices.length; j++) {
            const a = indices[i];
            const b = indices[j];
            // skip same-artist already handled by within-artist mode
            if (rows[a].globalArtistId === rows[b].globalArtistId) continue;
            // Length sanity
            const la = rows[a].normTitle.length;
            const lb = rows[b].normTitle.length;
            if (Math.abs(la - lb) > Math.max(la, lb) * 0.4) continue;
            if (rows[a].normTitle === rows[b].normTitle) {
              union(a, b);
              continue;
            }
            const sim = jaroWinklerSimilarity(
              rows[a].normTitle,
              rows[b].normTitle,
            );
            if (sim >= params.threshold) union(a, b);
          }
        }
      }
    }

    // Group by union-find root
    const groups = new Map<number, number[]>();
    for (let i = 0; i < rows.length; i++) {
      const r = find(i);
      const list = groups.get(r) ?? [];
      list.push(i);
      groups.set(r, list);
    }

    let clusters: ComputedCluster[] = [];
    for (const indices of groups.values()) {
      if (indices.length < params.minSize) continue;
      if (indices.length > params.maxSize) continue;

      const members = indices.map((i) => rows[i]);
      // anchor = highest channelCount (tie → lowest id)
      members.sort((a, b) => {
        if (b.channelCount !== a.channelCount)
          return b.channelCount - a.channelCount;
        return a.id - b.id;
      });
      const anchor = members[0];
      const memberIds = [...members.map((m) => m.id)].sort((a, b) => a - b);
      const totalChannels = members.reduce((s, m) => s + m.channelCount, 0);
      const artists = [
        ...new Set(members.map((m) => m.artistCanonicalName).filter(Boolean)),
      ];
      const isCrossArtist =
        new Set(members.map((m) => m.globalArtistId)).size > 1;

      clusters.push({
        clusterKey: createHash('sha1')
          .update(memberIds.join(','))
          .digest('hex')
          .slice(0, 16),
        mode: isCrossArtist ? 'cross-artist' : 'within-artist',
        size: members.length,
        totalChannels,
        anchorTitle: anchor.title,
        anchorNormTitle: anchor.normTitle,
        artistCanonicalNames: artists,
        memberIds,
      });
    }

    // overlapZeroOnly post-filter (cross-artist only): exclude clusters where
    // any single channel registered ≥2 members (= 동명이곡 신호).
    if (params.overlapZeroOnly) {
      const filtered: ComputedCluster[] = [];
      for (const c of clusters) {
        if (c.mode === 'within-artist') {
          filtered.push(c); // within-artist 는 overlap 의미 없음
          continue;
        }
        const songRows = await this.prisma.song.findMany({
          where: { globalSongId: { in: c.memberIds } },
          select: { channelId: true, globalSongId: true },
          distinct: ['channelId', 'globalSongId'],
        });
        const channelToSongs = new Map<number, Set<number>>();
        for (const r of songRows) {
          if (r.globalSongId === null) continue;
          const set = channelToSongs.get(r.channelId) ?? new Set<number>();
          set.add(r.globalSongId);
          channelToSongs.set(r.channelId, set);
        }
        const hasOverlap = [...channelToSongs.values()].some(
          (s) => s.size >= 2,
        );
        if (!hasOverlap) filtered.push(c);
      }
      clusters = filtered;
    }

    const elapsed = Date.now() - start;
    this.logger.log(
      `fuzzy compute done ${clusters.length} clusters in ${elapsed}ms`,
    );
    return clusters;
  }

  /* ====================================================================== */
  /*  Detail / LLM judge (memberIds 기반, fuzzy 도 exact 도 사용 가능)        */
  /* ====================================================================== */

  async detail(memberIds: number[]): Promise<FuzzyClusterDetailResponseDto> {
    const songs = await this.prisma.globalSong.findMany({
      where: { id: { in: memberIds } },
      select: {
        id: true,
        title: true,
        normTitle: true,
        globalArtistId: true,
        channelCount: true,
        globalArtist: { select: { canonicalName: true, normKey: true } },
      },
    });
    if (songs.length !== memberIds.length) {
      const found = new Set(songs.map((s) => s.id));
      const missing = memberIds.filter((id) => !found.has(id));
      throw new NotFoundException(
        `globalSongs not found: ${missing.join(',')}`,
      );
    }
    songs.sort((a, b) => {
      if (b.channelCount !== a.channelCount)
        return b.channelCount - a.channelCount;
      return a.id - b.id;
    });

    const rows: FuzzyClusterDetailRowDto[] = await Promise.all(
      songs.map(async (s) => {
        const sample = await this.prisma.song.findMany({
          where: { globalSongId: s.id },
          select: {
            channelId: true,
            channel: { select: { name: true } },
          },
          orderBy: { id: 'asc' },
          take: 5,
          distinct: ['channelId'],
        });
        return {
          id: s.id,
          title: s.title,
          normTitle: s.normTitle,
          globalArtistId: s.globalArtistId,
          artistCanonicalName: s.globalArtist?.canonicalName ?? '',
          artistNormKey: s.globalArtist?.normKey ?? '',
          channelCount: s.channelCount,
          sampleChannels: sample.map((s) => ({
            channelId: s.channelId,
            channelName: s.channel?.name ?? '',
          })),
        };
      }),
    );

    const ids = songs.map((s) => s.id);
    const overlap = await this.computeOverlapMatrix(ids);

    return { rows, overlap };
  }

  private async computeOverlapMatrix(ids: number[]): Promise<number[][]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.song.findMany({
      where: { globalSongId: { in: ids } },
      select: { channelId: true, globalSongId: true },
      distinct: ['channelId', 'globalSongId'],
    });
    const map = new Map<number, Set<number>>();
    for (const r of rows) {
      if (r.globalSongId === null) continue;
      const set = map.get(r.channelId) ?? new Set<number>();
      set.add(r.globalSongId);
      map.set(r.channelId, set);
    }
    const indexOfId = new Map(ids.map((id, i) => [id, i]));
    const matrix: number[][] = ids.map(() => ids.map(() => 0));
    for (const [, songSet] of map) {
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

  async llmJudge(
    memberIds: number[],
    anchor?: string,
  ): Promise<FuzzyClusterLlmJudgeResponseDto> {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return {
        verdict: 'PARSE_ERROR',
        groups: [],
        rawResponse: 'OPENROUTER_API_KEY not configured',
        model: this.llmModel,
      };
    }

    const detail = await this.detail(memberIds);
    const ids = detail.rows.map((r) => r.id);

    const rowLines = detail.rows
      .map((r, i) => {
        const channels =
          r.sampleChannels.length > 0
            ? r.sampleChannels
                .map((c) => c.channelName || `ch#${c.channelId}`)
                .join(', ')
            : '(no channels)';
        return `[${i + 1}] id=${r.id}  title="${r.title}"  normTitle="${r.normTitle}"  artist="${r.artistCanonicalName}" (artist_id=${r.globalArtistId})  channels=${r.channelCount}  sampleChannels=[${channels}]`;
      })
      .join('\n');

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
        ? '  (none — no streamer registered any two of these rows together → likely same song)'
        : overlapLines.join('\n');

    const prompt = `You are an entity-resolution judge for music recordings (K-pop, J-pop, Vocaloid, Korean indie, anime OST).

Multiple GlobalSong rows are clustered together because their normalized titles look **fuzzy-similar** (Jaro-Winkler ≥ 0.85), possibly across different artists. Decide whether they are:
  (a) the SAME song (typing variants, cross-language, collaboration permutations),
  (b) GENUINELY DIFFERENT songs that happen to look similar (homonyms, partial matches),
  (c) ambiguous — split into clear sub-groups.

${anchor ? `Anchor (representative title): "${anchor}"\n` : ''}
Rows:
${rowLines}

Pairwise channel overlap (key signal — 0 = no streamer registered both → likely same song; >0 = distinct entities):
${overlapBlock}

Use raw titles + normTitles + artists + channel overlap. If different artists registered the same song, they may all be the same recording.

Respond in EXACTLY this format (no other text, no markdown fences):

If all rows are the same song:
SAME

If split into distinct songs (subgroups), one group per line as space-separated **id values** (USE the id= numbers, NOT the [N] index; each id appears in exactly one group; singletons allowed):
SPLIT
<id> <id> <id>
<id> <id>

If ambiguous:
ABSTAIN

Be conservative — when in doubt, ABSTAIN.`;

    const client = new OpenAI({
      apiKey,
      baseURL:
        process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer': 'https://meloming.com',
        'X-Title': 'Meloming Admin Fuzzy Cluster Judge',
      },
    });

    let raw = '';
    try {
      const resp = await client.chat.completions.create({
        model: this.llmModel,
        user: 'meloming-back:admin-fuzzy-clusters',
        max_tokens: 2000,
        temperature: 0,
        messages: [{ role: 'user', content: prompt }],
      });
      raw = resp.choices[0]?.message?.content ?? '';
    } catch (e) {
      this.logger.error(
        `LLM call failed: ${e instanceof Error ? e.message : e}`,
      );
      return {
        verdict: 'PARSE_ERROR',
        groups: [],
        rawResponse: e instanceof Error ? e.message : String(e),
        model: this.llmModel,
      };
    }

    const { verdict, groups } = this.parseVerdict(raw, ids);
    return { verdict, groups, rawResponse: raw, model: this.llmModel };
  }

  private parseVerdict(
    raw: string,
    allIds: number[],
  ): {
    verdict: FuzzyClusterLlmJudgeResponseDto['verdict'];
    groups: number[][];
  } {
    const lines = raw
      .trim()
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (lines.length === 0) return { verdict: 'PARSE_ERROR', groups: [] };
    const cleanLine = (s: string) =>
      s.replace(/^[*_`#>\s-]+|[*_`\s]+$/g, '').toUpperCase();
    let idx = -1;
    let word: 'SAME' | 'SPLIT' | 'ABSTAIN' | null = null;
    for (let i = 0; i < lines.length; i++) {
      const c = cleanLine(lines[i]);
      if (c === 'SAME' || c === 'SPLIT' || c === 'ABSTAIN') {
        idx = i;
        word = c;
        break;
      }
    }
    if (word === null) return { verdict: 'PARSE_ERROR', groups: [] };
    if (word === 'SAME') return { verdict: 'SAME', groups: [allIds.slice()] };
    if (word === 'ABSTAIN') return { verdict: 'ABSTAIN', groups: [] };
    const groups: number[][] = [];
    const seen = new Set<number>();
    for (const line of lines.slice(idx + 1)) {
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
