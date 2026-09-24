import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  SongRequestStatus,
  SongRequestSource,
  SongRequestType,
  KaraokePlaybackMode,
  KaraokeVideoType,
  PriceSource,
} from '../../../../../../generated/prisma/client.js';
import type { WidgetType as OverlayWidgetTypeValue } from '../../../theme-manifest/widget-types.js';

export class OverlaySettingsDto {
  @ApiProperty({ description: '신청곡 활성화 여부' })
  requestEnabled!: boolean;

  @ApiProperty({ description: '신청곡 일시정지 여부' })
  paused!: boolean;

  @ApiProperty({ description: '신청 명령어', example: '!신청' })
  requestCommand!: string;

  @ApiProperty({ description: '최대 대기열 크기', example: 50 })
  maxQueueSize!: number;

  @ApiProperty({ description: '후원 우선순위 활성화' })
  donationPriorityEnabled!: boolean;

  @ApiProperty({
    description: '노래방 영상 재생 방식',
    enum: KaraokePlaybackMode,
  })
  karaokePlaybackMode!: KaraokePlaybackMode;

  @ApiProperty({ description: '재생 영상 종류', enum: KaraokeVideoType })
  karaokeVideoType!: KaraokeVideoType;

  @ApiProperty({ description: '오버레이에 신청자 이름 표시 여부' })
  showRequesterName!: boolean;

  @ApiPropertyOptional({ description: '채팅 신청 활성화 여부' })
  chatRequestEnabled?: boolean;

  @ApiPropertyOptional({ description: '후원 신청 활성화 여부' })
  donationRequestEnabled?: boolean;

  @ApiPropertyOptional({ description: '후원 신청만 허용 여부' })
  donationOnlyEnabled?: boolean;

  @ApiPropertyOptional({ description: '랜덤 신청 활성화 여부' })
  randomRequestEnabled?: boolean;

  @ApiPropertyOptional({ description: 'Sync 일반 채팅 신청 허용 여부' })
  syncChatRequestsEnabled?: boolean;

  @ApiPropertyOptional({ description: 'Sync 랜덤 곡 명령어' })
  syncRandomSongCommand?: string;

  @ApiPropertyOptional({ description: 'Sync 랜덤 곡 최소 후원 수량' })
  syncRandomSongMinDonation?: number;

  @ApiPropertyOptional({ description: 'Sync 스트리머 랜덤 명령어' })
  syncRandomStreamerCommand?: string;

  @ApiPropertyOptional({ description: 'Sync 스트리머 랜덤 최소 후원 수량' })
  syncRandomStreamerMinDonation?: number;
}

export class OverlayChannelDto {
  @ApiProperty({ description: '채널 ID' })
  id!: number;

  @ApiProperty({ description: '채널명' })
  name!: string;

  @ApiProperty({ description: '채널 주소' })
  webPath!: string;

  @ApiPropertyOptional({ description: '채널 프로필 이미지 URL' })
  profileImageUrl?: string | null;

  @ApiProperty({ description: '테마 색상' })
  themeColor!: string;
}

export class OverlaySongArtistDto {
  @ApiProperty({ description: '아티스트 ID' })
  id!: number;

  @ApiProperty({ description: '아티스트명' })
  name!: string;
}

export class OverlaySongDto {
  @ApiProperty({ description: '노래 ID' })
  id!: number;

  @ApiProperty({ description: '노래 제목' })
  title!: string;

  @ApiProperty({ description: '아티스트 정보' })
  artist!: OverlaySongArtistDto;

  @ApiPropertyOptional({ description: '앨범 아트 URL' })
  albumArt?: string | null;

  @ApiPropertyOptional({ description: '노래방 URL' })
  karaokeUrl?: string | null;

  @ApiPropertyOptional({ description: '커버 URL' })
  coverUrl?: string | null;

  @ApiPropertyOptional({ description: '원곡 URL' })
  originalUrl?: string | null;

  @ApiPropertyOptional({ description: '가사 링크' })
  lyricsLink?: string | null;

  // lyricsText: 작가 비공개 메모. overlay 응답 contract 에서 의도적으로 제거 —
  // 매니저용 endpoint 는 song-mappers 의 exposeLyrics 옵션으로 별도 expose.
  @ApiPropertyOptional({ description: '설명' })
  description?: string | null;

