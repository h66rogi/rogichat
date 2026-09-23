import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SongMatcherService, MatchedSong } from '../song-matcher.service';
import { TierClassifierService } from './tier-classifier.service';
import { GlobalSongCrossAliasService } from './global-song-cross-alias.service';
import {
  LlmMatcherContext,
  LlmMatcherService,
} from './llm-matcher.service';
import {
  extractYoutubeVideoId,
  jamoSimilarity,
  normalizeText,
  splitArtistTitle,
} from './fuzzy-extra.util';
import {
  MatchStepTrace,
  MatchTier,
  MatchV2Input,
  SongMatchResultV2,
  TIER_THRESHOLDS,
} from './types';

/**
 * 신청곡 매칭 v2.
 *
 * Tier별 알고리즘 분기:
 *   Tier 1 (`!신청` prefix): YouTube → v1 → cross-alias → jamo → LLM matcher (context-rich)
 *   Tier 2 (`신청` prefix / `!sr`): v1 → cross-alias → jamo
 *   Tier 3 (`신청` 포함): v1만 (정확매칭)
 *
 * LLM matcher는 채널 노래책 + 사전 fuzzy/cross-alias hints + lyrics hits를
 * 한 번에 박아 단일 호출로 매칭. agentic 미사용 (latency 1초 목표).
 */
@Injectable()
export class SongMatcherV2Service {
  private readonly logger = new Logger(SongMatcherV2Service.name);

  /** LLM 컨텍스트에 박을 채널 노래책 최대 곡 수. 초과 시 사전 필터. */
  private static readonly LLM_CHANNEL_SONGS_MAX = 500;

  constructor(
    private readonly v1: SongMatcherService,
    private readonly tierClassifier: TierClassifierService,
    private readonly crossAlias: GlobalSongCrossAliasService,
    private readonly llmMatcher: LlmMatcherService,
    private readonly prisma: PrismaService,
  ) {}

