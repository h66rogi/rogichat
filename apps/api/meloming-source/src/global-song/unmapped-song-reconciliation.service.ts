import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import OpenAI from 'openai';
import { PrismaService } from '../prisma/prisma.service';
import { GlobalSongRedisService } from './global-song-redis.service';
import { DistributedLockService } from '../common/distributed-lock/distributed-lock.service';
import { DistributedLock } from '../common/distributed-lock/distributed-lock.decorator';
import { CacheKeyTrackingService } from '../redis/cache-key-tracking.service';

/**
 * Daily reconciliation cron for songs without a globalSongId.
 *
 * Two passes:
 *   Pass 1 — Rule-based matching (always on):
 *     - Normalize the song title (lowercase, strip parentheticals, collapse
 *       whitespace)
 *     - Find GlobalSong rows with the same normTitle
 *     - For each candidate, compute alias overlap with the raw song's artist
 *       and pick the highest-scoring one, using channelCount as tiebreaker
 *   Pass 2 — AI-based matching (only when OPENROUTER_API_KEY is set).
 *     Uses Claude Haiku 4.5 via OpenRouter on a batch of 15 remaining songs
 *     at a time. Sends each song with up to 5 GlobalSong candidates (by
 *     partial title) and parses structured "idx:id|NONE" replies.
 *
 * Ported from the one-off scripts /tmp/smart-match-unmapped.js and
 * /tmp/ai-match-unmapped.js, which achieved ~71% rule-based coverage on the
 * initial backfill. Bounded by MAX_SONGS_PER_RUN so execution time stays
 * predictable.
 *
 * Safety:
 *   - Distributed lock prevents concurrent runs across pods
 *   - All Pass 1/2 errors are caught and logged; the cron never crashes
 *   - Redis failures are already swallowed by GlobalSongRedisService (no-ops)
 *   - DB writes are limited to `songs.global_song_id` on rows where it is
 *     still NULL — no destructive operations
 */
@Injectable()
export class UnmappedSongReconciliationService {
  private readonly logger = new Logger(UnmappedSongReconciliationService.name);

