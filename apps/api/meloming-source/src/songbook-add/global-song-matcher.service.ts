import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  GlobalSongLlmContext,
  LlmMatcherService,
} from '../song-request/v2/llm-matcher.service';
import {
  jamoSimilarity,
  normalizeText,
  splitArtistTitle,
} from '../song-request/v2/fuzzy-extra.util';

/**
 * `!노래책추가` 흐름의 GlobalSong 식별기.
 *
 * 신청곡 매칭(`SongMatcherV2Service.match`)이 채널 노래책 Song.id를 반환하는 것과
 * 달리, 이 서비스는 **채널에 없는 GlobalSong**을 찾는다 — 노래책 추가가 끝나면
 * 곧바로 Song INSERT 대상이 되는 row.
 *
 * 단계별 흐름 (실패 시 다음 단계):
 *   1. GlobalSongAlias.normAliasTitle 정확 일치
 *   2. GlobalSong.normTitle 정확 일치 (artist 지정 시 globalArtistId 일치 결합)
 *   3. Jamo fuzzy (normTitle prefix + GlobalArtistAlias 후보군 한정 — 전체 GS 대상 X)
 *   4. LLM matcher (사전 후보 + GlobalSongLyrics 부분일치 hit)
 *
 * autoAcceptable threshold = 0.8 — 신청(0.5~0.7)보다 보수적.
 * 노이즈 비용이 큰 노래책 영구 등록 작업이라.
 */
@Injectable()
export class GlobalSongMatcherService {
  private readonly logger = new Logger(GlobalSongMatcherService.name);

  static readonly AUTO_THRESHOLD = 0.8;

  /** Jamo Levenshtein 입력 길이 cap (DoS 방어). */
  private static readonly JAMO_INPUT_MAX_CHARS = 80;
  /** Jamo 후보군 최대 개수 (normTitle prefix LIKE 결과 cap). */
  private static readonly JAMO_CANDIDATE_LIMIT = 200;
  /** Jamo top 후보 보존 개수 — LLM context 기본 입력. */
  private static readonly JAMO_TOP_KEEP = 30;
  /** LLM에 박는 최종 candidate 풀 cap. */
  private static readonly LLM_CANDIDATE_LIMIT = 50;
  /** 가사 LIKE 검색 결과 cap. */
  private static readonly LYRICS_HIT_LIMIT = 10;

  constructor(
    private readonly prisma: PrismaService,
    private readonly llmMatcher: LlmMatcherService,
  ) {}

