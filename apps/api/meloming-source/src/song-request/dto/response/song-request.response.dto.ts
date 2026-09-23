import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  SongRequestStatus,
  SongRequestSource,
  PriceSource,
} from '@prisma/client';

export class SongRequestResponseDto {
  @ApiProperty({ description: '신청곡 ID', example: 1 })
  id: number;

  @ApiProperty({ description: '라이브 세션 ID', example: 1 })
  liveSessionId: number;

  @ApiProperty({ description: '노래 ID', example: 1, nullable: true })
  songId: number | null;

  @ApiProperty({ description: '아티스트명 (원본)', example: '아이유' })
  rawArtist: string;

  @ApiProperty({ description: '곡 제목 (원본)', example: '좋은날' })
  rawTitle: string;

  @ApiProperty({
    description: '신청 메시지',
    example: '좋은날 불러주세요!',
    nullable: true,
  })
  rawMessage: string | null;

  @ApiProperty({ description: '신청자 플랫폼 ID', example: 'chzzk_12345' })
  requesterPlatformId: string;

  @ApiProperty({ description: '신청자 닉네임', example: '음악러버' })
  requesterNickname: string;

  @ApiProperty({
    description: '신청자 유저 ID (로그인한 유저가 신청한 경우)',
    example: 1,
    nullable: true,
  })
  requestUserId: number | null;

  @ApiProperty({
    description: '신청곡 상태',
    example: 'PENDING',
    enum: SongRequestStatus,
  })
  status: SongRequestStatus;

  @ApiProperty({
    description: '신청 소스',
    example: 'CHAT',
    enum: SongRequestSource,
  })
  source: SongRequestSource;

  @ApiProperty({
    description: '후원 금액',
    example: 5000,
    nullable: true,
  })
  donationAmount: number | null;

  @ApiPropertyOptional({
    description: '네이티브 재화 수량 (예: 별풍선 2개)',
    example: 2,
    nullable: true,
  })
  donationNativeAmount?: number | null;

  @ApiPropertyOptional({
    description:
      '후원 재화 키 (SOOP_BALLOON/CHZZK_CHEESE/CIME_BEAM/KRW_LEGACY)',
    example: 'SOOP_BALLOON',
    nullable: true,
  })
  donationCurrency?: string | null;

  @ApiProperty({ description: '우선순위', example: 0 })
  priority: number;

  @ApiProperty({ description: '대기열 순서', example: 1 })
  queueOrder: number;

  @ApiProperty({
    description: '재생 시작 시간',
    example: '2024-01-20T10:30:00Z',
    nullable: true,
  })
  playedAt: Date | null;

  @ApiProperty({
    description: '완료 시간',
    example: '2024-01-20T10:35:00Z',
    nullable: true,
  })
  completedAt: Date | null;

  @ApiProperty({
    description: '거절 사유',
    example: '이미 불렀던 곡입니다',
    nullable: true,
  })
  rejectionReason: string | null;

  @ApiProperty({
    description: '생성 시간',
    example: '2024-01-20T10:00:00Z',
  })
  createdAt: Date;

  @ApiProperty({
    description: '수정 시간',
    example: '2024-01-20T10:30:00Z',
  })
  updatedAt: Date;

  @ApiProperty({
    description: '매칭된 노래 정보',
    required: false,
    nullable: true,
  })
  song?: {
    id: number;
    title: string;
    albumArt: string | null;
    karaokeUrl: string | null;
    coverUrl: string | null;
    originalUrl: string | null;
    lyricsLink?: string | null;
    lyricsText?: string | null;
    description?: string | null;
    difficulty?: number | null;
    proficiency?: number | null;
    songKey?: string | null;
    bpm?: number | null;
    preferredPitchSemitones?: number | null;
    preferredLyricsOffsetMs?: number | null;
    artist: {
      id: number;
      name: string;
    };
  } | null;

  @ApiPropertyOptional({
    description: '계산된 가격 (신청 시점)',
    example: 500,
    nullable: true,
  })
  calculatedPrice?: number | null;

  @ApiPropertyOptional({
    description: '가격 출처',
    enum: PriceSource,
    example: PriceSource.SONG,
    nullable: true,
  })
  priceSource?: PriceSource | null;

  @ApiPropertyOptional({
    description: '포맷팅된 가격 문자열',
    example: '500별풍선',
  })
  formattedPrice?: string;
}

export class SongRequestQueueResponseDto {
  @ApiProperty({
    description: '신청곡 목록',
    type: [SongRequestResponseDto],
  })
  requests: SongRequestResponseDto[];

  @ApiProperty({
    description: '전체 대기곡 수',
    example: 15,
  })
  total: number;
}
