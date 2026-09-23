import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GlobalSongRedisService } from './global-song-redis.service';
import { normalizeArtist } from './normalizer/artist-normalizer';
import { normalizeTitle } from './normalizer/title-normalizer';
import {
  MatchConfidence,
  MatchMethod,
  MatchRequestDto,
  MatchResponseDto,
  MatchResultItem,
} from './dto/match.dto';

/**
 * 4-stage global song matcher.
 *
 * See design spec Section 2 "Staged Matcher Flow":
 *
 *   Stage 1 (Exact)      ~1ms    artist alias hit + (normTitle, artistId) hit
 *   Stage 2 (Title Alias) ~5ms    gs:title_alias:{normTitle} hit
 *   Stage 3 (Fuzzy)       ~100ms  prefix candidates + Jaro-Winkler rerank
 *   Stage 4 (AI)          ~2s     delegated to meloming-ai-service (NOT in Phase 1)
 *
 * Phase 1 ships stages 1-3. Stage 4 is a stub: if stages 1-3 return nothing
 * we simply return an empty result set, and the UI can fall back to manual
 * entry with the "찾는 곡이 없나요?" affordance described in the spec.
 */
@Injectable()
export class GlobalSongMatcherService {
  private readonly logger = new Logger(GlobalSongMatcherService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: GlobalSongRedisService,
  ) {}

  async match(input: MatchRequestDto): Promise<MatchResponseDto> {
    if (!this.redis.isReady()) {
      throw new ServiceUnavailableException(
        'Global song index is not ready. Retry in a few seconds.',
      );
    }

    try {
      return await this.matchInternal(input);
    } catch (error) {
      // Rethrow ServiceUnavailableException as-is (it's already the right status)
      if (error instanceof ServiceUnavailableException) throw error;
      // Any other error coming from Redis mid-request is also treated as a
      // transient index outage so the client gets a well-formed 503 + retry
      // hint instead of an opaque 500.
      this.logger.warn(
        `match() runtime error: ${
          error instanceof Error ? error.message : error
        }`,
      );
      throw new ServiceUnavailableException(
        'Global song index temporarily unavailable. Retry in a few seconds.',
      );
    }
  }

  private async matchInternal(
    input: MatchRequestDto,
  ): Promise<MatchResponseDto> {
    const limit = input.limit ?? 5;
    const parsed = parseQuery(input.query);
    const normTitleRes = normalizeTitle(parsed.parsedTitle);

    // Try each stage in order
    const candidateIds = new Map<number, MatchMethod>();

    // --- Stage 1: Exact ----------------------------------------------------
    const artistIds = parsed.parsedArtist
      ? await this.resolveArtistIds(parsed.parsedArtist)
      : [];
    if (artistIds.length > 0) {
      for (const artistId of artistIds) {
        const hit = await this.redis.lookupSong(
          normTitleRes.normTitle,
          artistId,
        );
        if (hit !== null && !candidateIds.has(hit)) {
          candidateIds.set(hit, 'EXACT');
        }
      }
    }

    // --- Stage 2: Title Alias ----------------------------------------------
    if (candidateIds.size === 0) {
      const aliasSongIds = new Set<number>();

      const lookupKeys = [normTitleRes.normTitle, ...normTitleRes.aliases];
      const aliasResults = await Promise.all(
        lookupKeys.map((key) => this.redis.lookupTitleAlias(key)),
      );
      for (const hits of aliasResults) {
        for (const hitId of hits) aliasSongIds.add(hitId);
      }

      if (aliasSongIds.size > 0) {
        if (artistIds.length > 0) {
          // Artist context present: keep only hits whose global_artist_id
          // is in the parsed artist's candidate set
          const artistIdSet = new Set(artistIds);
          const filtered = await this.prisma.globalSong.findMany({
            where: {
              id: { in: Array.from(aliasSongIds) },
              globalArtistId: { in: artistIds },
            },
            select: { id: true, globalArtistId: true },
          });
          for (const row of filtered) {
            if (artistIdSet.has(row.globalArtistId)) {
              candidateIds.set(row.id, 'ALIAS');
            }
          }
        } else {
          // No artist context: accept all title-alias hits
          for (const id of aliasSongIds) {
            candidateIds.set(id, 'ALIAS');
          }
        }
      }
    }

    // --- Stage 3: Fuzzy ----------------------------------------------------
    if (candidateIds.size === 0) {
      const fuzzy = await this.fuzzyCandidates(
        parsed.parsedTitle,
        limit,
        artistIds,
      );
      for (const fuzzyHit of fuzzy) {
        if (!candidateIds.has(fuzzyHit)) {
          candidateIds.set(fuzzyHit, 'FUZZY');
        }
      }
    }

    // --- Stage 4: AI fallback (not implemented in Phase 1) -----------------
    // Intentionally empty. See spec — Phase 4 delivers meloming-ai-service MusicAgent.

    const topIds = Array.from(candidateIds.keys()).slice(0, limit);
    const results = await this.buildResults(
      topIds,
      candidateIds,
      input.channelId,
    );

    return {
      results,
      query: parsed,
    };
  }

