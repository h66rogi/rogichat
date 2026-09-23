/* eslint-disable no-useless-escape -- original Meloming regex source */
/**
 * Shared utilities for artist and title normalizers.
 */

/** Collapse whitespace, trim, and lowercase Latin characters only (Korean untouched). */
export function normalizeToken(token: string): string {
  return token
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[A-Z]/g, (c) => c.toLowerCase());
}

/**
 * Sanitize a normalized string for safe use in Redis keys.
 * Redis keys use `:` as a namespace separator, so we replace any
 * `:` in user-derived content with `_` to prevent key collision.
 * Also strips `*`, `?`, `\n`, `\0` which could interfere with
 * SCAN patterns or cause protocol issues.
 */
export function sanitizeForRedisKey(value: string): string {
  return value.replace(/[:\*\?\n\0]/g, '_');
}

/** Deduplicate strings preserving insertion order. */
export function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}
