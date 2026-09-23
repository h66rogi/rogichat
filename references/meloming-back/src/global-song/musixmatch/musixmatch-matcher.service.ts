import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GlobalSongMatcherStatus,
  MatcherConfidence,
  MatcherSource,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EnvironmentVariables } from '../../config/env.config';
import { normalizeArtist } from '../normalizer/artist-normalizer';
import {
  MusixmatchCircuitOpenError,
  MusixmatchClient,
  MusixmatchNotFoundError,
} from './musixmatch.client';
import { MusixmatchRedisService } from './musixmatch-redis.service';
import { MusixmatchLyricsService } from './musixmatch-lyrics.service';
import { MusixmatchAlternateSearchService } from './musixmatch-alternate-search.service';
import { MxmTrack } from './dto/musixmatch.dto';
import { MusixmatchQuotaExceededError } from './musixmatch-quota.service';

/**
 * Match a GlobalSong to a Musixmatch track and trigger commontrack-based
 * auto-dedup (spec Section 4.2 + 4.4).
 *
 * Flow:
 *   1. Skip if already MATCHED / IGNORED / UNMATCHED (terminal states for retry)
 *   2. Acquire per-globalsong lock
 *   3. Try ISRC lookup if `primaryIsrc` already known (HIGH confidence)
 *   4. Otherwise call `matcher.track.get` with q_track + q_artist
 *   5. Validate artist (canonical name match OR alias match) → confidence
 *   6. Acquire commontrack lock; check for sibling GlobalSongs sharing the
 *      same commontrack_id. Different status outcomes:
 *        - none → MATCHED, normal flow
 *        - sibling exists, both HIGH + 0 channel overlap + no version suffix
 *          → MATCHED + queue auto-merge candidate (mark this as
 *            MATCHED_DUP_OF_OTHER if winner determined deterministically)
 *        - sibling exists, conditions not met → MATCHED_DUP_OF_OTHER (manual)
 *   7. Trigger lyrics fetch when status is MATCHED (or MATCHED_DUP_OF_OTHER)
 *
 * MATCHED status invariant: matcher succeeded AND lyrics body was stored.
 * MATCHED_NO_LYRICS / MATCHED_INSTRUMENTAL / MATCHED_RESTRICTED are also
 * "matched" but indicate why no body is present.
 */