  async matchGlobalSong(input: {
    channelId: number;
    rawQuery: string;
  }): Promise<MatchGlobalSongResult | null> {
    const trace: GlobalMatchStepTrace[] = [];
    const trimmed = input.rawQuery.trim();
    if (!trimmed) return null;

    const { artist, title } = splitArtistTitle(trimmed);
    const queryTitle = title || trimmed;
    const normTitle = normalizeText(queryTitle);
    const normArtist = artist ? normalizeText(artist) : null;
    if (!normTitle) return null;

    // Step 1: GlobalSongAlias 정확 일치
    const aliasHit = await this.matchByAlias(normTitle, normArtist, trace);
    if (aliasHit) return this.finalize(aliasHit, 1.0, trace);

    // Step 2: GlobalSong.normTitle 정확 일치 (artist 결합)
    const normHit = await this.matchByNormTitle(normTitle, normArtist, trace);
    if (normHit) return this.finalize(normHit, 0.95, trace);

    // Step 3: Jamo fuzzy — 후보군은 prefix LIKE + artist alias 매치
    const candidatePool = await this.buildJamoCandidatePool(
      normTitle,
      normArtist,
    );
    const jamoTop = this.scoreCandidatesByJamo(
      queryTitle,
      artist || undefined,
      candidatePool,
    );
    trace.push({
      step: 'jamo-fuzzy',
      matched: jamoTop.length > 0 && jamoTop[0].score >= 0.85,
      globalSongId:
        jamoTop[0]?.score >= 0.85 ? jamoTop[0].globalSongId : undefined,
      score: jamoTop[0]?.score,
      note: `pool=${candidatePool.length} top=${jamoTop[0]?.score.toFixed(3) ?? 'n/a'}`,
    });
    if (jamoTop.length > 0 && jamoTop[0].score >= 0.85) {
      const top = jamoTop[0];
      const next = jamoTop[1];
      if (!next || top.score - next.score >= 0.05) {
        return this.finalize(
          {
            id: top.globalSongId,
            title: top.title,
            canonicalArtistName: top.artist,
          },
          top.score,
          trace,
        );
      }
    }

    // Step 4: LLM matcher
    if (!this.llmMatcher.isConfigured()) {
      trace.push({
        step: 'llm',
        matched: false,
        note: 'OPENROUTER_API_KEY not configured',
      });
      return this.fallbackFromJamo(jamoTop, trace);
    }

    const llmCandidates = await this.buildLlmCandidates(
      jamoTop,
      candidatePool,
      normArtist,
    );
    if (llmCandidates.length === 0) {
      trace.push({ step: 'llm', matched: false, note: 'no candidates' });
      return null;
    }

    const lyricsHits = await this.findLyricsHits(
      trimmed,
      llmCandidates.map((c) => c.globalSongId),
    );

    const llmCtx: GlobalSongLlmContext = {
      rawQuery: trimmed,
      candidates: llmCandidates.map((c) => ({
        globalSongId: c.globalSongId,
        title: c.title,
        artist: c.artist,
        ...(c.aliases && c.aliases.length > 0 ? { aliases: c.aliases } : {}),
      })),
      lyricsHits: lyricsHits.length > 0 ? lyricsHits : undefined,
    };

    const llmResult = await this.llmMatcher.matchGlobalSong(llmCtx);
    trace.push({
      step: 'llm',
      matched: llmResult.matchedGlobalSongId !== null,
      globalSongId: llmResult.matchedGlobalSongId ?? undefined,
      score: llmResult.confidence,
      note:
        (llmResult.reasoning ? `reason="${llmResult.reasoning}" ` : '') +
        `candidates=${llmCandidates.length} lyrics_hits=${lyricsHits.length}`,
    });

    if (llmResult.matchedGlobalSongId !== null && llmResult.confidence > 0) {
      const picked = llmCandidates.find(
        (c) => c.globalSongId === llmResult.matchedGlobalSongId,
      );
      if (picked) {
        return this.finalize(
          {
            id: picked.globalSongId,
            title: picked.title,
            canonicalArtistName: picked.artist,
          },
          llmResult.confidence,
          trace,
        );
      }
    }

    return this.fallbackFromJamo(jamoTop, trace);
  }

  // -------- Step 1: alias 정확 일치 --------

  private async matchByAlias(
    normTitle: string,
    normArtist: string | null,
    trace: GlobalMatchStepTrace[],
  ): Promise<GlobalSongRow | null> {
    const aliases = await this.prisma.globalSongAlias.findMany({
      where: { normAliasTitle: normTitle },
      select: {
        globalSong: {
          select: {
            id: true,
            title: true,
            globalArtistId: true,
            channelCount: true,
            globalArtist: { select: { canonicalName: true, normKey: true } },
          },
        },
      },
      take: 20,
    });
    if (aliases.length === 0) {
      trace.push({ step: 'alias-exact', matched: false, note: `norm="${normTitle}"` });
      return null;
    }

    let pool = aliases.map((a) => a.globalSong);
    if (normArtist) {
      // 사용자가 artist 를 명시했으면 artist 일치 후보로만 좁힘. 0건이면 step miss
      // — title-only 로 fallback 하면 다른 가수 동명 곡이 자동 등록될 위험.
      pool = pool.filter((gs) => gs.globalArtist.normKey === normArtist);
      if (pool.length === 0) {
        trace.push({
          step: 'alias-exact',
          matched: false,
          note: `pool=${aliases.length} artistFiltered=strict no-match`,
        });
        return null;
      }
    }
    pool.sort((a, b) => b.channelCount - a.channelCount);
    const picked = pool[0];
    trace.push({
      step: 'alias-exact',
      matched: true,
      globalSongId: picked.id,
      note: `pool=${aliases.length} artistFiltered=${normArtist ? 'strict' : 'no'}`,
    });
    return {
      id: picked.id,
      title: picked.title,
      canonicalArtistName: picked.globalArtist.canonicalName,
    };
  }

