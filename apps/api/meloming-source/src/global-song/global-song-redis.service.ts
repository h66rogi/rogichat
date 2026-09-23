import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, RedisClientType } from 'redis';
import { EnvironmentVariables } from '../config/env.config';

/**
 * Raw Redis client wrapper for the global-song index.
 *
 * Owns a dedicated node-redis v5 connection (not cache-manager) because
 * the matcher requires SET / HASH / SORTED-SET operations that the
 * cache-manager abstraction doesn't expose.
 *
 * CRITICAL: All connection failures are swallowed. If Redis is unreachable,
 * `isReady()` returns false and all calls become no-ops (or return empty).
 * The app MUST start normally even if Redis is down — existing features
 * are unaffected. The matcher checks `isReady()` and returns 503 for
 * global-song endpoints only.
 *
 * Redis key families (from spec Section 1):
 *
 *   gs:lookup:{normTitle}:{globalArtistId}    STRING      -> globalSongId
 *   gs:{id}:channels                          HASH        channelId -> songId
 *   ch:{channelId}:gsongs                     SET         of globalSongId
 *   ga:alias:{normAlias}                      SET         of globalArtistId
 *   gs:title_alias:{normAliasTitle}           SET         of globalSongId
 *   gs:prefix:{prefix}                        SORTED-SET  globalSongId by channelCount
 *   gs:{id}:categories                        SORTED-SET  categoryName by frequency
 */