  async match(input: MatchV2Input): Promise<SongMatchResultV2> {
    const trace: MatchStepTrace[] = [];
    const classification = this.tierClassifier.classify(
      input.rawMessage,
      input.requestCommand,
    );

    if (classification.tier === 'ignored') {
      return {
        matched: false,
        tier: 'ignored',
        reason: classification.reason,
        confidence: 0,
        threshold: 1,
        autoAcceptable: false,
        trace,
      };
    }

    const tier = classification.tier;
    const threshold = TIER_THRESHOLDS[tier];

    if (!classification.payload) {
      return {
        matched: false,
        tier,
        reason: classification.reason,
        confidence: 0,
        threshold,
        autoAcceptable: false,
        trace,
      };
    }

    // Step 1: YouTube URL (Tier 1만)
    if (tier === 'tier1') {
      const ytMatch = await this.tryYoutubeUrl(
        input.channelId,
        classification.payload,
        trace,
      );
      if (ytMatch) {
        return this.finalize(
          tier,
          classification.reason,
          threshold,
          ytMatch,
          0.97,
          trace,
        );
      }
    }

    // Step 2/3: v1 매칭
    const { artist, title } = splitArtistTitle(classification.payload);
    let v1Result;
    if (artist && title) {
      v1Result = await this.v1.matchSong(input.channelId, artist, title);
      trace.push({
        step: 'v1.matchSong',
        algorithm: 'fuzzy_levenshtein',
        matched: v1Result.matched,
        songId: v1Result.song?.id,
        candidates: v1Result.candidates?.map((c) => ({
          songId: c.id,
          score: 0,
          title: c.title,
          artist: c.artistName,
        })),
        note: `artist="${artist}" title="${title}"`,
      });
    } else {
      const keyword = title || artist || classification.payload;
      v1Result = await this.v1.matchByKeyword(input.channelId, keyword);
      trace.push({
        step: 'v1.matchByKeyword',
        algorithm: 'fuzzy_levenshtein',
        matched: v1Result.matched,
        songId: v1Result.song?.id,
        candidates: v1Result.candidates?.map((c) => ({
          songId: c.id,
          score: 0,
          title: c.title,
          artist: c.artistName,
        })),
        note: `keyword="${keyword}"`,
      });
    }

    if (v1Result.matched && v1Result.song) {
      return this.finalize(
        tier,
        classification.reason,
        threshold,
        v1Result.song,
        tierBase(tier),
        trace,
        v1Result.candidates,
      );
    }

    // Step 4: GlobalSong cross-streamer alias (Tier 1/2만)
    let crossHit: { songId: number; via: string; score: number } | null = null;
    if (tier !== 'tier3') {
      const normTitle = normalizeText(title || classification.payload);
      const normArtist = artist ? normalizeText(artist) : undefined;
      const cross = await this.crossAlias.findMatch({
        channelId: input.channelId,
        normTitle,
        normArtist,
      });
      if (cross) {
        crossHit = { songId: cross.songId, via: cross.via, score: cross.score };
        const song = await this.v1.getSongById(input.channelId, cross.songId);
        trace.push({
          step: 'cross-alias',
          algorithm: 'global_song_cross_alias',
          matched: !!song,
          songId: song?.id,
          score: cross.score,
          note: `via=${cross.via} normTitle="${normTitle}"`,
        });
        if (song) {
          return this.finalize(
            tier,
            classification.reason,
            threshold,
            song,
            cross.score,
            trace,
            v1Result.candidates,
          );
        }
      }
    }

    // Step 5: 자모 단위 fuzzy (Tier 1/2만) — 결과는 LLM 컨텍스트에도 사용
    let jamoTop: Array<{
      songId: number;
      score: number;
      title: string;
      artist: string;
    }> = [];
    if (tier !== 'tier3') {
      const jamoMatch = await this.tryJamoFuzzy(
        input.channelId,
        title || classification.payload,
        artist || undefined,
        trace,
      );
      if (jamoMatch) {
        jamoTop = jamoMatch.allCandidates;
        if (jamoMatch.accept) {
          return this.finalize(
            tier,
            classification.reason,
            threshold,
            jamoMatch.song,
            jamoMatch.score,
            trace,
            v1Result.candidates,
          );
        }
      }
    }

    // Step 6: LLM context-rich matcher (Tier 1만)
    if (tier === 'tier1' && this.llmMatcher.isConfigured()) {
      const llmCtx = await this.buildLlmContext(
        input.channelId,
        input.rawMessage,
        classification.payload, // prefix 제거된 본문 (lyrics_hits LIKE 검색용)
        artist || undefined,
        title || classification.payload,
        v1Result.candidates,
        crossHit,
        jamoTop,
      );
      if (llmCtx.channelSongs.length > 0) {
        const llmResult = await this.llmMatcher.match(llmCtx);
        trace.push({
          step: 'llm-matcher',
          algorithm: 'llm_extract',
          matched: llmResult.matchedSongId !== null,
          songId: llmResult.matchedSongId ?? undefined,
          score: llmResult.confidence,
          note:
            (llmResult.reasoning ? `reason="${llmResult.reasoning}" ` : '') +
            `channel_songs=${llmCtx.channelSongs.length} ` +
            `cross_aliases=${llmCtx.crossAliases?.length ?? 0} ` +
            `lyrics_hits=${llmCtx.lyricsHits?.length ?? 0}`,
        });

        if (
          llmResult.matchedSongId !== null &&
          llmResult.confidence >= 0.5
        ) {
          const song = await this.v1.getSongById(
            input.channelId,
            llmResult.matchedSongId,
          );
          if (song) {
            const result = this.finalize(
              tier,
              classification.reason,
              threshold,
              song,
              Math.min(0.95, llmResult.confidence),
              trace,
              v1Result.candidates,
            );
            result.llmExtracted = {
              title: song.title,
              artist: song.artistName,
            };
            return result;
          }
        }
      } else {
        trace.push({
          step: 'llm-matcher',
          algorithm: 'llm_extract',
          matched: false,
          note: 'channel songs empty — skipped',
        });
      }
    }

    // 매칭 실패
    return {
      matched: false,
      candidates: v1Result.candidates,
      tier,
      reason: classification.reason,
      confidence:
        v1Result.candidates && v1Result.candidates.length > 0 ? 0.4 : 0,
      threshold,
      autoAcceptable: false,
      trace,
    };
  }

  // -------- helpers --------

