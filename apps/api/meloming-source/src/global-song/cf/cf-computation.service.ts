import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { GlobalSongRedisService } from '../global-song-redis.service';
import { DistributedLockService } from '../../common/distributed-lock/distributed-lock.service';
import {
  songWeight,
  tverskySimilarity,
  userCFScore,
  sharpenWeight,
  itemSimilarity,
  itemCFScore,
  hybridScore,
  mmrSelect,
} from './cf-math';

/**
 * Batch CF computation for song recommendations.
 *
 * Runs as a one-shot job (triggered by admin or cron). Reads the current
 * global-song index from DB, computes channel-channel and item-item
 * similarities, generates per-channel recommendation lists, and caches
 * everything in Redis with a 24h TTL.
 *
 * Spec Section 4 pre-computation flow:
 *   1. Load per-channel global_song sets
 *   2. Compute song weights (IDF × reliability)
 *   3. Channel-channel similarity via inverted index
 *   4. Item-item similarity (PMI+ with shrinkage)
 *   5. Per-channel recommendations (hybrid user-CF + item-CF, MMR rerank)
 */
@Injectable()
export class CFComputationService {
  private readonly logger = new Logger(CFComputationService.name);

  private static readonly LOCK_KEY = 'global-song:cf-computation-lock';
  private static readonly LOCK_TTL_MS = 60 * 60 * 1000; // 1 hour
  private static readonly TOP_SIMILAR_CHANNELS = 50;
  private static readonly TOP_SIMILAR_ITEMS = 100;
  private static readonly MIN_COOCCURRENCE = 3;
  private static readonly MIN_CHANNEL_SONGS = 10;
  private static readonly RECS_PER_CHANNEL = 20;
  private static readonly RECS_TTL_SECONDS = 24 * 60 * 60;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: GlobalSongRedisService,
    private readonly lockService: DistributedLockService,
  ) {}

  private async flushCFKeys(): Promise<void> {
    if (!this.redis.isReady()) return;
    // Delegate to Redis service — scan + delete ch:*:similar,
    // gs:*:similar_items, ch:*:recs
    await this.redis.flushCFKeys();
  }

  async compute(): Promise<{
    channelSimilarities: number;
    itemSimilarities: number;
    channelRecommendations: number;
  }> {
    if (!this.redis.isReady()) {
      this.logger.warn('CF computation aborted: Redis not ready');
      return {
        channelSimilarities: 0,
        itemSimilarities: 0,
        channelRecommendations: 0,
      };
    }

    const lockAcquired = await this.lockService.acquireLock(
      CFComputationService.LOCK_KEY,
      CFComputationService.LOCK_TTL_MS,
    );
    if (!lockAcquired) {
      this.logger.warn('CF computation aborted: lock held by another pod');
      return {
        channelSimilarities: 0,
        itemSimilarities: 0,
        channelRecommendations: 0,
      };
    }

    const startedAt = Date.now();
    this.logger.log('CF computation starting');

    try {
      // Step 1: Load channel → globalSongIds mapping
      const { channelSongs, songChannels, totalChannels } =
        await this.loadChannelSongSets();

      this.logger.log(
        `Loaded ${channelSongs.size} channels, ${songChannels.size} songs, N=${totalChannels}`,
      );

      // Step 2: Compute song weights
      const weights = new Map<number, number>();
      for (const [songId, channels] of songChannels) {
        weights.set(songId, songWeight(channels.size, totalChannels));
      }

      // Flush stale CF keys before recomputing so old neighbors/items
      // don't persist across runs
      const flushStart = Date.now();
      await this.flushCFKeys();
      this.logger.log(
        `Step 2: flushed CF keys in ${((Date.now() - flushStart) / 1000).toFixed(1)}s`,
      );

      // Step 3: Channel-channel similarity via inverted index
      const step3Start = Date.now();
      const channelSimCount = await this.computeChannelSimilarities(
        channelSongs,
        songChannels,
        weights,
        totalChannels,
      );
      this.logger.log(
        `Step 3: channel similarities (${channelSimCount}) in ` +
          `${((Date.now() - step3Start) / 1000).toFixed(1)}s`,
      );

      // Step 4: Item-item similarities
      const step4Start = Date.now();
      const itemSimCount = await this.computeItemSimilarities(
        channelSongs,
        songChannels,
        totalChannels,
      );
      this.logger.log(
        `Step 4: item similarities (${itemSimCount}) in ` +
          `${((Date.now() - step4Start) / 1000).toFixed(1)}s`,
      );

      // Step 5: Per-channel recommendations
      const step5Start = Date.now();
      const recsCount = await this.computeRecommendations(
        channelSongs,
        songChannels,
        weights,
        totalChannels,
      );
      this.logger.log(
        `Step 5: recommendations (${recsCount}) in ` +
          `${((Date.now() - step5Start) / 1000).toFixed(1)}s`,
      );

      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
      this.logger.log(
        `CF computation complete: ${channelSimCount} channel similarities, ` +
          `${itemSimCount} item similarities, ${recsCount} channel recommendations, ` +
          `elapsed=${elapsed}s`,
      );

      return {
        channelSimilarities: channelSimCount,
        itemSimilarities: itemSimCount,
        channelRecommendations: recsCount,
      };
    } finally {
      await this.lockService
        .releaseLock(CFComputationService.LOCK_KEY)
        .catch(() => undefined);
    }
  }

  /* -------------------------------------------------------------------- */
  /* Step 1: Load data                                                     */
  /* -------------------------------------------------------------------- */

  private async loadChannelSongSets(): Promise<{
    channelSongs: Map<number, Set<number>>;
    songChannels: Map<number, Set<number>>;
    totalChannels: number;
  }> {
    const dbStart = Date.now();

    // Use the Redis channel mapping hashes as the ground truth
    // for which channels contain which global songs.
    const globalSongs = await this.prisma.globalSong.findMany({
      where: { channelCount: { gt: 0 } },
      select: { id: true, channelCount: true },
    });

    const dbElapsed = ((Date.now() - dbStart) / 1000).toFixed(1);
    this.logger.log(
      `Step 1a: loaded ${globalSongs.length} globalSongs from DB in ${dbElapsed}s`,
    );

    const channelSongs = new Map<number, Set<number>>();
    const songChannels = new Map<number, Set<number>>();
    const allChannelIds = new Set<number>();

    // Batch Redis HGETALL via Promise.all (node-redis auto-pipelining)
    // to avoid N+1 sequential round-trips. Chunk to bound concurrency.
    const redisStart = Date.now();
    const CHUNK = 500;
    let processed = 0;
    for (let i = 0; i < globalSongs.length; i += CHUNK) {
      const chunk = globalSongs.slice(i, i + CHUNK);
      const ids = chunk.map((gs) => gs.id);
      const mappings = await this.redis.getChannelSongMappingsBatch(ids);

      for (const gs of chunk) {
        const channelMapping = mappings.get(gs.id);
        if (!channelMapping) continue;

        const channelIds = Object.keys(channelMapping).map(Number);
        songChannels.set(gs.id, new Set(channelIds));

        for (const chId of channelIds) {
          allChannelIds.add(chId);
          if (!channelSongs.has(chId)) channelSongs.set(chId, new Set());
          channelSongs.get(chId).add(gs.id);
        }
      }
      processed += chunk.length;
    }

    const redisElapsed = ((Date.now() - redisStart) / 1000).toFixed(1);
    this.logger.log(
      `Step 1b: fetched ${processed} Redis channel mappings in ${redisElapsed}s ` +
        `(${channelSongs.size} channels, ${songChannels.size} songs with mappings)`,
    );

    return {
      channelSongs,
      songChannels,
      totalChannels: allChannelIds.size,
    };
  }

  /* -------------------------------------------------------------------- */
  /* Step 3: Channel-channel similarity                                    */
  /* -------------------------------------------------------------------- */

  private async computeChannelSimilarities(
    channelSongs: Map<number, Set<number>>,
    songChannels: Map<number, Set<number>>,
    weights: Map<number, number>,
    totalChannels: number,
  ): Promise<number> {
    // Inverted index approach: for each song with df >= 2, accumulate
    // weighted intersection for every pair of channels that share it.
    const pairIntersection = new Map<string, number>();

    // Pre-compute channel masses
    const channelMass = new Map<number, number>();
    for (const [chId, songs] of channelSongs) {
      let mass = 0;
      for (const songId of songs) {
        mass += weights.get(songId) ?? 0;
      }
      channelMass.set(chId, mass);
    }

    for (const [songId, channels] of songChannels) {
      if (channels.size < 2) continue;
      const w = weights.get(songId) ?? 0;
      if (w <= 0) continue;

      const channelList = Array.from(channels);
      for (let i = 0; i < channelList.length; i++) {
        for (let j = i + 1; j < channelList.length; j++) {
          const key = `${channelList[i]}:${channelList[j]}`;
          pairIntersection.set(key, (pairIntersection.get(key) ?? 0) + w);
        }
      }
    }

    // Compute Tversky and store top-K similar channels per channel
    const channelSims = new Map<
      number,
      Array<{ chId: number; score: number }>
    >();

    for (const [key, intersection] of pairIntersection) {
      const [c1Str, c2Str] = key.split(':');
      const c1 = Number(c1Str);
      const c2 = Number(c2Str);
      const massC1 = channelMass.get(c1) ?? 0;
      const massC2 = channelMass.get(c2) ?? 0;

      // Compute both directions (asymmetric Tversky)
      const sim12 = tverskySimilarity(intersection, massC1, massC2);
      const sim21 = tverskySimilarity(intersection, massC2, massC1);

      if (sim12 > 0) {
        if (!channelSims.has(c1)) channelSims.set(c1, []);
        channelSims.get(c1).push({ chId: c2, score: sim12 });
      }
      if (sim21 > 0) {
        if (!channelSims.has(c2)) channelSims.set(c2, []);
        channelSims.get(c2).push({ chId: c1, score: sim21 });
      }
    }

    // Store top-50 per channel in Redis
    let stored = 0;
    for (const [chId, sims] of channelSims) {
      // Only for channels with enough songs
      if (
        (channelSongs.get(chId)?.size ?? 0) <
        CFComputationService.MIN_CHANNEL_SONGS
      ) {
        continue;
      }

      sims.sort((a, b) => b.score - a.score);
      const top = sims.slice(0, CFComputationService.TOP_SIMILAR_CHANNELS);

      for (const { chId: neighborId, score } of top) {
        await this.redis.addChannelSimilarity(chId, neighborId, score);
      }
      stored++;
    }

    return stored;
  }

  /* -------------------------------------------------------------------- */
  /* Step 4: Item-item similarities                                        */
  /* -------------------------------------------------------------------- */

  private async computeItemSimilarities(
    channelSongsInput: Map<number, Set<number>>,
    songChannels: Map<number, Set<number>>,
    totalChannels: number,
  ): Promise<number> {
    // Memory budget: ~1-2M pairs max. Per-channel cap + df>=2 prefilter
    // together keep the co-occurrence map bounded for prod-scale data
    // (191K songs, 1742 channels, some channels with 1000+ songs).
    const MAX_PAIR_SIZE = 50;

    // Prefilter: only songs appearing in >= 2 channels can contribute
    // to item-item similarity (df=1 pairs have 0 co-occurrences)
    const candidateSongs = new Set<number>();
    for (const [songId, channels] of songChannels) {
      if (channels.size >= 2) candidateSongs.add(songId);
    }

    const coOccurrence = new Map<string, number>();

    for (const [, songsSet] of channelSongsInput) {
      // Filter to df>=2 candidates only, then cap for O(n²) safety
      const songs: number[] = [];
      for (const s of songsSet) {
        if (candidateSongs.has(s)) songs.push(s);
        if (songs.length >= MAX_PAIR_SIZE) break;
      }
      if (songs.length < 2) continue;

      for (let i = 0; i < songs.length; i++) {
        for (let j = i + 1; j < songs.length; j++) {
          const key =
            songs[i] < songs[j]
              ? `${songs[i]}:${songs[j]}`
              : `${songs[j]}:${songs[i]}`;
          coOccurrence.set(key, (coOccurrence.get(key) ?? 0) + 1);
        }
      }
    }

    this.logger.log(
      `Item similarity: ${candidateSongs.size} df>=2 songs, ${coOccurrence.size} pairs accumulated`,
    );

    // Compute PMI+ and store top-100 per song
    const songSims = new Map<
      number,
      Array<{ songId: number; score: number }>
    >();

    for (const [key, count] of coOccurrence) {
      if (count < CFComputationService.MIN_COOCCURRENCE) continue;

      const [s1Str, s2Str] = key.split(':');
      const s1 = Number(s1Str);
      const s2 = Number(s2Str);
      const df1 = songChannels.get(s1)?.size ?? 0;
      const df2 = songChannels.get(s2)?.size ?? 0;

      const sim = itemSimilarity(count, df1, df2, totalChannels);
      if (sim <= 0) continue;

      if (!songSims.has(s1)) songSims.set(s1, []);
      if (!songSims.has(s2)) songSims.set(s2, []);
      songSims.get(s1).push({ songId: s2, score: sim });
      songSims.get(s2).push({ songId: s1, score: sim });
    }

    // Store top-100 in Redis
    let stored = 0;
    for (const [songId, sims] of songSims) {
      sims.sort((a, b) => b.score - a.score);
      const top = sims.slice(0, CFComputationService.TOP_SIMILAR_ITEMS);

      for (const { songId: similarId, score } of top) {
        await this.redis.addItemSimilarity(songId, similarId, score);
      }
      stored++;
    }

    return stored;
  }

  /* -------------------------------------------------------------------- */
  /* Step 5: Per-channel recommendations                                   */
  /* -------------------------------------------------------------------- */

  private async computeRecommendations(
    channelSongs: Map<number, Set<number>>,
    songChannels: Map<number, Set<number>>,
    weights: Map<number, number>,
    totalChannels: number,
  ): Promise<number> {
    let computed = 0;
    const failedChannels: Array<{ channelId: number; mySongs: Set<number> }> =
      [];

    // 1st pass: compute recs for all eligible channels, collect transient failures
    for (const [channelId, mySongs] of channelSongs) {
      if (mySongs.size < 3) continue; // too few songs for meaningful recs

      try {
        const recs = await this.computeChannelRecs(
          channelId,
          mySongs,
          channelSongs,
          songChannels,
          weights,
          totalChannels,
        );

        if (recs.length > 0) {
          await this.redis.setChannelRecommendations(
            channelId,
            recs,
            CFComputationService.RECS_TTL_SECONDS,
          );
          computed++;
        }
      } catch (error) {
        this.logger.debug(
          `CF recs 1st pass failed for channel ${channelId}: ${
            error instanceof Error ? error.message : error
          }`,
        );
        failedChannels.push({ channelId, mySongs });
      }
    }

    // 2nd pass: retry failed channels once. Covers transient Redis blips
    // (e.g., connection oscillation during long Step 5 loops). Permanent
    // failures still surface as errors.
    if (failedChannels.length > 0) {
      this.logger.warn(
        `CF recs 1st pass: ${failedChannels.length} channels failed, retrying`,
      );
      let retrySucceeded = 0;
      for (const { channelId, mySongs } of failedChannels) {
        try {
          const recs = await this.computeChannelRecs(
            channelId,
            mySongs,
            channelSongs,
            songChannels,
            weights,
            totalChannels,
          );
          if (recs.length > 0) {
            await this.redis.setChannelRecommendations(
              channelId,
              recs,
              CFComputationService.RECS_TTL_SECONDS,
            );
            computed++;
            retrySucceeded++;
          }
        } catch (error) {
          this.logger.error(
            `CF recs retry failed for channel ${channelId}: ${
              error instanceof Error ? error.message : error
            }`,
          );
        }
      }
      this.logger.log(
        `CF recs retry: ${retrySucceeded}/${failedChannels.length} recovered`,
      );
    }

    return computed;
  }

  private async computeChannelRecs(
    channelId: number,
    mySongs: Set<number>,
    channelSongs: Map<number, Set<number>>,
    songChannels: Map<number, Set<number>>,
    weights: Map<number, number>,
    totalChannels: number,
  ): Promise<Array<{ globalSongId: number; score: number; reason: string }>> {
    const channelSize = mySongs.size;

    // User-CF: get top-K similar channels
    const similarChannels = await this.redis.getChannelSimilarities(
      channelId,
      CFComputationService.TOP_SIMILAR_CHANNELS,
    );

    // Candidate songs: union of all songs in similar channels, minus my songs
    const candidateScores = new Map<
      number,
      { userCF: number; itemCF: number }
    >();

    // User-CF scores
    if (similarChannels.length > 0) {
      const sharpWeights = similarChannels.map((s) => ({
        chId: s.chId,
        weight: sharpenWeight(s.score),
      }));
      const totalW = sharpWeights.reduce((sum, s) => sum + s.weight, 0);

      for (const { chId: neighborId, weight } of sharpWeights) {
        const neighborSongs = channelSongs.get(neighborId);
        if (!neighborSongs) continue;

        for (const songId of neighborSongs) {
          if (mySongs.has(songId)) continue;
          const prev = candidateScores.get(songId) ?? {
            userCF: 0,
            itemCF: 0,
          };
          prev.userCF += weight; // accumulate n(C,s)
          candidateScores.set(songId, prev);
        }
      }

      // Convert accumulated votes to Bayesian uplift scores
      for (const [songId, scores] of candidateScores) {
        const df = songChannels.get(songId)?.size ?? 1;
        const prevalence = df / totalChannels;
        const totalWeight = totalW > 0 ? totalW : 1;
        scores.userCF = userCFScore(scores.userCF, totalWeight, prevalence);
      }
    }

    // Item-CF scores
    for (const [candidateId, scores] of candidateScores) {
      const similarities: number[] = [];
      const itemSims = await this.redis.getItemSimilarities(candidateId, 50);

      for (const { songId: neighborSongId, score } of itemSims) {
        if (mySongs.has(neighborSongId)) {
          similarities.push(score);
        }
      }

      scores.itemCF = itemCFScore(similarities, channelSize);
    }

    // Also add item-CF-only candidates (for small channels where user-CF is weak)
    for (const mySongId of mySongs) {
      const itemSims = await this.redis.getItemSimilarities(mySongId, 20);
      for (const { songId, score } of itemSims) {
        if (mySongs.has(songId)) continue;
        if (!candidateScores.has(songId)) {
          candidateScores.set(songId, {
            userCF: 0,
            itemCF: score / channelSize,
          });
        }
      }
    }

    // Hybrid blend
    const scoredCandidates = Array.from(candidateScores.entries())
      .map(([globalSongId, { userCF: u, itemCF: i }]) => ({
        id: globalSongId,
        relevance: hybridScore(u, i, channelSize),
      }))
      .filter((c) => c.relevance > 0)
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, 100); // pre-filter top 100 before MMR

    // Take top-K by relevance. MMR diversity reranking deferred until
    // item-similarity data is pre-loaded into the batch context (Phase 3+).
    const topResults = scoredCandidates.slice(
      0,
      CFComputationService.RECS_PER_CHANNEL,
    );

    // Build result with reason strings
    const neighborCount = similarChannels.length;
    return topResults.map((r) => ({
      globalSongId: r.id,
      score: r.relevance,
      reason: `비슷한 노래책 ${neighborCount}개 중 추천`,
    }));
  }
}
