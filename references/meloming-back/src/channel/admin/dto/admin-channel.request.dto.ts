import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ChannelVerificationStatus,
  ChannelVisibility,
  StreamPlatform,
} from '@prisma/client';
import { Transform, TransformFnParams, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

const SORTABLE_FIELDS = ['createdAt', 'updatedAt', 'id', 'name'] as const;

export type AdminChannelSortBy = (typeof SORTABLE_FIELDS)[number];
export type AdminChannelSortOrder = 'asc' | 'desc';

const toBoolean = ({ value }: TransformFnParams): boolean | undefined => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return value as boolean;
};

export class AdminChannelListQueryDto {
  @ApiPropertyOptional({ description: '페이지 번호', default: 1, minimum: 1 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    description: '페이지 크기',
    default: 20,
    minimum: 1,
    maximum: 100,
  })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

  @ApiPropertyOptional({
    description: '채널명/webPath/platformUrl/소유자 이메일/닉네임 검색어',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    enum: ChannelVisibility,
    description: '채널 공개 상태',
  })
  @IsOptional()
  @IsEnum(ChannelVisibility)
  visibility?: ChannelVisibility;

  @ApiPropertyOptional({ enum: StreamPlatform, description: '인증 플랫폼' })
  @IsOptional()
  @IsEnum(StreamPlatform)
  platform?: StreamPlatform;

  @ApiPropertyOptional({
    enum: ChannelVerificationStatus,
    description: '채널 인증 상태',
  })
  @IsOptional()
  @IsEnum(ChannelVerificationStatus)
  verificationStatus?: ChannelVerificationStatus;

  @ApiPropertyOptional({ description: '소유자 유저 ID' })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  ownerUserId?: number;

  @ApiPropertyOptional({
    type: Boolean,
    description: '진행 중 라이브 존재 여부',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  hasActiveLive?: boolean;

  @ApiPropertyOptional({ type: Boolean, description: '글로벌 노출 여부' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isGlobalEnabled?: boolean;

  @ApiPropertyOptional({
    description: '생성일 시작 (ISO 8601)',
    type: String,
    format: 'date-time',
  })
  @IsOptional()
  @IsDateString()
  createdFrom?: string;

  @ApiPropertyOptional({
    description: '생성일 종료 (ISO 8601)',
    type: String,
    format: 'date-time',
  })
  @IsOptional()
  @IsDateString()
  createdTo?: string;

  @ApiPropertyOptional({
    description: '정렬 기준',
    enum: SORTABLE_FIELDS,
    default: 'createdAt',
  })
  @IsOptional()
  @IsIn(SORTABLE_FIELDS)
  sortBy?: AdminChannelSortBy;

  @ApiPropertyOptional({
    description: '정렬 방향',
    enum: ['asc', 'desc'],
    default: 'desc',
  })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: AdminChannelSortOrder;
}
