import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export type UpcomingHighlightsOrder = 'date' | 'random';

export class UpcomingAnniversaryHighlightsQueryDto {
  @ApiPropertyOptional({
    description: '기간(일) 필터 (기본 7일)',
    default: 7,
    minimum: 1,
    maximum: 30,
    example: 7,
  })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  days?: number;

  @ApiPropertyOptional({
    description: '수량 제한 (기본 10개)',
    default: 10,
    minimum: 1,
    maximum: 50,
    example: 10,
  })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @ApiPropertyOptional({
    description:
      "정렬 방식 (기본 'date' = 가까운 날짜 우선, 'random' = seed 기반 셔플)",
    enum: ['date', 'random'],
    default: 'date',
    example: 'date',
  })
  @IsOptional()
  @IsIn(['date', 'random'])
  order?: UpcomingHighlightsOrder;

  @ApiPropertyOptional({
    description:
      'random 정렬 시 사용할 seed (미지정 시 KST 기준 YYYY-MM-DD로 고정)',
    example: '2025-12-17',
  })
  @IsOptional()
  @IsString()
  seed?: string;
}
