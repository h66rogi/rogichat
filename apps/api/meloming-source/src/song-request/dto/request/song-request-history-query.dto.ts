import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class SongRequestHistoryQueryDto {
  @ApiProperty({ description: '곡 ID', example: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  songId!: number;

  @ApiProperty({ description: '채널 ID', example: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  channelId!: number;

  @ApiProperty({
    description: '페이지 (1부터)',
    example: 1,
    required: false,
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiProperty({
    description: '페이지 크기',
    example: 20,
    required: false,
    default: 20,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
