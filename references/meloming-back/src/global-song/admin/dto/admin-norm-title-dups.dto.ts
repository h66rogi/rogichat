import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

/**
 * GET /v1/admin/global-songs/norm-title-dups
 *
 * cross-artist 같은 norm_title GlobalSong 그룹 페이지네이션 리스트.
 * (같은 artist 같은 norm_title 은 UNIQUE 제약으로 발생 불가)
 */
export class NormTitleDupListQueryDto {
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

  /** norm_title 부분 검색 */
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(['gsize_desc', 'channels_desc', 'title_asc'])
  sort?: 'gsize_desc' | 'channels_desc' | 'title_asc';
}

export interface NormTitleDupListItemDto {
  normTitle: string;
  groupSize: number;
  /** 전 row 의 channelCount 합 */
  totalChannels: number;
}

export interface NormTitleDupListResponseDto {
  data: NormTitleDupListItemDto[];
  total: number;
  page: number;
  limit: number;
}

export interface NormTitleDupRowDto {
  id: number;
  title: string;
  globalArtistId: number;
  artistCanonicalName: string;
  artistNormKey: string;
  channelCount: number;
  /** 이 GlobalSong 을 등록한 채널 sample (top N by song.id) */
  sampleChannels: Array<{ channelId: number; channelName: string }>;
}

export interface NormTitleDupDetailResponseDto {
  normTitle: string;
  rows: NormTitleDupRowDto[];
  /**
   * pairwise channel overlap matrix. overlap[i][j] = i번 row 와 j번 row 가
   * 둘 다 등록된 channel 수. 0 이면 cross-artist 라도 같은 곡일 가능성 ↑.
   * (rows 순서와 동일, 대칭. self diagonal 은 channelCount.)
   */
  overlap: number[][];
}

/**
 * POST /v1/admin/global-songs/norm-title-dups/:normTitle/llm-judge
 */
export interface NormTitleLlmJudgeResponseDto {
  normTitle: string;
  verdict: 'SAME' | 'SPLIT' | 'ABSTAIN' | 'PARSE_ERROR';
  /** SAME → [[all ids]], SPLIT → multiple groups, ABSTAIN/PARSE_ERROR → [] */
  groups: number[][];
  rawResponse: string;
  model: string;
}

/**
 * POST /v1/admin/global-songs/norm-title-dups/:normTitle/merge
 *
 * 사용자가 검토한 song-merge 계획. 각 batch 는 winner + 1+ losers
 * (모두 같은 normTitle, 다른 artist).
 */
export class NormTitleDupMergeBatchDto {
  @IsInt()
  @Min(1)
  winnerId!: number;

  @IsArray()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  loserIds!: number[];

  @IsString()
  reason!: string;
}

export class NormTitleDupMergeRequestDto {
  @IsArray()
  @ArrayMinSize(1)
  @Type(() => NormTitleDupMergeBatchDto)
  batches!: NormTitleDupMergeBatchDto[];
}

export interface NormTitleDupMergeResultDto {
  winnerId: number;
  loserIds: number[];
  ok: boolean;
  songsReassigned?: number;
  losersDeleted?: number;
  redisSyncOk?: boolean;
  error?: string;
}

export interface NormTitleDupMergeResponseDto {
  results: NormTitleDupMergeResultDto[];
  okCount: number;
  failCount: number;
  totalLosersDeleted: number;
  totalSongsReassigned: number;
}
