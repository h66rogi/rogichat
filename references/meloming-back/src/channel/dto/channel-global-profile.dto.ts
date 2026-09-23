import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';

/**
 * meloming.gg 노출/override 설정.
 * channelId는 path param에서 오므로 body에는 포함하지 않음.
 */
export class ChannelGlobalProfileUpsertRequestDto {
  @ApiPropertyOptional({
    description: '글로벌 노출 토글 (false 이면 meloming.gg 어디에도 등장하지 않음)',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  globalEnabled?: boolean;

  @ApiPropertyOptional({
    description: '글로벌 채널명 override (NULL → Channel.name 사용)',
    maxLength: 255,
    example: 'Hakui Koyori EN',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  globalName?: string | null;

  @ApiPropertyOptional({
    description: '글로벌 채널 설명 override (NULL → Channel.channelDescription 사용)',
  })
  @IsOptional()
  @IsString()
  globalDescription?: string | null;

  @ApiPropertyOptional({
    description: '글로벌 프로필 이미지 URL override (NULL → Channel.profileImageUrl 사용)',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  globalProfileImageUrl?: string | null;

  @ApiPropertyOptional({
    description:
      '주요 자막/콘텐츠 언어 (ISO 639-1, 예: "en", "ja"). meloming.gg 추천/필터 용도',
    maxLength: 8,
    example: 'ja',
  })
  @IsOptional()
  @IsString()
  @Length(2, 8)
  primaryLocale?: string | null;
}

export class ChannelGlobalProfileResponseDto {
  @ApiProperty({ description: '멜로밍 채널 ID', example: 123 })
  channelId!: number;

  @ApiProperty({ description: '글로벌 노출 토글', example: false })
  globalEnabled!: boolean;

  @ApiPropertyOptional({ description: '글로벌 채널명 override' })
  globalName?: string | null;

  @ApiPropertyOptional({ description: '글로벌 채널 설명 override' })
  globalDescription?: string | null;

  @ApiPropertyOptional({ description: '글로벌 프로필 이미지 URL override' })
  globalProfileImageUrl?: string | null;

  @ApiPropertyOptional({
    description: '주요 자막/콘텐츠 언어 (ISO 639-1)',
    example: 'ja',
  })
  primaryLocale?: string | null;
}