  @ApiPropertyOptional({ description: '난이도 (1-5)' })
  difficulty?: number | null;

  @ApiPropertyOptional({ description: '숙련도 (1-5)' })
  proficiency?: number | null;

  @ApiPropertyOptional({ description: '키' })
  songKey?: string | null;

  @ApiPropertyOptional({ description: 'BPM' })
  bpm?: number | null;
}

export class OverlaySongRequestDto {
  @ApiProperty({ description: '신청곡 ID' })
  id!: number;

  @ApiPropertyOptional({ description: '연결된 노래 정보' })
  song?: OverlaySongDto | null;

  @ApiProperty({ description: '원본 아티스트' })
  rawArtist!: string;

  @ApiProperty({ description: '원본 제목' })
  rawTitle!: string;

  @ApiPropertyOptional({ description: '신청자 메시지' })
  rawMessage?: string | null;

  @ApiProperty({ description: '신청자 플랫폼 ID' })
  requesterPlatformId!: string;

  @ApiProperty({ description: '신청자 닉네임' })
  requesterNickname!: string;

  @ApiProperty({ description: '상태', enum: SongRequestStatus })
  status!: SongRequestStatus;

  @ApiProperty({ description: '신청 출처', enum: SongRequestSource })
  source!: SongRequestSource;

  @ApiProperty({ description: '신청 타입', enum: SongRequestType })
  requestType!: SongRequestType;

  @ApiPropertyOptional({ description: '후원 금액' })
  donationAmount?: number | null;

  @ApiPropertyOptional({
    description: '네이티브 재화 수량 (예: 별풍선 2개)',
    nullable: true,
  })
  donationNativeAmount?: number | null;

  @ApiPropertyOptional({
    description:
      '후원 재화 키 (SOOP_BALLOON/CHZZK_CHEESE/CIME_BEAM/KRW_LEGACY)',
    nullable: true,
  })
  donationCurrency?: string | null;

  @ApiProperty({ description: '우선순위' })
  priority!: number;

  @ApiProperty({ description: '대기열 순서' })
  queueOrder!: number;

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
    example: '500별풍선 / 1,000치즈',
    nullable: true,
  })
  formattedPrice?: string | null;

  @ApiPropertyOptional({ description: '재생 시각' })
  playedAt?: Date | null;

  @ApiPropertyOptional({ description: '완료 시각' })
  completedAt?: Date | null;

  @ApiPropertyOptional({ description: '거절 사유' })
  rejectionReason?: string | null;

  @ApiProperty({ description: '생성 시각' })
  createdAt!: Date;

  @ApiProperty({ description: '수정 시각' })
  updatedAt!: Date;
}

export class OverlayOmakaseDto {
  @ApiProperty({ description: '오마카세 활성화 여부' })
  enabled!: boolean;

  @ApiProperty({ description: '표시명', example: '도마카세' })
  displayName!: string;

  @ApiProperty({ description: '잔여 개수' })
  count!: number;
}

export class OverlayPlaybackSnapshotItemDto {
  @ApiProperty({ description: '신청곡 ID' })
  requestId!: number;

  @ApiPropertyOptional({ description: '연결된 노래 ID', nullable: true })
  songId?: number | null;

  @ApiProperty({ description: '표시 제목' })
  title!: string;

  @ApiProperty({ description: '표시 아티스트' })
  artist!: string;

  @ApiPropertyOptional({ description: '앨범 아트 URL', nullable: true })
  albumArt?: string | null;

  @ApiPropertyOptional({ description: '커버 URL', nullable: true })
  coverUrl?: string | null;

  @ApiPropertyOptional({ description: '원본 제목' })
  rawTitle?: string | null;

  @ApiPropertyOptional({ description: '원본 아티스트' })
  rawArtist?: string | null;

  @ApiProperty({ description: '신청자 플랫폼 ID' })
  requesterPlatformId!: string;

  @ApiProperty({ description: '신청자 닉네임' })
  requesterNickname!: string;