  // -------- Step 2: normTitle 정확 일치 --------

  private async matchByNormTitle(
    normTitle: string,
    normArtist: string | null,
    trace: GlobalMatchStepTrace[],
  ): Promise<GlobalSongRow | null> {
    const songs = await this.prisma.globalSong.findMany({
      where: { normTitle },
      select: {
        id: true,
        title: true,
        globalArtistId: true,
        channelCount: true,
        globalArtist: { select: { canonicalName: true, normKey: true } },
      },
      take: 20,
    });
    if (songs.length === 0) {
      trace.push({ step: 'normTitle-exact', matched: false });
      return null;
    }
    let pool = songs;
    if (normArtist) {
      // artist strict — 일치 후보 0건이면 step miss (다른 가수 fallback 차단)
      pool = pool.filter((gs) => gs.globalArtist.normKey === normArtist);
      if (pool.length === 0) {
        trace.push({
          step: 'normTitle-exact',
          matched: false,
          note: `pool=${songs.length} artistFiltered=strict no-match`,
        });
        return null;
      }
    }
    pool.sort((a, b) => b.channelCount - a.channelCount);
    const picked = pool[0];
    trace.push({
      step: 'normTitle-exact',
      matched: true,
      globalSongId: picked.id,
      note: `pool=${songs.length} artistFiltered=${normArtist ? 'strict' : 'no'}`,
    });
    return {
      id: picked.id,
      title: picked.title,
      canonicalArtistName: picked.globalArtist.canonicalName,
    };
  }

  // -------- Step 3: jamo fuzzy 후보군 --------

  /**
   * Jamo Levenshtein 후보군. 전체 GlobalSong (수만 row) 대상이면 비용 폭발이라
   * `normTitle LIKE prefix%` + `GlobalArtistAlias.normAlias` 매치 GlobalSong을 합쳐
   * 후보군을 좁힌다.
   */
  private async buildJamoCandidatePool(
    normTitle: string,
    normArtist: string | null,
  ): Promise<GlobalSongRowWithNorm[]> {
    const titleKey = normTitle.slice(0, 20);
    const ids = new Set<number>();
    const rows: GlobalSongRowWithNorm[] = [];

    if (titleKey.length >= 2) {
      const byTitle = await this.prisma.globalSong.findMany({
        where: { normTitle: { startsWith: titleKey } },
        select: {
          id: true,
          title: true,
          normTitle: true,
          globalArtistId: true,
          channelCount: true,
          globalArtist: { select: { canonicalName: true, normKey: true } },
        },
        take: GlobalSongMatcherService.JAMO_CANDIDATE_LIMIT,
      });
      for (const r of byTitle) {
        if (ids.has(r.id)) continue;
        ids.add(r.id);
        rows.push({
          id: r.id,
          title: r.title,
          normTitle: r.normTitle,
          canonicalArtistName: r.globalArtist.canonicalName,
          normArtistKey: r.globalArtist.normKey,
          channelCount: r.channelCount,
        });
      }
    }

    if (normArtist) {
      const byArtist = await this.prisma.globalArtistAlias.findMany({
        where: { normAlias: normArtist },
        select: {
          globalArtist: {
            select: {
              canonicalName: true,
              normKey: true,
              songs: {
                select: {
                  id: true,
                  title: true,
                  normTitle: true,
                  channelCount: true,
                },
                take: 100,
                orderBy: { channelCount: 'desc' },
              },
            },
          },
        },
        take: 5,
      });
      for (const a of byArtist) {
        for (const s of a.globalArtist.songs) {
          if (ids.has(s.id)) continue;
          ids.add(s.id);
          rows.push({
            id: s.id,
            title: s.title,
            normTitle: s.normTitle,
            canonicalArtistName: a.globalArtist.canonicalName,
            normArtistKey: a.globalArtist.normKey,
            channelCount: s.channelCount,
          });
        }
      }
    }
    return rows;
  }

