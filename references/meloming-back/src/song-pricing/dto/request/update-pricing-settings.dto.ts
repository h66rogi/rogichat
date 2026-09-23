import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsInt,
  Min,
  ValidateNested,
  IsString,
  IsNotEmpty,
  MaxLength,
  IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

class DifficultyPricesDto {
  @ApiPropertyOptional({ description: '난이도 1 가격', example: 50 })
  @IsOptional()
  @IsInt()
  @Min(0)
  '1'?: number | null;

  @ApiPropertyOptional({ description: '난이도 2 가격', example: 100 })
  @IsOptional()
  @IsInt()
  @Min(0)
  '2'?: number | null;

  @ApiPropertyOptional({ description: '난이도 3 가격', example: 150 })
  @IsOptional()
  @IsInt()
  @Min(0)
  '3'?: number | null;

  @ApiPropertyOptional({ description: '난이도 4 가격', example: 200 })
  @IsOptional()
  @IsInt()
  @Min(0)
  '4'?: number | null;

  @ApiPropertyOptional({ description: '난이도 5 가격', example: 300 })
  @IsOptional()
  @IsInt()
  @Min(0)
  '5'?: number | null;
}

class CurrencyPriceMapDto {
  [currencyKey: string]: number | null;
}

class DifficultyPricesByCurrencyDto {
  [currencyKey: string]: DifficultyPricesDto | null;
}

class CurrencyConfigDto {
  @ApiPropertyOptional({
    description: '재화 식별 키 (계정/플랫폼 단위)',
    example: 'SOOP_BALLOON',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  key!: string;

  @ApiPropertyOptional({
    description: '재화 단위명',
    example: '별풍선',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  unit!: string;

  @ApiPropertyOptional({
    description: '재화별 금액 (null이면 미입력/미표기)',
    example: 1000,
    nullable: true,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  amount?: number | null;
}

export class UpdatePricingSettingsDto {
  @ApiPropertyOptional({
    description: '가격 기능 활성화 여부',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  pricingEnabled?: boolean;

  @ApiPropertyOptional({
    description: '기본 가격 (null이면 무료)',
    example: 100,
    nullable: true,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  defaultPrice?: number | null;

  @ApiPropertyOptional({
    description: '재화별 기본 가격',
    example: { SOOP_BALLOON: 500, CHZZK_CHEESE: 2000 },
    nullable: true,
  })
  @IsOptional()
  @IsObject()
  defaultPrices?: CurrencyPriceMapDto | null;

  @ApiPropertyOptional({
    description: '난이도별 가격 설정',
    type: DifficultyPricesDto,
    example: { '1': 50, '2': 100, '3': 150, '4': 200, '5': 300 },
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => DifficultyPricesDto)
  difficultyPrices?: DifficultyPricesDto | null;

  @ApiPropertyOptional({
    description: '재화별 난이도 가격 설정',
    example: {
      SOOP_BALLOON: { '1': 200, '2': 300, '3': 400 },
      CHZZK_CHEESE: { '1': 1000, '2': 1500, '3': 2000 },
    },
    nullable: true,
  })
  @IsOptional()
  @IsObject()
  difficultyPricesByCurrency?: DifficultyPricesByCurrencyDto | null;

  @ApiPropertyOptional({
    description:
      '다중 재화 설정 (선택은 되었지만 amount가 null인 항목은 표시하지 않음)',
    type: [CurrencyConfigDto],
    example: [
      { key: 'SOOP_BALLOON', unit: '별풍선', amount: 500 },
      { key: 'CHZZK_CHEESE', unit: '치즈', amount: null },
    ],
    nullable: true,
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CurrencyConfigDto)
  currencyConfigs?: CurrencyConfigDto[] | null;
}
