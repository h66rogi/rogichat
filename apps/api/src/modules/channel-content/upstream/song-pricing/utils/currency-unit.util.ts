import { StreamPlatform } from '../types/pricing.types.js';
import type { StreamPlatform as StreamPlatformType } from '../types/pricing.types.js';
import type {
  CurrencyConfig,
  CurrencyPriceMap,
  DifficultyPrices,
  DifficultyPricesByCurrency,
} from '../types/pricing.types.js';

/**
 * 플랫폼별 기본 재화 단위 매핑
 */
export const CURRENCY_UNITS: Record<StreamPlatformType, string> = {
  [StreamPlatform.SOOP]: '별풍선',
  [StreamPlatform.CHZZK]: '치즈',
  [StreamPlatform.CIME]: '빔',
  [StreamPlatform.YOUTUBE]: '', // Super Chat — Phase 4에서 통화별 (USD/JPY/...) 처리
  [StreamPlatform.MELOMING]: '', // meloming-native: donation 없음 (chat-only)
  [StreamPlatform.OTHER]: '',
};

/**
 * 플랫폼별 기본 재화 키 매핑
 */
export const PLATFORM_DEFAULT_CURRENCY_KEYS: Partial<
  Record<StreamPlatformType, string>
> = {
  [StreamPlatform.SOOP]: 'SOOP_BALLOON',
  [StreamPlatform.CHZZK]: 'CHZZK_CHEESE',
  [StreamPlatform.CIME]: 'CIME_BEAM',
};

export const CURRENCY_CONFIG_META_KEY = '__currencyConfigs';
export const DEFAULT_PRICES_META_KEY = '__defaultPrices';
export const DIFFICULTY_BY_CURRENCY_META_KEY = '__difficultyPricesByCurrency';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeAmount(value: unknown): number | null {
  if (value == null || value === '') {
    return null;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value));
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.floor(parsed));
    }
  }

  return null;
}

function normalizeDifficultyPrices(value: unknown): DifficultyPrices | null {
  if (!isPlainObject(value)) {
    return null;
  }

  const out: DifficultyPrices = {};
  for (const level of ['1', '2', '3', '4', '5'] as const) {
    if (!Object.prototype.hasOwnProperty.call(value, level)) {
      continue;
    }
    out[level] = normalizeAmount(value[level]);
  }

  return Object.keys(out).length > 0 ? out : null;
}

export function sanitizeCurrencyPriceMap(
  value: unknown,
): CurrencyPriceMap | null {
  if (!isPlainObject(value)) {
    return null;
  }

  const out: CurrencyPriceMap = {};
  for (const [rawKey, rawValue] of Object.entries(value)) {
    const key = rawKey.trim();
    if (!key) {
      continue;
    }
    out[key] = normalizeAmount(rawValue);
  }

  return Object.keys(out).length > 0 ? out : null;
}

export function pickLegacyPrice(
  currencyPrices: CurrencyPriceMap | null | undefined,
): number | null {
  if (!currencyPrices) {
    return null;
  }
  const firstKey = Object.keys(currencyPrices)[0];
  if (!firstKey) {
    return null;
  }
  return currencyPrices[firstKey] ?? null;
}

export function sanitizeDifficultyPricesByCurrency(
  value: unknown,
): DifficultyPricesByCurrency | null {
  if (!isPlainObject(value)) {
    return null;
  }

  const out: DifficultyPricesByCurrency = {};
  for (const [rawCurrencyKey, rawDifficulty] of Object.entries(value)) {
    const currencyKey = rawCurrencyKey.trim();
    if (!currencyKey) {
      continue;
    }
    out[currencyKey] = normalizeDifficultyPrices(rawDifficulty);
  }

  return Object.keys(out).length > 0 ? out : null;
}

/**
 * 재화 설정을 정규화합니다.
 */
