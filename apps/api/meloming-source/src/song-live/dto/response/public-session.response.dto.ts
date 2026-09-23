import { ApiProperty } from '@nestjs/swagger';
import {
  KaraokePlaybackMode,
  KaraokeVideoType,
  SongRequestMode,
} from '@prisma/client';

export class PublicSessionSettingsDto {
  @ApiProperty({ description: '신청곡 기능 활성화 여부' })
  requestEnabled: boolean;

  @ApiProperty({ description: '신청곡 일시정지 여부' })
  paused: boolean;

  @ApiProperty({ description: '신청 명령어' })
  requestCommand: string;

  @ApiProperty({ description: '최대 대기 곡 수' })
  maxQueueSize: number;

  @ApiProperty({ description: '후원 우선순위 적용 여부' })
  donationPriorityEnabled: boolean;

  @ApiProperty({ description: '채팅 신청 허용 여부' })
  chatRequestEnabled: boolean;

  @ApiProperty({ description: '후원 전용 모드 활성화 여부' })
  donationOnlyEnabled: boolean;

  @ApiProperty({
    description: '신청곡 허용 범위 모드',
    enum: ['EVERYONE', 'VERIFIED_ONLY', 'CHAT_ONLY'],
  })
  requestMode: SongRequestMode;

  @ApiProperty({ description: '후원 신청 허용 여부' })
  donationRequestEnabled: boolean;

  @ApiProperty({
    description:
      '익명 신청 허용 여부 — EVERYONE 모드에서 로그인 없이 닉네임만 입력하여 신청 가능',
  })
  allowAnonymous: boolean;

  @ApiProperty({ description: '노래책 매칭 필수 여부' })
  requireSongMatch: boolean;

  @ApiProperty({
    description:
      '랜덤 신청 허용 여부 — 채팅 `!랜덤신청` 명령 + 웹/모바일 랜덤신청 버튼 활성. false 시 백엔드 진입에서 거부',
  })
  randomRequestEnabled: boolean;

  @ApiProperty({
    description: '싱크 노래 랜덤 후원 명령어',
    required: false,
  })
  syncRandomSongCommand?: string;

  @ApiProperty({
    description: '싱크 참여 채널 채팅 신청 허용 여부',
    required: false,
  })
  syncChatRequestsEnabled?: boolean;

  @ApiProperty({
    description: '싱크 노래 랜덤 최소 후원 개수',
    required: false,
  })
  syncRandomSongMinDonation?: number;

  @ApiProperty({
    description: '싱크 스트리머 랜덤 후원 명령어',
    required: false,
  })
  syncRandomStreamerCommand?: string;

  @ApiProperty({
    description: '싱크 스트리머 랜덤 최소 후원 개수',
    required: false,
  })
  syncRandomStreamerMinDonation?: number;

  @ApiProperty({ description: '동일 곡 중복 신청 방지' })
  preventDuplicateSongs: boolean;

  @ApiProperty({ description: '신청 불가 카테고리 ID 목록', type: [Number] })
  blockedCategoryIds: number[];

  @ApiProperty({
    description: '노래방 영상 재생 방식',
    enum: KaraokePlaybackMode,
  })
  karaokePlaybackMode: KaraokePlaybackMode;

  @ApiProperty({ description: '재생 영상 종류', enum: KaraokeVideoType })
  karaokeVideoType: KaraokeVideoType;

  @ApiProperty({ description: '오버레이에 신청자 이름 표시 여부' })
  showRequesterName: boolean;
}

export class PublicActiveSessionResponseDto {
  @ApiProperty({ description: '라이브 세션 ID', nullable: true })
  sessionId: number | null;

  @ApiProperty({ description: '라이브 상태 여부' })
  isLive: boolean;

  @ApiProperty({
    description: '세션 설정',
    nullable: true,
    type: PublicSessionSettingsDto,
  })
  settings: PublicSessionSettingsDto | null;

  @ApiProperty({ description: '현재 대기열 수' })
  queueCount: number;

  @ApiProperty({
    description: '요청 사용자가 이 세션을 관리할 수 있는지 여부',
    required: false,
  })
  canManage?: boolean;

  @ApiProperty({
    description: '운영자에게만 노출되는 연습 세션 여부',
    required: false,
  })
  isPracticeMode?: boolean;
}
