import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  GlobalSongMatcherStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  MusixmatchClient,
  MusixmatchApiError,
  MusixmatchNotFoundError,
  MusixmatchQuotaExceededError,
} from '../musixmatch/musixmatch.client';
import { MusixmatchLyricsService } from '../musixmatch/musixmatch-lyrics.service';
import { MusixmatchMatcherService } from '../musixmatch/musixmatch-matcher.service';
import { MusixmatchQuotaService } from '../musixmatch/musixmatch-quota.service';
import { MusixmatchRedisService } from '../musixmatch/musixmatch-redis.service';
import { MxmTrack } from '../musixmatch/dto/musixmatch.dto';
import {
  AdminMusixmatchInfoDto,
  AdminMusixmatchManualNeededItemDto,
  AdminMusixmatchManualNeededQueryDto,
  AdminMusixmatchManualNeededResponseDto,
  AdminMusixmatchMatchResponseDto,
  AdminMusixmatchSearchCandidateDto,
  AdminMusixmatchSearchResponseDto,
  AdminMusixmatchUsageDto,
} from './dto/admin-musixmatch.dto';

/**
 * Admin operations for Musixmatch matching (Phase A1c).
 *
 * Note: this service intentionally does NOT replicate the matcher's
 * commontrack auto-dedup logic. Manual matches via admin go through a
 * thinner path: store snapshot + fetch lyrics. Operators can re-trigger
 * the full matcher via the "재매칭" button if they need dedup detection.
 */
@Injectable()
export class AdminMusixmatchService {
  private readonly logger = new Logger(AdminMusixmatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: MusixmatchClient,
    private readonly lyrics: MusixmatchLyricsService,
    private readonly matcher: MusixmatchMatcherService,
    private readonly quota: MusixmatchQuotaService,
    private readonly redis: MusixmatchRedisService,
  ) {}

  async getInfo(globalSongId: number): Promise<AdminMusixmatchInfoDto> {
    const gs = await this.prisma.globalSong.findUnique({
      where: { id: globalSongId },
      include: { lyrics: true, globalArtist: true },
    });
    if (!gs)
      throw new NotFoundException(`globalSong ${globalSongId} not found`);

    return {
      songTitle: gs.title,
      artistName: gs.globalArtist.canonicalName,
      matcherStatus: gs.matcherStatus,
      matcherAttempts: gs.matcherAttempts,
      matcherLastAt: gs.matcherLastAt?.toISOString() ?? null,
      matcherConfidence: gs.matcherConfidence,
      matcherSource: gs.matcherSource,
      mxmCommontrackId: gs.mxmCommontrackId,
      mxmTrackId: gs.mxmTrackId,
      primaryIsrc: gs.primaryIsrc,
      iswc: gs.iswc,
      spotifyTrackId: gs.spotifyTrackId,
      mxmHasLyrics: gs.mxmHasLyrics,
      mxmHasSubtitles: gs.mxmHasSubtitles,
      mxmHasRichsync: gs.mxmHasRichsync,
      mxmInstrumental: gs.mxmInstrumental,
      mxmShareUrl: gs.mxmShareUrl,
      mxmAlbumId: gs.mxmAlbumId,
      mxmAlbumName: gs.mxmAlbumName,
      mxmAlbumArtUrl: gs.mxmAlbumArtUrl,
      mxmTrackLengthSec: gs.mxmTrackLengthSec,
      mxmRating: gs.mxmRating,
      mxmExplicit: gs.mxmExplicit,
      mxmGenres: (gs.mxmGenresJson ?? null) as Array<{
        id?: number;
        name?: string;
        vanity?: string;
      }> | null,
      lyrics: gs.lyrics
        ? {
            externalId: gs.lyrics.externalId,
            // Admin is internal — send the full body, not a 200-char snippet.
            // Frontend `pre` block scrolls naturally for long content.
            bodyPreview: gs.lyrics.body,
            bodyLength: gs.lyrics.body.length,
            language: gs.lyrics.language,
            hasSubtitle: gs.lyrics.hasSubtitle,
            hasRichsync: gs.lyrics.hasRichsync,
            restrictedKr: gs.lyrics.restrictedKr,
            fetchedAt: gs.lyrics.fetchedAt.toISOString(),
            expiresAt: gs.lyrics.expiresAt?.toISOString() ?? null,
            bodyKoPronPreview: gs.lyrics.bodyKoPron ?? null,
            bodyKoPronLength: gs.lyrics.bodyKoPron?.length ?? 0,
            bodyKoPronAt: gs.lyrics.bodyKoPronAt?.toISOString() ?? null,
            bodyTranslationPreview: gs.lyrics.bodyTranslation ?? null,
            bodyTranslationLength: gs.lyrics.bodyTranslation?.length ?? 0,
            bodyTranslationLanguage: gs.lyrics.bodyTranslationLanguage ?? null,
            bodyTranslationAt: gs.lyrics.bodyTranslationAt?.toISOString() ?? null,
          }
        : null,
    };
  }

