import { ApiProperty } from '@nestjs/swagger';

export type UpcomingAnniversaryType = 'birthday' | 'broadcast';

export class UpcomingAnniversaryHighlightDto {
  @ApiProperty({
    description: '항목 ID (안정적인 식별자)',
    example: 'birthday:5:2025-12-17T15:00:00.000Z',
  })
  id!: string;

  @ApiProperty({ description: '채널 ID', example: 5 })
  channelId!: number;

  @ApiProperty({ description: '채널 이름', example: '멜로밍의 노래책' })
  channelName!: string;

  @ApiProperty({ description: '채널 주소', example: 'meloming_user' })
  webPath!: string;

  @ApiProperty({
    description: '채널 프로필 이미지 URL',
    required: false,
    nullable: true,
    example: 'https://example.com/profile.jpg',
  })
  profileImageUrl?: string | null;

  @ApiProperty({
    description: '채널 테마 색상',
    required: false,
    nullable: true,
    example: '#3B82F6',
  })
  themeColor?: string | null;

  @ApiProperty({
    description: '기념일 타입',
    enum: ['birthday', 'broadcast'],
    example: 'birthday',
  })
  type!: UpcomingAnniversaryType;

  @ApiProperty({
    description: '표시 라벨 (예: 생일 (1월 1일), 100일, 1주년)',
    example: '생일 (1월 1일)',
  })
  label!: string;

  @ApiProperty({
    description: '이벤트 날짜(ISO string). KST 날짜 경계를 UTC ISO로 표현',
    example: '2025-12-17T15:00:00.000Z',
  })
  date!: string;

  @ApiProperty({ description: '남은 일수', example: 3 })
  daysUntil!: number;

  @ApiProperty({
    description: '채널 소유자의 프로 구독 활성 상태',
    example: true,
  })
  isOwnerProSubscriber!: boolean;

  @ApiProperty({
    description: '채널 소유자의 앰배서더 여부',
    example: true,
  })
  isOwnerAmbassador!: boolean;
}

export class UpcomingAnniversaryHighlightsResponseDto {
  @ApiProperty({
    description: '다가오는 기념일 하이라이트 목록',
    type: [UpcomingAnniversaryHighlightDto],
  })
  items!: UpcomingAnniversaryHighlightDto[];
}
