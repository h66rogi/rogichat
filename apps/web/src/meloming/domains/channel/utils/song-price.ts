import type {
  CurrencyConfig,
  CurrencyPriceMap,
  DifficultyPrices,
  DifficultyPricesByCurrency,
  PriceSource,
  PricingSettings,
} from "@/meloming/domains/channel/types/pricing";
import type { Song, SongCategory } from "@/meloming/domains/channel/types/song";

type SongPriceInput = Pick<Song, "price" | "currencyPrices" | "difficulty"> & {
  categories?: Array<Pick<SongCategory, "price" | "currencyPrices">>;
};

export interface CalculatedSongPrice {
  price: number | null;
  source: PriceSource;
  currencyKey: string | null;
}

export const PRICE_SOURCE_LABELS: Record<PriceSource, string> = {
  SONG: "곡별 설정",
  CATEGORY: "카테고리 설정",
  DIFFICULTY: "난이도 설정",
  DEFAULT: "채널 기본값",
  FREE: "무료",
};

function normalizeCurrencyConfigs(
  currencyConfigs: CurrencyConfig[] | null | undefined
): CurrencyConfig[] {
  return (currencyConfigs ?? []).filter(
    (config) => config.key?.trim() && config.unit?.trim()
  );
}

function getCurrencyUnitByKey(
  currencyKey: string | null | undefined,
  currencyUnit: string | undefined,
  currencyConfigs?: CurrencyConfig[] | null
): string {
  if (currencyKey) {
    const match = (currencyConfigs ?? []).find((config) => config.key === currencyKey);
    if (match?.unit) {
      return match.unit;
    }
  }

  if (currencyUnit?.trim()) {
    return currencyUnit.trim();
  }

  return (currencyConfigs ?? [])[0]?.unit ?? "";
}

function getPriceByCurrencyOrLegacy(
  currencyPrices: CurrencyPriceMap | null | undefined,
  currencyKey: string | null,
  legacyPrice: number | null | undefined
): number | null {
  if (
    currencyKey &&
    currencyPrices &&
    Object.prototype.hasOwnProperty.call(currencyPrices, currencyKey)
  ) {
    return currencyPrices[currencyKey] ?? null;
  }
  return legacyPrice ?? null;
}

function getDifficultyPrice(
  difficulty: number | null | undefined,
  currencyKey: string | null,
  difficultyPrices: DifficultyPrices | null | undefined,
  difficultyPricesByCurrency: DifficultyPricesByCurrency | null | undefined
): number | null {
  if (difficulty == null) {
    return null;
  }
  const key = String(difficulty) as "1" | "2" | "3" | "4" | "5";

  if (currencyKey) {
    const byCurrency = difficultyPricesByCurrency?.[currencyKey];
    if (byCurrency && Object.prototype.hasOwnProperty.call(byCurrency, key)) {
      return byCurrency[key] ?? null;
    }
  }

  return difficultyPrices?.[key] ?? null;
}

function getMaxCategoryPrice(
  categories: Array<Pick<SongCategory, "price" | "currencyPrices">> | undefined,
  currencyKey: string | null
): number | null {
  if (!categories || categories.length === 0) {
    return null;
  }
  const prices = categories
    .map((category) =>
      getPriceByCurrencyOrLegacy(category.currencyPrices, currencyKey, category.price)
    )
    .filter((price): price is number => price != null);
  if (prices.length === 0) {
    return null;
  }
  return Math.max(...prices);
}

function resolveCurrencyKey(
  song: SongPriceInput,
  pricingSettings: PricingSettings | undefined,
  preferredCurrencyKey?: string | null
): string | null {
  if (preferredCurrencyKey) {
    return preferredCurrencyKey;
  }

  const configs = normalizeCurrencyConfigs(pricingSettings?.currencyConfigs);
  if (configs.length > 0) {
    return configs[0].key;
  }

  const priceMaps: Array<CurrencyPriceMap | null | undefined> = [
    song.currencyPrices,
    ...(song.categories ?? []).map((category) => category.currencyPrices),
    pricingSettings?.defaultPrices,
  ];

  for (const map of priceMaps) {
    if (!map) {
      continue;
    }
    const first = Object.keys(map)[0];
    if (first) {
      return first;
    }
  }

  return null;
}

export function calculateSongPrice(
  song: SongPriceInput,
  pricingSettings: PricingSettings | undefined,
  preferredCurrencyKey?: string | null
): CalculatedSongPrice {
  if (!pricingSettings?.pricingEnabled) {
    return { price: null, source: "FREE", currencyKey: preferredCurrencyKey ?? null };
  }

  const currencyKey = resolveCurrencyKey(song, pricingSettings, preferredCurrencyKey);
  const songPrice = getPriceByCurrencyOrLegacy(
    song.currencyPrices,
    currencyKey,
    song.price
  );
  if (songPrice != null) {
    return { price: songPrice, source: "SONG", currencyKey };
  }

  const difficultyPrice = getDifficultyPrice(
    song.difficulty,
    currencyKey,
    pricingSettings.difficultyPrices,
    pricingSettings.difficultyPricesByCurrency
  );
  const categoryPrice = getMaxCategoryPrice(song.categories, currencyKey);

  if (difficultyPrice != null || categoryPrice != null) {
    if (difficultyPrice != null && categoryPrice != null) {
      if (difficultyPrice >= categoryPrice) {
        return { price: difficultyPrice, source: "DIFFICULTY", currencyKey };
      }
      return { price: categoryPrice, source: "CATEGORY", currencyKey };
    }
    if (difficultyPrice != null) {
      return { price: difficultyPrice, source: "DIFFICULTY", currencyKey };
    }
    return { price: categoryPrice, source: "CATEGORY", currencyKey };
  }

  const defaultPrice = getPriceByCurrencyOrLegacy(
    pricingSettings.defaultPrices,
    currencyKey,
    pricingSettings.defaultPrice
  );
  if (defaultPrice != null) {
    return { price: defaultPrice, source: "DEFAULT", currencyKey };
  }

  return { price: null, source: "FREE", currencyKey };
}

export function formatSongPrice(
  price: number | null,
  currencyUnit: string | undefined,
  currencyConfigs?: CurrencyConfig[] | null,
  currencyKey?: string | null
): string {
  if (price == null) {
    return "무료";
  }

  const resolvedUnit = getCurrencyUnitByKey(currencyKey, currencyUnit, currencyConfigs);
  return `${price.toLocaleString()}${resolvedUnit ? ` ${resolvedUnit}` : ""}`;
}