  async search(
    globalSongId: number,
    q?: string,
    artist?: string,
    pageSize?: number,
  ): Promise<AdminMusixmatchSearchResponseDto> {
    const gs = await this.prisma.globalSong.findUnique({
      where: { id: globalSongId },
      include: { globalArtist: true },
    });
    if (!gs)
      throw new NotFoundException(`globalSong ${globalSongId} not found`);

    const trackQ = (q ?? '').trim();
    const artistQ = (artist ?? '').trim();
    const size = pageSize && pageSize > 0 ? Math.min(pageSize, 100) : 25;

    // If admin gave no input at all, fall back to GS values so the default
    // "검색" click without typing still shows useful candidates.
    const effTrack =
      trackQ.length > 0 || artistQ.length > 0 ? trackQ : gs.title;
    const effArtist =
      trackQ.length > 0 || artistQ.length > 0
        ? artistQ
        : gs.globalArtist.canonicalName;

    let result;
    try {
      result = await this.client.trackSearch(
        {
          ...(effTrack ? { q_track: effTrack } : {}),
          ...(effArtist ? { q_artist: effArtist } : {}),
          page_size: size,
        },
        { mode: 'normal' },
      );
    } catch (err) {
      if (err instanceof MusixmatchNotFoundError) {
        return { candidates: [] };
      }
      throw err;
    }

    const tracks: MxmTrack[] =
      ('track_list' in result ? result.track_list.map((t) => t.track) : []) ??
      [];

    return {
      candidates: tracks.map<AdminMusixmatchSearchCandidateDto>((t) => ({
        trackId: t.track_id,
        commontrackId: t.commontrack_id,
        trackName: t.track_name,
        artistName: t.artist_name,
        albumName: t.album_name ?? null,
        isrc: t.track_isrc ?? null,
        spotifyTrackId: t.track_spotify_id ?? null,
        hasLyrics: t.has_lyrics === 1,
        hasSubtitle: t.has_subtitles === 1,
        hasRichsync: t.has_richsync === 1,
        instrumental: t.instrumental === 1,
        trackShareUrl: t.track_share_url ?? null,
      })),
    };
  }

  /**
   * Promote a MANUAL_NEEDED match to MATCHED. The matcher already saved
   * its suggested mxmTrackId on the GS row when it dropped to
   * MANUAL_NEEDED — admin verifies the suggestion is correct and clicks
   * "매칭 확정", which reuses match() with the same trackId.
   */
  async confirmManualMatch(
    globalSongId: number,
  ): Promise<AdminMusixmatchMatchResponseDto> {
    const gs = await this.prisma.globalSong.findUnique({
      where: { id: globalSongId },
      select: { id: true, matcherStatus: true, mxmTrackId: true },
    });
    if (!gs)
      throw new NotFoundException(`globalSong ${globalSongId} not found`);
    if (gs.matcherStatus !== 'MANUAL_NEEDED') {
      throw new BadRequestException(
        `globalSong ${globalSongId} is not MANUAL_NEEDED (current=${gs.matcherStatus})`,
      );
    }
    if (!gs.mxmTrackId) {
      throw new BadRequestException(
        `globalSong ${globalSongId} has no mxmTrackId suggestion — use manual search instead`,
      );
    }
    // Operator confirmed → MANUAL source (final decision is human, even if
    // the suggestion originally came from ALTERNATE_LLM).
    return this.match(globalSongId, gs.mxmTrackId);
  }

