import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class AdminArtistsListQueryDto {
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

  /** canonicalName / normKey 부분 검색 (대소문자 무시) */
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(['songs_desc', 'songs_asc', 'id_desc', 'id_asc', 'name_asc'])
  sort?: 'songs_desc' | 'songs_asc' | 'id_desc' | 'id_asc' | 'name_asc';
}

export interface AdminArtistListItemDto {
  id: number;
  canonicalName: string;
  normKey: string;
  songCount: number;
}

export interface AdminArtistsListResponseDto {
  data: AdminArtistListItemDto[];
  total: number;
  page: number;
  limit: number;
}

export interface AdminArtistDetailResponseDto {
  id: number;
  canonicalName: string;
  normKey: string;
  songCount: number;
  sampleSongs: Array<{
    id: number;
    title: string;
    normTitle: string;
    channelCount: number;
  }>;
  /** 같은 canonical_name 의 다른 row 들 (있으면) */
  siblings: Array<{ id: number; normKey: string; songCount: number }>;
}

export class AdminArtistSongsQueryDto {
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
}

export class AdminArtistsMergeRequestDto {
  @IsInt()
  @Min(1)
  winnerId!: number;

  @IsArray()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  loserIds!: number[];

  @IsString()
  reason!: string;

  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}
