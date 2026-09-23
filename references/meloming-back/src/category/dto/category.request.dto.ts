import { IsString, IsOptional, IsInt, Min, IsObject } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CreateCategoryDto {
  @ApiProperty({ description: '카테고리 이름', example: '발라드' })
  @IsString()
  name: string;

  @ApiProperty({ description: '카테고리 색상 HEX', example: '#3B82F6' })
  @IsString()
  color: string;

  @ApiPropertyOptional({
    description:
      '카테고리 표시 순서 (큰 숫자일수록 앞에 표시, null이면 생성일순)',
    example: 1,
    nullable: true,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  displayOrder?: number;

  @ApiPropertyOptional({
    description: '신청곡 가격 (null이면 기본 가격 적용)',
    example: 200,
    nullable: true,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  price?: number;

  @ApiPropertyOptional({
    description: '재화별 카테고리 가격',
    example: { SOOP_BALLOON: 200, CHZZK_CHEESE: 1000 },
    nullable: true,
  })
  @IsOptional()
  @IsObject()
  currencyPrices?: Record<string, number | null> | null;
}

export class UpdateCategoryDto {
  @ApiPropertyOptional({ description: '카테고리 이름', example: '발라드' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: '카테고리 색상 HEX', example: '#3B82F6' })
  @IsOptional()
  @IsString()
  color?: string;

  @ApiPropertyOptional({
    description:
      '카테고리 표시 순서 (큰 숫자일수록 앞에 표시, null이면 생성일순)',
    example: 1,
    nullable: true,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  displayOrder?: number | null;

  @ApiPropertyOptional({
    description: '신청곡 가격 (null이면 가격 제거)',
    example: 200,
    nullable: true,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  price?: number | null;

  @ApiPropertyOptional({
    description: '재화별 카테고리 가격 (null이면 재화별 가격 제거)',
    example: { SOOP_BALLOON: 200, CHZZK_CHEESE: 1000 },
    nullable: true,
  })
  @IsOptional()
  @IsObject()
  currencyPrices?: Record<string, number | null> | null;
}

export class SwapCategoryOrderDto {
  @ApiProperty({
    description: '순서를 변경할 카테고리 ID',
    example: 10,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  categoryId: number;

  @ApiProperty({
    description: '교체 대상 카테고리 ID',
    example: 11,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  targetCategoryId: number;
}
