import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { StreamPlatform } from '@prisma/client';

/**
 * 라이브 세션 시작 DTO
 * platform, platformChannelId는 무시됨 — ChannelVerification에서 자동 결정.
 * 기존 클라이언트 호환을 위해 필드는 유지 (forbidNonWhitelisted 400 방지).
 */
export class StartSessionDto {
  @IsOptional()
  @IsEnum(StreamPlatform)
  platform?: StreamPlatform;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  platformChannelId?: string;

  @IsOptional()
  @IsBoolean()
  practiceMode?: boolean;
}
