import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Request/response DTOs for GET /global-artists/:id/songs
 *
 * Returns the artist's GlobalSongs sorted by `channelCount DESC, id DESC`
 * (popular cover first). Only songs with channelCount > 0 are surfaced —
 * songs no streamer has registered are noise on the artist page.
 */

export class GlobalArtistSongsQueryDto {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit must be an integer' })
  @Min(1, { message: 'limit must be >= 1' })
  @Max(50, { message: 'limit must be <= 50' })
  limit?: number = 24;
}

export interface GlobalArtistSongItemDto {
  id: number;
  title: string;
  albumArt: string | null;
  channelCount: number;
}

export interface GlobalArtistSongsResponseDto {
  items: GlobalArtistSongItemDto[];
  nextCursor: string | null;
  mergedFrom?: number | null;
}

/** Cursor: keyset on (channelCount DESC, id DESC). */
export type GlobalArtistSongsCursorPayload = {
  channelCount: number;
  id: number;
};
