import { IsEnum, IsIn, IsNumber, IsString, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { StreamPlatform } from '@prisma/client';

export class SessionCommandDto {
  @IsEnum(StreamPlatform)
  platform: StreamPlatform;

  @IsString()
  @MaxLength(64)
  platformUserId: string;

  @Type(() => Number)
  @IsNumber()
  sessionId: number;

  @IsString()
  @MaxLength(128)
  streamMessageId: string; // dispatcher가 구성한 고유 키 (향후 중복 명령 방지용, 현재는 수신만)

  @IsIn(['pause', 'resume', 'end', 'play-next'])
  command: 'pause' | 'resume' | 'end' | 'play-next';
}
