import { ApiProperty } from '@nestjs/swagger';
import { ClipPlatform } from '@prisma/client';
import { ScheduleResponseDto } from '../../schedule/dto/schedule.response.dto';
import { PublicSetlistSummaryDto } from '../../song-live/dto/response/public-setlist.response.dto';

/**
 * 채널 통합 캘린더 (Task 1.7) 응답 DTO.
 *
 * 5 종 데이터 소스 (schedules / broadcasts / setlists / anniversaries / clips) 를
 * 한 응답에 담는다. setlists 는 setlist 응답 DTO 를 재사용 (Task 1.4),
 * schedules 는 ScheduleResponseDto 재사용. broadcasts / anniversaries / clips 는
 * 캘린더 전용으로 신규 정의.
 */

export class CalendarRangeDto {
  @ApiProperty({
    description: 'from (요청 echo)',
    example: '2026-04-01',
  })
  from!: string;

  @ApiProperty({
    description: 'to (요청 echo)',
    example: '2026-05-31',
  })
  to!: string;
}

export class CalendarBroadcastDto {
  @ApiProperty({
    description:
      '셋리스트 매칭용 세션 키. 형식: `${platform}:${platformChannelId}:${startedAt.toISOString()}`. ' +
      'setlists[*].sessionKey 와 매칭 가능.',
    example: 'CHZZK:abc1234:2026-04-15T01:00:00.000Z',
  })
  sessionKey!: string;

  @ApiProperty({
    description: '방송 플랫폼 (CHZZK / SOOP / CIME / YOUTUBE)',
    example: 'CHZZK',
  })
  platform!: string;

  @ApiProperty({
    description: '방송 시작 시각 (ISO8601)',
    example: '2026-04-15T01:00:00.000Z',
  })
  startedAt!: string;

  @ApiProperty({
    description: '방송 종료 시각 (ISO8601). ACTIVE 면 null.',
    nullable: true,
    example: '2026-04-15T03:00:00.000Z',
  })
  endedAt!: string | null;

  @ApiProperty({
    description: '방송 상태',
    enum: ['ENDED', 'ACTIVE'],
    example: 'ENDED',
  })
  status!: 'ENDED' | 'ACTIVE';

  @ApiProperty({
    description: '방송 진행 시간 (분). ACTIVE 면 null.',
    nullable: true,
    example: 120,
  })
  durationMinutes!: number | null;

  @ApiProperty({
    description: '방송 제목 (없으면 빈 문자열)',
    example: '오늘의 신청곡 방송',
  })
  title!: string;

  @ApiProperty({
    description: '카테고리 / 게임 (없으면 빈 문자열)',
    example: 'Just Chatting',
  })
  category!: string;

  @ApiProperty({
    description: '최고 시청자 수 (없으면 0)',
    example: 1234,
  })
  peakViewerCount!: number;
}

export class CalendarAnniversaryDto {
  @ApiProperty({
    description:
      '기념일 ID. 자동 계산 (profile 의 debutDate / birthday 기반) 이면 null, ' +
      '수동 (Phase 2 의 ChannelAnniversary 테이블) 이면 cuid.',
    nullable: true,
    example: null,
  })
  id!: string | null;

  @ApiProperty({
    description: '기념일 출처. Phase 1 은 모두 AUTO.',
    enum: ['AUTO', 'MANUAL'],
    example: 'AUTO',
  })
  source!: 'AUTO' | 'MANUAL';

  @ApiProperty({
    description: '기념일 종류. Phase 1 은 BIRTHDAY / BROADCAST_MILESTONE.',
    enum: ['BIRTHDAY', 'BROADCAST_MILESTONE'],
    example: 'BROADCAST_MILESTONE',
  })
  type!: 'BIRTHDAY' | 'BROADCAST_MILESTONE';

  @ApiProperty({
    description: '기념일 표시명 (예: "100일", "1주년", "생일")',
    example: '100일',
  })
  title!: string;

