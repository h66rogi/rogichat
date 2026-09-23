import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  CHANNEL_COLOR_MODE_VALUES,
  type ChannelColorModeValue,
} from '../customization/constants/color-mode';
import {
  CHANNEL_LAYOUT_WIDTH_VALUES,
  type ChannelLayoutWidthValue,
} from '../customization/constants/layout-width';
import {
  CHANNEL_HEADER_STYLE_VALUES,
  type ChannelHeaderStyleValue,
} from '../customization/constants/header-style';
import {
  CHANNEL_LAYOUT_TYPE_VALUES,
  type ChannelLayoutTypeValue,
} from '../customization/constants/layout-type';
import { type ChannelVisibility, type StreamPlatform } from '@prisma/client';

export class ChannelSummaryDto {
  @ApiProperty() id: number;
  @ApiProperty() name: string;
  @ApiProperty() webPath: string;
  @ApiProperty({ required: false, nullable: true }) platformUrl?: string | null;
  @ApiProperty({ required: false, nullable: true }) topBannerUrl?:
    | string
    | null;
  @ApiProperty({ required: false, nullable: true }) leftBannerUrl?:
    | string
    | null;
  @ApiProperty({ required: false, nullable: true }) leftBannerLink?:
    | string
    | null;
  @ApiProperty({ required: false, nullable: true }) rightBannerUrl?:
    | string
    | null;
  @ApiProperty({ required: false, nullable: true }) rightBannerLink?:
    | string
    | null;
  @ApiProperty({ required: false, nullable: true }) profileImageUrl?:
    | string
    | null;
  @ApiProperty() themeColor: string;
  @ApiProperty({ required: false, nullable: true }) channelDescription?:
    | string
    | null;
  @ApiProperty({
    required: false,
    nullable: true,
    type: 'array',
    items: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        url: { type: 'string' },
      },
    },
  })
  additionalLinks?: Array<{ name: string; url: string }> | null;
  @ApiProperty({
    required: false,
    nullable: true,
    description: '일정 공지',
    example: '이번 주는 개인 사정으로 휴방합니다.',
  })
  scheduleNotice?: string | null;
  @ApiProperty({
    description: '채널 인증 여부 (플랫폼 소유권 검증 완료)',
    example: true,
  })
  isVerified: boolean;
  @ApiProperty({
    description: '승인된 인증 목록 (플랫폼별)',
    type: 'array',
    items: {
      type: 'object',
      properties: {
        platform: { type: 'string', enum: ['SOOP', 'CHZZK', 'CIME', 'OTHER'] },
        platformChannelId: { type: 'string', nullable: true },
      },
    },
    required: false,
  })
  verifications?: {
    platform: StreamPlatform;
    platformChannelId: string | null;
  }[];
  @ApiProperty({
    description: '채널 공개 범위',
    enum: ['PUBLIC', 'UNLISTED'],
    default: 'PUBLIC',
  })
  visibility: ChannelVisibility;
  @ApiProperty({
    description: '멜로밍 1주년 설립자 뱃지 보유 여부',
    example: false,
  })
  isFounder: boolean;
}

export class ChannelMyResponseDto extends ChannelSummaryDto {
  @ApiProperty({ type: Object })
  _count: { songs: number; categories: number; artists: number };
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
  @ApiProperty() isOwner: boolean;
}

export class ChannelWithCountsDto extends ChannelSummaryDto {
  @ApiProperty({ type: Object })
  _count: { songs: number; categories: number; artists: number };
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
  @ApiProperty({
    required: false,
    description: '채널 즐겨찾기 수',
    example: 123,
    nullable: true,
  })
  favoritesCount?: number;
  @ApiProperty({
    required: false,
    description: '채널 내 노래 좋아요 수 합계',
    example: 456,
    nullable: true,
  })
  songLikesCount?: number;
  @ApiProperty({
    required: false,
    description: '채널 등록 노래 수',
    example: 78,
    nullable: true,
  })
  songsCount?: number;
  @ApiProperty({
    required: false,
    description: '가중치 기반 인기 점수',
    example: 589.7,
    nullable: true,
  })
  popularityScore?: number;
  @ApiProperty({
    required: false,
    description: '채널 소유자의 프로 구독 활성 상태',
    example: true,
    nullable: true,
  })
  isOwnerProSubscriber?: boolean;
  @ApiProperty({
    required: false,
    description: '채널 소유자의 앰배서더 여부',
    example: true,
    nullable: true,
  })
  isOwnerAmbassador?: boolean;
}

