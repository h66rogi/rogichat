import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  CurrencyConfig,
  CurrencyPriceMap,
  DifficultyPrices,
  DifficultyPricesByCurrency,
} from '../../types/pricing.types';

export class PricingSettingsResponseDto {
  @ApiProperty({ description: '채널 ID', example: 1 })
  channelId: number;

  @ApiProperty({ description: '가격 기능 활성화 여부', example: true })
  pricingEnabled: boolean;

  @ApiPropertyOptional({
    description: '기본 가격',
    example: 100,
    nullable: true,
  })
  defaultPrice: number | null;

  @ApiPropertyOptional({
    description: '재화별 기본 가격',
    example: { SOOP_BALLOON: 500, CHZZK_CHEESE: 2000 },
    nullable: true,
  })
  defaultPrices: CurrencyPriceMap | null;

  @ApiPropertyOptional({
    description: '난이도별 가격 설정',
    example: { '1': 50, '2': 100, '3': 150, '4': 200, '5': 300 },
    nullable: true,
  })
  difficultyPrices: DifficultyPrices | null;

  @ApiPropertyOptional({
    description: '재화별 난이도 가격 설정',
    example: {
      SOOP_BALLOON: { '1': 200, '2': 300, '3': 400 },
      CHZZK_CHEESE: { '1': 1000, '2': 1500, '3': 2000 },
    },
    nullable: true,
  })
  difficultyPricesByCurrency: DifficultyPricesByCurrency | null;

  @ApiProperty({
    description: '재화 단위 (별풍선, 치즈 등)',
    example: '별풍선',
  })
  currencyUnit: string;

  @ApiProperty({
    description:
      '다중 재화 설정 (amount가 null인 항목은 선택 상태만 유지되며 미표기 대상)',
    example: [
      { key: 'SOOP_BALLOON', unit: '별풍선', amount: 500 },
      { key: 'CHZZK_CHEESE', unit: '치즈', amount: null },
    ],
    type: 'array',
  })
  currencyConfigs: CurrencyConfig[];
}
