import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class SongAutocompleteQueryDto {
  @ApiPropertyOptional({
    description: '노래 제목 검색어 (비어있으면 인기곡 기준)',
    example: '폰서트',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  query?: string;

  @ApiPropertyOptional({
    description: '검색 범위 (channel 또는 global)',
    example: 'global',
    default: 'channel',
  })
  @IsOptional()
  @IsIn(['channel', 'global'])
  scope?: 'channel' | 'global';

  @ApiPropertyOptional({
    description: '반환할 추천 개수 (기본 8, 최대 20)',
    example: 8,
    default: 8,
    minimum: 1,
    maximum: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit?: number;
}