export class ChannelWithCountsWithGroupDto extends ChannelWithCountsDto {
  @ApiProperty({ description: '채널명 첫 초성 그룹', example: 'ㅅ' })
  group: string;
}

export class ChannelListAllResponseDto {
  @ApiProperty({ type: [ChannelWithCountsWithGroupDto] })
  channels: ChannelWithCountsWithGroupDto[];
  @ApiProperty({ type: [String] })
  groups: string[];
}

export class ChannelDetailDto extends ChannelSummaryDto {
  @ApiProperty({ type: () => Object })
  user: { id: number; nickname: string };
  @ApiProperty({ type: () => Object })
  _count: { songs: number; categories: number; artists: number };
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
  @ApiPropertyOptional({
    description:
      '커스텀 CSS 코드 (isEnabled: true인 경우에만 모든 사용자에게 표시됨)',
    example: '.container { color: red; }',
    nullable: true,
  })
  customCss?: string | null;
  @ApiPropertyOptional({
    description: '채널 페이지 강제 색상 모드 (커스텀 CSS 적용 시)',
    enum: CHANNEL_COLOR_MODE_VALUES,
    example: 'light',
  })
  forcedColorMode?: ChannelColorModeValue;
  @ApiPropertyOptional({
    description: '채널 레이아웃 너비 (PRO 전용)',
    enum: CHANNEL_LAYOUT_WIDTH_VALUES,
    example: 'default',
  })
  layoutWidth?: ChannelLayoutWidthValue;
  @ApiPropertyOptional({
    description: '채널 상단 보기 방식 (PRO 전용)',
    enum: CHANNEL_HEADER_STYLE_VALUES,
    example: 'wide',
  })
  headerStyle?: ChannelHeaderStyleValue;
  @ApiProperty({
    description:
      '채널 페이지 레이아웃 타입 (legacy=기존, new=신규 메뉴 사이드바형). PRO 무관 항상 응답하며, 별도 설정이 없으면 new.',
    enum: CHANNEL_LAYOUT_TYPE_VALUES,
    example: 'new',
  })
  layoutType: ChannelLayoutTypeValue;
  @ApiProperty({
    description: '채널 소유자의 프로 구독 활성 상태',
    example: true,
  })
  isOwnerProSubscriber: boolean;
  @ApiProperty({
    description: '채널 소유자의 앰배서더 여부',
    example: true,
  })
  isOwnerAmbassador: boolean;

  @ApiProperty({
    description: '보이스 커미션 활성 여부 (탭 게이팅용)',
    example: false,
  })
  voiceCommissionActive: boolean;

  @ApiProperty({
    description: '숙제곡 활성 여부 (탭 게이팅용)',
    example: false,
  })
  homeworkSongActive: boolean;
}

export class ChannelDetailWithStatsDto extends ChannelDetailDto {
  @ApiProperty({ type: () => Object })
  stats: { songs: number; categories: number; artists: number };
}

export class ChannelSearchItemDto extends ChannelSummaryDto {
  @ApiProperty({ required: false, nullable: true, type: () => Object })
  user: { id: number; nickname: string; profileImageUrl: string | null } | null;
  @ApiProperty({ description: '검색 관련성 점수' })
  relevanceScore: number;
  @ApiProperty({ description: '현재 사용자 즐겨찾기 여부' })
  isFavorite: boolean;
  @ApiProperty({
    description: '채널 소유자의 프로 구독 활성 상태',
    example: true,
  })
  isOwnerProSubscriber: boolean;
  @ApiProperty({
    description: '채널 소유자의 앰배서더 여부',
    example: true,
  })
  isOwnerAmbassador: boolean;
}