@Injectable()
export class GlobalSongRedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GlobalSongRedisService.name);
  private client?: RedisClientType;
  private _ready = false;
  private readonly redisUrl: string;

  constructor(configService: ConfigService<EnvironmentVariables>) {
    const host = configService.get('REDIS_HOST');
    const port = configService.get('REDIS_PORT');
    const password = configService.get('REDIS_PASSWORD');
    this.redisUrl = password
      ? `redis://:${encodeURIComponent(password)}@${host}:${port}`
      : `redis://${host}:${port}`;
  }

  async onModuleInit(): Promise<void> {
    try {
      this.client = createClient({ url: this.redisUrl });
      this.client.on('error', (error) => {
        this._ready = false;
        this.logger.error(
          `GlobalSong Redis error: ${error instanceof Error ? error.message : error}`,
        );
      });
      this.client.on('ready', () => {
        this._ready = true;
        this.logger.log('GlobalSong Redis connected');
      });
      await this.client.connect();
    } catch (error) {
      this._ready = false;
      this.logger.error(
        `GlobalSong Redis connect failed (app will continue without index): ${
          error instanceof Error ? error.message : error
        }`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.client) return;
    await this.client.quit().catch(() => undefined);
  }

  isReady(): boolean {
    return this._ready && this.client !== undefined;
  }

  /* -------------------------------------------------------------------- */
  /* Song lookup: gs:lookup:{normTitle}:{globalArtistId}                    */
  /* -------------------------------------------------------------------- */

  async lookupSong(
    normTitle: string,
    globalArtistId: number,
  ): Promise<number | null> {
    if (!this.client || !this._ready) return null;
    const value = await this.client.get(
      this.lookupKey(normTitle, globalArtistId),
    );
    return value ? Number(value) : null;
  }

  async setSongLookup(
    normTitle: string,
    globalArtistId: number,
    globalSongId: number,
  ): Promise<void> {
    if (!this.client || !this._ready) return;
    await this.client.set(
      this.lookupKey(normTitle, globalArtistId),
      String(globalSongId),
    );
  }

  async deleteSongLookup(
    normTitle: string,
    globalArtistId: number,
  ): Promise<void> {
    if (!this.client || !this._ready) return;
    await this.client.del(this.lookupKey(normTitle, globalArtistId));
  }

  /* -------------------------------------------------------------------- */
  /* Artist alias: ga:alias:{normAlias} (Set of globalArtistId)             */
  /* -------------------------------------------------------------------- */

  async lookupArtistAlias(normAlias: string): Promise<number[]> {
    if (!this.client || !this._ready) return [];
    const members = await this.client.sMembers(
      `ga:alias:${this.safe(normAlias)}`,
    );
    return members.map((m) => Number(m));
  }

  async addArtistAlias(
    normAlias: string,
    globalArtistId: number,
  ): Promise<void> {
    if (!this.client || !this._ready) return;
    await this.client.sAdd(
      `ga:alias:${this.safe(normAlias)}`,
      String(globalArtistId),
    );
  }

  async removeArtistAlias(
    normAlias: string,
    globalArtistId: number,
  ): Promise<void> {
    if (!this.client || !this._ready) return;
    await this.client.sRem(
      `ga:alias:${this.safe(normAlias)}`,
      String(globalArtistId),
    );
  }

  /* -------------------------------------------------------------------- */
  /* Title alias: gs:title_alias:{normAliasTitle} (Set of globalSongId)     */
  /* -------------------------------------------------------------------- */

  async lookupTitleAlias(normAliasTitle: string): Promise<number[]> {
    if (!this.client || !this._ready) return [];
    const members = await this.client.sMembers(
      `gs:title_alias:${this.safe(normAliasTitle)}`,
    );
    return members.map((m) => Number(m));
  }

  async addTitleAlias(
    normAliasTitle: string,
    globalSongId: number,
  ): Promise<void> {
    if (!this.client || !this._ready) return;
    await this.client.sAdd(
      `gs:title_alias:${this.safe(normAliasTitle)}`,
      String(globalSongId),
    );
  }

  async removeTitleAlias(
    normAliasTitle: string,
    globalSongId: number,
  ): Promise<void> {
    if (!this.client || !this._ready) return;
    await this.client.sRem(
      `gs:title_alias:${this.safe(normAliasTitle)}`,
      String(globalSongId),
    );
  }

  /* -------------------------------------------------------------------- */
  /* Channel song mapping: gs:{globalSongId}:channels (Hash)                */
  /* -------------------------------------------------------------------- */

  async setChannelSongMapping(
    globalSongId: number,
    channelId: number,
    songId: number,
  ): Promise<void> {
    if (!this.client || !this._ready) return;
    await this.client.hSet(
      `gs:${globalSongId}:channels`,
      String(channelId),
      String(songId),
    );
  }

  async getChannelSongMapping(
    globalSongId: number,
    channelId: number,
  ): Promise<number | null> {
    if (!this.client || !this._ready) return null;
    const value = await this.client.hGet(
      `gs:${globalSongId}:channels`,
      String(channelId),
    );
    return value ? Number(value) : null;
  }

  async removeChannelSongMapping(
    globalSongId: number,
    channelId: number,
  ): Promise<void> {
    if (!this.client || !this._ready) return;
    await this.client.hDel(`gs:${globalSongId}:channels`, String(channelId));
  }

  async getChannelSongMappingCount(globalSongId: number): Promise<number> {
    if (!this.client || !this._ready) return 0;
    return this.client.hLen(`gs:${globalSongId}:channels`);
  }

  /* -------------------------------------------------------------------- */
  /* Channel global-song set: ch:{channelId}:gsongs (Set of globalSongId)   */
  /* -------------------------------------------------------------------- */

  async addToChannelSongSet(
    channelId: number,
    globalSongId: number,
  ): Promise<void> {
    if (!this.client || !this._ready) return;
    await this.client.sAdd(`ch:${channelId}:gsongs`, String(globalSongId));
  }

  async removeFromChannelSongSet(
    channelId: number,
    globalSongId: number,
  ): Promise<void> {
    if (!this.client || !this._ready) return;
    await this.client.sRem(`ch:${channelId}:gsongs`, String(globalSongId));
  }

  async getChannelSongSet(channelId: number): Promise<number[]> {
    if (!this.client || !this._ready) return [];
    const members = await this.client.sMembers(`ch:${channelId}:gsongs`);
    return members.map((m) => Number(m));
  }

  async getChannelSongSetCount(channelId: number): Promise<number> {
    if (!this.client || !this._ready) return 0;
    return this.client.sCard(`ch:${channelId}:gsongs`);
  }

  /* -------------------------------------------------------------------- */
  /* Prefix index: gs:prefix:{prefix} (SortedSet globalSongId by count)     */
  /* -------------------------------------------------------------------- */

  async addToPrefixIndex(
    prefix: string,
    globalSongId: number,
    channelCount: number,
  ): Promise<void> {
    if (!this.client || !this._ready) return;
    await this.client.zAdd(`gs:prefix:${this.safe(prefix)}`, {
      score: channelCount,
      value: String(globalSongId),
    });
  }

  async getPrefixCandidates(prefix: string, limit = 50): Promise<number[]> {
    if (!this.client || !this._ready) return [];
    // Top-N by score descending (highest channel_count first)
    const members = await this.client.zRange(
      `gs:prefix:${this.safe(prefix)}`,
      0,
      limit - 1,
      { REV: true },
    );
    return members.map((m) => Number(m));
  }

  async removeFromPrefixIndex(
    prefix: string,
    globalSongId: number,
  ): Promise<void> {
    if (!this.client || !this._ready) return;
    await this.client.zRem(
      `gs:prefix:${this.safe(prefix)}`,
      String(globalSongId),
    );
  }

  /* -------------------------------------------------------------------- */
  /* Category frequency: gs:{globalSongId}:categories (SortedSet)           */
  /* -------------------------------------------------------------------- */

  async incrementCategoryFrequency(
    globalSongId: number,
    categoryName: string,
    delta = 1,
  ): Promise<void> {
    if (!this.client || !this._ready) return;
    await this.client.zIncrBy(
      `gs:${globalSongId}:categories`,
      delta,
      categoryName,
    );
  }

  async getTopCategories(globalSongId: number, limit = 5): Promise<string[]> {
    if (!this.client || !this._ready) return [];
    const members = await this.client.zRange(
      `gs:${globalSongId}:categories`,
      0,
      limit - 1,
      { REV: true },
    );
    return members;
  }

  /* -------------------------------------------------------------------- */
  /* Channel song mapping: full hash read (for CF computation)              */
  /* -------------------------------------------------------------------- */

  async getChannelSongMappingAll(
    globalSongId: number,
  ): Promise<Record<string, string> | null> {
    if (!this.client || !this._ready) return null;
    const hash = await this.client.hGetAll(`gs:${globalSongId}:channels`);
    return Object.keys(hash).length > 0 ? hash : null;
  }

  /**
   * Batch version of getChannelSongMappingAll.
   *
   * Issues HGETALL for each song id in a single node-redis pipeline via
   * Promise.all, then returns a Map keyed by songId. Empty hashes are
   * represented as null so callers can skip songs with no channel mapping.
   *
   * Callers should chunk large input arrays (recommended ≤ 1000 per call)
   * to bound memory and avoid blocking the event loop.
   */
  async getChannelSongMappingsBatch(
    globalSongIds: number[],
  ): Promise<Map<number, Record<string, string> | null>> {
    const result = new Map<number, Record<string, string> | null>();
    if (!this.client || !this._ready || globalSongIds.length === 0) {
      for (const id of globalSongIds) result.set(id, null);
      return result;
    }

    const client = this.client;
    const hashes = await Promise.all(
      globalSongIds.map((id) => client.hGetAll(`gs:${id}:channels`)),
    );
    for (let i = 0; i < globalSongIds.length; i++) {
      const hash = hashes[i];
      result.set(globalSongIds[i], Object.keys(hash).length > 0 ? hash : null);
    }
    return result;
  }

  /* -------------------------------------------------------------------- */
  /* Channel similarity: ch:{channelId}:similar (SortedSet)                 */
  /* -------------------------------------------------------------------- */

  async addChannelSimilarity(
    channelId: number,
    neighborId: number,
    score: number,
  ): Promise<void> {
    if (!this.client || !this._ready) return;
    await this.client.zAdd(`ch:${channelId}:similar`, {
      score,
      value: String(neighborId),
    });
  }

  async getChannelSimilarities(
    channelId: number,
    limit = 50,
  ): Promise<Array<{ chId: number; score: number }>> {
    if (!this.client || !this._ready) return [];
    const members = await this.client.zRangeWithScores(
      `ch:${channelId}:similar`,
      0,
      limit - 1,
      { REV: true },
    );
    return members.map((m) => ({ chId: Number(m.value), score: m.score }));
  }

  /* -------------------------------------------------------------------- */
  /* Item similarity: gs:{globalSongId}:similar_items (SortedSet)           */
  /* -------------------------------------------------------------------- */

  async addItemSimilarity(
    songId: number,
    similarId: number,
    score: number,
  ): Promise<void> {
    if (!this.client || !this._ready) return;
    await this.client.zAdd(`gs:${songId}:similar_items`, {
      score,
      value: String(similarId),
    });
  }

  async getItemSimilarities(
    songId: number,
    limit = 100,
  ): Promise<Array<{ songId: number; score: number }>> {
    if (!this.client || !this._ready) return [];
    const members = await this.client.zRangeWithScores(
      `gs:${songId}:similar_items`,
      0,
      limit - 1,
      { REV: true },
    );
    return members.map((m) => ({
      songId: Number(m.value),
      score: m.score,
    }));
  }

  /* -------------------------------------------------------------------- */
  /* Channel recommendations: ch:{channelId}:recs (String, JSON)            */
  /* -------------------------------------------------------------------- */

  async setChannelRecommendations(
    channelId: number,
    recs: Array<{ globalSongId: number; score: number; reason: string }>,
    ttlSeconds: number,
  ): Promise<void> {
    if (!this.client || !this._ready) return;
    await this.client.set(`ch:${channelId}:recs`, JSON.stringify(recs), {
      EX: ttlSeconds,
    });
  }

  async getChannelRecommendations(channelId: number): Promise<Array<{
    globalSongId: number;
    score: number;
    reason: string;
  }> | null> {
    if (!this.client || !this._ready) return null;
    const raw = await this.client.get(`ch:${channelId}:recs`);
    if (!raw || typeof raw !== 'string') return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  /* -------------------------------------------------------------------- */
  /* CF key flush (for CF recomputation)                                    */
  /* -------------------------------------------------------------------- */

  async flushCFKeys(): Promise<void> {
    if (!this.client || !this._ready) return;
    await this.scanAndDelete('ch:*:similar');
    await this.scanAndDelete('gs:*:similar_items');
    await this.scanAndDelete('ch:*:recs');
  }

  /* -------------------------------------------------------------------- */
  /* Bulk flush (for bootstrap rebuild)                                     */
  /* -------------------------------------------------------------------- */

  async flushGlobalSongKeys(): Promise<void> {
    if (!this.client || !this._ready) return;
    const patterns = [
      'gs:lookup:*',
      'gs:title_alias:*',
      'gs:prefix:*',
      'ga:alias:*',
      'ch:*:gsongs',
    ];
    for (const pattern of patterns) {
      await this.scanAndDelete(pattern);
    }
    // Separately flush per-song keys (hash + sortedset)
    await this.scanAndDelete('gs:*:channels');
    await this.scanAndDelete('gs:*:categories');
  }

  /**
   * Scan all `gs:{id}:channels` HASH keys and yield every
   * { globalSongId, channelId, songId } mapping. Used by the backfill
   * service to populate Song.globalSongId from the Redis index.
   */
  async *scanAllChannelMappings(): AsyncGenerator<{
    globalSongId: number;
    channelId: number;
    songId: number;
  }> {
    if (!this.client || !this._ready) return;
    const iter = this.client.scanIterator({
      MATCH: 'gs:*:channels',
      COUNT: 500,
    });
    for await (const key of iter) {
      const keys = Array.isArray(key) ? key : [key];
      for (const k of keys) {
        // Parse globalSongId from key pattern gs:{id}:channels
        const match = k.match(/^gs:(\d+):channels$/);
        if (!match) continue;
        const globalSongId = parseInt(match[1], 10);
        if (Number.isNaN(globalSongId)) {
          this.logger.warn(
            `scanAllChannelMappings: invalid globalSongId in key ${k}`,
          );
          continue;
        }
        const hash = await this.client.hGetAll(k);
        for (const [chId, sId] of Object.entries(hash)) {
          const channelId = parseInt(chId, 10);
          const songId = parseInt(sId, 10);
          if (Number.isNaN(channelId) || Number.isNaN(songId)) {
            this.logger.warn(
              `scanAllChannelMappings: invalid mapping in ${k}: channelId=${chId}, songId=${sId}`,
            );
            continue;
          }
          yield { globalSongId, channelId, songId };
        }
      }
    }
  }

  /* -------------------------------------------------------------------- */
  /* Merge redirect cache: gs:merged:{loserId} -> winnerId                 */
  /* -------------------------------------------------------------------- */

  async setMergeRedirect(
    loserId: number,
    winnerId: number,
    ttlSeconds: number,
  ): Promise<void> {
    if (!this.client || !this._ready) return;
    await this.client.set(`gs:merged:${loserId}`, String(winnerId), {
      EX: ttlSeconds,
    });
  }

  async getMergeRedirect(loserId: number): Promise<number | null> {
    if (!this.client || !this._ready) return null;
    const raw = await this.client.get(`gs:merged:${loserId}`);
    return raw ? Number(raw) : null;
  }

  /* -------------------------------------------------------------------- */
  /* High-level merge sync used by GlobalSongMergeService after DB commit.  */
  /*                                                                        */
  /* Idempotent enough to be retried on transient Redis failures, but if    */
  /* it fails mid-way the recovery path is a full bootstrap rebuild — the   */
  /* in-DB state is authoritative.                                          */
  /* -------------------------------------------------------------------- */

  async applyMergeSync(args: {
    winnerId: number;
    winnerNormTitle: string;
    newChannelCount: number;
    losers: Array<{
      id: number;
      normTitle: string;
      globalArtistId: number;
      aliasTitles: string[];
    }>;
    mergeRedirectTtlSeconds: number;
  }): Promise<void> {
    if (!this.client || !this._ready) {
      this.logger.warn(
        `applyMergeSync skipped (Redis not ready) — winner=${args.winnerId}. Schedule bootstrap to heal.`,
      );
      return;
    }
    const client = this.client;
    const { winnerId, winnerNormTitle, newChannelCount, losers } = args;

    for (const loser of losers) {
      // 1. Move channel hash: every loser channel entry migrates to winner.
      //    After merge, ch:{channelId}:gsongs gets winner added and loser removed.
      const channels = await client.hGetAll(`gs:${loser.id}:channels`);
      const channelEntries = Object.entries(channels);
      if (channelEntries.length > 0) {
        // Write winner fields first so readers never see a gap.
        await client.hSet(
          `gs:${winnerId}:channels`,
          Object.fromEntries(channelEntries),
        );
        for (const [chId] of channelEntries) {
          await client.sAdd(`ch:${chId}:gsongs`, String(winnerId));
          await client.sRem(`ch:${chId}:gsongs`, String(loser.id));
        }
      }
      await client.del(`gs:${loser.id}:channels`);

      // 2. Drop loser's own lookup key (winner's lookup is already correct).
      await client.del(
        `gs:lookup:${this.safe(loser.normTitle)}:${loser.globalArtistId}`,
      );

      // 3. Title aliases: loser → winner in every alias set.
      for (const alias of loser.aliasTitles) {
        await client.sRem(
          `gs:title_alias:${this.safe(alias)}`,
          String(loser.id),
        );
        await client.sAdd(
          `gs:title_alias:${this.safe(alias)}`,
          String(winnerId),
        );
      }

      // 4. Prefix zset: remove loser.
      const loserPrefix = loser.normTitle.slice(0, 2);
      if (loserPrefix.length > 0) {
        await client.zRem(
          `gs:prefix:${this.safe(loserPrefix)}`,
          String(loser.id),
        );
      }

      // 5. Category zset union: merge loser into winner, then delete loser's.
      const loserCatKey = `gs:${loser.id}:categories`;
      const winnerCatKey = `gs:${winnerId}:categories`;
      const loserCatExists = await client.exists(loserCatKey);
      if (loserCatExists > 0) {
        await client.zUnionStore(winnerCatKey, [winnerCatKey, loserCatKey]);
        await client.del(loserCatKey);
      }

      // 6. Item similarity (CF output): drop; rebuilt on next CF run.
      await client.del(`gs:${loser.id}:similar_items`);

      // 7. Redirect cache.
      await this.setMergeRedirect(
        loser.id,
        winnerId,
        args.mergeRedirectTtlSeconds,
      );
    }

    // 8. Winner prefix score reflects recomputed DB channelCount.
    const winnerPrefix = winnerNormTitle.slice(0, 2);
    if (winnerPrefix.length > 0) {
      await client.zAdd(`gs:prefix:${this.safe(winnerPrefix)}`, {
        score: newChannelCount,
        value: String(winnerId),
      });
    }
  }

  private async scanAndDelete(pattern: string): Promise<void> {
    if (!this.client) return;
    const iter = this.client.scanIterator({ MATCH: pattern, COUNT: 500 });
    const batch: string[] = [];
    for await (const key of iter) {
      // node-redis v5 returns `string` (or string[] in batched mode); handle both
      if (Array.isArray(key)) {
        batch.push(...key);
      } else {
        batch.push(key);
      }
      if (batch.length >= 500) {
        await this.client.del(batch.splice(0));
      }
    }
    if (batch.length > 0) {
      await this.client.del(batch);
    }
  }

  /**
   * Generic raw GET / SET. Used by admin-side caches (fuzzy clusters etc.)
   * that need plain JSON storage outside the canonical key families.
   */
  async rawGet(key: string): Promise<string | null> {
    if (!this._ready || !this.client) return null;
    try {
      const v = await this.client.get(key);
      return typeof v === 'string' ? v : null;
    } catch (e) {
      this.logger.warn(
        `rawGet failed key=${key}: ${e instanceof Error ? e.message : e}`,
      );
      return null;
    }
  }

  async rawSetEx(
    key: string,
    ttlSeconds: number,
    value: string,
  ): Promise<void> {
    if (!this._ready || !this.client) return;
    try {
      await this.client.set(key, value, { EX: ttlSeconds });
    } catch (e) {
      this.logger.warn(
        `rawSetEx failed key=${key}: ${e instanceof Error ? e.message : e}`,
      );
    }
  }

  /**
   * Sanitize user-derived content for safe use in Redis keys.
   * Prevents key namespace collision from `:` and SCAN pattern
   * disruption from `*` or `?` in normalized titles/aliases.
   */
  private safe(value: string): string {
    return value.replace(/[:\*\?\n\0]/g, '_');
  }

  private lookupKey(normTitle: string, globalArtistId: number): string {
    return `gs:lookup:${this.safe(normTitle)}:${globalArtistId}`;
  }
}
