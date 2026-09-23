import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class PopularChannelsQueryDto {
  @ApiProperty({
    required: false,
    description: '조회 개수 (최대 50)',
    example: 10,
    default: 10,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 10;

  @ApiProperty({
    required: false,
    description: '최근 N일 기준으로 집계 (미지정 시 전체)',
    example: 90,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  days?: number;

  @ApiProperty({
    required: false,
    description: '즐겨찾기 가중치',
    example: 1.5,
    default: 1.5,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  favoritesWeight?: number;

  @ApiProperty({
    required: false,
    description: '노래 좋아요 가중치',
    example: 1.0,
    default: 1.0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  songLikesWeight?: number;

  @ApiProperty({
    required: false,
    description: '등록 노래 수 가중치',
    example: 0.1,
    default: 0.1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  songsWeight?: number;
}
