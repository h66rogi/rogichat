import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ChannelCalendarQueryDto } from './channel-calendar.query.dto';

/**
 * 채널 통합 캘린더 검색 쿼리 DTO.
 *
 * `ChannelCalendarQueryDto` (from / to / include 플래그 5종) 를 그대로 상속하여
 * 동일한 범위·소스 토글 컨벤션을 재사용하고, 검색 키워드 `q` 와 결과 상한 `limit`
 * 만 추가한다. cross-field 검증 (`to > from`, 13개월 cap) 은 상위 service 에서 수행.
 */
export class CalendarSearchQueryDto extends ChannelCalendarQueryDto {
  @ApiProperty({
    description:
      '검색 키워드. 일정(제목/내용/장소), 방송 기록(제목/카테고리), 노래 방송(곡 제목/아티스트), ' +
      '클립(제목/곡 제목), 기념일(표시명) 에 대해 부분 일치(대소문자 무시) 매칭한다.',
    example: '정기방송',
    maxLength: 100,
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  q!: string;

  @ApiProperty({
    description: '최대 결과 수 (병합·정렬 후 상한). default 50, max 100.',
    required: false,
    default: 50,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
