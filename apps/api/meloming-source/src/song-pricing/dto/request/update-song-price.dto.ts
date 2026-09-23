import { IsInt, IsObject, IsOptional, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateSongPriceDto {
  @ApiProperty({
    description: '곡 가격 (null로 설정 시 가격 제거)',
    example: 500,
    nullable: true,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  price: number | null;

  @ApiPropertyOptional({
    description: '재화별 곡 가격',
    example: { SOOP_BALLOON: 500, CHZZK_CHEESE: 2000 },
    nullable: true,
  })
  @IsOptional()
  @IsObject()
  currencyPrices?: Record<string, number | null> | null;
}
