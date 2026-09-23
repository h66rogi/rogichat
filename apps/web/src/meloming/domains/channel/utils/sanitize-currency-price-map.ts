import type { CurrencyPriceMap } from "@/meloming/domains/channel/types/pricing";

/**
 * Sanitize currency price map values from arbitrary input.
 */
export function sanitizeCurrencyPriceMap(value: unknown): CurrencyPriceMap | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const out: CurrencyPriceMap = {};
  for (const [rawKey, rawValue] of Object.entries(value)) {
    const key = rawKey.trim();
    if (!key) {
      continue;
    }
    if (rawValue == null || rawValue === "") {
      out[key] = null;
      continue;
    }
    const amount = typeof rawValue === "number" ? rawValue : Number(rawValue);
    out[key] = Number.isFinite(amount) ? Math.max(0, Math.floor(amount)) : null;
  }

  return Object.keys(out).length > 0 ? out : null;
}
