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
