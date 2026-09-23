import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class FuzzyClusterListQueryDto {
  @IsOptional()
  @IsIn(['within-artist', 'cross-artist', 'all'])
  mode?: 'within-artist' | 'cross-artist' | 'all';

  /** 0~1. 기본 0.85 */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.5)
  @Max(1)
  threshold?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2)
  minSize?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2)
  maxSize?: number;

  /** cross-artist mode 에서 채널 overlap=0 인 것만 (= 표기변주 가능성 ↑) */
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  overlapZeroOnly?: boolean;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(['size_desc', 'channels_desc', 'title_asc'])
  sort?: 'size_desc' | 'channels_desc' | 'title_asc';

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

  /** true 면 캐시 무시하고 재계산 */
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  refresh?: boolean;
}

export interface FuzzyClusterListItemDto {
  clusterKey: string;
  mode: 'within-artist' | 'cross-artist';
  size: number;
  totalChannels: number;
  anchorTitle: string;
  anchorNormTitle: string;
  artistCanonicalNames: string[];
  /** sorted ASC for stable encoding */
  memberIds: number[];
}

export interface FuzzyClusterListResponseDto {
  data: FuzzyClusterListItemDto[];
  total: number;
  page: number;
  limit: number;
  computedAt: string;
  cacheKey: string;
}

export class FuzzyClusterDetailRequestDto {
  @IsArray()
  @ArrayMinSize(2)
  @IsInt({ each: true })
  memberIds!: number[];
}

export interface FuzzyClusterDetailRowDto {
  id: number;
  title: string;
  normTitle: string;
  globalArtistId: number;
  artistCanonicalName: string;
  artistNormKey: string;
  channelCount: number;
  sampleChannels: Array<{ channelId: number; channelName: string }>;
}

export interface FuzzyClusterDetailResponseDto {
  rows: FuzzyClusterDetailRowDto[];
  /** rows 동일 순서. overlap[i][j] = i와 j 둘 다 등록한 채널 수. diagonal = channelCount. */
  overlap: number[][];
}

export class FuzzyClusterLlmJudgeRequestDto {
  @IsArray()
  @ArrayMinSize(2)
  @IsInt({ each: true })
  memberIds!: number[];

  @IsOptional()
  @IsString()
  anchor?: string;
}

export interface FuzzyClusterLlmJudgeResponseDto {
  verdict: 'SAME' | 'SPLIT' | 'ABSTAIN' | 'PARSE_ERROR';
  groups: number[][];
  rawResponse: string;
  model: string;
}

export class FuzzyClusterAutoMergeRequestDto {
  @IsArray()
  @ArrayMinSize(2)
  @IsInt({ each: true })
  memberIds!: number[];

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  /** Hard cap on cluster size; clusters larger than this are skipped. Default 10. */
  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(50)
  @Type(() => Number)
  maxClusterSize?: number;

  /** When false, only SAME verdicts are merged. Default true. */
  @IsOptional()
  @IsBoolean()
  allowSplit?: boolean;
}

export class FuzzyClusterBulkAutoMergeRequestDto {
  /** Array of memberIds arrays — one per cluster to process. */
  @IsArray()
  @ArrayMinSize(1)
  clusters!: number[][];

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(50)
  @Type(() => Number)
  maxClusterSize?: number;

  @IsOptional()
  @IsBoolean()
  allowSplit?: boolean;
}

export interface FuzzyClusterAutoMergeBatchResultDto {
  winnerId: number;
  loserIds: number[];
  status: 'merged' | 'error';
  dryRun?: boolean;
  songsReassigned?: number;
  losersDeleted?: number;
  error?: string;
}

export interface FuzzyClusterAutoMergeResponseDto {
  memberIds: number[];
  verdict: 'SAME' | 'SPLIT' | 'ABSTAIN' | 'PARSE_ERROR';
  skipped: boolean;
  skipReason?: string;
  batches: FuzzyClusterAutoMergeBatchResultDto[];
  rawResponse: string;
  model: string;
}

export interface FuzzyClusterBulkAutoMergeResponseDto {
  total: number;
  mergedClusters: number;
  skippedClusters: number;
  totalLosers: number;
  results: FuzzyClusterAutoMergeResponseDto[];
}
