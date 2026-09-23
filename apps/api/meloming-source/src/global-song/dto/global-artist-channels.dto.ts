import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Request/response DTOs for GET /global-artists/:id/channels
 *
 * Returns the channels (PUBLIC visibility) that have *any* of this artist's
 * songs registered, ordered by how many of this artist's songs the channel
 * covers (songCount DESC, channelId DESC). The streamer who covers more of
 * the artist's catalog ranks higher.
 */

export class GlobalArtistChannelsQueryDto {
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

export interface GlobalArtistChannelItemDto {
  id: number;
  name: string;
  profileImage: string | null;
  platform: string;
  followerCount: number;
  /** Number of this artist's songs the channel has covered. */
  songCount: number;
  isLive: boolean;
}

export interface GlobalArtistChannelsResponseDto {
  items: GlobalArtistChannelItemDto[];
  nextCursor: string | null;
  mergedFrom?: number | null;
}

/** Cursor: keyset on (songCount DESC, channelId DESC). */
export type GlobalArtistChannelsCursorPayload = {
  songCount: number;
  id: number;
};