export function sanitizeCurrencyConfigs(
  currencyConfigs: unknown[],
): CurrencyConfig[] {
  const deduped = new Map<string, CurrencyConfig>();

  for (const raw of currencyConfigs) {
    if (!isPlainObject(raw)) {
      continue;
    }

    const key =
      typeof raw.key === 'string'
        ? raw.key.trim()
        : typeof raw.currencyKey === 'string'
          ? raw.currencyKey.trim()
          : '';
    const unit =
      typeof raw.unit === 'string'
        ? raw.unit.trim()
        : typeof raw.currencyUnit === 'string'
          ? raw.currencyUnit.trim()
          : '';

    if (!key || !unit) {
      continue;
    }

    deduped.set(key, {
      key,
      unit,
      // 구버전 amount 입력값은 유지(마이그레이션 용)
      ...(Object.prototype.hasOwnProperty.call(raw, 'amount') && {
        amount: normalizeAmount(raw.amount),
      }),
    });
  }

  return Array.from(deduped.values());
}

/**
 * 플랫폼에 따른 재화 단위를 반환합니다.
 */
export function getCurrencyUnit(
  platform: StreamPlatform | undefined | null,
): string {
  if (!platform) {
    return '';
  }
  return CURRENCY_UNITS[platform] ?? '';
}

function getUnitByCurrencyKey(
  currencyKey: string | null | undefined,
  currencyConfigs?: CurrencyConfig[] | null,
): string {
  if (!currencyKey) {
    return '';
  }

  const normalized = sanitizeCurrencyConfigs(currencyConfigs ?? []);
  const match = normalized.find((item) => item.key === currencyKey);
  return match?.unit ?? '';
}

/**
 * 저장된 difficultyPrices JSON에서 가격/재화 설정을 분리합니다.
 */
export function extractStoredPricingData(stored: unknown): {
  difficultyPrices: DifficultyPrices | null;
  difficultyPricesByCurrency: DifficultyPricesByCurrency | null;
  defaultPrices: CurrencyPriceMap | null;
  currencyConfigs: CurrencyConfig[];
} {
  if (!isPlainObject(stored)) {
    return {
      difficultyPrices: null,
      difficultyPricesByCurrency: null,
      defaultPrices: null,
      currencyConfigs: [],
    };
  }

  const difficultyPrices = normalizeDifficultyPrices(stored);

  const rawCurrencyConfigs = stored[CURRENCY_CONFIG_META_KEY];
  const currencyConfigs = Array.isArray(rawCurrencyConfigs)
    ? sanitizeCurrencyConfigs(rawCurrencyConfigs)
    : [];

  const defaultPrices = sanitizeCurrencyPriceMap(
    stored[DEFAULT_PRICES_META_KEY],
  );
  const difficultyPricesByCurrency = sanitizeDifficultyPricesByCurrency(
    stored[DIFFICULTY_BY_CURRENCY_META_KEY],
  );

  return {
    difficultyPrices,
    difficultyPricesByCurrency,
    defaultPrices,
    currencyConfigs,
  };
}

/**
 * 난이도/기본가/재화 설정을 difficultyPrices JSON으로 직렬화합니다.
 * channel_pricing_settings.difficulty_prices 컬럼의 역호환 목적입니다.
 */
export function buildStoredDifficultyPrices(input: {
  difficultyPrices?: DifficultyPrices | null;
  difficultyPricesByCurrency?: DifficultyPricesByCurrency | null;
  defaultPrices?: CurrencyPriceMap | null;
  currencyConfigs?: CurrencyConfig[] | null;
}): Record<string, unknown> | null {
  const nextDifficulty: DifficultyPrices = {};
  for (const level of ['1', '2', '3', '4', '5'] as const) {
    const value = input.difficultyPrices?.[level];
    if (value == null) {
      continue;
    }
    nextDifficulty[level] = value;
  }

  const nextCurrencyConfigs = sanitizeCurrencyConfigs(
    input.currencyConfigs ?? [],
  );
  const nextDefaultPrices =
    sanitizeCurrencyPriceMap(input.defaultPrices) ?? null;
  const nextDifficultyByCurrency =
    sanitizeDifficultyPricesByCurrency(input.difficultyPricesByCurrency) ??
    null;

  if (
    Object.keys(nextDifficulty).length === 0 &&
    nextCurrencyConfigs.length === 0 &&
    !nextDefaultPrices &&
    !nextDifficultyByCurrency
  ) {
    return null;
  }

  return {
    ...nextDifficulty,
    ...(nextCurrencyConfigs.length > 0 && {
      [CURRENCY_CONFIG_META_KEY]: nextCurrencyConfigs,
    }),
    ...(nextDefaultPrices && {
      [DEFAULT_PRICES_META_KEY]: nextDefaultPrices,
    }),
    ...(nextDifficultyByCurrency && {
      [DIFFICULTY_BY_CURRENCY_META_KEY]: nextDifficultyByCurrency,
    }),
  };
}

