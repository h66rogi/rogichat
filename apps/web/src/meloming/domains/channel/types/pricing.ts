// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export type PriceSource = 'SONG' | 'CATEGORY' | 'DIFFICULTY' | 'DEFAULT' | 'FREE';

// ---------------------------------------------------------------------------
// Domain Types
// ---------------------------------------------------------------------------

/**
 * 난이도별 가격 설정
 */
export interface DifficultyPrices {
  '1'?: number | null;
  '2'?: number | null;
  '3'?: number | null;
  '4'?: number | null;
  '5'?: number | null;
}

export type CurrencyPriceMap = Record<string, number | null>;
export type DifficultyPricesByCurrency = Record<string, DifficultyPrices | null>;

/**
 * 다중 재화 설정
 */
export interface CurrencyConfig {
  key: string;
  unit: string;
  amount?: number | null;
}

/**
 * 채널 가격 설정
 */
export interface PricingSettings {
  channelId: number;
  pricingEnabled: boolean;
  defaultPrice: number | null;
  defaultPrices: CurrencyPriceMap | null;
  difficultyPrices: DifficultyPrices | null;
  difficultyPricesByCurrency: DifficultyPricesByCurrency | null;
  currencyUnit: string;
  currencyConfigs: CurrencyConfig[];
}

/**
 * 계산된 가격 결과
 */
export interface CalculatedPrice {
  songId: number;
  price: number | null;
  source: PriceSource;
  currencyKey?: string | null;
  currencyUnit: string;
  formattedPrice: string;
}

// ---------------------------------------------------------------------------
// Request DTOs
// ---------------------------------------------------------------------------

export interface UpdatePricingSettingsDto {
  pricingEnabled?: boolean;
  defaultPrice?: number | null;
  defaultPrices?: CurrencyPriceMap | null;
  difficultyPrices?: DifficultyPrices | null;
  difficultyPricesByCurrency?: DifficultyPricesByCurrency | null;
  currencyConfigs?: CurrencyConfig[] | null;
}

export interface UpdateSongPriceDto {
  price?: number | null;
  currencyPrices?: CurrencyPriceMap | null;
}

export interface UpdateCategoryPriceDto {
  price?: number | null;
  currencyPrices?: CurrencyPriceMap | null;
}

export interface CalculatePricesDto {
  songIds: number[];
}

// ---------------------------------------------------------------------------
// Response DTOs
// ---------------------------------------------------------------------------

export type GetPricingSettingsResponse = PricingSettings;

export type UpdatePricingSettingsResponse = PricingSettings;

export interface UpdateSongPriceResponse {
  id: number;
  price: number | null;
  currencyPrices: CurrencyPriceMap | null;
}

export interface UpdateCategoryPriceResponse {
  id: number;
  price: number | null;
  currencyPrices: CurrencyPriceMap | null;
}

export type CalculatePricesResponse = CalculatedPrice[];

export type GetSongPriceResponse = CalculatedPrice;
