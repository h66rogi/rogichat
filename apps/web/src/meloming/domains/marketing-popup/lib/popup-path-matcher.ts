/**
 * Client-side path matching for marketing popup targetPages.
 * Supports:
 *   "*" = all pages
 *   "/path/*" = prefix matching (wildcard)
 *   "/channel/:id" = parameter patterns
 *   exact path matching
 */
export function matchesTargetPath(
  patterns: string[],
  currentPath: string
): boolean {
  if (!patterns || patterns.length === 0) return true;

  for (const pattern of patterns) {
    if (pattern === "*") return true;

    if (pattern.endsWith("/*")) {
      const prefix = pattern.slice(0, -2);
      if (currentPath === prefix || currentPath.startsWith(prefix + "/")) {
        return true;
      }
      continue;
    }

    // Parameter pattern: /channel/:id → /channel/[^/]+
    if (pattern.includes(":")) {
      const regex = new RegExp(
        "^" + pattern.replace(/:[^/]+/g, "[^/]+") + "$"
      );
      if (regex.test(currentPath)) return true;
      continue;
    }

    // Exact match
    if (pattern === currentPath) return true;
  }

  return false;
}