  private scoreCandidatesByJamo(
    titleQuery: string,
    artistQuery: string | undefined,
    pool: GlobalSongRowWithNorm[],
  ): JamoScored[] {
    if (pool.length === 0) return [];
    const cleanTitle = titleQuery
      .trim()
      .slice(0, GlobalSongMatcherService.JAMO_INPUT_MAX_CHARS);
    const cleanArtist = artistQuery
      ?.trim()
      .slice(0, GlobalSongMatcherService.JAMO_INPUT_MAX_CHARS);
    if (!cleanTitle) return [];

    const scored: JamoScored[] = pool.map((row) => {
      const sTitle = (row.title ?? '').slice(
        0,
        GlobalSongMatcherService.JAMO_INPUT_MAX_CHARS,
      );
      const sArtist = (row.canonicalArtistName ?? '').slice(
        0,
        GlobalSongMatcherService.JAMO_INPUT_MAX_CHARS,
      );
      const titleScore = jamoSimilarity(cleanTitle, sTitle);
      const artistScore = cleanArtist
        ? jamoSimilarity(cleanArtist, sArtist)
        : 0;
      const score = cleanArtist
        ? titleScore * 0.7 + artistScore * 0.3
        : titleScore;
      return {
        globalSongId: row.id,
        score,
        title: row.title,
        artist: row.canonicalArtistName,
        channelCount: row.channelCount,
      };
    });
    return scored
      .filter((s) => s.score > 0.5)
      .sort((a, b) =>
        b.score === a.score
          ? b.channelCount - a.channelCount
          : b.score - a.score,
      )
      .slice(0, GlobalSongMatcherService.JAMO_TOP_KEEP);
  }

  // -------- Step 4: LLM 후보 + 가사 hit --------

  private async buildLlmCandidates(
    jamoTop: JamoScored[],
    pool: GlobalSongRowWithNorm[],
    normArtist: string | null,
  ): Promise<LlmCandidate[]> {
    const ids = new Set<number>();
    const out: LlmCandidate[] = [];

    for (const s of jamoTop) {
      if (ids.has(s.globalSongId)) continue;
      ids.add(s.globalSongId);
      out.push({
        globalSongId: s.globalSongId,
        title: s.title,
        artist: s.artist,
      });
      if (out.length >= GlobalSongMatcherService.LLM_CANDIDATE_LIMIT) break;
    }

    // jamo top이 없거나 부족하면 pool 상위로 채움 (artist 일치 우선)
    if (out.length < GlobalSongMatcherService.LLM_CANDIDATE_LIMIT) {
      const remaining = pool
        .filter((p) => !ids.has(p.id))
        .sort((a, b) => {
          if (normArtist) {
            const aArtistMatch = a.normArtistKey === normArtist ? 1 : 0;
            const bArtistMatch = b.normArtistKey === normArtist ? 1 : 0;
            if (aArtistMatch !== bArtistMatch) return bArtistMatch - aArtistMatch;
          }
          return b.channelCount - a.channelCount;
        });
      for (const p of remaining) {
        if (out.length >= GlobalSongMatcherService.LLM_CANDIDATE_LIMIT) break;
        ids.add(p.id);
        out.push({
          globalSongId: p.id,
          title: p.title,
          artist: p.canonicalArtistName,
        });
      }
    }

    if (out.length === 0) return out;
    const aliases = await this.prisma.globalSongAlias.findMany({
      where: { globalSongId: { in: out.map((c) => c.globalSongId) } },
      select: { globalSongId: true, aliasTitle: true },
    });
    const aliasByGs = new Map<number, string[]>();
    for (const a of aliases) {
      const arr = aliasByGs.get(a.globalSongId) ?? [];
      arr.push(a.aliasTitle);
      aliasByGs.set(a.globalSongId, arr);
    }
    return out.map((c) => ({
      ...c,
      aliases: aliasByGs.get(c.globalSongId)?.slice(0, 8),
    }));
  }