  @ApiProperty({ description: '상태', enum: SongRequestStatus })
  status!: SongRequestStatus;

  @ApiProperty({ description: '신청 출처', enum: SongRequestSource })
  source!: SongRequestSource;

  @ApiProperty({ description: '신청 타입', enum: SongRequestType })
  requestType!: SongRequestType;

  @ApiPropertyOptional({ description: '후원 금액', nullable: true })
  donationAmount?: number | null;

  @ApiPropertyOptional({
    description: '네이티브 재화 수량 (예: 별풍선 2개)',
    nullable: true,
  })
  donationNativeAmount?: number | null;

  @ApiPropertyOptional({
    description:
      '후원 재화 키 (SOOP_BALLOON/CHZZK_CHEESE/CIME_BEAM/KRW_LEGACY)',
    nullable: true,
  })
  donationCurrency?: string | null;

  @ApiProperty({ description: '우선순위' })
  priority!: number;

  @ApiProperty({ description: '대기열 순서' })
  queueOrder!: number;

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
    example: '500별풍선 / 1,000치즈',
    nullable: true,
  })
  formattedPrice?: string | null;

  @ApiPropertyOptional({ description: '재생 시각', nullable: true })
  playedAt?: string | null;

  @ApiPropertyOptional({ description: '완료 시각', nullable: true })
  completedAt?: string | null;

  @ApiProperty({ description: '생성 시각' })
  createdAt!: string;

  @ApiProperty({ description: '수정 시각' })
  updatedAt!: string;

  @ApiPropertyOptional({ description: 'Sync 원본 채널 ID', nullable: true })
  sourceChannelId?: number | null;

  @ApiPropertyOptional({
    description: 'Sync 요청을 처리할 수 있는 채널 목록',
    type: 'array',
    items: { type: 'object' },
  })
  availableChannels?: unknown[];
}

export class OverlayPlaybackSnapshotSourceDto {
  @ApiProperty({ description: 'snapshot 생성 서비스' })
  producer!: string;

  @ApiProperty({ description: 'snapshot 생성 모드' })
  mode!: string;
}

export class OverlayPlaybackSnapshotDto {
  @ApiProperty({ description: 'event name' })
  event!: 'overlay.playback.snapshot.v1';

  @ApiProperty({ description: 'contract version', example: 1 })
  contractVersion!: 1;

  @ApiProperty({ description: '채널 ID' })
  channelId!: number;

  @ApiPropertyOptional({ description: '활성 세션 ID', nullable: true })
  activeSessionId!: number | null;

  @ApiPropertyOptional({ description: '요청 세션 ID', nullable: true })
  requestedSessionId?: number | null;

  @ApiPropertyOptional({
    description:
      '세션 epoch = 활성(또는 방금 종료된) LiveSession.id. 세션 이력이 전혀 없으면 null.',
    nullable: true,
  })
  sessionEpoch!: number | null;

  @ApiPropertyOptional({
    description:
      'snapshot revision = LiveSession.playbackRevision (단조 증가 카운터). 세션 이력이 전혀 없으면 null (client 는 dedup 없이 apply).',
    nullable: true,
  })
  revision!: number | null;

  @ApiProperty({ description: '라이브 활성 상태' })
  isLive!: boolean;

  @ApiPropertyOptional({
    description: '현재 재생 중인 곡',
    type: OverlayPlaybackSnapshotItemDto,
    nullable: true,
  })
  nowPlaying!: OverlayPlaybackSnapshotItemDto | null;

  @ApiProperty({
    description: 'pending queue snapshot',
    type: [OverlayPlaybackSnapshotItemDto],
  })
  queue!: OverlayPlaybackSnapshotItemDto[];

  @ApiProperty({
    description: 'setlist snapshot',
    type: [OverlayPlaybackSnapshotItemDto],
  })
  setlist!: OverlayPlaybackSnapshotItemDto[];

  @ApiPropertyOptional({ description: '세션 설정', type: OverlaySettingsDto })
  settings?: OverlaySettingsDto | null;

  @ApiPropertyOptional({
    description: '위젯별 resolved theme',
    type: 'object',
    additionalProperties: { type: 'string' },
  })
  themes?: Record<string, string>;

