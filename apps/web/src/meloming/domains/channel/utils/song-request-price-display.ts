import type { PriceSource, PricingSettings } from "@/meloming/domains/channel/types/pricing";
import { calculateSongPrice } from "@/meloming/domains/channel/utils/song-price";

type CurrencyPriceMap = Record<string, number | null> | null | undefined;

type SongRequestPricingInput = {
  price?: number | null;
  currencyPrices?: CurrencyPriceMap;
  difficulty?: number | null;
  categories?: Array<{
    price?: number | null;
    currencyPrices?: CurrencyPriceMap;
  }>;
};

export interface SongRequestPriceItem {
  currencyKey: string | null;
  unit: string;
  price: number | null;
  source: PriceSource;
}

function normalizeCurrencyConfigs(settings: PricingSettings | undefined) {
  return (settings?.currencyConfigs ?? []).filter(
    (config) => config.key?.trim() && config.unit?.trim()
  );
}

function resolveFallbackUnitByKey(currencyKey: string | null): string {
  if (!currencyKey) {
    return "";
  }
  const normalizedKey = currencyKey.toUpperCase();
  if (normalizedKey.includes("SOOP")) {
    return "별풍선";
  }
  if (normalizedKey.includes("CHZZK")) {
    return "치즈";
  }
  if (normalizedKey.includes("CIME")) {
    return "빔";
  }
  if (normalizedKey.includes("KRW")) {
    return "원";
  }
  return "";
}

function resolveUnit(
  currencyKey: string | null,
  unitFromConfig: string | undefined,
  settings: PricingSettings | undefined
): string {
  if (unitFromConfig?.trim()) {
    return unitFromConfig.trim();
  }

  const fromSettings = (settings?.currencyConfigs ?? []).find(
    (config) => config.key === currencyKey
  )?.unit;
  if (fromSettings?.trim()) {
    return fromSettings.trim();
  }

  if (settings?.currencyUnit?.trim()) {
    return settings.currencyUnit.trim();
  }

  return resolveFallbackUnitByKey(currencyKey);
}

function normalizeSongInput(song: SongRequestPricingInput) {
  return {
    price: typeof song.price === "number" ? song.price : null,
    currencyPrices: song.currencyPrices ?? null,
    difficulty: typeof song.difficulty === "number" ? song.difficulty : 1,
    categories: (song.categories ?? []).map((category) => ({
      price: typeof category.price === "number" ? category.price : null,
      currencyPrices: category.currencyPrices ?? null,
    })),
  };
}

export function getSongRequestPriceItems(
  song: SongRequestPricingInput,
  settings: PricingSettings | undefined
): SongRequestPriceItem[] {
  if (!settings?.pricingEnabled) {
    return [];
  }

  const normalizedSong = normalizeSongInput(song);
  const currencyConfigs = normalizeCurrencyConfigs(settings);

  if (currencyConfigs.length > 0) {
    const calculated = currencyConfigs.map((config) => {
      const result = calculateSongPrice(normalizedSong, settings, config.key);
      return {
        currencyKey: config.key,
        unit: resolveUnit(config.key, config.unit, settings),
        price: result.price,
        source: result.source,
      } satisfies SongRequestPriceItem;
    });

    const priced = calculated.filter((item) => item.price != null);
    if (priced.length > 0) {
      return priced;
    }

    return calculated.length > 0 ? [calculated[0]] : [];
  }

  const fallback = calculateSongPrice(normalizedSong, settings);
  return [
    {
      currencyKey: fallback.currencyKey,
      unit: resolveUnit(fallback.currencyKey, undefined, settings),
      price: fallback.price,
      source: fallback.source,
    },
  ];
}
