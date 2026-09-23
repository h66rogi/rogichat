// Copied from meloming-back a91393b2 src/song-pricing/utils/currency-unit.util.ts.
type CurrencyPriceMap = Record<string, number | null>;

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