export function resolvePricingCurrencyKey(
  platform: StreamPlatform | undefined | null,
  currencyConfigs?: CurrencyConfig[] | null,
  priceMaps?: Array<CurrencyPriceMap | null | undefined>,
): string | null {
  const normalizedConfigs = sanitizeCurrencyConfigs(currencyConfigs ?? []);
  const configuredKeys = normalizedConfigs.map((item) => item.key);
  const preferred = platform
    ? PLATFORM_DEFAULT_CURRENCY_KEYS[platform]
    : undefined;

  if (preferred && configuredKeys.includes(preferred)) {
    return preferred;
  }

  if (configuredKeys.length > 0) {
    return configuredKeys[0] ?? null;
  }

  if (preferred) {
    for (const map of priceMaps ?? []) {
      if (map && Object.prototype.hasOwnProperty.call(map, preferred)) {
        return preferred;
      }
    }
  }

  for (const map of priceMaps ?? []) {
    if (!map) {
      continue;
    }
    const firstKey = Object.keys(map)[0];
    if (firstKey) {
      return firstKey;
    }
  }

  return preferred ?? null;
}

/**
 * 하위 호환용 단일 재화 단위를 반환합니다.
 * - 전달된 currencyKey가 있으면 해당 키의 단위를 우선 반환
 * - 없으면 기존 규칙(첫 번째 재화 > 플랫폼 기본 단위)을 따릅니다.
 */
export function getPrimaryCurrencyUnit(
  platform: StreamPlatform | undefined | null,
  currencyConfigs?: CurrencyConfig[] | null,
  currencyKey?: string | null,
): string {
  if (currencyKey) {
    const unit = getUnitByCurrencyKey(currencyKey, currencyConfigs);
    if (unit) {
      return unit;
    }
  }

  const normalized = sanitizeCurrencyConfigs(currencyConfigs ?? []);
  if (normalized.length > 0) {
    return normalized[0]!.unit;
  }
  return getCurrencyUnit(platform);
}

/**
 * 가격과 플랫폼을 받아 포맷팅된 가격 문자열을 반환합니다.
 */
export function formatPriceWithUnit(
  price: number | null | undefined,
  platform: StreamPlatform | undefined | null,
): string {
  if (price == null) {
    return '';
  }
  const unit = getCurrencyUnit(platform);
  return `${price}${unit}`;
}

/**
 * 재화 키 기반 가격 포맷
 */
export function formatPriceByCurrencyKey(
  price: number | null | undefined,
  currencyKey: string | null,
  currencyConfigs: CurrencyConfig[] | null | undefined,
  platform: StreamPlatform | undefined | null,
): string {
  if (price == null) {
    return '';
  }

  const unit =
    getUnitByCurrencyKey(currencyKey, currencyConfigs) ||
    getCurrencyUnit(platform);
  return `${price}${unit}`;
}

/**
 * @deprecated 구버전 호환용
 */
export function formatPriceWithCurrencyConfigs(
  price: number | null | undefined,
  platform: StreamPlatform | undefined | null,
  currencyConfigs?: CurrencyConfig[] | null,
): string {
  if (price == null) {
    return '';
  }
  const currencyKey = resolvePricingCurrencyKey(platform, currencyConfigs);
  return formatPriceByCurrencyKey(
    price,
    currencyKey,
    currencyConfigs,
    platform,
  );
}