  private async tryYoutubeUrl(
    channelId: number,
    payload: string,
    trace: MatchStepTrace[],
  ): Promise<MatchedSong | null> {
    const videoId = extractYoutubeVideoId(payload);
    if (!videoId) return null;

    const songs = await this.prisma.song.findMany({
      where: {
        channelId,
        OR: [
          { originalUrl: { contains: videoId } },
          { karaokeUrl: { contains: videoId } },
          { coverUrl: { contains: videoId } },
        ],
      },
      include: { artist: true },
      take: 5,
    });

    trace.push({
      step: 'youtube-url',
      algorithm: 'youtube_url',
      matched: songs.length > 0,
      songId: songs[0]?.id,
      note: `videoId=${videoId} hits=${songs.length}`,
    });

    if (songs.length === 0) return null;
    const s = songs[0];
    return {
      id: s.id,
      title: s.title,
      artistId: s.artist.id,
      artistName: s.artist.name,
      albumArt: s.albumArt,
      karaokeUrl: s.karaokeUrl,
      coverUrl: s.coverUrl,
      originalUrl: s.originalUrl,
      lyricsText: s.lyricsText,
    };
  }

  /** Jamo fuzzy DoS 방어 — Levenshtein O(m×n)이라 입력 길이 cap. */
  private static readonly JAMO_INPUT_MAX_CHARS = 80;

  private async tryJamoFuzzy(
    channelId: number,
    titleQuery: string,
    artistQuery: string | undefined,
    trace: MatchStepTrace[],
  ): Promise<{
    song: MatchedSong;
    score: number;
    accept: boolean;
    allCandidates: Array<{
      songId: number;
      score: number;
      title: string;
      artist: string;
    }>;
  } | null> {
    const cleanTitle = (titleQuery ?? '')
      .trim()
      .slice(0, SongMatcherV2Service.JAMO_INPUT_MAX_CHARS);
    const cleanArtist = artistQuery
      ?.trim()
      .slice(0, SongMatcherV2Service.JAMO_INPUT_MAX_CHARS);
    if (!cleanTitle) return null;

    const songs = await this.prisma.song.findMany({
      where: { channelId },
      include: { artist: true },
    });
    if (songs.length === 0) return null;

    const scored = songs
      .map((s) => {
        // 노래책 title도 동일 cap (긴 곡 제목은 ClickHouse 분석에서 53자 정도라 80자면 충분)
        const sTitle = (s.title ?? '').slice(
          0,
          SongMatcherV2Service.JAMO_INPUT_MAX_CHARS,
        );
        const sArtist = (s.artist.name ?? '').slice(
          0,
          SongMatcherV2Service.JAMO_INPUT_MAX_CHARS,
        );
        const titleScore = jamoSimilarity(cleanTitle, sTitle);
        const artistScore = cleanArtist
          ? jamoSimilarity(cleanArtist, sArtist)
          : 0;
        const score = cleanArtist
          ? titleScore * 0.7 + artistScore * 0.3
          : titleScore;
        return { song: s, score };
      })
      .filter((x) => x.score > 0.5) // LLM 컨텍스트로 더 많이 보내기 위해 임계값 낮춤
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    const allCandidates = scored.map((s) => ({
      songId: s.song.id,
      score: s.score,
      title: s.song.title,
      artist: s.song.artist.name,
    }));

    if (scored.length === 0) {
      trace.push({
        step: 'jamo-fuzzy',
        algorithm: 'fuzzy_jamo',
        matched: false,
        note: `no candidate above 0.5 for title="${cleanTitle}"`,
      });
      return null;
    }

    const top = scored[0];
    const next = scored[1];
    const accept =
      top.score >= 0.85 || (next && top.score - next.score >= 0.05);

    trace.push({
      step: 'jamo-fuzzy',
      algorithm: 'fuzzy_jamo',
      matched: !!accept,
      songId: accept ? top.song.id : undefined,
      score: top.score,
      candidates: allCandidates,
      note: `top=${top.score.toFixed(3)}${next ? ` next=${next.score.toFixed(3)}` : ''} accept=${!!accept}`,
    });

    const s = top.song;
    return {
      song: {
        id: s.id,
        title: s.title,
        artistId: s.artist.id,
        artistName: s.artist.name,
        albumArt: s.albumArt,
        karaokeUrl: s.karaokeUrl,
        coverUrl: s.coverUrl,
        originalUrl: s.originalUrl,
        lyricsText: s.lyricsText,
      },
      score: top.score,
      accept: !!accept,
      allCandidates,
    };
  }

