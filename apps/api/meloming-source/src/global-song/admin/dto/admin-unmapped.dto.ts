import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class AdminUnmappedSongsListQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  /** title / artist.name / channel.name 통합 검색 */
  @IsOptional()
  @IsString()
  search?: string;
}

export interface AdminUnmappedSongListItemDto {
  id: number;
  title: string;
  artistName: string;
  channelId: number;
  channelName: string;
  createdAt: string;
}

export interface AdminUnmappedSongsListResponseDto {
  data: AdminUnmappedSongListItemDto[];
  total: number;
  page: number;
  limit: number;
}

export class AdminUnmappedLinkRequestDto {
  @IsInt()
  @Min(1)
  globalSongId!: number;
}

export interface AdminUnmappedLinkResponseDto {
  songId: number;
  globalSongId: number;
  alreadyLinked: boolean;
  winnerChannelCountAfter: number;
}
