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
 * GET /v1/admin/global-songs/canonical-name-dups
 *
 * canonical_name 중복 그룹의 페이지네이션 리스트.
 */
export class CanonicalNameDupListQueryDto {
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

  /** canonical_name 부분 검색 */
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(['gsize_desc', 'songs_desc', 'name_asc'])
  sort?: 'gsize_desc' | 'songs_desc' | 'name_asc';
}

export interface CanonicalNameDupListItemDto {
  canonicalName: string;
  groupSize: number;
  totalSongs: number;
  winnerId: number;
  winnerSongCount: number;
}

export interface CanonicalNameDupListResponseDto {
  data: CanonicalNameDupListItemDto[];
  total: number;
  page: number;
  limit: number;
}

/**
 * GET /v1/admin/global-songs/canonical-name-dups/:name
 *
 * 한 그룹 상세: 각 row + 샘플 song titles.
 */
export interface CanonicalNameDupRowDto {
  id: number;
  normKey: string;
  songCount: number;
  sampleTitles: string[];
}

export interface CanonicalNameDupDetailResponseDto {
  canonicalName: string;
  rows: CanonicalNameDupRowDto[];
}

/**
 * POST /v1/admin/global-songs/canonical-name-dups/:name/llm-judge
 */
export interface LlmJudgeResponseDto {
  canonicalName: string;
  verdict: 'SAME' | 'SPLIT' | 'ABSTAIN' | 'PARSE_ERROR';
  /** SAME → [[all ids]], SPLIT → multiple groups, ABSTAIN/PARSE_ERROR → [] */
  groups: number[][];
  rawResponse: string;
  model: string;
}

/**
 * POST /v1/admin/global-songs/canonical-name-dups/:name/merge
 *
 * 사용자가 검토한 머지 계획. 각 batch 는 winner + 1+ losers.
 */
export class CanonicalNameDupMergeBatchDto {
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

export class CanonicalNameDupMergeRequestDto {
  @IsArray()
  @ArrayMinSize(1)
  @Type(() => CanonicalNameDupMergeBatchDto)
  batches!: CanonicalNameDupMergeBatchDto[];
}

export interface CanonicalNameDupMergeResultDto {
  winnerId: number;
  loserIds: number[];
  ok: boolean;
  songsReassigned?: number;
  conflictSongsAutoMerged?: number;
  losersDeleted?: number;
  redisSyncOk?: boolean;
  error?: string;
}

export interface CanonicalNameDupMergeResponseDto {
  results: CanonicalNameDupMergeResultDto[];
  okCount: number;
  failCount: number;
  totalLosersDeleted: number;
  totalSongsReassigned: number;
  totalConflictsAutoMerged: number;
}
