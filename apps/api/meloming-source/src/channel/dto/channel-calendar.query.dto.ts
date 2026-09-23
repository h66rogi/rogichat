import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsISO8601, IsOptional } from 'class-validator';

/**
 * 채널 통합 캘린더 (Task 1.7) 쿼리 DTO.
 *
 * - `from`, `to`: half-open `[from, to)` 범위. RFC 3339 / YYYY-MM-DD 모두 허용
 *   (`@IsISO8601()`). cross-field 검증 (`to > from`, `to - from <= 13개월`) 은
 *   service 레이어에서 수행.
 * - include 플래그: 5종 데이터 소스 (schedules / broadcasts / setlists /
 *   anniversaries / clips) 의 부분 포함을 허용. 미지정 시 모두 true.
 *
 * 문자열 → boolean 변환은 query string 특성상 항상 string 으로 들어오므로
 * `@Transform` 으로 'true'/'false' 만 명시적으로 매핑한다.
 */
function parseBooleanQueryFlag(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return undefined;
  const lower = value.toLowerCase();
  if (lower === 'true' || lower === '1') return true;
  if (lower === 'false' || lower === '0') return false;
  return undefined;
}

export class ChannelCalendarQueryDto {
  @ApiProperty({
    description:
      '조회 범위 시작 (RFC 3339 또는 YYYY-MM-DD, inclusive). half-open `[from, to)`.',
    example: '2026-04-01',
  })
  @IsISO8601()
  from!: string;

  @ApiProperty({
    description:
      '조회 범위 끝 (RFC 3339 또는 YYYY-MM-DD, exclusive). half-open `[from, to)`.',
    example: '2026-05-31',
  })
  @IsISO8601()
  to!: string;

  @ApiProperty({
    description: '방송기록 (broadcasts) 포함 여부 (default: true)',
    required: false,
    default: true,
  })
  @IsOptional()
  @Transform(({ value }) => parseBooleanQueryFlag(value))
  @IsBoolean()
  includeBroadcasts?: boolean;

  @ApiProperty({
    description: '셋리스트 (setlists) 포함 여부 (default: true)',
    required: false,
    default: true,
  })
  @IsOptional()
  @Transform(({ value }) => parseBooleanQueryFlag(value))
  @IsBoolean()
  includeSetlists?: boolean;

  @ApiProperty({
    description: '기념일 (anniversaries) 포함 여부 (default: true)',
    required: false,
    default: true,
  })
  @IsOptional()
  @Transform(({ value }) => parseBooleanQueryFlag(value))
  @IsBoolean()
  includeAnniversaries?: boolean;

  @ApiProperty({
    description: '일정 (schedules) 포함 여부 (default: true)',
    required: false,
    default: true,
  })
  @IsOptional()
  @Transform(({ value }) => parseBooleanQueryFlag(value))
  @IsBoolean()
  includeSchedules?: boolean;

  @ApiProperty({
    description: '노래 클립 (clips) 포함 여부 (default: true)',
    required: false,
    default: true,
  })
  @IsOptional()
  @Transform(({ value }) => parseBooleanQueryFlag(value))
  @IsBoolean()
  includeClips?: boolean;
}