  @ApiProperty({
    description: '기념일 날짜 (ISO8601 — KST 자정의 UTC 표현)',
    example: '2026-04-15T00:00:00.000Z',
  })
  date!: string;
}

export class CalendarClipDto {
  @ApiProperty({
    description: '클립 ID',
    example: 1234,
  })
  id!: number;

  @ApiProperty({
    description: '클립 제목',
    example: '오늘의 명곡 모음',
  })
  title!: string;

  @ApiProperty({
    description: '클립 플랫폼 (YOUTUBE / SOOP / CHZZK / OTHER)',
    enum: ['YOUTUBE', 'SOOP', 'CHZZK', 'OTHER'],
    example: 'YOUTUBE',
  })
  platform!: ClipPlatform;

  @ApiProperty({
    description:
      '플랫폼 video ID (YouTube/SOOP/CHZZK 식별자). OTHER 면 null 가능.',
    nullable: true,
    example: 'dQw4w9WgXcQ',
  })
  videoId!: string | null;

  @ApiProperty({
    description: '비디오 URL (OTHER 플랫폼용 또는 전체 URL)',
    nullable: true,
    example: 'https://youtube.com/watch?v=dQw4w9WgXcQ',
  })
  videoUrl!: string | null;

  @ApiProperty({
    description: '썸네일 URL',
    nullable: true,
    example: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
  })
  thumbnailUrl!: string | null;

  @ApiProperty({
    description: '재생 시간 (초)',
    nullable: true,
    example: 213,
  })
  duration!: number | null;

  @ApiProperty({
    description: '클립 생성 시각 (ISO8601). 캘린더 표시 기준 시점.',
    example: '2026-04-15T01:00:00.000Z',
  })
  createdAt!: string;

  @ApiProperty({
    description:
      '해당 채널이 이 클립의 메인 채널인지 여부. 듀엣/단체곡일 때 false 면 출연(태그) 채널.',
    example: true,
  })
  isPrimary!: boolean;

  @ApiProperty({
    description: '연결된 노래 제목 (없으면 null)',
    nullable: true,
    example: 'Never Gonna Give You Up',
  })
  songTitle!: string | null;
}

export class ChannelCalendarResponseDto {
  @ApiProperty({
    description: '채널 ID (numeric ID 의 문자열 표현)',
    example: '123',
  })
  channelId!: string;

  @ApiProperty({
    description: '요청 범위 echo',
    type: CalendarRangeDto,
  })
  range!: CalendarRangeDto;

  @ApiProperty({
    description:
      '채널 일정 목록 (PUBLIC + 본인/매니저면 PRIVATE 포함). 기존 ScheduleResponseDto 재사용.',
    type: [ScheduleResponseDto],
  })
  schedules!: ScheduleResponseDto[];

  @ApiProperty({
    description:
      '방송 기록 목록. 종료된 source의 fail-open 계약을 유지해 현재는 빈 배열.',
    type: [CalendarBroadcastDto],
  })
  broadcasts!: CalendarBroadcastDto[];

  @ApiProperty({
    description:
      '셋리스트 목록 (재생 완료 곡 ≥ 1 의 종료 세션). 기존 PublicSetlistSummaryDto 재사용. ' +
      '`sessionKey` 로 broadcasts 와 매칭 가능.',
    type: [PublicSetlistSummaryDto],
  })
  setlists!: PublicSetlistSummaryDto[];

  @ApiProperty({
    description:
      '기념일 목록. Phase 1 은 profile 의 debutDate (100일 / N주년) + birthday 기반 ' +
      '자동 계산만 포함 (source = AUTO).',
    type: [CalendarAnniversaryDto],
  })
  anniversaries!: CalendarAnniversaryDto[];

  @ApiProperty({
    description:
      '노래 클립 목록. 채널이 메인/출연으로 연결된 VISIBLE 클립을 createdAt DESC 로 반환. ' +
      '`createdAt` 이 [from, to) 안에 들어오는 것만 포함.',
    type: [CalendarClipDto],
  })
  clips!: CalendarClipDto[];
}