  /* -------------------------------------------------------------------- */
  /* Helpers                                                               */
  /* -------------------------------------------------------------------- */

  private async resolveArtistIds(rawArtist: string): Promise<number[]> {
    const normArtist = normalizeArtist(rawArtist);
    const seen = new Set<number>();
    for (const alias of normArtist.aliases) {
      const ids = await this.redis.lookupArtistAlias(alias);
      for (const id of ids) seen.add(id);
    }
    return Array.from(seen);
  }

  private async fuzzyCandidates(
    rawTitle: string,
    limit: number,
    artistIds: number[],
  ): Promise<number[]> {
    const normTitleRes = normalizeTitle(rawTitle);
    const prefix = normTitleRes.normTitle.slice(0, 2);
    if (prefix.length === 0) return [];

    const candidateIds = await this.redis.getPrefixCandidates(prefix, 50);
    if (candidateIds.length === 0) return [];

    // Load only the columns we need for similarity reranking. If artist
    // context is present, pre-filter to matching artists so fuzzy matching
    // never crosses artist boundaries.
    const rows = await this.prisma.globalSong.findMany({
      where: {
        id: { in: candidateIds },
        ...(artistIds.length > 0 ? { globalArtistId: { in: artistIds } } : {}),
      },
      select: {
        id: true,
        normTitle: true,
        channelCount: true,
      },
    });

    // Apply the similarity threshold to the RAW Jaro-Winkler score so that
    // popular-but-weak matches cannot slip past the threshold and rare-
    // but-strong matches cannot be dropped. Popularity only affects the
    // rerank order, not the accept/reject decision.
    const FUZZY_THRESHOLD = 0.82;
    const scored = rows
      .map((row) => {
        const similarity = jaroWinklerSimilarity(
          normTitleRes.normTitle,
          row.normTitle,
        );
        return {
          id: row.id,
          similarity,
          // Rerank by similarity weighted by log(popularity)
          rankScore: similarity * Math.log(row.channelCount + 2),
        };
      })
      .filter((r) => r.similarity >= FUZZY_THRESHOLD)
      .sort((a, b) => b.rankScore - a.rankScore)
      .slice(0, limit);

    return scored.map((r) => r.id);
  }

  private async buildResults(
    globalSongIds: number[],
    methodMap: Map<number, MatchMethod>,
    channelId: number | undefined,
  ): Promise<MatchResultItem[]> {
    if (globalSongIds.length === 0) return [];

    const rows = await this.prisma.globalSong.findMany({
      where: { id: { in: globalSongIds } },
      include: { globalArtist: true },
    });

    const rowById = new Map(rows.map((r) => [r.id, r]));

    // Parallel Redis lookups (topCategories + channelMapping) for all results
    const [categoriesArr, mappingsArr] = await Promise.all([
      Promise.all(
        globalSongIds.map((id) => this.redis.getTopCategories(id, 5)),
      ),
      channelId !== undefined
        ? Promise.all(
            globalSongIds.map((id) =>
              this.redis.getChannelSongMapping(id, channelId),
            ),
          )
        : Promise.resolve(globalSongIds.map(() => null)),
    ]);

    const results: MatchResultItem[] = [];
    for (let i = 0; i < globalSongIds.length; i++) {
      const id = globalSongIds[i];
      const row = rowById.get(id);
      if (!row) continue;

      results.push({
        globalSongId: row.id,
        title: row.title,
        artist: row.globalArtist.canonicalName,
        albumArt: row.albumArt,
        channelCount: row.channelCount,
        matchConfidence: methodToConfidence(methodMap.get(id) ?? 'FUZZY'),
        matchMethod: methodMap.get(id) ?? 'FUZZY',
        alreadyInChannel:
          channelId !== undefined ? mappingsArr[i] !== null : undefined,
        topCategories: categoriesArr[i],
      });
    }

    return results;
  }
}

