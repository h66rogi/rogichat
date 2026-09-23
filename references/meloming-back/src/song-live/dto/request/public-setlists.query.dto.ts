import { IsISO8601, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * 공개 셋리스트 목록 query DTO.
 *
 * 채널 통합 캘린더에서 월별로 호출하기 위해 from/to (RFC 3339, half-open
 * `[from, to)`) 를 추가했다. 두 필드는 함께 와야 하며, cross-field 제약
 * (`to > from`, `to - from <= 90일`) 은 service 레이어에서 검증한다.
 */
export class PublicSetlistsQueryDto {
  @IsString()
  identifier: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  /**
   * 조회 범위 시작 (inclusive). RFC 3339 (`@IsISO8601`).
   * `to` 와 함께 와야 한다 (only-one 검증은 service 레이어).
   */
  @IsOptional()
  @IsISO8601()
  from?: string;

  /**
   * 조회 범위 끝 (exclusive). RFC 3339 (`@IsISO8601`).
   * `from` 과 함께 와야 한다 (only-one 검증은 service 레이어).
   */
  @IsOptional()
  @IsISO8601()
  to?: string;
}