  @ApiPropertyOptional({
    description: '통합 오버레이 레이아웃',
    type: 'object',
    additionalProperties: true,
  })
  layout?: Record<string, unknown> | null;

  @ApiPropertyOptional({
    description: '통합 오버레이 레이아웃 저장 revision',
  })
  layoutVersion?: number;

  @ApiPropertyOptional({
    description: '통합 오버레이 레이아웃 마지막 수정 시각',
    nullable: true,
  })
  layoutUpdatedAt?: string | null;

  @ApiProperty({
    description: 'snapshot source',
    type: OverlayPlaybackSnapshotSourceDto,
  })
  source!: OverlayPlaybackSnapshotSourceDto;

  @ApiProperty({ description: 'snapshot 생성 시각' })
  emittedAt!: string;
}

export class OverlayDataResponseDto {
  @ApiPropertyOptional({ description: '세션 ID (활성 세션이 없으면 null)' })
  sessionId!: number | null;

  @ApiProperty({ description: '채널 정보' })
  channel!: OverlayChannelDto;

  @ApiPropertyOptional({ description: '세션 설정 (활성 세션이 없으면 null)' })
  settings!: OverlaySettingsDto | null;

  @ApiProperty({ description: '현재 대기열', type: [OverlaySongRequestDto] })
  queue!: OverlaySongRequestDto[];

  @ApiProperty({
    description:
      '세션 전체 셋리스트 (COMPLETED + PLAYING + PENDING + ACCEPTED)',
    type: [OverlaySongRequestDto],
  })
  setlist!: OverlaySongRequestDto[];

  @ApiPropertyOptional({
    description: '현재 재생 중인 곡',
    type: OverlaySongRequestDto,
    nullable: true,
  })
  nowPlaying?: OverlaySongRequestDto | null;

  @ApiPropertyOptional({
    description: '오마카세 표시 상태. 비활성 또는 설정 없음이면 null.',
    type: OverlayOmakaseDto,
    nullable: true,
  })
  omakase?: OverlayOmakaseDto | null;

  @ApiProperty({
    description:
      '위젯별로 resolve된 effective 테마 ID (now-playing/queue/chatbox/setlist). 채널 기본 테마 + 위젯별 override를 적용한 결과.',
    type: 'object',
    additionalProperties: { type: 'string' },
    example: {
      'now-playing': 'apple',
      queue: 'apple',
      chatbox: 'kawaii',
      setlist: 'apple',
    },
  })
  resolvedThemes!: Record<string, string>;

  @ApiPropertyOptional({
    description:
      '위젯별 resolved 옵션 (catalog defaults + 채널/위젯 커스텀 머지)',
    type: 'object',
    additionalProperties: true,
  })
  resolvedOptions?: Record<string, Record<string, unknown>>;

  @ApiPropertyOptional({
    description: '위젯별 활성화된 커스텀 CSS',
    example: { queue: '.queue { color: red; }', 'now-playing': null },
  })
  widgetCustomCss?: Partial<Record<OverlayWidgetTypeValue, string | null>>;

  @ApiPropertyOptional({
    description: '통합 오버레이 레이아웃',
    type: 'object',
    additionalProperties: true,
  })
  totalLayout?: Record<string, unknown>;

  @ApiPropertyOptional({
    description: '통합 오버레이 레이아웃 저장 revision. 기본값이면 0.',
  })
  totalLayoutVersion?: number;

  @ApiPropertyOptional({
    description: '통합 오버레이 레이아웃 마지막 수정 시각. 기본값이면 null.',
    nullable: true,
  })
  totalLayoutUpdatedAt?: string | null;

  @ApiPropertyOptional({
    description: '세션 시작 시각 (활성 세션이 없으면 null)',
  })
  startedAt!: Date | null;

  @ApiProperty({ description: '라이브 활성 상태' })
  isLive!: boolean;

  @ApiPropertyOptional({
    description:
      'Gateway sync 전용 playback snapshot. 기존 필드와 queue.sync 호환성을 유지한 채 additive로 제공한다.',
    type: OverlayPlaybackSnapshotDto,
  })
  playbackSnapshot?: OverlayPlaybackSnapshotDto;
}
