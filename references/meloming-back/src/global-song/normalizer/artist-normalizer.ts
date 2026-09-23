/**
 * Artist normalizer for the Smart Song Addition matcher.
 *
 * Pure function. Converts raw artist strings ("아이유 (IU)", "IU(아이유)",
 * "아이유 feat. 오혁", ...) into a stable `normKey` used to match global
 * artists across channels that type names differently.
 *
 * Pipeline (see docs/plans/smart-song-addition.md, Section 2):
 *   1. Validate length/empty
 *   2. NFKC Unicode normalize (fullwidth halfwidth conversion happens here)
 *   3. Pull featuring artists (feat./ft./with) off the tail
 *   4. On the main head: pull parenthetical / bracket content out as aliases
 *   5. Otherwise split on slash
 *   6. Otherwise detect Korean/Latin script boundaries (both space-separated
 *      and glued)
 *   7. Collapse whitespace and lowercase Latin runs
 *   8. Deduplicate aliases, sort (case-insensitive) and join with "|"
 */

export interface ArtistNormalizationResult {
  canonicalName: string;
  normKey: string;
  aliases: string[];
  featuring: string[];
}

const MAX_INPUT_LENGTH = 200;

// Hangul syllables + Jamo ranges
const HANGUL_RANGE = '\u3131-\u318E\uAC00-\uD7A3';
const HANGUL_CHAR = new RegExp(`[${HANGUL_RANGE}]`);
const LATIN_CHAR = /[A-Za-z]/;

// Matches feat. / ft. / with used as featuring separators. Case-insensitive.
const FEATURING_SPLIT = /\s+(?:feat\.?|ft\.?|with)\s+/i;

/**
 * Public API - normalize an artist string.
 */
export function normalizeArtist(raw: string): ArtistNormalizationResult {
  if (typeof raw !== 'string') {
    throw new Error('normalizeArtist: input must be a string');
  }

  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error('normalizeArtist: input must not be empty');
  }
  if (trimmed.length > MAX_INPUT_LENGTH) {
    throw new Error(
      `normalizeArtist: input exceeds ${MAX_INPUT_LENGTH} characters`,
    );
  }

  // Step 2 - NFKC normalize (fullwidth halfwidth, compatibility forms)
  const nfkc = trimmed.normalize('NFKC');

  // Step 3 - split featuring off the tail
  const { main, featuring } = pullFeaturing(nfkc);

  // Step 4-6 - break the main part into alias candidates
  const aliasCandidates = splitIntoAliasCandidates(main);

  if (aliasCandidates.length === 0) {
    throw new Error('normalizeArtist: produced no usable aliases');
  }

  // Step 7 - normalize each candidate
  const normalized = aliasCandidates
    .map(normalizeAliasToken)
    .filter((s) => s.length > 0);

  if (normalized.length === 0) {
    throw new Error('normalizeArtist: produced no usable aliases');
  }

  // Step 8 - dedupe + sort for stable normKey
  const aliases = dedupe(normalized);
  const sorted = [...aliases].sort((a, b) =>
    a.localeCompare(b, 'en', { sensitivity: 'base' }),
  );
  const normKey = sorted.join('|');

  return {
    canonicalName: aliases[0],
    normKey,
    aliases,
    featuring,
  };
}

/* -------------------------------------------------------------------------- */
/* Featuring handling                                                          */
/* -------------------------------------------------------------------------- */

function pullFeaturing(input: string): {
  main: string;
  featuring: string[];
} {
  const match = input.match(FEATURING_SPLIT);
  if (!match || match.index === undefined) {
    return { main: input, featuring: [] };
  }

  const main = input.slice(0, match.index).trim();
  const tail = input.slice(match.index + match[0].length).trim();

  // The tail may contain further separators ("A feat. B, C" or "A with B & C")
  const featuring = tail
    .split(/\s*[,&]\s*|\s+(?:and|with)\s+/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  return { main, featuring };
}

/* -------------------------------------------------------------------------- */
/* Alias candidate splitting                                                   */
/* -------------------------------------------------------------------------- */

function splitIntoAliasCandidates(main: string): string[] {
  // Pass 1 - parentheses / brackets: "A (B)" -> ["A", "B"]
  const bracketCandidates = pullBracketAliases(main);
  if (bracketCandidates.length > 1) {
    return bracketCandidates;
  }

  // Strip brackets for subsequent passes (nothing useful inside)
  const unbracketed = main.replace(/[\(\)\[\]（）［］]/g, ' ').trim();

  // Pass 2 - slash: "A / B" -> ["A", "B"]
  if (/[\/／]/.test(unbracketed)) {
    const parts = unbracketed
      .split(/\s*[\/／]\s*/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (parts.length > 1) {
      return parts;
    }
  }

  // Pass 3 - explicit spaces between distinct scripts: "아이유 IU"
  const spaceParts = unbracketed.split(/\s+/).filter((s) => s.length > 0);
  if (spaceParts.length > 1 && containsMixedScript(spaceParts)) {
    return spaceParts;
  }

  // Pass 4 - glued mixed scripts: "아이유IU"
  const gluedSingle = spaceParts.length === 1 ? spaceParts[0] : unbracketed;
  if (HANGUL_CHAR.test(gluedSingle) && LATIN_CHAR.test(gluedSingle)) {
    const boundarySplit = gluedSingle
      .split(
        new RegExp(
          `(?<=[${HANGUL_RANGE}])(?=[A-Za-z])|(?<=[A-Za-z])(?=[${HANGUL_RANGE}])`,
        ),
      )
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (boundarySplit.length > 1) {
      return boundarySplit;
    }
  }

  // Fallback - single alias
  return [unbracketed];
}

/**
 * Pull aliases from bracket expressions like "A (B)", "A [B]", "A(B)[C]".
 * Returns an ordered list [outer, inner1, inner2, ...]. Duplicates are kept
 * here and deduped later after normalization.
 */
function pullBracketAliases(input: string): string[] {
  const aliases: string[] = [];
  const bracketRegex = /[\(（\[［]([^\)\]）］]*)[\)\]）］]/g;

  // Outer = input with all brackets stripped
  const outer = input.replace(bracketRegex, ' ').replace(/\s+/g, ' ').trim();
  if (outer.length > 0) aliases.push(outer);

  let match: RegExpExecArray | null;
  while ((match = bracketRegex.exec(input)) !== null) {
    const inner = match[1].trim();
    if (inner.length > 0) aliases.push(inner);
  }

  return aliases;
}

function containsMixedScript(parts: string[]): boolean {
  let hasHangul = false;
  let hasLatin = false;
  for (const p of parts) {
    if (HANGUL_CHAR.test(p)) hasHangul = true;
    if (LATIN_CHAR.test(p)) hasLatin = true;
  }
  return hasHangul && hasLatin;
}

/* -------------------------------------------------------------------------- */
/* Per-alias normalization                                                     */
/* -------------------------------------------------------------------------- */

import { normalizeToken, dedupe } from './utils';

const normalizeAliasToken = normalizeToken;
