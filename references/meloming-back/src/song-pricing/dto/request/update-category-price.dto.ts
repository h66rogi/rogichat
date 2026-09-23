import { IsInt, IsObject, IsOptional, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateCategoryPriceDto {
  @ApiProperty({
    description: '카테고리 가격 (null로 설정 시 가격 제거)',
    example: 200,
    nullable: true,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  price: number | null;

  @ApiPropertyOptional({
    description: '재화별 카테고리 가격',
    example: { SOOP_BALLOON: 200, CHZZK_CHEESE: 1000 },
    nullable: true,
  })
  @IsOptional()
  @IsObject()
  currencyPrices?: Record<string, number | null> | null;
}
