import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Request/response DTOs for POST /global-songs/quick-add/channel/:channelId.
 *
 * Category is REQUIRED (at least one categoryId or categoryName), matching
 * the existing SongMutationService contract.
 *
 * Title / artistName / albumArt are pulled from the canonical GlobalSong row
 * inside the service — clients do not (and cannot) override identity fields.
 * `albumArt` here is an *override*: if provided, it replaces the GlobalSong's
 * stored cover for this channel's Song row only. Useful when the user wants a
 * channel-specific cover or when the GlobalSong has none yet.
 *
 * The `overrides` block is kept for backward compatibility with the original
 * quick-add caller; new fields live at the top level alongside CreateSongDto.
 */

class QuickAddOverridesDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  difficulty?: number;

  @IsOptional()
  @IsString()
  songKey?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  bpm?: number;
}

export class QuickAddRequestDto {
  @IsInt()
  @Min(1)
  globalSongId!: number;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  categoryIds?: number[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  categoryNames?: string[];

  @IsOptional()
  @ValidateNested()
  @Type(() => QuickAddOverridesDto)
  overrides?: QuickAddOverridesDto;

  // ---------------------------------------------------------------------------
  // Optional metadata — accepted from the full prefill modal flow. All fields
  // are optional; omitted ones fall back to GlobalSong metadata or defaults.
  // ---------------------------------------------------------------------------

  /** Per-channel album art override. Falls back to GlobalSong.albumArt. */
  @IsOptional()
  @IsUrl()
  albumArt?: string;

  /** Trigger Spotify-based album-art lookup when no albumArt is given. */
  @IsOptional()
  @IsBoolean()
  autoSearchAlbumArt?: boolean;

  @IsOptional()
  @IsUrl()
  karaokeUrl?: string;

  @IsOptional()
  @IsUrl()
  coverUrl?: string;

  @IsOptional()
  @IsUrl()
  originalUrl?: string;

  @IsOptional()
  @IsUrl()
  lyricsLink?: string;

  @IsOptional()
  @IsString()
  lyricsText?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  difficulty?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  proficiency?: number;

  @IsOptional()
  @IsString()
  songKey?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  bpm?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;

  @IsOptional()
  @IsObject()
  currencyPrices?: Record<string, number | null> | null;
}

export interface QuickAddRecommendationItem {
  globalSongId: number;
  title: string;
  artist: string;
  albumArt: string | null;
  score: number;
  reason: string;
  channelCount: number;
  topCategories: string[];
}

export interface QuickAddResponseDto {
  song: any; // Reuses the existing SongDetailResponse shape
  recommendations: QuickAddRecommendationItem[];
}