  /**
   * LLM에 박을 컨텍스트를 구성. 채널 노래책이 LLM_CHANNEL_SONGS_MAX를 넘으면
   * jamo top + cross-alias hit + 같은 artist 곡으로 사전 필터.
   * gates: tier1만 호출하므로 비용 통제는 호출 측에서.
   */
  private async buildLlmContext(
    channelId: number,
    rawMessage: string,
    payloadOnly: string, // tier-classifier가 prefix(`!신청 ` 등) 제거한 본문 — lyrics_hits LIKE 검색에 사용
    artistQuery: string | undefined,
    titleQuery: string,
    v1Candidates:
      | Array<{ id: number; title: string; artistName: string }>
      | undefined,
    crossHit: { songId: number; via: string; score: number } | null,
    jamoTop: Array<{
      songId: number;
      score: number;
      title: string;
      artist: string;
    }>,
  ): Promise<LlmMatcherContext> {
    // 1) 채널 노래책 전체 조회
    const allSongs = await this.prisma.song.findMany({
      where: { channelId },
      select: {
        id: true,
        title: true,
        artist: { select: { name: true } },
        globalSongId: true,
        songCategories: {
          select: { category: { select: { name: true } } },
        },
      },
    });

    // 2) cap 초과 시 사전 필터 (jamo top + v1 candidates + cross hit + 같은 artist)
    let scoped = allSongs;
    if (allSongs.length > SongMatcherV2Service.LLM_CHANNEL_SONGS_MAX) {
      const keepIds = new Set<number>();
      jamoTop.forEach((j) => keepIds.add(j.songId));
      v1Candidates?.forEach((c) => keepIds.add(c.id));
      if (crossHit) keepIds.add(crossHit.songId);

      // 같은 artist의 곡 모두 포함
      if (artistQuery) {
        const artistMatches = allSongs.filter((s) =>
          s.artist.name.toLowerCase().includes(artistQuery.toLowerCase()),
        );
        artistMatches.forEach((s) => keepIds.add(s.id));
      }

      scoped = allSongs.filter((s) => keepIds.has(s.id));
      // 빈 경우 fallback: 무조건 cap 만큼 자름 (id 오름차순)
      if (scoped.length === 0) {
        scoped = allSongs.slice(0, SongMatcherV2Service.LLM_CHANNEL_SONGS_MAX);
      }
    }

    // 3) 가사 부분일치 hit (채널 노래책 한정, payload에서 substring 추출)
    //    rawMessage가 아니라 prefix 제거된 payload를 넘겨야 가사와 LIKE 매칭됨
    const lyricsHits = await this.findLyricsHits(channelId, payloadOnly, scoped);

    // 4) cross-streamer alias 풀 (입력 normTitle 기준, channelId 무관)
    const crossAliases = await this.findCrossAliases(titleQuery);

    return {
      channelId,
      rawMessage,
      channelSongs: scoped.map((s) => ({
        songId: s.id,
        title: s.title,
        artist: s.artist.name,
        categories: s.songCategories.length
          ? s.songCategories.map((sc) => sc.category.name)
          : undefined,
      })),
      fuzzyHints: jamoTop.length
        ? jamoTop.map((j) => ({
            songId: j.songId,
            score: Number(j.score.toFixed(3)),
            via: 'jamo',
          }))
        : undefined,
      crossAliases: crossAliases.length ? crossAliases : undefined,
      lyricsHits: lyricsHits.length ? lyricsHits : undefined,
    };
  }

