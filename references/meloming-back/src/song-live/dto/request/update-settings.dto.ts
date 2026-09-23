import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsEnum,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  KaraokePlaybackMode,
  KaraokeVideoType,
  SongRequestMode,
} from '@prisma/client';

/**
 * 라이브 세션 설정 업데이트 DTO
 */
export class UpdateSettingsDto {
  @IsOptional()
  @IsBoolean()
  requestEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  paused?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  requestCommand?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  maxQueueSize?: number;

  @IsOptional()
  @IsBoolean()
  donationPriorityEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  enforceDonationMinimumPrice?: boolean;

  @IsOptional()
  @IsBoolean()
  donationOnlyEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  chatRequestEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  donationRequestEnabled?: boolean;

  @IsOptional()
  @IsEnum(SongRequestMode)
  requestMode?: SongRequestMode;

  @IsOptional()
  @IsBoolean()
  allowAnonymous?: boolean;

  @IsOptional()
  @IsBoolean()
  requireSongMatch?: boolean;

  @IsOptional()
  @IsBoolean()
  randomRequestEnabled?: boolean;

  @IsOptional()
  @IsEnum(KaraokePlaybackMode)
  karaokePlaybackMode?: KaraokePlaybackMode;

  @IsOptional()
  @IsEnum(KaraokeVideoType)
  karaokeVideoType?: KaraokeVideoType;

  @IsOptional()
  @IsBoolean()
  preventDuplicateSongs?: boolean;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Type(() => Number)
  blockedCategoryIds?: number[];

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  maxRequestsPerUser?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(500)
  maxTotalRequests?: number;

  @IsOptional()
  @IsBoolean()
  showRequesterName?: boolean;
}
