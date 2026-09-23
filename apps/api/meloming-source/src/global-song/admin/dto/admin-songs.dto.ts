import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class AdminSongsListQueryDto {
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

  /** title / normTitle / artist.canonicalName / artist.normKey 통합 검색 */
  @IsOptional()
  @IsString()
  search?: string;

  /** artist 만 별도로 좁힐 때 사용 (search 와 AND 조합) */
  @IsOptional()
  @IsString()
  artistSearch?: string;

  /** 특정 GlobalArtist 로만 필터 */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  artistId?: number;

  @IsOptional()
  @IsIn(['channels_desc', 'channels_asc', 'id_desc', 'id_asc', 'title_asc'])
  sort?: 'channels_desc' | 'channels_asc' | 'id_desc' | 'id_asc' | 'title_asc';
}

export interface AdminSongListItemDto {
  id: number;
  title: string;
  normTitle: string;
  globalArtistId: number;
  artistCanonicalName: string;
  channelCount: number;
}

export interface AdminSongsListResponseDto {
  data: AdminSongListItemDto[];
  total: number;
  page: number;
  limit: number;
}

export interface AdminSongDetailResponseDto {
  id: number;
  title: string;
  normTitle: string;
  globalArtistId: number;
  artistCanonicalName: string;
  artistNormKey: string;
  channelCount: number;
  /** 모든 송 row 가 매핑된 channel 들 (최대 30개) */
  channels: Array<{
    channelId: number;
    channelName: string;
    songId: number;
    songTitle: string;
  }>;
  /** 같은 normTitle 다른 artist 의 row 들 (cross-artist dup 후보) */
  crossArtistSiblings: Array<{
    id: number;
    title: string;
    globalArtistId: number;
    artistCanonicalName: string;
    channelCount: number;
  }>;
}

export class AdminSongChannelsQueryDto {
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

export class AdminSongSiblingsQueryDto {
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

export interface AdminSongChannelsResponseDto {
  data: Array<{
    channelId: number;
    channelName: string;
    songId: number;
    songTitle: string;
  }>;
  total: number;
  page: number;
  limit: number;
}

export interface AdminSongSiblingsResponseDto {
  data: Array<{
    id: number;
    title: string;
    globalArtistId: number;
    artistCanonicalName: string;
    channelCount: number;
  }>;
  total: number;
  page: number;
  limit: number;
}

export class AdminSongsMergeRequestDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  winnerId!: number;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsInt({ each: true })
  @Type(() => Number)
  loserIds!: number[];

  @IsString()
  reason!: string;

  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}

export class AdminLocalSongMergeRequestDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  keepSongId!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  dropSongId!: number;

  @IsOptional()
  @IsString()
  reason?: string;
}
