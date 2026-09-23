import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ChannelUserBlockFeature,
  SongRequestUserBlockScope,
  SongRequestUserBlockTargetType,
  StreamPlatform,
} from '@prisma/client';

export class SongRequestUserBlockResponseDto {
  @ApiProperty({ description: '차단 ID' })
  id: number;

  @ApiProperty({
    description: '차단 범위',
    enum: SongRequestUserBlockScope,
  })
  scope: SongRequestUserBlockScope;

  @ApiProperty({
    description: '차단 적용 기능',
    enum: ChannelUserBlockFeature,
  })
  feature: ChannelUserBlockFeature;

  @ApiProperty({
    description: '차단 대상 타입',
    enum: SongRequestUserBlockTargetType,
  })
  targetType: SongRequestUserBlockTargetType;

  @ApiProperty({ description: '차단 대상 내부 키' })
  targetKey: string;

  @ApiPropertyOptional({ description: '채널 ID', nullable: true })
  channelId?: number | null;

  @ApiPropertyOptional({ description: '멜로밍 유저 ID', nullable: true })
  requestUserId?: number | null;

  @ApiPropertyOptional({
    description: '방송 플랫폼',
    enum: StreamPlatform,
    nullable: true,
  })
  platform?: StreamPlatform | null;

  @ApiPropertyOptional({ description: '플랫폼 유저 ID', nullable: true })
  platformUserId?: string | null;

  @ApiPropertyOptional({ description: 'DI 해시', nullable: true })
  diHash?: string | null;

  @ApiProperty({ description: '차단 당시 신청자 닉네임' })
  requesterNickname: string;

  @ApiPropertyOptional({ description: '차단 사유', nullable: true })
  reason?: string | null;

  @ApiPropertyOptional({ description: '차단 생성 유저 ID', nullable: true })
  createdByUserId?: number | null;

  @ApiProperty({ description: '생성 시간' })
  createdAt: Date;

  @ApiProperty({ description: '수정 시간' })
  updatedAt: Date;
}

export class CreateSongRequestUserBlockResponseDto {
  @ApiProperty({
    description: '생성 또는 갱신된 차단 키 목록',
    type: [SongRequestUserBlockResponseDto],
  })
  blocks: SongRequestUserBlockResponseDto[];
}
