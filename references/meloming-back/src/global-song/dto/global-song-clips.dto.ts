import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Request/response DTOs for GET /global-songs/:id/clips
 *
 * Public endpoint — returns the clip list for a global song, ordered by
 * popularity (COALESCE(view_count, 0) DESC) or recency (Clip.createdAt DESC).
 * Shape is authoritative per design spec Section 4.2.
 */

export type GlobalSongClipSort = 'popular' | 'recent';

export class GlobalSongClipQueryDto {
  @IsOptional()
  @IsEnum(['popular', 'recent'], {
    message: 'sort must be one of: popular, recent',
  })
  sort?: GlobalSongClipSort = 'popular';

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

export interface GlobalSongClipChannelDto {
  id: number;
  name: string;
  profileImage: string | null;
}

export interface GlobalSongClipDto {
  id: number;
  title: string;
  thumbnailUrl: string | null;
  duration: number | null;
  platform: string;
  channel: GlobalSongClipChannelDto;
  viewCount: number;
  createdAt: string;
}

export interface GlobalSongClipResponseDto {
  items: GlobalSongClipDto[];
  nextCursor: string | null;
  /**
   * The canonical winner globalSongId when the request used a merged loser.
   * `null` / undefined when the request matched a live row directly.
   */
  globalSongId?: number;
  mergedFrom?: number | null;
}

/**
 * Cursor payloads. Encoded as Base64(JSON).
 *
 * The `sort` field is stored inside the cursor so we can detect sort-mismatch
 * at decode time and treat the request as a fresh first page.
 */
export type GlobalSongClipCursorPayload =
  | { sort: 'popular'; viewCount: number; id: number }
  | { sort: 'recent'; createdAt: string; id: number };