  /**
   * 가사 부분일치 hit. **반드시 GlobalSongLyrics.body (Musixmatch 가사)를 사용**.
   * Song.lyricsText는 스트리머 비공개 메모이므로 매칭 신호로 보면 안 됨.
   *
   * 채널 노래책의 Song → globalSongId → GlobalSongLyrics.body LIKE 검색.
   * GlobalSong에 매핑되지 않았거나 lyrics row가 없는 곡은 자연스럽게 hit X.
   *
   * @param payload tier-classifier가 prefix(`!신청 ` 등) 제거한 본문.
   *   raw message를 넘기면 `!신청` substring이 가사에 없어 0 hit이 되니 주의.
   */
  private async findLyricsHits(
    channelId: number,
    payload: string,
    songsInScope: Array<{ id: number; globalSongId: number | null }>,
  ): Promise<LlmMatcherContext['lyricsHits']> {
    const trimmed = payload.trim();
    const candidates: string[] = [];
    if (trimmed.length >= 6 && trimmed.length <= 60) {
      candidates.push(trimmed);
    }
    if (trimmed.length > 60) {
      candidates.push(trimmed.slice(0, 30));
    }
    const tokens = trimmed.split(/\s+/).filter((t) => t.length >= 4);
    for (const t of tokens.slice(0, 3)) {
      candidates.push(t);
    }
    if (candidates.length === 0) return [];

    const globalSongIds = songsInScope
      .map((s) => s.globalSongId)
      .filter((g): g is number => g !== null);
    if (globalSongIds.length === 0) return [];

    const orClauses = candidates.map((c) => ({ body: { contains: c } }));
    const lyricsRows = await this.prisma.globalSongLyrics.findMany({
      where: {
        globalSongId: { in: globalSongIds },
        OR: orClauses,
      },
      select: { globalSongId: true, body: true },
      take: 10,
    });
    if (lyricsRows.length === 0) return [];

    // globalSongId → 채널 노래책 Song으로 역매핑
    const hitGsIds = lyricsRows.map((r) => r.globalSongId);
    const songs = await this.prisma.song.findMany({
      where: { channelId, globalSongId: { in: hitGsIds } },
      include: { artist: true },
    });
    const songByGs = new Map(songs.map((s) => [s.globalSongId!, s]));

    return lyricsRows
      .map((r) => {
        const song = songByGs.get(r.globalSongId);
        if (!song) return null;
        const body = r.body ?? '';
        const matched = candidates.find((c) => body.includes(c));
        const idx = matched ? body.indexOf(matched) : 0;
        const start = Math.max(0, idx - 20);
        const snippet = body.slice(start, start + 80);
        return {
          songId: song.id,
          title: song.title,
          artist: song.artist.name,
          snippet,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }

  private async findCrossAliases(
    titleQuery: string,
  ): Promise<LlmMatcherContext['crossAliases']> {
    const norm = normalizeText(titleQuery);
    if (!norm || norm.length < 2) return [];

    // GlobalSongAlias.normAliasTitle 또는 GlobalSong.normTitle에 입력 substring
    const aliases = await this.prisma.globalSongAlias.findMany({
      where: { normAliasTitle: { contains: norm.slice(0, 20) } },
      select: {
        aliasTitle: true,
        globalSong: {
          select: {
            id: true,
            title: true,
            globalArtist: { select: { canonicalName: true } },
            aliases: { select: { aliasTitle: true } },
          },
        },
      },
      take: 10,
    });

    const dedup = new Map<number, NonNullable<LlmMatcherContext['crossAliases']>[number]>();
    for (const a of aliases) {
      const gs = a.globalSong;
      if (!gs) continue;
      if (dedup.has(gs.id)) continue;
      dedup.set(gs.id, {
        globalSongId: gs.id,
        canonicalTitle: gs.title,
        artist: gs.globalArtist.canonicalName,
        aliases: gs.aliases.map((al) => al.aliasTitle).slice(0, 8),
      });
    }
    return Array.from(dedup.values());
  }

  private finalize(
    tier: MatchTier,
    reason: SongMatchResultV2['reason'],
    threshold: number,
    song: MatchedSong,
    confidence: number,
    trace: MatchStepTrace[],
    candidates?: MatchedSong[],
  ): SongMatchResultV2 {
    return {
      matched: true,
      song,
      candidates,
      tier,
      reason,
      confidence,
      threshold,
      autoAcceptable: confidence >= threshold,
      trace,
    };
  }
}

function tierBase(tier: MatchTier): number {
  const base: Record<MatchTier, number> = {
    tier1: 0.85,
    tier2a: 0.85,
    tier2b: 0.85,
    tier3: 0.95,
    ignored: 0,
  };
  return base[tier];
}
