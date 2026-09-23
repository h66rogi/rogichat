import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  KaraokePlaybackMode,
  KaraokeVideoType,
  SongRequestMode,
} from '@prisma/client';

/**
 * 채널 신청곡 설정 응답 DTO. 라이브 한정 상태(paused/requestEnabled) 는 별도 LiveSession.settings 응답.
 */
export class ChannelSongRequestSettingsResponseDto {
  @ApiProperty()
  channelId!: number;

  @ApiProperty()
  requestCommand!: string;

  @ApiProperty()
  maxQueueSize!: number;

  @ApiProperty()
  donationPriorityEnabled!: boolean;

  @ApiProperty()
  enforceDonationMinimumPrice!: boolean;

  @ApiProperty({ enum: KaraokePlaybackMode })
  karaokePlaybackMode!: KaraokePlaybackMode;

  @ApiProperty({ enum: KaraokeVideoType })
  karaokeVideoType!: KaraokeVideoType;

  @ApiProperty()
  donationOnlyEnabled!: boolean;

  @ApiProperty({ enum: SongRequestMode })
  requestMode!: SongRequestMode;

  @ApiProperty()
  chatRequestEnabled!: boolean;

  @ApiProperty()
  donationRequestEnabled!: boolean;

  @ApiProperty()
  allowAnonymous!: boolean;

  @ApiProperty()
  requireSongMatch!: boolean;

  @ApiProperty()
  randomRequestEnabled!: boolean;

  @ApiProperty()
  preventDuplicateSongs!: boolean;

  @ApiProperty({ type: [Number] })
  blockedCategoryIds!: number[];

  @ApiProperty()
  maxRequestsPerUser!: number;

  @ApiProperty()
  maxTotalRequests!: number;

  @ApiProperty()
  showRequesterName!: boolean;
}

/**
 * 채널 신청곡 설정 업데이트 DTO. paused/requestEnabled 는 LiveSession 한정 상태이므로 별도 endpoint.
 */
export class UpdateChannelSongRequestSettingsDto {
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
  @IsEnum(KaraokePlaybackMode)
  karaokePlaybackMode?: KaraokePlaybackMode;

  @IsOptional()
  @IsEnum(KaraokeVideoType)
  karaokeVideoType?: KaraokeVideoType;

  @IsOptional()
  @IsBoolean()
  donationOnlyEnabled?: boolean;

  @IsOptional()
  @IsEnum(SongRequestMode)
  requestMode?: SongRequestMode;

  @IsOptional()
  @IsBoolean()
  chatRequestEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  donationRequestEnabled?: boolean;

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
