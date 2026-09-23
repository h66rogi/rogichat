import { IsOptional, IsEnum, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { SongAddRequestStatus } from '@prisma/client';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class SongAddRequestListQueryDto {
  @ApiPropertyOptional({
    description: '상태 필터',
    enum: SongAddRequestStatus,
  })
  @IsOptional()
  @IsEnum(SongAddRequestStatus)
  status?: SongAddRequestStatus;

  @ApiPropertyOptional({ description: '커서 (마지막 조회된 ID)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  cursorId?: number;

  @ApiPropertyOptional({ description: '조회 개수 (기본 20, 최대 100)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  take?: number;
}
