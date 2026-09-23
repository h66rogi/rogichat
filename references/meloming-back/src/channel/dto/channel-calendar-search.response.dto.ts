import { ApiProperty } from '@nestjs/swagger';
import { CalendarRangeDto } from './channel-calendar.response.dto';

/**
 * 통합 캘린더 검색 결과 아이템 타입.
 * 5종 데이터 소스를 하나의 flat 리스트로 통합하기 위한 discriminator.
 */
export type CalendarSearchItemType =
  | 'SCHEDULE'
  | 'BROADCAST'
  | 'SETLIST'
  | 'CLIP'
  | 'ANNIVERSARY';

/**
 * 통합 캘린더 검색 결과 1건.
 *
 * 5종(일정/방송기록/노래방송/클립/기념일)을 하나의 flat 리스트로 합치므로,
 * 표시용 공통 필드(`type`/`date`/`title`/`subtitle`)와 클릭 시 해당 항목으로
 * 이동/오픈하기 위한 타입별 식별자(scheduleId/sessionKey/sessionId/clipId/
 * anniversaryType)를 함께 담는다. 해당 타입이 아닌 식별자는 모두 null.
 *
 * `date` 는 캘린더가 그 날짜로 이동하는 기준 시각 — 일정은 startAt, 방송기록/
 * 노래방송은 startedAt, 클립은 createdAt, 기념일은 date.
 */
export class CalendarSearchItemDto {
  @ApiProperty({
    description: '항목 종류',
    enum: ['SCHEDULE', 'BROADCAST', 'SETLIST', 'CLIP', 'ANNIVERSARY'],
    example: 'SCHEDULE',
  })
  type!: CalendarSearchItemType;

  @ApiProperty({
    description: '이동 기준 날짜 (ISO8601). 클릭 시 캘린더가 이 날짜로 이동.',
    example: '2026-04-15T12:00:00.000Z',
  })
  date!: string;

  @ApiProperty({ description: '결과 표시 제목', example: '정기 방송' })
  title!: string;

  @ApiProperty({
    description: '결과 보조 설명 (장소 / 카테고리 / 매칭 곡 등). 없으면 null.',
    nullable: true,
    example: '온라인',
  })
  subtitle!: string | null;

  @ApiProperty({
    description: 'SCHEDULE 일 때 일정 ID. 그 외 null.',
    nullable: true,
    example: 123,
  })
  scheduleId!: number | null;

  @ApiProperty({
    description:
      'BROADCAST/SETLIST 일 때 세션 키 (`${platform}:${platformChannelId}:${startedAt}`). 그 외 null.',
    nullable: true,
    example: 'CHZZK:abc1234:2026-04-15T01:00:00.000Z',
  })
  sessionKey!: string | null;

  @ApiProperty({
    description: 'SETLIST 일 때 세션 ID. 그 외 null.',
    nullable: true,
    example: 456,
  })
  sessionId!: number | null;

  @ApiProperty({
    description: 'CLIP 일 때 클립 ID. 그 외 null.',
    nullable: true,
    example: 789,
  })
  clipId!: number | null;

  @ApiProperty({
    description:
      'ANNIVERSARY 일 때 기념일 종류 (BIRTHDAY / BROADCAST_MILESTONE). 그 외 null.',
    nullable: true,
    example: 'BIRTHDAY',
  })
  anniversaryType!: string | null;
}

export class CalendarSearchResponseDto {
  @ApiProperty({
    description: '채널 ID (numeric ID 의 문자열 표현)',
    example: '123',
  })
  channelId!: string;

  @ApiProperty({ description: '검색 키워드 echo', example: '정기방송' })
  query!: string;

  @ApiProperty({ description: '검색 범위 echo', type: CalendarRangeDto })
  range!: CalendarRangeDto;

  @ApiProperty({
    description: '전체 매칭 수 (limit 상한 적용 전)',
    example: 12,
  })
  total!: number;

  @ApiProperty({
    description: '검색 결과 (date DESC 정렬, limit 상한 적용 후)',
    type: [CalendarSearchItemDto],
  })
  items!: CalendarSearchItemDto[];
}