  private readonly MAX_SONGS_PER_RUN = 2000;
  private readonly AI_BATCH_SIZE = 15;
  private readonly AI_MODEL =
    process.env.OPENROUTER_MODEL ?? 'anthropic/claude-haiku-4.5';
  private readonly AI_MAX_TOKENS = 2000;
  private readonly AI_BATCH_DELAY_MS = 500;
  private readonly AI_CANDIDATE_LIMIT = 5;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: GlobalSongRedisService,
    private readonly distributedLockService: DistributedLockService,
    private readonly cacheTracker: CacheKeyTrackingService,
  ) {}

  /** Daily at 04:00 KST. */
  @Cron('0 4 * * *', {
    name: 'unmapped-song-reconciliation',
    timeZone: 'Asia/Seoul',
  })
  @DistributedLock('cron:unmapped-song-reconciliation', 60 * 60 * 1000, 2000)
  async reconcile(): Promise<void> {
    const startedAt = Date.now();
    this.logger.log('Starting daily unmapped song reconciliation');
    /** 이번 reconcile 회차 동안 매칭된 song 의 channelId — 종료 시 batch invalidate. */
    const affectedChannels = new Set<number>();

    try {
      const unmapped = await this.prisma.song.findMany({
        where: { globalSongId: null },
        select: {
          id: true,
          title: true,
          channelId: true,
          artist: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: this.MAX_SONGS_PER_RUN,
      });

      this.logger.log(
        `Found ${unmapped.length} unmapped songs (max ${this.MAX_SONGS_PER_RUN})`,
      );

      if (unmapped.length === 0) {
        this.logger.log('No unmapped songs. Done.');
        return;
      }

      // Pass 1: rule-based
      const pass1Matches = await this.runPass1(unmapped, affectedChannels);

      // Pass 2: AI-based via OpenRouter (optional, skip if no API key)
      const remaining = unmapped.filter((s) => !pass1Matches.has(s.id));
      const apiKey = process.env.OPENROUTER_API_KEY;
      let pass2MatchedCount = 0;
      if (apiKey && remaining.length > 0) {
        pass2MatchedCount = await this.runPass2(
          remaining,
          apiKey,
          affectedChannels,
        );
      } else if (!apiKey) {
        this.logger.log('OPENROUTER_API_KEY not set. Skipping Pass 2.');
      }

      const unmatched = unmapped.length - pass1Matches.size - pass2MatchedCount;
      const durationSec = Math.round((Date.now() - startedAt) / 1000);
      this.logger.log(
        `Reconciliation done: pass1=${pass1Matches.size}, pass2=${pass2MatchedCount}, unmatched=${unmatched}, duration=${durationSec}s`,
      );

      // 매칭된 song 들의 channelId 들 distinct batch invalidate.
      // song.globalSongId 변경은 song list 응답에 노출되므로 채널 SET 회수 필요.
      // per-row 호출 시 N 회 SUNION/UNLINK — batch 로 distinct 처리.
      const affected = Array.from(affectedChannels);
      if (affected.length > 0) {
        await this.cacheTracker.clearChannelsBatchSafe(
          affected,
          'reconciliation',
        );
        this.logger.log(
          `cache invalidate dispatched for ${affected.length} channels`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Reconciliation failed: ${
          error instanceof Error ? error.message : error
        }`,
        error instanceof Error ? error.stack : undefined,
      );
      // Swallow — the cron must not crash.
    }
  }

  /* -------------------------------------------------------------------- */
  /* Pass 1: rule-based matching                                           */
  /* -------------------------------------------------------------------- */

  /**
   * Rule-based matcher. For each unmapped song:
   *   1. Compute normTitle
   *   2. Find GlobalSong candidates with the same normTitle
   *   3. For each candidate, derive the alias set from canonicalName +
   *      normKey + GlobalArtistAlias rows and score by overlap with the
   *      unmapped song's artist aliases
   *   4. Apply the highest-scoring match (tiebreaker: channelCount). If no
   *      overlap but there is exactly one candidate with channelCount >= 3,
   *      use it as a "popular single candidate" match.
   *
   * Applies matches to DB + Redis via {@link applyMatch}.
   *
   * @returns Map of matched songId -> globalSongId
   */
  private async runPass1(
    songs: Array<{
      id: number;
      title: string;
      channelId: number;
      artist: { name: string };
    }>,
    affectedChannels: Set<number>,
  ): Promise<Map<number, number>> {
    const matches = new Map<number, number>();
    let noCandidate = 0;
    let ambiguous = 0;

    for (const song of songs) {
      try {
        const normTitle = this.normalize(song.title);
        if (!normTitle) continue;

        const artistAliases = this.extractArtistAliases(song.artist.name);

        const candidates = await this.prisma.globalSong.findMany({
          where: { normTitle },
          select: {
            id: true,
            normTitle: true,
            channelCount: true,
            globalArtist: {
              select: {
                id: true,
                canonicalName: true,
                normKey: true,
                aliases: { select: { normAlias: true } },
              },
            },
          },
        });

        if (candidates.length === 0) {
          noCandidate++;
          continue;
        }

        let bestMatch: (typeof candidates)[number] | null = null;
        let bestScore = 0;

        for (const cand of candidates) {
          const candAliases = new Set<string>();
          candAliases.add(cand.globalArtist.canonicalName.toLowerCase());
          for (const key of cand.globalArtist.normKey.split('|')) {
            if (key) candAliases.add(key.toLowerCase());
          }
          for (const a of cand.globalArtist.aliases) {
            candAliases.add(a.normAlias.toLowerCase());
          }

          let overlap = 0;
          for (const alias of artistAliases) {
            if (candAliases.has(alias)) overlap++;
          }

          // Score: heavy weight on alias overlap, channelCount as tiebreaker
          const score = overlap * 1000 + cand.channelCount;
          if (score > bestScore) {
            bestScore = score;
            bestMatch = cand;
          }
        }

        let resolved: number | null = null;
        if (bestMatch && bestScore >= 1000) {
          resolved = bestMatch.id;
        } else if (candidates.length === 1 && candidates[0].channelCount >= 3) {
          // Exactly one candidate and it's popular enough — trust it
          resolved = candidates[0].id;
        } else {
          ambiguous++;
        }

        if (resolved !== null) {
          await this.applyMatch(song.id, song.channelId, resolved);
          matches.set(song.id, resolved);
          affectedChannels.add(song.channelId);
        }
      } catch (error) {
        this.logger.warn(
          `Pass1 failed for songId=${song.id}: ${
            error instanceof Error ? error.message : error
          }`,
        );
      }
    }

    this.logger.log(
      `Pass1 complete: matched=${matches.size}, ambiguous=${ambiguous}, noCandidate=${noCandidate}`,
    );
    return matches;
  }

  /* -------------------------------------------------------------------- */
  /* Pass 2: AI-based matching                                             */
  /* -------------------------------------------------------------------- */

  /**
   * AI-based matcher. For each remaining song, find up to 5 GlobalSong
   * candidates by partial title (first 8 chars of normTitle as a prefix
   * search, also trying exact normTitle). Batches 15 songs at a time to
   * Claude Haiku, which returns a compact "idx:id|NONE" list.
   *
   * All failures within a batch are caught so a single bad response does
   * not stop the cron.
   *
   * @returns number of matches successfully applied
   */
  private async runPass2(
    songs: Array<{
      id: number;
      title: string;
      channelId: number;
      artist: { name: string };
    }>,
    apiKey: string,
    affectedChannels: Set<number>,
  ): Promise<number> {
    const client = new OpenAI({
      apiKey,
      baseURL:
        process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer':
          process.env.OPENROUTER_SITE_URL ?? 'https://meloming.com',
        'X-Title': process.env.OPENROUTER_SITE_NAME ?? 'Meloming Global Song',
      },
    });

    let totalMatched = 0;
    let totalNoCandidate = 0;
    let totalNoMatch = 0;

    this.logger.log(
      `Pass2 starting: ${songs.length} songs, batch=${this.AI_BATCH_SIZE}`,
    );

    for (let i = 0; i < songs.length; i += this.AI_BATCH_SIZE) {
      const batch = songs.slice(i, i + this.AI_BATCH_SIZE);

      // Build per-song candidate lists
      const songWithCandidates: Array<{
        song: (typeof batch)[number];
        candidates: Array<{
          id: number;
          normTitle: string;
          channelCount: number;
          globalArtist: { canonicalName: string; normKey: string };
        }>;
      }> = [];

      for (const song of batch) {
        try {
          const normTitle = this.normalize(song.title);
          if (!normTitle) {
            totalNoCandidate++;
            continue;
          }
          const searchTerm = normTitle.slice(0, Math.min(8, normTitle.length));

          const candidates = await this.prisma.globalSong.findMany({
            where: {
              OR: [{ normTitle }, { normTitle: { startsWith: searchTerm } }],
            },
            select: {
              id: true,
              normTitle: true,
              channelCount: true,
              globalArtist: {
                select: { canonicalName: true, normKey: true },
              },
            },
            orderBy: { channelCount: 'desc' },
            take: this.AI_CANDIDATE_LIMIT,
          });

          if (candidates.length === 0) {
            totalNoCandidate++;
            continue;
          }

          songWithCandidates.push({ song, candidates });
        } catch (error) {
          this.logger.warn(
            `Pass2 candidate lookup failed for songId=${song.id}: ${
              error instanceof Error ? error.message : error
            }`,
          );
        }
      }

      if (songWithCandidates.length === 0) {
        await this.sleep(this.AI_BATCH_DELAY_MS);
        continue;
      }

      // Build prompt
      const lines = songWithCandidates
        .map((sc, idx) => {
          const candStr = sc.candidates
            .map(
              (c) =>
                `gs:${c.id} "${c.globalArtist.canonicalName} - ${c.normTitle}" (${c.channelCount} channels)`,
            )
            .join('\n    ');
          return (
            `${idx + 1}. Song: "${sc.song.artist.name} - ${sc.song.title}" (id:${sc.song.id})\n` +
            `   Candidates:\n    ${candStr}`
          );
        })
        .join('\n\n');

      const prompt =
        'You are matching songs from a music platform. For each song below, determine if any candidate is the SAME song (same melody/composition, possibly different artist name format or title transliteration).\n\n' +
        'Rules:\n' +
        '- Same song with different artist name format (e.g., Korean vs English name) = MATCH\n' +
        '- Same song with transliterated title (e.g., Japanese to Korean) = MATCH\n' +
        '- Cover versions by the same original composer = MATCH\n' +
        '- Different songs that happen to share a title = NO MATCH\n' +
        '- If uncertain, say NO MATCH\n\n' +
        'For each song, respond with ONLY the format: {song_index}:{gs_id} or {song_index}:NONE\n' +
        'No explanations needed.\n\n' +
        lines;

      try {
        const response = await this.callOpenRouter(client, prompt);
        const matchLines = response.trim().split('\n');

        for (const line of matchLines) {
          const match = line.match(/^(\d+):(\d+|NONE)/);
          if (!match) continue;

          const idx = parseInt(match[1], 10) - 1;
          if (idx < 0 || idx >= songWithCandidates.length) continue;

          if (match[2] === 'NONE') {
            totalNoMatch++;
            continue;
          }

          const gsId = parseInt(match[2], 10);
          if (Number.isNaN(gsId)) continue;

          const sc = songWithCandidates[idx];
          const validCandidate = sc.candidates.find((c) => c.id === gsId);
          if (!validCandidate) continue;

          try {
            await this.applyMatch(sc.song.id, sc.song.channelId, gsId);
            totalMatched++;
            affectedChannels.add(sc.song.channelId);
          } catch (applyError) {
            this.logger.warn(
              `Pass2 apply failed for songId=${sc.song.id} -> gs:${gsId}: ${
                applyError instanceof Error ? applyError.message : applyError
              }`,
            );
          }
        }
      } catch (error) {
        this.logger.warn(
          `OpenRouter API error at batch ${Math.floor(i / this.AI_BATCH_SIZE)}: ${
            error instanceof Error ? error.message : error
          }`,
        );
      }

      // Gentle rate limiting between batches
      await this.sleep(this.AI_BATCH_DELAY_MS);
    }

    this.logger.log(
      `Pass2 complete: matched=${totalMatched}, noMatch=${totalNoMatch}, noCandidate=${totalNoCandidate}`,
    );
    return totalMatched;
  }

  /* -------------------------------------------------------------------- */
  /* Helpers                                                              */
  /* -------------------------------------------------------------------- */

  private async callOpenRouter(
    client: OpenAI,
    prompt: string,
  ): Promise<string> {
    const response = await client.chat.completions.create({
      model: this.AI_MODEL,
      user: 'meloming-back:global-song-unmapped-reconciliation',
      max_tokens: this.AI_MAX_TOKENS,
      temperature: 0,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.choices[0]?.message?.content;
    if (typeof text !== 'string' || text.length === 0) {
      throw new Error('OpenRouter returned no text content');
    }
    return text;
  }

  /**
   * Normalize title for matching: lowercase, strip parentheticals, collapse
   * whitespace, trim.
   */
  private normalize(str: string): string {
    return str
      .toLowerCase()
      .replace(/[\(（\[［][^\)\]）］]*[\)\]）］]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Extract alias variants from a raw artist name. Mirrors the logic in the
   * /tmp/smart-match-unmapped.js POC: keep the whole string, pull parts from
   * bracket expressions, and split on whitespace.
   */
  private extractArtistAliases(artistName: string): string[] {
    const aliases = new Set<string>();
    const normalized = artistName.toLowerCase().trim();
    if (!normalized) return [];
    aliases.add(normalized);

    const parenMatch = artistName.match(
      /^(.+?)[\s]*[\(（\[［](.+?)[\)\]）］](.*)$/,
    );
    if (parenMatch) {
      aliases.add(parenMatch[1].toLowerCase().trim());
      aliases.add(parenMatch[2].toLowerCase().trim());
    }

    for (const part of normalized.split(/\s+/)) {
      if (part.length > 1) aliases.add(part);
    }

    return [...aliases].filter((a) => a.length > 0);
  }

  /**
   * Apply a match: update the DB row (only where globalSongId IS NULL to stay
   * idempotent and avoid clobbering a concurrent write) and mirror into Redis.
   */
  private async applyMatch(
    songId: number,
    channelId: number,
    globalSongId: number,
  ): Promise<void> {
    const updated = await this.prisma.song.updateMany({
      where: { id: songId, globalSongId: null },
      data: { globalSongId },
    });

    // If another writer beat us to it, skip the Redis update
    if (updated.count === 0) return;

    await this.redis.setChannelSongMapping(globalSongId, channelId, songId);
    await this.redis.addToChannelSongSet(channelId, globalSongId);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