export class PaginationDto {
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
  @ApiProperty() total: number;
  @ApiProperty() totalPages: number;
}

export class ChannelSearchResponseDto {
  @ApiProperty({ type: [ChannelSearchItemDto] })
  channels: ChannelSearchItemDto[];
  @ApiProperty({ type: PaginationDto }) pagination: PaginationDto;
}

export class ChannelPermissionResponseDto {
  @ApiProperty() view: boolean;
  @ApiProperty() manageContent: boolean;
  @ApiProperty() manageSettings: boolean;
  @ApiProperty() manageProfile: boolean;
  @ApiProperty() manageGuestbook: boolean;
  @ApiProperty() manageCustomization: boolean;
  @ApiProperty() manageEmoticons: boolean;
  @ApiProperty() isOwner: boolean;
  @ApiProperty({
    description: '채널 소유자의 프로 구독 상태',
    example: true,
  })
  isOwnerProSubscriber: boolean;
}

export class MessageResponseDto {
  @ApiProperty() message: string;
}

export class ChannelTransferResponseDto {
  @ApiProperty({ example: 123 })
  requestId!: number;
  @ApiProperty({ example: 'PENDING' })
  status!:
    | 'PENDING'
    | 'CONFIRMED'
    | 'APPROVED'
    | 'REJECTED'
    | 'CANCELED'
    | 'COMPLETED';
}

export class TransferTargetInfoDto {
  @ApiProperty() userId!: number;
  @ApiProperty() email!: string;
  @ApiProperty() nickname!: string;
  @ApiProperty({ required: false, nullable: true })
  profileImageUrl?: string | null;
}

export class ChannelTransferIncomingChannelDto {
  @ApiProperty() id!: number;
  @ApiProperty() name!: string;
  @ApiProperty({ required: false, nullable: true })
  profileImageUrl?: string | null;
  @ApiProperty() webPath!: string;
}

export class ChannelTransferIncomingOwnerDto {
  @ApiProperty() id!: number;
  @ApiProperty() nickname!: string;
}

export class ChannelTransferIncomingItemDto {
  @ApiProperty() requestId!: number;
  @ApiProperty({ type: () => ChannelTransferIncomingChannelDto })
  channel!: ChannelTransferIncomingChannelDto;
  @ApiProperty({ type: () => ChannelTransferIncomingOwnerDto })
  currentOwner!: ChannelTransferIncomingOwnerDto;
  @ApiProperty({ required: false, nullable: true })
  noteFromRequester?: string | null;
  @ApiProperty({ description: '신청 일시' })
  requestedAt!: Date;
  @ApiProperty({ description: '마지막 알림 발송 시각' })
  lastNotifiedAt!: Date;
}

export class ChannelTransferIncomingListResponseDto {
  @ApiProperty({ type: [ChannelTransferIncomingItemDto] })
  requests!: ChannelTransferIncomingItemDto[];
}

export class ChannelTransferOutgoingTargetDto {
  @ApiProperty() id!: number;
  @ApiProperty() email!: string;
  @ApiProperty({ required: false, nullable: true })
  nickname?: string | null;
  @ApiProperty({ required: false, nullable: true })
  profileImageUrl?: string | null;
}

export class ChannelTransferOutgoingResponseDto {
  @ApiProperty() requestId!: number;
  @ApiProperty({ type: () => ChannelTransferOutgoingTargetDto })
  target!: ChannelTransferOutgoingTargetDto;
  @ApiProperty({ required: false, nullable: true })
  noteFromRequester?: string | null;
  @ApiProperty({ description: '신청 일시' })
  requestedAt!: Date;
  @ApiProperty({ description: '마지막 알림 발송 시각' })
  lastNotifiedAt!: Date;
}