@Injectable()
export class MusixmatchMatcherService {
  private readonly logger = new Logger(MusixmatchMatcherService.name);
  private readonly autoDedupEnabled: boolean;
  private static readonly MAX_ATTEMPTS = 5;

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: MusixmatchClient,
    private readonly redis: MusixmatchRedisService,
    private readonly lyrics: MusixmatchLyricsService,
    private readonly alternateSearch: MusixmatchAlternateSearchService,
    configService: ConfigService<EnvironmentVariables>,
  ) {
    this.autoDedupEnabled =
      configService.get('MUSIXMATCH_AUTO_DEDUP_ENABLED') ?? false;
  }

  /**
   * Entry point invoked by event listener / backfill.
   *
   * Returns the final matcherStatus for telemetry. Never throws — failure
   * isolation is the caller's contract too, but defense-in-depth here.
   */
  async maybeMatch(
    globalSongId: number,
    mode: 'normal' | 'backfill',
  ): Promise<GlobalSongMatcherStatus | 'SKIPPED'> {
    try {
      const gs = await this.prisma.globalSong.findUnique({
        where: { id: globalSongId },
        include: { globalArtist: true },
      });
      if (!gs) return 'SKIPPED';
      if (this.isTerminalStatus(gs.matcherStatus)) return 'SKIPPED';
      if (gs.matcherAttempts >= MusixmatchMatcherService.MAX_ATTEMPTS) {
        // Persistent failure cap (spec Section 4.1) — stop hammering mxm
        await this.prisma.globalSong.update({
          where: { id: gs.id },
          data: { matcherStatus: 'ERROR' },
        });
        return 'ERROR';
      }

      // Negative cache fast-path
      if (await this.redis.hasNegative(gs.id)) {
        return 'SKIPPED';
      }

      // Per-song lock
      const lockKey = this.redis.songLockKey(gs.id);
      const token = await this.redis.acquireLock(lockKey);
      if (!token) {
        // Another worker is already matching this song.
        return 'SKIPPED';
      }

      try {
        return await this.runMatch(gs, mode);
      } finally {
        await this.redis.releaseLock(lockKey, token);
      }
    } catch (error) {
      // Surface quota/breaker errors so callers (e.g. backfill cron) can
      // halt the entire run instead of burning attempts on every song.
      // Other errors are logged + swallowed (per-song failure isolation).
      if (
        error instanceof MusixmatchQuotaExceededError ||
        error instanceof MusixmatchCircuitOpenError
      ) {
        throw error;
      }
      this.logger.error(
        `maybeMatch failed for globalSongId=${globalSongId}: ${
          error instanceof Error ? error.message : error
        }`,
      );
      return 'SKIPPED';
    }
  }

  private isTerminalStatus(s: GlobalSongMatcherStatus): boolean {
    return (
      s === 'MATCHED' ||
      s === 'MATCHED_NO_LYRICS' ||
      s === 'MATCHED_INSTRUMENTAL' ||
      s === 'MATCHED_RESTRICTED' ||
      s === 'MATCHED_DUP_OF_OTHER' ||
      s === 'UNMATCHED' ||
      s === 'IGNORED'
    );
  }

  private async runMatch(
    gs: Prisma.GlobalSongGetPayload<{ include: { globalArtist: true } }>,
    mode: 'normal' | 'backfill',
  ): Promise<GlobalSongMatcherStatus> {
    let mxmTrack: MxmTrack | null = null;
    let confidence: MatcherConfidence = 'MEDIUM';
    // Tracks which discovery path produced mxmTrack — propagated to the
    // matcher_source column so we can distinguish primary auto-match from
    // the Serper+LLM alternate fallback in audits.
    let discoveredVia: MatcherSource = 'PRIMARY';

    // Step 1: ISRC fast path (HIGH confidence)
    if (gs.primaryIsrc) {
      try {
        const result = await this.client.trackGet(
          { track_isrc: gs.primaryIsrc },
          { mode },
        );
        if (result?.track) {
          mxmTrack = result.track;
          confidence = 'HIGH';
        }
      } catch (err) {
        if (!(err instanceof MusixmatchNotFoundError)) throw err;
      }
    }

    // Step 2: matcher.track.get fuzzy (f_has_lyrics=1 to avoid wasting quota
    // on tracks that have no lyrics body to fetch in step 6)
    if (!mxmTrack) {
      try {
        const result = await this.client.matcherTrackGet(
          {
            q_track: gs.title,
            q_artist: gs.globalArtist.canonicalName,
            f_has_lyrics: 1,
          },
          { mode },
        );
        mxmTrack = result?.track ?? null;
      } catch (err) {
        if (err instanceof MusixmatchNotFoundError) {
          mxmTrack = null;
        } else if (
          err instanceof MusixmatchQuotaExceededError ||
          err instanceof MusixmatchCircuitOpenError
        ) {
          // Don't mark UNMATCHED on quota/breaker — leave PENDING for next pass
          throw err;
        } else {
          throw err;
        }
      }
    }

    // Step 2b: Serper + LLM alternate search fallback (Phase A1d).
    // Only kicks in when primary matcher missed AND title/artist contain
    // non-Latin chars (Korean/Japanese/etc). Pure-Latin titles are
    // unlikely to benefit and would waste Serper+LLM calls.
    if (
      !mxmTrack &&
      this.alternateSearch.shouldAttempt(
        gs.title,
        gs.globalArtist.canonicalName,
      )
    ) {
      try {
        const alt = await this.alternateSearch.findAlternate(
          gs.title,
          gs.globalArtist.canonicalName,
          mode,
        );
        if (alt.track) {
          mxmTrack = alt.track;
          discoveredVia = 'ALTERNATE_LLM';
          // Confidence stays MEDIUM — went through fuzzy candidate. Artist
          // validation step below will downgrade to LOW (→ MANUAL_NEEDED)
          // if the artist isn't recognized via aliases.
        }
      } catch (err) {
        // Quota/breaker — leave PENDING for next pass instead of UNMATCHED
        if (
          err instanceof MusixmatchQuotaExceededError ||
          err instanceof MusixmatchCircuitOpenError
        ) {
          throw err;
        }
        this.logger.warn(
          `alternate search failed for globalSongId=${gs.id}: ${
            err instanceof Error ? err.message : err
          }`,
        );
      }
    }

    if (!mxmTrack) {
      await this.markUnmatched(gs.id);
      return 'UNMATCHED';
    }

    // Step 3: artist validation
    confidence = await this.assessConfidence(gs, mxmTrack, confidence);
    if (confidence === 'LOW') {
      await this.markManualNeeded(
        gs.id,
        mxmTrack,
        confidence,
        'artist mismatch',
      );
      return 'MANUAL_NEEDED';
    }

    // Step 4: instrumental short-circuit BEFORE storing snapshot — we still
    // record the mxm metadata but don't fetch lyrics.
    if (mxmTrack.instrumental === 1) {
      await this.storeMatchSnapshot(
        gs.id,
        mxmTrack,
        confidence,
        'MATCHED_INSTRUMENTAL',
        discoveredVia,
      );
      return 'MATCHED_INSTRUMENTAL';
    }

    // Step 5: fetch lyrics FIRST (deferred snapshot until we know lyrics
    // outcome). Failure here leaves status=PENDING and matcherAttempts++
    // so retries get capped via MAX_ATTEMPTS guard at top of maybeMatch.
    let lyricsOutcome: Awaited<
      ReturnType<MusixmatchLyricsService['fetchAndStore']>
    >;
    try {
      lyricsOutcome = await this.lyrics.fetchAndStore(
        gs.id,
        mxmTrack.track_id,
        mxmTrack.has_subtitles === 1,
        mode,
      );
    } catch (err) {
      // Bump attempts so the MAX_ATTEMPTS cap eventually fires
      await this.prisma.globalSong.update({
        where: { id: gs.id },
        data: {
          matcherAttempts: { increment: 1 },
          matcherLastAt: new Date(),
        },
      });
      throw err;
    }

    let nextStatus: GlobalSongMatcherStatus;
    switch (lyricsOutcome) {
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

    // Step 6: commontrack lock + dedup detection + final snapshot — all in
    // ONE critical section so two concurrent matchers cannot both decide
    // "no sibling" and both write MATCHED for the same commontrack.
    const ctLockKey = this.redis.commontrackLockKey(mxmTrack.commontrack_id);
    const ctToken = await this.redis.acquireLock(ctLockKey);
    let finalStatus: GlobalSongMatcherStatus = nextStatus;
    try {
      if (ctToken) {
        const sibling = await this.findSiblingByCommontrack(
          gs.id,
          mxmTrack.commontrack_id,
        );
        if (sibling) {
          finalStatus = 'MATCHED_DUP_OF_OTHER';
          this.logger.log(
            `commontrack=${mxmTrack.commontrack_id} dup detected: gs=${gs.id} sibling=${sibling.id}`,
          );
        }
      }
      // If lock acquisition failed (Redis down or contention), fall back to
      // best-effort: mark MATCHED. Cleanup happens at next pass via the
      // eventual sibling matcher run; admin queue still catches it.
      await this.storeMatchSnapshot(
        gs.id,
        mxmTrack,
        confidence,
        finalStatus,
        discoveredVia,
      );
    } finally {
      if (ctToken) {
        await this.redis.releaseLock(ctLockKey, ctToken);
      }
    }

    return finalStatus;
  }

  private async findSiblingByCommontrack(
    selfId: number,
    commontrackId: number,
  ): Promise<{ id: number } | null> {
    return this.prisma.globalSong.findFirst({
      where: {
        mxmCommontrackId: commontrackId,
        id: { not: selfId },
        matcherStatus: {
          in: [
            'MATCHED',
            'MATCHED_DUP_OF_OTHER',
            'MATCHED_NO_LYRICS',
            'MATCHED_INSTRUMENTAL',
            'MATCHED_RESTRICTED',
          ],
        },
      },
      orderBy: [{ channelCount: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
  }

  private async assessConfidence(
    gs: Prisma.GlobalSongGetPayload<{ include: { globalArtist: true } }>,
    track: MxmTrack,
    base: MatcherConfidence,
  ): Promise<MatcherConfidence> {
    if (base === 'HIGH') return 'HIGH';
    let mxmArtistNorm: string;
    try {
      mxmArtistNorm = normalizeArtist(track.artist_name).normKey;
    } catch {
      return 'LOW';
    }
    let sourceArtistNorm: string;
    try {
      sourceArtistNorm = normalizeArtist(gs.globalArtist.canonicalName).normKey;
    } catch {
      return 'LOW';
    }
    if (mxmArtistNorm === sourceArtistNorm) return 'MEDIUM';
    // Check artist aliases — same canonical, different surface form
    const aliasHit = await this.prisma.globalArtistAlias.findFirst({
      where: {
        globalArtistId: gs.globalArtistId,
        normAlias: mxmArtistNorm,
      },
    });
    return aliasHit ? 'MEDIUM' : 'LOW';
  }

  /**
   * Persist the matched mxm track's metadata onto the GlobalSong row.
   *
   * Public so the admin manual-match path can reuse the canonical write —
   * keeps the Phase A1f metadata (album, length, genres, rating, explicit)
   * in sync with the auto-matcher path.
   */
  async storeMatchSnapshot(
    globalSongId: number,
    track: MxmTrack,
    confidence: MatcherConfidence,
    matcherStatus: GlobalSongMatcherStatus,
    source: MatcherSource,
  ): Promise<void> {
    const albumArt = pickBestAlbumArt(track);
    const genres = extractGenresJson(track);

    // Auto-fill GlobalSong.albumArt only when currently null (preserve any
    // explicit user override). Skip mxm "nocover" placeholder.
    let autoFillAlbumArt: string | undefined;
    if (albumArt) {
      const current = await this.prisma.globalSong.findUnique({
        where: { id: globalSongId },
        select: { albumArt: true },
      });
      if (!current?.albumArt) {
        autoFillAlbumArt = albumArt;
      }
    }

    await this.prisma.globalSong.update({
      where: { id: globalSongId },
      data: {
        mxmCommontrackId: track.commontrack_id,
        mxmTrackId: track.track_id,
        primaryIsrc: track.track_isrc ?? null,
        spotifyTrackId: track.track_spotify_id ?? null,
        mxmHasLyrics: track.has_lyrics === 1,
        mxmHasSubtitles: track.has_subtitles === 1,
        mxmHasRichsync: track.has_richsync === 1,
        mxmInstrumental: track.instrumental === 1,
        mxmShareUrl: track.track_share_url ?? null,
        // Phase A1f metadata
        mxmAlbumId: track.album_id ?? null,
        mxmAlbumName: track.album_name ?? null,
        mxmAlbumArtUrl: albumArt,
        mxmTrackLengthSec: track.track_length ?? null,
        mxmRating: track.track_rating ?? null,
        mxmExplicit:
          typeof track.explicit === 'number' ? track.explicit === 1 : null,
        mxmGenresJson: genres,
        ...(autoFillAlbumArt ? { albumArt: autoFillAlbumArt } : {}),
        matcherStatus,
        matcherConfidence: confidence,
        matcherSource: source,
        matcherAttempts: { increment: 1 },
        matcherLastAt: new Date(),
      },
    });
  }

  private async markUnmatched(globalSongId: number): Promise<void> {
    await this.prisma.globalSong.update({
      where: { id: globalSongId },
      data: {
        matcherStatus: 'UNMATCHED',
        matcherAttempts: { increment: 1 },
        matcherLastAt: new Date(),
      },
    });
    await this.redis.setNegative(globalSongId);
  }

  private async markManualNeeded(
    globalSongId: number,
    track: MxmTrack,
    confidence: MatcherConfidence,
    reason: string,
  ): Promise<void> {
    this.logger.log(
      `globalSongId=${globalSongId} → MANUAL_NEEDED (${reason}, suggested mxm trackId=${track.track_id})`,
    );
    // Persist mxm suggestion fields too so admin UI doesn't need re-search.
    await this.prisma.globalSong.update({
      where: { id: globalSongId },
      data: {
        mxmCommontrackId: track.commontrack_id,
        mxmTrackId: track.track_id,
        primaryIsrc: track.track_isrc ?? null,
        spotifyTrackId: track.track_spotify_id ?? null,
        mxmHasLyrics: track.has_lyrics === 1,
        mxmHasSubtitles: track.has_subtitles === 1,
        mxmHasRichsync: track.has_richsync === 1,
        mxmInstrumental: track.instrumental === 1,
        mxmShareUrl: track.track_share_url ?? null,
        mxmAlbumId: track.album_id ?? null,
        mxmAlbumName: track.album_name ?? null,
        mxmAlbumArtUrl: pickBestAlbumArt(track),
        mxmTrackLengthSec: track.track_length ?? null,
        mxmRating: track.track_rating ?? null,
        mxmExplicit:
          typeof track.explicit === 'number' ? track.explicit === 1 : null,
        mxmGenresJson: extractGenresJson(track),
        matcherStatus: 'MANUAL_NEEDED',
        matcherConfidence: confidence,
        matcherAttempts: { increment: 1 },
        matcherLastAt: new Date(),
      },
    });
  }
}

/**
 * Pick highest-resolution non-placeholder cover art URL from a mxm track
 * response. mxm uses "nocover" placeholder when no real art exists, which
 * we filter out so the field stays NULL instead of pointing to a missing
 * asset.
 */
function pickBestAlbumArt(track: MxmTrack): string | null {
  const candidates = [
    track.album_coverart_800x800,
    track.album_coverart_500x500,
    track.album_coverart_350x350,
    track.album_coverart_100x100,
  ];
  for (const url of candidates) {
    if (typeof url !== 'string') continue;
    const trimmed = url.trim();
    if (!trimmed) continue;
    if (trimmed.includes('nocover')) continue;
    return trimmed;
  }
  return null;
}

/**
 * Flatten primary + secondary genres into a compact JSON array. Returns
 * null when no genres present so we don't bloat the column with empty
 * arrays.
 */
function extractGenresJson(track: MxmTrack): Prisma.InputJsonValue | undefined {
  const all: Array<{ id?: number; name?: string; vanity?: string }> = [];
  for (const list of [track.primary_genres, track.secondary_genres]) {
    const inner = list?.music_genre_list;
    if (!Array.isArray(inner)) continue;
    for (const item of inner) {
      const g = item?.music_genre;
      if (!g) continue;
      all.push({
        id: g.music_genre_id,
        name: g.music_genre_name,
        vanity:
          'music_genre_vanity' in g
            ? (g as { music_genre_vanity?: string }).music_genre_vanity
            : undefined,
      });
    }
  }
  if (all.length === 0) return undefined;
  return all as unknown as Prisma.InputJsonValue;
}