  /**
   * Apply a Musixmatch match from the admin manual-matching surface.
   *
   * Idempotency: when the row is already in a MATCHED_* status with the
   * same `mxmTrackId`, returns early without refetching the track or
   * lyrics. Prevents the high-cost `track.lyrics.get` quota bucket from
   * being burned on retries.
   */
  async match(
    globalSongId: number,
    trackId: number,
  ): Promise<AdminMusixmatchMatchResponseDto> {
    const gs = await this.prisma.globalSong.findUnique({
      where: { id: globalSongId },
    });
    if (!gs)
      throw new NotFoundException(`globalSong ${globalSongId} not found`);

    if (
      gs.matcherStatus.startsWith('MATCHED') &&
      gs.mxmTrackId === trackId
    ) {
      this.logger.log(
        `match() idempotent skip — globalSongId=${globalSongId} already ${gs.matcherStatus} with trackId=${trackId}`,
      );
      return {
        globalSongId,
        matcherStatus: gs.matcherStatus,
      };
    }

    const trackResp = await this.client.trackGet(
      { track_id: trackId },
      { mode: 'normal' },
    );
    const track = trackResp?.track;
    if (!track) {
      throw new BadRequestException(`mxm trackId ${trackId} not found`);
    }

    const nextStatus =
      track.instrumental === 1
        ? 'MATCHED_INSTRUMENTAL'
        : await this.fetchLyricsStatusForConfirmedMatch(
            globalSongId,
            track,
          );

    // Reuse the canonical write path so Phase A1f metadata (album, length,
    // genres, rating, explicit) ends up identical to the auto-matcher run.
    await this.matcher.storeMatchSnapshot(
      globalSongId,
      track,
      'HIGH',
      nextStatus,
      'MANUAL',
    );

    await this.redis.invalidateLyrics(globalSongId);
    await this.redis.clearNegative(globalSongId);

    return { globalSongId, matcherStatus: nextStatus };
  }

  private async fetchLyricsStatusForConfirmedMatch(
    globalSongId: number,
    track: MxmTrack,
  ): Promise<GlobalSongMatcherStatus> {
    try {
      const outcome = await this.lyrics.fetchAndStore(
        globalSongId,
        track.track_id,
        track.has_subtitles === 1,
        'normal',
      );
      switch (outcome) {
        case 'STORED':
          return 'MATCHED';
        case 'NO_LYRICS':
          return 'MATCHED_NO_LYRICS';
        case 'RESTRICTED_KR':
          return 'MATCHED_RESTRICTED';
        case 'INSTRUMENTAL':
          return 'MATCHED_INSTRUMENTAL';
      }
    } catch (err) {
      if (
        err instanceof MusixmatchApiError ||
        err instanceof MusixmatchQuotaExceededError
      ) {
        this.logger.warn(
          `lyrics fetch failed during confirmed match; storing match metadata only globalSongId=${globalSongId} trackId=${track.track_id}: ${err.message}`,
        );
        return 'MATCHED';
      }
      throw err;
    }
  }

  /**
   * Clear the matcher state (set back to PENDING) and delete lyrics row.
   * Use when admin determines a previous match was wrong.
   */
  async clear(globalSongId: number): Promise<void> {
    const gs = await this.prisma.globalSong.findUnique({
      where: { id: globalSongId },
    });
    if (!gs)
      throw new NotFoundException(`globalSong ${globalSongId} not found`);

    await this.prisma.$transaction(async (tx) => {
      await tx.globalSongLyrics.deleteMany({
        where: { globalSongId },
      });
      await tx.globalSong.update({
        where: { id: globalSongId },
        data: {
          mxmCommontrackId: null,
          mxmTrackId: null,
          primaryIsrc: null,
          iswc: null,
          spotifyTrackId: null,
          mxmHasLyrics: false,
          mxmHasSubtitles: false,
          mxmHasRichsync: false,
          mxmInstrumental: false,
          mxmShareUrl: null,
          mxmAlbumId: null,
          mxmAlbumName: null,
          mxmAlbumArtUrl: null,
          mxmTrackLengthSec: null,
          mxmRating: null,
          mxmExplicit: null,
          mxmGenresJson: Prisma.DbNull,
          matcherStatus: 'PENDING',
          matcherConfidence: null,
          matcherSource: null,
          matcherLastAt: new Date(),
        },
      });
    });

    await this.redis.invalidateLyrics(globalSongId);
    await this.redis.clearNegative(globalSongId);

  }

