import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Request/response DTOs for the POST /global-songs/match endpoint.
 *
 * NOTE: `matchConfidence` (API response) is distinct from `entityConfidence`
 * (DB column on GlobalSong). See design spec Appendix item 22.
 */

export type MatchConfidence = 'HIGH' | 'MEDIUM' | 'LOW';
export type MatchMethod = 'EXACT' | 'ALIAS' | 'FUZZY' | 'AI';

export class MatchRequestDto {
  @IsString()
  @MaxLength(300)
  query!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  channelId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit?: number;
}

export interface MatchResultItem {
  globalSongId: number;
  title: string;
  artist: string;
  albumArt: string | null;
  channelCount: number;
  matchConfidence: MatchConfidence;
  matchMethod: MatchMethod;
  /** Only populated when the request carried a channelId for duplicate checking. */
  alreadyInChannel?: boolean;
  /** Top-N category names by cross-channel frequency for this global song. */
  topCategories: string[];
}

export interface MatchResponseDto {
  results: MatchResultItem[];
  query: {
    parsedTitle: string;
    parsedArtist: string | null;
  };
}
