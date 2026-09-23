import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SongArtistSuggestQueryDto {
  @ApiProperty({
    description: '입력한 노래 제목',
    example: '폰서트',
    maxLength: 200,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @ApiPropertyOptional({
    description: '검색 범위 (channel 또는 global)',
    example: 'global',
    default: 'channel',
  })
  @IsOptional()
  @IsIn(['channel', 'global'])
  scope?: 'channel' | 'global';

  @ApiPropertyOptional({
    description: '반환할 추천 개수 (기본 5, 최대 20)',
    example: 5,
    default: 5,
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