  /**
   * Reset matcher state to PENDING and trigger automatic matching pipeline
   * (primary matcher.track.get + Serper/LLM alternate fallback if enabled).
   *
   * Use case: testing the auto-matching flow on a song that previously
   * landed in UNMATCHED, MANUAL_NEEDED, or any other terminal state.
   * Resets matcherAttempts to 0 so MAX_ATTEMPTS guard doesn't block.
   *
   * Returns the new status the matcher landed on.
   */
  async retryAuto(globalSongId: number): Promise<{
    globalSongId: number;
    matcherStatus: GlobalSongMatcherStatus | 'SKIPPED';
  }> {
    const gs = await this.prisma.globalSong.findUnique({
      where: { id: globalSongId },
    });
    if (!gs)
      throw new NotFoundException(`globalSong ${globalSongId} not found`);

    // Reset state so matcher will re-enter and not skip on terminal/attempts.
    // Negative cache also cleared so Serper+LLM gets a fresh shot.
    await this.prisma.$transaction(async (tx) => {
      await tx.globalSongLyrics.deleteMany({
        where: { globalSongId },
      });
      await tx.globalSong.update({
        where: { id: globalSongId },
        data: {
          mxmCommontrackId: null,
          mxmTrackId: null,
          primaryIsrc: null,
          iswc: null,
          spotifyTrackId: null,
          mxmHasLyrics: false,
          mxmHasSubtitles: false,
          mxmHasRichsync: false,
          mxmInstrumental: false,
          mxmShareUrl: null,
          mxmAlbumId: null,
          mxmAlbumName: null,
          mxmAlbumArtUrl: null,
          mxmTrackLengthSec: null,
          mxmRating: null,
          mxmExplicit: null,
          mxmGenresJson: Prisma.DbNull,
          matcherStatus: 'PENDING',
          matcherConfidence: null,
          matcherSource: null,
          matcherAttempts: 0,
          matcherLastAt: null,
        },
      });
    });
    await this.redis.invalidateLyrics(globalSongId);
    await this.redis.clearNegative(globalSongId);

    // Run the matcher synchronously in 'normal' mode and return the result.
    const result = await this.matcher.maybeMatch(globalSongId, 'normal');
    return { globalSongId, matcherStatus: result };
  }

  /**
   * Manually override the lyrics language tag. mxm's auto-detection
   * misclassifies romanized Korean/Japanese frequently and the
   * inference helper only catches the most common minor-Latin cases —
   * this endpoint lets admins fix anything else (e.g. a song mxm
   * labeled `en` that's actually Korean with English title).
   *
   * Pass null to clear the language tag.
   */
  async updateLyricsLanguage(
    globalSongId: number,
    language: string | null,
  ): Promise<{ globalSongId: number; language: string | null }> {
    const lyrics = await this.prisma.globalSongLyrics.findUnique({
      where: { globalSongId },
      select: { globalSongId: true },
    });
    if (!lyrics) {
      throw new NotFoundException(
        `globalSong ${globalSongId} has no lyrics row to update`,
      );
    }
    const normalized = language?.trim().toLowerCase() || null;
    await this.prisma.globalSongLyrics.update({
      where: { globalSongId },
      data: { language: normalized },
    });
    await this.redis.invalidateLyrics(globalSongId);
    return { globalSongId, language: normalized };
  }

