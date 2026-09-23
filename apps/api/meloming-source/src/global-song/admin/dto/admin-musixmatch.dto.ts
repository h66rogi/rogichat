import { ApiProperty } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  GlobalSongMatcherStatus,
  MatcherConfidence,
  MatcherSource,
} from '@prisma/client';

/**
 * DTOs for `AdminMusixmatchController` (Phase A1c).
 *
 * spec: docs/superpowers/specs/2026-04-28-musixmatch-integration-design.md
 *       Section 5.2 (admin endpoints)
 */

export class AdminMusixmatchInfoDto {
  /** GlobalSong.title — pre-fills the admin manual search "곡명" input. */
  songTitle!: string;
  /** GlobalArtist.canonicalName — pre-fills the "아티스트" input. */
  artistName!: string;
  @ApiProperty({ enum: GlobalSongMatcherStatus })
  matcherStatus!: GlobalSongMatcherStatus;
  matcherAttempts!: number;
  matcherLastAt!: string | null;
  @ApiProperty({ enum: MatcherConfidence, nullable: true })
  matcherConfidence!: MatcherConfidence | null;
  @ApiProperty({ enum: MatcherSource, nullable: true })
  matcherSource!: MatcherSource | null;
  mxmCommontrackId!: number | null;
  mxmTrackId!: number | null;
  primaryIsrc!: string | null;
  iswc!: string | null;
  spotifyTrackId!: string | null;
  mxmHasLyrics!: boolean;
  mxmHasSubtitles!: boolean;
  mxmHasRichsync!: boolean;
  mxmInstrumental!: boolean;
  mxmShareUrl!: string | null;
  // Phase A1f metadata
  mxmAlbumId!: number | null;
  mxmAlbumName!: string | null;
  mxmAlbumArtUrl!: string | null;
  mxmTrackLengthSec!: number | null;
  mxmRating!: number | null;
  mxmExplicit!: boolean | null;
  mxmGenres!: Array<{ id?: number; name?: string; vanity?: string }> | null;

  // Lyrics row preview (admin-side internal — no leak to public)
  lyrics!: {
    externalId: string | null;
    bodyPreview: string; // first 200 chars
    bodyLength: number;
    language: string | null;
    hasSubtitle: boolean;
    hasRichsync: boolean;
    restrictedKr: boolean;
    fetchedAt: string;
    expiresAt: string | null;
    // Phase A1f — Korean phonetic spelling for non-Korean lyrics
    bodyKoPronPreview: string | null;
    bodyKoPronLength: number;
    bodyKoPronAt: string | null;
    bodyTranslationPreview: string | null;
    bodyTranslationLength: number;
    bodyTranslationLanguage: string | null;
    bodyTranslationAt: string | null;
  } | null;
}

export class AdminMusixmatchLyricsLanguageRequestDto {
  /** ISO 639-1/-3 like 'ko', 'ja', 'en', 'zh'. Null clears. */
  @IsOptional()
  @IsString()
  @MaxLength(10)
  language?: string | null;
}

export class AdminMusixmatchSearchRequestDto {
  /**
   * Track name. If both `q` and `artist` are empty, server defaults to
   * GlobalSong.title + globalArtist.canonicalName.
   */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  /** Artist filter. Optional — narrows candidates by artist name. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  artist?: string;

  /**
   * mxm page size. Default 25, max 100 (mxm Grow v2 ceiling). Admin only —
   * larger values give more candidates per call but cost the same.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  pageSize?: number;
}

export class AdminMusixmatchSearchCandidateDto {
  trackId!: number;
  commontrackId!: number;
  trackName!: string;
  artistName!: string;
  albumName!: string | null;
  isrc!: string | null;
  spotifyTrackId!: string | null;
  hasLyrics!: boolean;
  hasSubtitle!: boolean;
  hasRichsync!: boolean;
  instrumental!: boolean;
  trackShareUrl!: string | null;
}

export class AdminMusixmatchSearchResponseDto {
  candidates!: AdminMusixmatchSearchCandidateDto[];
}

export class AdminMusixmatchMatchRequestDto {
  @IsInt()
  @Min(1)
  @Type(() => Number)
  trackId!: number;
}

export class AdminMusixmatchMatchResponseDto {
  globalSongId!: number;
  @ApiProperty({ enum: GlobalSongMatcherStatus })
  matcherStatus!: GlobalSongMatcherStatus;
}

export class AdminMusixmatchUsageDto {
  today!: {
    date: string;
    calls: number;
    callsLyrics: number;
    callsTranslations: number;
    callsAnalysis: number;
    callsFingerprint: number;
    errors: number;
    rateLimitHits: number;
  };
  limits!: {
    total: number;
    lyrics: number;
    translations: number;
    lyricsAnalysis: number;
    lyricsFingerprint: number;
  };
  // Last 30 days, oldest first
  history!: Array<{
    date: string;
    calls: number;
    callsLyrics: number;
    errors: number;
    rateLimitHits: number;
  }>;
}

export class AdminMusixmatchManualNeededQueryDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  cursor?: number;
}

export class AdminMusixmatchManualNeededItemDto {
  globalSongId!: number;
  title!: string;
  artistName!: string;
  channelCount!: number;
  matcherAttempts!: number;
  matcherLastAt!: string | null;
  // Suggested mxm match (rejected at LOW confidence). nullable when matcher
  // never received a candidate.
  suggested!: {
    trackId: number | null;
    commontrackId: number | null;
    trackName: string | null;
    artistName: string | null;
    isrc: string | null;
  } | null;
}

export class AdminMusixmatchManualNeededResponseDto {
  items!: AdminMusixmatchManualNeededItemDto[];
  nextCursor!: number | null;
  /** Total MANUAL_NEEDED + MATCHED_DUP_OF_OTHER rows across all pages. */
  total!: number;
}
