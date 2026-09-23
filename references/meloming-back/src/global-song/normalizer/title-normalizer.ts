/**
 * Title normalizer for the Smart Song Addition matcher.
 *
 * Pure function. Converts raw song titles into a stable `normTitle` used for
 * exact/fuzzy matching, while preserving important version variants (Live,
 * Remix, ...) and extracting translation parentheticals as aliases.
 *
 * Pipeline (see docs/superpowers/specs/2026-04-01-smart-song-addition-design.md,
 * Section 2):
 *   1. Validate length/empty
 *   2. NFKC Unicode normalize (fullwidth → halfwidth, compat forms)
 *   3. For each bracketed span:
 *      - version keyword → keep as `(lowercased content)` in normTitle
 *      - translation (non-version, non-empty) → strip from normTitle and
 *        register normalized content as an alias
 *      - empty → strip, no alias
 *   4. Collapse whitespace
 *   5. Lowercase Latin characters only (Korean untouched)
 */

export interface TitleNormalizationResult {
  /** Stable key used for exact/fuzzy matching (lowercased Latin, brackets processed). */
  normTitle: string;
  /** Trimmed + whitespace-collapsed original title, case preserved for display. */
  displayTitle: string;
  /** Normalized alias titles pulled out of translation parentheticals. */
  aliases: string[];
}

const MAX_INPUT_LENGTH = 300;

const VERSION_KEYWORDS = new Set([
  'live',
  'inst',
  'instrumental',
  'remix',
  'acoustic',
  'ver',
  'version',
  'cover',
]);

// Matches any bracketed span (half + fullwidth). Capture group 1 is the inner content.
const BRACKET_PATTERN = /[\(\[（［]([^\)\]）］]*)[\)\]）］]/g;

/**
 * Public API — normalize a song title.
 */
export function normalizeTitle(raw: string): TitleNormalizationResult {
  if (typeof raw !== 'string') {
    throw new Error('normalizeTitle: input must be a string');
  }

  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error('normalizeTitle: input must not be empty');
  }
  if (trimmed.length > MAX_INPUT_LENGTH) {
    throw new Error(
      `normalizeTitle: input exceeds ${MAX_INPUT_LENGTH} characters`,
    );
  }

  // Step 2 - NFKC Unicode normalize (handles ＩＵ → IU etc.)
  const nfkc = trimmed.normalize('NFKC');

  // displayTitle = trimmed + whitespace collapsed, original case
  const displayTitle = nfkc.replace(/\s+/g, ' ').trim();

  // Step 3 - walk brackets, classify each
  const aliases: string[] = [];
  const normBuilder = nfkc.replace(BRACKET_PATTERN, (_match, inner: string) => {
    const content = inner.trim();
    if (content.length === 0) {
      return ''; // empty bracket → strip
    }
    if (isVersionBracket(content)) {
      // Keep as version tag. Lowercase the entire content, Latin-only.
      const lowered = content.replace(/\s+/g, ' ').trim();
      const lowerLatin = lowered.replace(/[A-Z]/g, (c) => c.toLowerCase());
      return ` (${lowerLatin})`;
    }
    // Translation parenthetical → strip from title, register alias
    const aliasNorm = normalizeAliasContent(content);
    if (aliasNorm.length > 0) {
      aliases.push(aliasNorm);
    }
    return '';
  });

  // Step 4-5 - collapse whitespace + lowercase Latin only
  const normTitle = normBuilder
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[A-Z]/g, (c) => c.toLowerCase());

  return {
    normTitle,
    displayTitle,
    aliases: dedupe(aliases),
  };
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function isVersionBracket(content: string): boolean {
  const tokens = content
    .toLowerCase()
    .split(/[\s.,]+/)
    .filter((t) => t.length > 0);
  return tokens.some((t) => VERSION_KEYWORDS.has(t));
}

import { normalizeToken, dedupe } from './utils';

const normalizeAliasContent = normalizeToken;