  /**
   * Re-fetch lyrics from mxm using the existing track id. Useful when
   * mxm-side lyrics were updated, or when the previous fetch returned
   * NO_LYRICS but the song was MATCHED via metadata anyway. The matcher
   * status is rolled forward to reflect the new outcome — e.g. a row
   * stuck on MATCHED_NO_LYRICS that now retrieves a body becomes MATCHED.
   */
  async refetchLyrics(
    globalSongId: number,
  ): Promise<{ globalSongId: number; matcherStatus: GlobalSongMatcherStatus }> {
    const gs = await this.prisma.globalSong.findUnique({
      where: { id: globalSongId },
    });
    if (!gs)
      throw new NotFoundException(`globalSong ${globalSongId} not found`);
    if (!gs.mxmTrackId) {
      throw new BadRequestException(
        `globalSong ${globalSongId} has no mxmTrackId — match first`,
      );
    }

    const outcome = await this.lyrics.fetchAndStore(
      globalSongId,
      gs.mxmTrackId,
      gs.mxmHasSubtitles,
      'normal',
    );

    let nextStatus: GlobalSongMatcherStatus;
    switch (outcome) {
      case 'STORED':
        nextStatus = 'MATCHED';
        break;
      case 'NO_LYRICS':
        nextStatus = 'MATCHED_NO_LYRICS';
        break;
      case 'RESTRICTED_KR':
        nextStatus = 'MATCHED_RESTRICTED';
        break;
      case 'INSTRUMENTAL':
        nextStatus = 'MATCHED_INSTRUMENTAL';
        break;
    }

    if (gs.matcherStatus !== nextStatus) {
      await this.prisma.globalSong.update({
        where: { id: globalSongId },
        data: {
          matcherStatus: nextStatus,
          matcherLastAt: new Date(),
        },
      });
    }

    await this.redis.invalidateLyrics(globalSongId);
    return { globalSongId, matcherStatus: nextStatus };
  }

  async getUsage(): Promise<AdminMusixmatchUsageDto> {
    const today = await this.quota.getTodayUsage();

    const last30 = await this.prisma.musixmatchUsageLog.findMany({
      orderBy: { date: 'desc' },
      take: 30,
    });

    return {
      today: {
        date: today.date.toISOString().slice(0, 10),
        calls: today.total,
        callsLyrics: today.lyrics,
        callsTranslations: today.translations,
        callsAnalysis: today.analysis,
        callsFingerprint: today.fingerprint,
        errors: today.errors,
        rateLimitHits: today.rateLimitHits,
      },
      limits: {
        total: today.limits.total,
        lyrics: today.limits.lyrics,
        translations: today.limits.translations,
        lyricsAnalysis: today.limits.lyricsAnalysis,
        lyricsFingerprint: today.limits.lyricsFingerprint,
      },
      history: last30.reverse().map((row) => ({
        date: row.date.toISOString().slice(0, 10),
        calls: row.calls,
        callsLyrics: row.callsLyrics,
        errors: row.errors,
        rateLimitHits: row.rateLimitHits,
      })),
    };
  }

  async manualNeededList(
    query: AdminMusixmatchManualNeededQueryDto,
  ): Promise<AdminMusixmatchManualNeededResponseDto> {
    const limit = query.limit ?? 20;
    const cursor = query.cursor;

    const baseWhere: Prisma.GlobalSongWhereInput = {
      matcherStatus: { in: ['MANUAL_NEEDED', 'MATCHED_DUP_OF_OTHER'] },
    };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.globalSong.count({ where: baseWhere }),
      this.prisma.globalSong.findMany({
        where: {
          ...baseWhere,
          ...(cursor ? { id: { lt: cursor } } : {}),
        },
        include: { globalArtist: true },
        orderBy: [{ id: 'desc' }],
        take: limit + 1,
      }),
    ]);

    const hasMore = rows.length > limit;
    const items = (
      hasMore ? rows.slice(0, limit) : rows
    ).map<AdminMusixmatchManualNeededItemDto>((r) => ({
      globalSongId: r.id,
      title: r.title,
      artistName: r.globalArtist.canonicalName,
      channelCount: r.channelCount,
      matcherAttempts: r.matcherAttempts,
      matcherLastAt: r.matcherLastAt?.toISOString() ?? null,
      suggested: r.mxmTrackId
        ? {
            trackId: r.mxmTrackId,
            commontrackId: r.mxmCommontrackId,
            trackName: null, // Suggestion details require a re-fetch — UI can call /search if needed
            artistName: null,
            isrc: r.primaryIsrc,
          }
        : null,
    }));

    return {
      items,
      nextCursor: hasMore ? items[items.length - 1].globalSongId : null,
      total,
    };
  }
}
