import { PriceSource } from '@prisma/client';

/**
 * 난이도별 가격 설정
 * 키: 난이도 (1-5), 값: 가격 (null이면 미설정)
 */
export interface DifficultyPrices {
  '1'?: number | null;
  '2'?: number | null;
  '3'?: number | null;
  '4'?: number | null;
  '5'?: number | null;
}

/**
 * 재화별 가격 맵
 * - key: 재화 키 (예: SOOP_BALLOON, CHZZK_CHEESE)
 * - value: 가격 (null이면 미설정)
 */
export type CurrencyPriceMap = Record<string, number | null>;

/**
 * 재화별 난이도 가격 설정
 * - key: 재화 키
 * - value: 난이도별 가격
 */
export type DifficultyPricesByCurrency = Record<
  string,
  DifficultyPrices | null
>;

/**
 * 다중 재화 설정
 */
export interface CurrencyConfig {
  /** 재화 식별 키 (예: SOOP_BALLOON, CHZZK_CHEESE) */
  key: string;
  /** 재화 단위 표시명 (예: 별풍선, 치즈) */
  unit: string;
  /** @deprecated 구버전 호환용 */
  amount?: number | null;
}

/**
 * 가격 계산 결과
 */
export interface CalculatedPriceResult {
  /** 계산된 가격 (null이면 무료) */
  price: number | null;
  /** 가격의 출처 */
  source: PriceSource;
  /** 계산 기준 재화 키 */
  currencyKey: string | null;
  /** 재화 단위 (별풍선, 치즈 등) */
  currencyUnit: string;
  /** 포맷팅된 가격 문자열 (예: "500별풍선") */
  formattedPrice: string;
}

/**
 * 가격 계산에 필요한 곡 정보
 */
export interface SongForPricing {
  id: number;
  price: number | null;
  currencyPrices: unknown;
  difficulty: number | null;
  songCategories: Array<{
    category: {
      id: number;
      price: number | null;
      currencyPrices: unknown;
    };
  }>;
}

/**
 * 채널 가격 설정 정보
 */
export interface PricingSettingsData {
  pricingEnabled: boolean;
  defaultPrice: number | null;
  defaultPrices: CurrencyPriceMap | null;
  difficultyPrices: DifficultyPrices | null;
  difficultyPricesByCurrency: DifficultyPricesByCurrency | null;
}