  private async findLyricsHits(
    rawQuery: string,
    candidateGlobalSongIds: number[],
  ): Promise<NonNullable<GlobalSongLlmContext['lyricsHits']>> {
    if (candidateGlobalSongIds.length === 0) return [];
    const trimmed = rawQuery.trim();
    const candidates: string[] = [];
    if (trimmed.length >= 6 && trimmed.length <= 60) candidates.push(trimmed);
    if (trimmed.length > 60) candidates.push(trimmed.slice(0, 30));
    const tokens = trimmed.split(/\s+/).filter((t) => t.length >= 4);
    for (const t of tokens.slice(0, 3)) candidates.push(t);
    if (candidates.length === 0) return [];

    const lyrics = await this.prisma.globalSongLyrics.findMany({
      where: {
        globalSongId: { in: candidateGlobalSongIds },
        OR: candidates.map((c) => ({ body: { contains: c } })),
      },
      select: {
        globalSongId: true,
        body: true,
        globalSong: {
          select: {
            title: true,
            globalArtist: { select: { canonicalName: true } },
          },
        },
      },
      take: GlobalSongMatcherService.LYRICS_HIT_LIMIT,
    });

    return lyrics.map((row) => {
      const body = row.body ?? '';
      const matched = candidates.find((c) => body.includes(c));
      const idx = matched ? body.indexOf(matched) : 0;
      const start = Math.max(0, idx - 20);
      return {
        globalSongId: row.globalSongId,
        title: row.globalSong.title,
        artist: row.globalSong.globalArtist.canonicalName,
        snippet: body.slice(start, start + 80),
      };
    });
  }

  // -------- finalize / fallback --------

  private fallbackFromJamo(
    jamoTop: JamoScored[],
    trace: GlobalMatchStepTrace[],
  ): MatchGlobalSongResult | null {
    if (jamoTop.length === 0) return null;
    const top = jamoTop[0];
    return this.finalize(
      {
        id: top.globalSongId,
        title: top.title,
        canonicalArtistName: top.artist,
      },
      Math.min(top.score, 0.79), // LLM 못 거치면 autoAcceptable threshold 미달
      trace,
    );
  }

  private finalize(
    globalSong: GlobalSongRow,
    confidence: number,
    trace: GlobalMatchStepTrace[],
  ): MatchGlobalSongResult {
    const clamped = Math.max(0, Math.min(1, confidence));
    return {
      globalSong,
      confidence: clamped,
      autoAcceptable: clamped >= GlobalSongMatcherService.AUTO_THRESHOLD,
      trace,
    };
  }
}

// -------- types --------

export interface GlobalSongRow {
  id: number;
  title: string;
  canonicalArtistName: string;
}

export interface MatchGlobalSongResult {
  globalSong: GlobalSongRow;
  /** 0.0 ~ 1.0 */
  confidence: number;
  /** confidence ≥ AUTO_THRESHOLD (=0.8) 일 때만 노래책 INSERT 진행. */
  autoAcceptable: boolean;
  trace: GlobalMatchStepTrace[];
}

export interface GlobalMatchStepTrace {
  step: 'alias-exact' | 'normTitle-exact' | 'jamo-fuzzy' | 'llm';
  matched: boolean;
  globalSongId?: number;
  score?: number;
  note?: string;
}

interface GlobalSongRowWithNorm {
  id: number;
  title: string;
  normTitle: string;
  canonicalArtistName: string;
  normArtistKey: string;
  channelCount: number;
}

interface JamoScored {
  globalSongId: number;
  score: number;
  title: string;
  artist: string;
  channelCount: number;
}

interface LlmCandidate {
  globalSongId: number;
  title: string;
  artist: string;
  aliases?: string[];
}
