import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { GlobalSongArtistDto } from './global-song-detail.dto';

/**
 * Request/response DTOs for GET /global-songs/search
 *
 * Public endpoint — returns a page of global songs matching `q`, filtered to
 * songs that have at least one channel registered (channelCount > 0).
 * Shape is authoritative per design spec Section 4.3.
 */

export class GlobalSongSearchQueryDto {
  @Transform(({ value }): string => {
    if (typeof value === 'string') return value.trim();
    return typeof value === 'undefined' ? '' : String(value);
  })
  @IsString()
  @IsNotEmpty({ message: 'q must not be empty' })
  @MaxLength(100, { message: 'q must be 100 characters or fewer' })
  q!: string;

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit must be an integer' })
  @Min(1, { message: 'limit must be >= 1' })
  @Max(50, { message: 'limit must be <= 50' })
  limit?: number = 20;
}

export interface GlobalSongSearchItemDto {
  id: number;
  title: string;
  artist: GlobalSongArtistDto;
  albumArt: string | null;
  channelCount: number;
}

export interface GlobalSongSearchResponseDto {
  items: GlobalSongSearchItemDto[];
  nextCursor: string | null;
}

/** Cursor for search pagination — ordered by (channelCount DESC, id DESC). */
export interface GlobalSongSearchCursorPayload {
  channelCount: number;
  id: number;
}

/**
 * Response for GET /global-songs/:id/by-artist
 *
 * Returns other GlobalSong rows of the same GlobalArtist, filtered to
 * `channelCount > 0` (at least one streamer registered) and excluding the
 * current song. Ordered (channelCount DESC, id DESC). Reuses
 * `GlobalSongSearchItemDto` so the same SongCard component on the front can
 * render either source.
 */
export interface GlobalSongByArtistResponseDto {
  items: GlobalSongSearchItemDto[];
}
