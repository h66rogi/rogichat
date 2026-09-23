import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ChannelUserBlockFeature,
  SongRequestUserBlockScope,
  StreamPlatform,
} from '@prisma/client';
import {
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum SongRequestUserBlockTargetBasis {
  AUTO = 'AUTO',
  PLATFORM_USER = 'PLATFORM_USER',
  MELOMING_USER = 'MELOMING_USER',
}

export class CreateSongRequestUserBlockDto {
  @ApiPropertyOptional({
    description:
      '차단 범위. CHANNEL은 해당 채널에서만, GLOBAL은 전체 신청곡에서 차단합니다. GLOBAL은 사이트 관리자만 사용할 수 있습니다.',
    enum: SongRequestUserBlockScope,
    default: SongRequestUserBlockScope.CHANNEL,
  })
  @IsOptional()
  @IsEnum(SongRequestUserBlockScope)
  scope?: SongRequestUserBlockScope;

  @ApiPropertyOptional({
    description:
      '차단 적용 기능. ALL을 포함하면 모든 기능에 적용합니다. 미지정 시 신청곡에만 적용합니다.',
    enum: ChannelUserBlockFeature,
    isArray: true,
    default: [ChannelUserBlockFeature.SONG_REQUEST],
  })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsEnum(ChannelUserBlockFeature, { each: true })
  features?: ChannelUserBlockFeature[];

  @ApiPropertyOptional({
    description:
      '기존 신청곡에서 차단 키를 만들 때 사용할 대상 기준. AUTO는 기존처럼 가능한 키를 모두 생성합니다.',
    enum: SongRequestUserBlockTargetBasis,
    default: SongRequestUserBlockTargetBasis.AUTO,
  })
  @IsOptional()
  @IsEnum(SongRequestUserBlockTargetBasis)
  targetBasis?: SongRequestUserBlockTargetBasis;

  @ApiPropertyOptional({
    description: '차단 사유',
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;
}

export class CreateChannelUserBlockDto {
  @ApiPropertyOptional({
    description: '채널 ID. CHANNEL 범위 차단 생성 시 필요합니다.',
  })
  @ValidateIf((dto) => dto.scope !== SongRequestUserBlockScope.GLOBAL)
  @Type(() => Number)
  @IsInt()
  channelId?: number;

  @ApiPropertyOptional({
    description:
      '차단 범위. CHANNEL은 해당 채널에서만, GLOBAL은 전체에서 차단합니다. GLOBAL은 사이트 관리자만 사용할 수 있습니다.',
    enum: SongRequestUserBlockScope,
    default: SongRequestUserBlockScope.CHANNEL,
  })
  @IsOptional()
  @IsEnum(SongRequestUserBlockScope)
  scope?: SongRequestUserBlockScope;

  @ApiPropertyOptional({
    description: '차단 적용 기능',
    enum: ChannelUserBlockFeature,
    isArray: true,
    default: [ChannelUserBlockFeature.SONG_REQUEST],
  })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsEnum(ChannelUserBlockFeature, { each: true })
  features?: ChannelUserBlockFeature[];

  @ApiPropertyOptional({
    description:
      'PLATFORM_USER는 외부 플랫폼 유저 ID 기준, MELOMING_USER는 멜로밍 유저의 DI 기준 차단입니다.',
    enum: SongRequestUserBlockTargetBasis,
    default: SongRequestUserBlockTargetBasis.MELOMING_USER,
  })
  @IsOptional()
  @IsEnum(SongRequestUserBlockTargetBasis)
  targetBasis?: Exclude<
    SongRequestUserBlockTargetBasis,
    SongRequestUserBlockTargetBasis.AUTO
  >;

  @ApiPropertyOptional({ enum: StreamPlatform })
  @ValidateIf(
    (dto) => dto.targetBasis === SongRequestUserBlockTargetBasis.PLATFORM_USER,
  )
  @IsEnum(StreamPlatform)
  platform?: StreamPlatform;

  @ApiPropertyOptional({ description: '외부 플랫폼 유저 ID', maxLength: 64 })
  @ValidateIf(
    (dto) => dto.targetBasis === SongRequestUserBlockTargetBasis.PLATFORM_USER,
  )
  @IsString()
  @MaxLength(64)
  platformUserId?: string;

  @ApiPropertyOptional({ description: '멜로밍 유저 ID' })
  @ValidateIf(
    (dto) => dto.targetBasis !== SongRequestUserBlockTargetBasis.PLATFORM_USER,
  )
  @Type(() => Number)
  @IsInt()
  melomingUserId?: number;

  @ApiPropertyOptional({
    description:
      '차단 목록에 표시할 이름. 미지정 시 유저/플랫폼 ID를 사용합니다.',
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  displayName?: string;

  @ApiPropertyOptional({
    description: '차단 사유',
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;
}