/* ========================================================================= */
/* Query parsing                                                              */
/* ========================================================================= */

export interface ParsedQuery {
  parsedTitle: string;
  parsedArtist: string | null;
}

/**
 * Parse a free-text query into artist + title.
 *
 *   "아이유 - 밤편지"  -> { artist: "아이유", title: "밤편지" }
 *   "10cm - 봄이 좋냐" -> { artist: "10cm",  title: "봄이 좋냐" }
 *   "밤편지"           -> { artist: null, title: "밤편지" }
 *   "Love wins all"    -> { artist: null, title: "Love wins all" }
 *   "Love-Wins"        -> { artist: null, title: "Love-Wins" }   (no split)
 *   "아이유-밤편지"    -> { artist: null, title: "아이유-밤편지" } (no split)
 *
 * Policy: to avoid false splits on hyphenated titles, we ONLY split when
 * the dash has whitespace on BOTH sides. Users typing free-form queries
 * into a search box overwhelmingly use spaces around the separator, so
 * this is the right trade-off. An advanced operator UI can always send
 * artist + title as separate fields in a later phase.
 */
export function parseQuery(raw: string): ParsedQuery {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { parsedTitle: '', parsedArtist: null };
  }

  // Require whitespace on BOTH sides of a dash-like separator
  const match = trimmed.match(/^(.+?)\s+[-–—−ー]\s+(.+)$/);
  if (!match) {
    return { parsedTitle: trimmed, parsedArtist: null };
  }

  const [, left, right] = match;
  const leftTrim = left.trim();
  const rightTrim = right.trim();

  if (leftTrim.length === 0 || rightTrim.length === 0) {
    return { parsedTitle: trimmed, parsedArtist: null };
  }

  return {
    parsedTitle: rightTrim,
    parsedArtist: leftTrim,
  };
}

/* ========================================================================= */
/* Similarity helpers (Jaro-Winkler)                                          */
/* ========================================================================= */

/**
 * Jaro-Winkler similarity. Returns [0, 1]. 1 = identical, 0 = no match.
 * Pure function, no dependencies.
 */
export function jaroWinklerSimilarity(s1: string, s2: string): number {
  if (s1 === s2) return 1;
  if (s1.length === 0 || s2.length === 0) return 0;

  const jaro = jaroSimilarity(s1, s2);
  // Winkler bonus: up to 4 matching chars from the start, scaling factor p = 0.1
  let prefix = 0;
  const maxPrefix = Math.min(4, s1.length, s2.length);
  for (let i = 0; i < maxPrefix; i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }
  return jaro + prefix * 0.1 * (1 - jaro);
}

function jaroSimilarity(s1: string, s2: string): number {
  const len1 = s1.length;
  const len2 = s2.length;
  if (len1 === 0 && len2 === 0) return 1;
  if (len1 === 0 || len2 === 0) return 0;

  const matchDistance = Math.floor(Math.max(len1, len2) / 2) - 1;
  const s1Matches = new Array(len1).fill(false);
  const s2Matches = new Array(len2).fill(false);
  let matches = 0;
  let transpositions = 0;

  for (let i = 0; i < len1; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(len2, i + matchDistance + 1);
    for (let j = start; j < end; j++) {
      if (s2Matches[j]) continue;
      if (s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0;

  let k = 0;
  for (let i = 0; i < len1; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }

  const t = transpositions / 2;
  return (matches / len1 + matches / len2 + (matches - t) / matches) / 3;
}

function methodToConfidence(method: MatchMethod): MatchConfidence {
  switch (method) {
    case 'EXACT':
      return 'HIGH';
    case 'ALIAS':
      return 'MEDIUM';
    case 'FUZZY':
      return 'LOW';
    case 'AI':
      return 'LOW';
  }
}
