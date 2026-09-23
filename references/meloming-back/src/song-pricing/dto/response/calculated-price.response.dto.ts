import { ApiProperty } from '@nestjs/swagger';
import { PriceSource } from '@prisma/client';

export class CalculatedPriceResponseDto {
  @ApiProperty({ description: '곡 ID', example: 1 })
  songId: number;

  @ApiProperty({
    description: '계산된 가격 (null이면 무료)',
    example: 500,
    nullable: true,
  })
  price: number | null;

  @ApiProperty({
    description: '가격 출처',
    enum: PriceSource,
    example: PriceSource.SONG,
  })
  source: PriceSource;

  @ApiProperty({
    description: '재화 단위 (별풍선, 치즈 등)',
    example: '별풍선',
  })
  currencyUnit: string;

  @ApiProperty({
    description: '포맷팅된 가격 문자열',
    example: '500별풍선',
  })
  formattedPrice: string;
}
